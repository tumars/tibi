import type { Database } from '../db/driver.js';
import { memoryCapabilities, memoryMethods } from '../domain/memory/index.js';
import type { CapabilityMap, Ctx, MethodMap } from '../rpc/define.js';
import { TibiError, type SkillId } from '../types.js';
import { runSkill, type AgentDeps, type ResolvedModel } from './agent.js';
import { builtinCapabilities, CapabilityRegistry, type UiContext } from './capabilities.js';
import { JobRunnerImpl } from './jobs.js';
import { chatMethods, taskMethods } from './methods.js';
import { makeSkillMethods } from './skills.js';
import type { EventSink, JobContext } from './types.js';

export * from './jobs.js';
export * from './capabilities.js';
export * from './conversations.js';
export * from './usage.js';
export * from './skills.js';
export { runSkill, buildSystemPrompt, resolveModelFromProviders, type AgentDeps, type ResolvedModel, type RunSkillArgs, type RunSkillResult } from './agent.js';
export { chatMethods, taskMethods } from './methods.js';

/**
 * TibiKernel（05 §6，R9 自建）：任务运行器 + 能力注册表 + pi 桥接 + 对话 / 任务 / 技能 / 记忆方法。
 *
 * 用法（主线接线）：
 *   const kernel = createKernel(db, events, { resolveModel? });
 *   const core = new Core({ db, dict, platform, jobs: kernel.jobs });
 *   kernel.bind(caller => core.ctx(caller), core.events);   // 技能运行时需要 Ctx；事件改发到 Core 的总线
 *   kernel.registerCapabilities({ ...textCaps, ...reviewCaps });   // 各领域的能力
 *   core.use(kernel.methods);                        // chat.* tasks.* skills.* memory.*
 *   jobs.register('import', importPipeline) 由导入流水线自己注册；
 *   await kernel.jobs.resumeAll();                   // 启动时续跑
 */
export interface KernelOptions { resolveModel?: AgentDeps['resolveModel']; device?: 'desktop' | 'mobile' }

export interface Kernel {
  jobs: JobRunnerImpl;
  registry: CapabilityRegistry;
  methods: MethodMap;
  bind(makeCtx: (caller: Ctx['caller']) => Ctx, events?: EventSink): void;
  registerCapabilities(map: CapabilityMap): void;
  /** 运行一项技能并等结果（run_skill wait=true、skills.runNow 的内部实现也走任务） */
  runSkillJob(args: { skill_id: SkillId; input: string; conversation_id?: string; context?: unknown; parent_job_id?: string; trigger?: 'user' | 'auto' | 'mcp' | 'share'; wait?: boolean }): Promise<{ task_id: string; result?: string }>;
  uiContext(): UiContext | undefined;
  setUiContext(c: UiContext | undefined): void;
}

/** 事件先发到 createKernel 传入的总线；bind() 时可以换成 Core 的总线（Core 自己 new 了一个 EventBus） */
class ForwardingSink implements EventSink {
  constructor(public target: EventSink) {}
  emit(event: Parameters<EventSink['emit']>[0], data: unknown) { this.target.emit(event, data); }
}

export function createKernel(db: Database, initialEvents: EventSink, opts: KernelOptions = {}): Kernel {
  const events = new ForwardingSink(initialEvents);
  const runner = new JobRunnerImpl(db, events);
  const registry = new CapabilityRegistry(db, runner);
  let makeCtx: ((caller: Ctx['caller']) => Ctx) | undefined;
  let ui: UiContext | undefined;
  const needCtx = () => { if (!makeCtx) throw new Error('kernel.bind() 还没调用'); return makeCtx; };

  const agentDeps: AgentDeps = { db, events, registry, runner, makeCtx: caller => needCtx()(caller), resolveModel: opts.resolveModel, uiContext: () => ui };

  // 'skill' 流水线：一次技能运行（主对话、run_skill、skills.runNow 都走它）
  runner.register('skill', async (job: JobContext, input: { skill_id: SkillId; input: string; conversation_id?: string; tier?: 'fast' | 'deep'; context?: unknown }) => {
    const r = await runSkill(agentDeps, { skill_id: input.skill_id, input: input.input, conversation_id: input.conversation_id, tier: input.tier, context: input.context, job });
    return { text: r.text, usage: r.usage, summary: r.text.slice(0, 80) };
  });

  const runSkillJob: Kernel['runSkillJob'] = async a => {
    const { task_id } = await runner.submit('skill', { kind: 'skill', skill_id: a.skill_id, parent_job_id: a.parent_job_id, conversation_id: a.conversation_id, title: a.input.slice(0, 40), trigger: a.trigger ?? 'user', input: { skill_id: a.skill_id, input: a.input, conversation_id: a.conversation_id, context: a.context } });
    if (!a.wait) return { task_id };
    const r = await runner.wait(task_id, 5 * 60_000);
    if (r.status !== 'done') throw new TibiError(r.status === 'deferred' ? 'model_unavailable' : 'busy', r.error ?? `技能没有完成（${r.status}）`);
    return { task_id, result: (r.output as { text?: string } | undefined)?.text };
  };

  registry.register(builtinCapabilities({
    db, registry, runner, uiContext: () => ui,
    runSkill: a => runSkillJob({ skill_id: a.skill_id, input: a.input, context: a.context, wait: a.wait, parent_job_id: a.parent.caller.job_id, trigger: a.parent.caller.origin === 'mcp' ? 'mcp' : 'auto' }),
  }));
  registry.register(memoryCapabilities);

  const methodDeps = { db, runner, setUiContext: (c: UiContext | undefined) => { ui = c; } };
  const methods: MethodMap = {
    ...chatMethods(methodDeps),
    ...taskMethods(methodDeps),
    ...makeSkillMethods((skill_id, input) => runSkillJob({ skill_id, input, trigger: 'user' })),
    ...memoryMethods,
  };

  return {
    jobs: runner, registry, methods,
    bind(fn, ev) { makeCtx = fn; if (ev) events.target = ev; },
    registerCapabilities(map) { registry.register(map); },
    runSkillJob,
    uiContext: () => ui,
    setUiContext: c => { ui = c; },
  };
}

export type { ResolvedModel as KernelResolvedModel };
