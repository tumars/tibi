import type { Database } from '../db/driver.js';
import { memoryCapabilities, memoryMethods } from '../domain/memory/index.js';
import type { CapabilityMap, Ctx, MethodMap } from '../rpc/define.js';
import { TibiError, type SkillId } from '../types.js';
import { resolveModelFromProviders, runSkill, type AgentDeps, type ResolvedModel } from './agent.js';
import { completeOnce, type CompleteOptions, type CompleteResult } from './complete.js';
import { askCapabilities } from './ask.js';
import { builtinCapabilities, CapabilityRegistry, type UiContext } from './capabilities.js';
import { Conversations } from './conversations.js';
import { approvalMethods, chatMethods, submitTurn, type TurnOptions } from './methods.js';
import { makeSkillMethods } from './skills.js';
import { makeMcpMethods } from './mcp.js';
import { errMsg, Turns } from './turns.js';
import type { EventSink } from './types.js';
import type { AgentEngine } from './engine.js';

export * from './turns.js';
export * from './capabilities.js';
export * from './conversations.js';
export * from './skills.js';
export { runSkill, buildSystemPrompt, resolveModelFromProviders, attachmentFor, type AgentDeps, type ResolvedModel, type RunSkillArgs, type RunSkillResult } from './agent.js';
export * from './engine.js';
export { chatMethods, approvalMethods, submitTurn } from './methods.js';

/**
 * TibiKernel（05 §6）：进行中的回答 + 能力注册表 + pi 桥接 + 对话 / 技能 / 记忆方法。
 * 没有"任务"：一轮回答就是对话里的一段消息，跑着的时候在内存里（turns.ts）。
 *
 * 用法（主线接线）：
 *   const kernel = createKernel(db, events, { resolveModel? });
 *   const core = new Core({ db, dict, platform });
 *   kernel.bind(caller => core.ctx(caller), core.events);   // 技能运行时需要 Ctx；事件改发到 Core 的总线
 *   kernel.registerCapabilities({ ...textCaps, ...reviewCaps });   // 各领域的能力
 *   core.use(kernel.methods);                        // chat.* approvals.* skills.* memory.* mcp.*
 *   await kernel.recover();                          // 启动时：上次没答完的记成中断
 */
export interface KernelOptions {
  resolveModel?: AgentDeps['resolveModel'];
  device?: 'desktop' | 'mobile';
  /** agent 引擎（10 §3）：桌面端是 core-node 的 PiEngine；不给时技能运行报 model_unavailable */
  engine?: AgentEngine;
}

export interface Kernel {
  turns: Turns;
  registry: CapabilityRegistry;
  methods: MethodMap;
  bind(makeCtx: (caller: Ctx['caller']) => Ctx, events?: EventSink): void;
  registerCapabilities(map: CapabilityMap): void;
  /** 在一段对话里开一轮回答（技能直接运行、测试用）；返回 turn_id */
  send(conversation_id: string, text: string, o?: Partial<TurnOptions>): Promise<string>;
  /** 启动时调用：上次退出时还没答完的回答记成中断 */
  recover(): Promise<number>;
  uiContext(): UiContext | undefined;
  setUiContext(c: UiContext | undefined): void;
  /** 一次性模型调用（Core.ai 指向它） */
  complete(ctx: Ctx, o: CompleteOptions): Promise<CompleteResult>;
}

/** 事件先发到 createKernel 传入的总线；bind() 时可以换成 Core 的总线（Core 自己 new 了一个 EventBus） */
class ForwardingSink implements EventSink {
  constructor(public target: EventSink) {}
  emit(event: Parameters<EventSink['emit']>[0], data: unknown) { this.target.emit(event, data); }
}

export function createKernel(db: Database, initialEvents: EventSink, opts: KernelOptions = {}): Kernel {
  const events = new ForwardingSink(initialEvents);
  const turns = new Turns(db, events);
  const registry = new CapabilityRegistry(db, turns);
  const convs = new Conversations(db);
  let makeCtx: ((caller: Ctx['caller']) => Ctx) | undefined;
  let ui: UiContext | undefined;
  const needCtx = () => { if (!makeCtx) throw new Error('kernel.bind() 还没调用'); return makeCtx; };

  const agentDeps: AgentDeps = { db, events, registry, engine: opts.engine, makeCtx: caller => needCtx()(caller), resolveModel: opts.resolveModel, uiContext: () => ui };

  /** 让这一轮跑起来；结束时把结果记在第一句用户消息上，并告诉界面 */
  const startTurn = (conversation_id: string, turn_id: string, o: TurnOptions & { tainted?: boolean }) => {
    turns.start({ id: turn_id, conversation_id, tainted: o.tainted, onTaint: () => void convs.setTurn(turn_id, { tainted: true }) }, async run => {
      let state: 'done' | 'error' | 'cancel' = 'done'; let error: string | undefined;
      try { await runSkill(agentDeps, { skill_id: o.skill_id, input: '', conversation_id, run, tier: o.tier, provider_id: o.provider_id }); } catch (e) {
        if (run.signal.aborted) state = 'cancel';
        else { state = 'error'; error = errMsg(e); }
      }
      await convs.setTurn(turn_id, { state, ...(error ? { error } : {}) });
      events.emit('chat.end', { conversation_id, submission_id: turn_id, state, ...(error ? { error } : {}) });
    });
  };

  registry.register(builtinCapabilities({
    db, registry, uiContext: () => ui,
    // 子技能在调用方这一轮里跑：共用停止信号、审批和不可信标记
    runSkill: async a => {
      const run = turns.get(a.parent.caller.turn_id);
      if (!run) throw new TibiError('conflict', '这里不能运行技能');
      const r = await runSkill(agentDeps, { skill_id: a.skill_id, input: a.input, context: a.context, run, depth: 1 });
      return { result: r.text };
    },
  }));
  registry.register(askCapabilities({ turns }));
  registry.register(memoryCapabilities);

  const methodDeps = { db, turns, registry, engine: opts.engine, startTurn, setUiContext: (c: UiContext | undefined) => { ui = c; } };
  const send: Kernel['send'] = (conversation_id, text, o = {}) => submitTurn(methodDeps, conversation_id, text, { skill_id: o.skill_id ?? 'tibi', tier: o.tier, provider_id: o.provider_id });
  const methods: MethodMap = {
    ...chatMethods(methodDeps),
    ...approvalMethods(methodDeps),
    ...makeSkillMethods(async (skill_id, input) => {
      const c = await convs.create({ kind: 'skill', title: input.slice(0, 40), skill_id, trigger: 'user' });
      return { conversation_id: c.id, submission_id: await send(c.id, input || '开始', { skill_id }) };
    }),
    ...memoryMethods,
    ...makeMcpMethods({ db, registry, turns, makeCtx: caller => needCtx()(caller) }),
  };

  return {
    turns, registry, methods, send,
    bind(fn, ev) { makeCtx = fn; if (ev) events.target = ev; },
    registerCapabilities(map) { registry.register(map); },
    recover: () => convs.interruptRunning(),
    uiContext: () => ui,
    setUiContext: c => { ui = c; },
    complete: (ctx, o) => completeOnce(ctx, opts.resolveModel ?? resolveModelFromProviders, o),
  };
}

export type { ResolvedModel as KernelResolvedModel };
