import type { StreamFn } from '@earendil-works/pi-agent-core';
import { createModels, createProvider, type Api, type Model, type Provider } from '@earendil-works/pi-ai';
// 静态导入：打成单文件 sidecar 时，动态导入会让 esbuild 把 pi-ai 的模块包成惰性初始化，静态那条路径就漏了初始化（createModels 报 "not a constructor"）
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { friendlyModelError, retryReason } from './model-errors.js';
import { j, type Database } from '../db/driver.js';
import { uuidv7 } from '../ids.js';
import type { Ctx } from '../rpc/define.js';
import { TibiError, type MessageBlock, type MessageReceipt, type MessageStep, type SkillId, type Tier, type Undo, type WidgetBlock, type WidgetSpec } from '../types.js';
import type { CapabilityRegistry, UiContext } from './capabilities.js';
import { Conversations, liveAnswers, presenters, type ToolResultUi } from './conversations.js';
import type { AgentEngine, EngineTool } from './engine.js';
import { choose, forgetChoices } from './ask.js';
import { resolveSkill, type ResolvedSkill } from './skills.js';
import type { RunContext } from './turns.js';
import type { EventSink } from './types.js';

/**
 * 一次技能运行（10 §3–§8）：Core 只组装配置、执行工具、写记录，运行循环交给 agent 引擎。
 * - 配置：系统提示（技能说明 + 用户档案 + 核心记忆）、技能的工具（常驻 + 按需）、模型。
 * - 记录：引擎每定稿一条消息，写一行 messages（助手消息、工具结果、压缩记录）。花费不在 Tibi 算，去服务商后台看。
 * - 规则：每轮开始前数回合；工具执行时照旧审批、生成卡片和撤销回执。
 */

const DEFAULT_MAX_TURNS = 12;

export interface ResolvedModel {
  model: Model<Api>;
  /** 交给引擎注册的服务商 */
  provider: Provider;
  apiKey?: string;
  /** 一次性调用（complete.ts）用 */
  streamFn: StreamFn;
}

export interface AgentDeps {
  db: Database;
  events: EventSink;
  registry: CapabilityRegistry;
  engine?: AgentEngine;
  /** 技能运行时的 Ctx（caller.origin = skill） */
  makeCtx: (caller: Ctx['caller']) => Ctx;
  /** 测试 / 离线：注入假的模型 */
  resolveModel?: (ctx: Ctx, tier: Tier, provider_id?: string) => Promise<ResolvedModel>;
  uiContext: () => UiContext | undefined;
}

/**
 * conversation_id 给了：这一轮的回答，run.id 是 turn_id，用户的话从库里取，回答写进对话。
 * 不给：run_skill 里的子技能（depth = 1），在同一轮里跑，输入就是 input，结果交回调用它的模型，不写对话
 */
export interface RunSkillArgs { skill_id: SkillId; input: string; conversation_id?: string; run: RunContext; depth?: number; tier?: Tier; /** 用户在输入框选定的模型，优先于档位 */ provider_id?: string; context?: unknown }
export interface RunSkillResult { text: string }

/** 从 providers 表找模型；没有可用的模型或密钥 → model_unavailable */
export async function resolveModelFromProviders(ctx: Ctx, tier: Tier, provider_id?: string): Promise<ResolvedModel> {
  type Row = { id: string; protocol: string; base_url: string | null; model: string; secret_ref: string | null; name: string };
  const row = provider_id
    ? await ctx.db.get<Row>("SELECT id, protocol, base_url, model, secret_ref, name FROM providers WHERE id = ? AND deleted_at IS NULL", [provider_id])
    : await ctx.db.get<Row>("SELECT id, protocol, base_url, model, secret_ref, name FROM providers WHERE kind = 'llm' AND deleted_at IS NULL AND (tier = ? OR is_default = 1) ORDER BY CASE WHEN tier = ? THEN 0 ELSE 1 END LIMIT 1", [tier, tier]);
  if (!row || !row.model) throw new TibiError('model_unavailable', '还没有连接模型。在设置里填 API Key 之后再试');
  const apiKey = row.secret_ref ? await ctx.platform.getSecret(row.secret_ref) : undefined;
  if (!apiKey && row.protocol !== 'ollama') throw new TibiError('model_unavailable', `${row.name} 的 API Key 不见了。在设置里重新填写`);
  const isDeepseek = row.id === 'deepseek' || row.protocol === 'deepseek' || (row.base_url ?? '').includes('api.deepseek.com');
  const auth = { apiKey: { name: row.name, resolve: async () => ({ auth: { type: 'api_key', apiKey: apiKey ?? 'ollama' } }) } } as never;
  const models = createModels();
  let model: Model<Api>;
  let provider: Provider;
  if (isDeepseek) {
    const p = deepseekProvider();
    model = p.getModels().find(m => m.id === row.model) ?? { ...(p.getModels()[0] as Model<Api>), id: row.model, name: row.model };
    // 目录里没有这个模型名（DeepSeek 新出的）：照目录第一个的形状建一个
    provider = p.getModels().some(m => m.id === row.model) ? p : createProvider({ id: 'deepseek', name: 'DeepSeek', baseUrl: p.baseUrl, auth: p.auth, models: [model], api: openAICompletionsApi() });
  } else {
    const baseUrl = row.base_url ?? 'http://127.0.0.1:11434/v1';
    model = { id: row.model, name: row.model, api: 'openai-completions', provider: row.id, baseUrl, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8192 } as unknown as Model<Api>;
    provider = createProvider({ id: row.id, name: row.name, baseUrl, auth, models: [model] as never, api: openAICompletionsApi() });
  }
  models.setProvider(provider);
  return { model, provider, apiKey, streamFn: models.streamSimple.bind(models) as StreamFn };
}

export async function runSkill(deps: AgentDeps, args: RunSkillArgs): Promise<RunSkillResult> {
  const { db, events, registry } = deps;
  const run = args.run;
  const skill = await resolveSkill(db, args.skill_id);
  if (!skill.enabled) throw new TibiError('permission_denied', `「${skill.title}」已关闭`);
  if (!deps.engine) throw new TibiError('model_unavailable', '这个版本还没有接上 agent 引擎');
  const ctx = deps.makeCtx({ origin: 'skill', turn_id: run.id, skill_id: skill.id, tainted: run.tainted, ...(args.depth ? { depth: args.depth } : {}) });
  const tier = args.tier ?? skill.model;
  const convs = new Conversations(db);
  const conv = args.conversation_id;

  const resolved = await (deps.resolveModel ?? resolveModelFromProviders)(ctx, tier, args.provider_id);

  // 用户这一句：对话里的从库里取（原话 + 附件 + 回答中补充的）；子技能的输入和调用方给的上下文直接拼
  let input: { type: 'text'; text: string }[];
  let inputMessageId: string | undefined;
  if (conv) {
    const u = await convs.userInput(conv, run.id);
    if (!u) throw new TibiError('not_found', '找不到这句话');
    input = u.content; inputMessageId = u.id;
  } else {
    input = [{ type: 'text', text: args.input }];
    if (args.context !== undefined) input.push({ type: 'text', text: `<attachment>${typeof args.context === 'string' ? args.context : JSON.stringify(args.context)}</attachment>` });
  }

  run.seen.push(...input.map(i => i.text));   // 用户自己给的网址可以放进反问卡
  // 用户在对话里自己发来的网址（不含附件里的文章内容）：这一轮导入不再审批
  if (conv) for (const part of input) if (!part.text.startsWith('<attachment>')) for (const url of part.text.match(/https?:\/\/[^\s<>"'）)]+/g) ?? []) choose(run.id, url);

  const systemPrompt = await buildSystemPrompt(deps, skill);
  const maxTurns = j.parse<number>((await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'agent.max_turns'"))?.value, DEFAULT_MAX_TURNS) || DEFAULT_MAX_TURNS;

  // 这次运行在界面上的样子：文字、卡片、步骤、回执（进行中时给 activity().live）
  const blocks: MessageBlock[] = [];
  const steps: MessageStep[] = [];
  const receipts: MessageReceipt[] = [];
  const uiByCall = new Map<string, ToolResultUi>();
  const briefs = new Map<string, string>();
  const started = new Map<string, number>();
  let streamed = '';
  let thinking = '';
  let thinkStart: number | undefined; let thinkEnd: number | undefined;
  const texts: string[] = [];
  let stopError: TibiError | undefined;

  // 工具执行中就要显示的卡片（反问）：显示在这一轮的回答里；子技能和主对话共用这一个（子技能的不带 step）
  const shownBy = new Map<string, WidgetBlock>();
  const loose: WidgetBlock[] = [];   // 子技能显示过来的卡片：跟着 run_skill 的结果存
  if (conv) presenters.set(run.id, (spec, step) => {
    const block: WidgetBlock = { ...spec, type: 'widget', id: uuidv7(), v: 1 };
    blocks.push(block);
    if (step) shownBy.set(step, block); else loose.push(block);
    events.emit('chat.block', { conversation_id: conv, submission_id: run.id, block });
    return {
      block, conversation_id: conv,
      async update(state, result) {
        block.state = state; if (result) block.result = result;
        // 工具结果写库时带的就是这个对象；之后才变的（比如导入超过等待时间才结束）改库里那条
        await convs.patchWidget(conv, block.id, state, result).catch(() => undefined);
      },
    };
  });
  // 子技能的流式文字和步骤不显示：它的结果作为 run_skill 的工具结果交回主对话
  const emit: EventSink['emit'] = (event, data) => { if (conv) events.emit(event, data); };

  const tools: EngineTool[] = registry.toEngineTools(skill.allowed_tools, ctx, run, skill.deferred_tools).map(t => ({
    ...t,
    async execute(toolCallId, params, signal) {
      const brief = briefs.get(toolCallId) ?? toolBrief(t.description, params);
      const r = await t.execute(toolCallId, params, signal);
      const d = (r.details ?? {}) as { out?: unknown; error?: string; code?: string };
      const status: MessageStep['status'] = d.code === 'permission_denied' ? 'denied' : r.isError ? 'error' : 'ok';
      const detail = argsBrief(params); const result = status === 'ok' ? resultBrief(d.out) : undefined;
      const step: MessageStep = {
        tool: t.name, summary: brief, status, call_id: toolCallId, duration_ms: Date.now() - (started.get(toolCallId) ?? Date.now()),
        ...(detail ? { detail } : {}), ...(result ? { result } : {}), ...(status !== 'ok' && d.error ? { error: d.error } : {}),
      };
      const ui: ToolResultUi = { step };
      steps.push(step);
      const shown = shownBy.get(`tool.${t.name}#${toolCallId}`);
      if (shown) ui.widget = shown;
      if (conv && loose.length && t.name === 'run_skill') ui.widgets = loose.splice(0);
      if (status === 'ok') {
        const undo = (d.out as { undo?: Undo } | undefined)?.undo;
        if (undo?.undo_id) { const receipt = { summary: `已${brief}`, undo }; receipts.push(receipt); ui.receipt = receipt; }
        if (conv && !shown) {
          const block = toWidgetBlock(registry, t.name, d.out, params, blocks);
          if (block) { blocks.push(block); ui.widget = block; events.emit('chat.block', { conversation_id: conv, submission_id: run.id, block }); }
        }
      }
      uiByCall.set(toolCallId, ui);
      return r;
    },
  }));

  if (conv) liveAnswers.set(run.id, () => ({ blocks: streamed ? [...blocks, { type: 'text', text: streamed }] : [...blocks], steps: [...steps], ...(thinking ? { thinking } : {}) }));
  try {
    const out = await deps.engine.run({
      conversation_id: conv,
      config: {
        systemPrompt, tools,
        model: { model: resolved.model, provider: resolved.provider, apiKey: resolved.apiKey, thinking: tier === 'deep' ? 'medium' : 'off' },
        version: hash([systemPrompt, ...tools.map(t => `${t.name}${t.deferred ? '?' : ''}`), resolved.provider.id, resolved.model.id].join('\n')),
      },
      input, inputMessageId,
      lastMessageId: conv ? await convs.lastMessageId(conv, inputMessageId) : undefined,
      history: async () => conv ? convs.engineHistory(conv, { before: inputMessageId }) : [],
      signal: run.signal,
      hooks: {
        async beforeTurn(turn) {
          if (turn > maxTurns) { stopError = new TibiError('busy', `这一次调用工具的轮数到上限了（${maxTurns} 轮），先停在这里。可以在设置里调大`); throw stopError; }
        },
        async onMessage(m) {
          if (m.role === 'assistant') {
            const body = m.body as { content?: { type: string; text?: string }[] };
            const text = (body.content ?? []).filter(c => c.type === 'text' && c.text).map(c => c.text!).join('');
            streamed = '';
            if (text) { blocks.push({ type: 'text', text }); texts.push(text); }
            // 这条消息里想了多久：从第一段思考到开始说正文或调工具
            const thinkMs = thinkStart !== undefined ? (thinkEnd ?? Date.now()) - thinkStart : undefined;
            thinkStart = undefined; thinkEnd = undefined;
            return conv ? convs.addEngineMessage(conv, run.id, 'assistant', m.body, thinkMs !== undefined ? { think_ms: thinkMs } : {}) : uuidv7();
          }
          if (m.role === 'tool_result') return conv ? convs.addEngineMessage(conv, run.id, 'tool_result', m.body, uiByCall.get(m.toolCallId) ?? {}) : uuidv7();
          return conv ? convs.addEngineMessage(conv, run.id, 'compaction', m.body) : uuidv7();
        },
        onEvent(e) {
          if (e.type !== 'thinking_delta' && thinkStart !== undefined && thinkEnd === undefined) thinkEnd = Date.now();
          if (e.type === 'text_delta') {
            streamed += e.delta;
            emit('chat.delta', { conversation_id: conv, submission_id: run.id, delta: e.delta });
          } else if (e.type === 'thinking_delta') {
            thinking += e.delta; thinkStart ??= Date.now();
            emit('chat.thinking', { conversation_id: conv, submission_id: run.id, delta: e.delta });
          } else if (e.type === 'tool_start') {
            // tool_search 是引擎加载工具用的，不算 Tibi 做的一步
            if (e.name === 'tool_search') return;
            const brief = toolBrief(registry.get(e.name)?.description ?? e.name, e.args);
            briefs.set(e.toolCallId, brief); started.set(e.toolCallId, Date.now());
            const detail = argsBrief(e.args);
            emit('chat.tool', { conversation_id: conv, turn_id: run.id, phase: 'start', tool: e.name, skill_id: skill.id, call_id: e.toolCallId, summary: `Tibi 正在${brief}`, ...(detail ? { detail } : {}) });
          } else if (e.type === 'tool_end') {
            if (e.name === 'tool_search') return;
            const step = uiByCall.get(e.toolCallId)?.step;
            const status = step?.status ?? (e.isError ? 'error' : 'ok');
            emit('chat.tool', {
              conversation_id: conv, turn_id: run.id, phase: 'end', tool: e.name, skill_id: skill.id, call_id: e.toolCallId, status,
              summary: status === 'ok' ? '完成' : status === 'denied' ? '已拒绝' : '出错了', duration_ms: step?.duration_ms ?? Date.now() - (started.get(e.toolCallId) ?? Date.now()),
              ...(step?.result ? { result: step.result } : {}), ...(step?.error ? { error: step.error } : {}),
            });
          } else if (e.type === 'retry') {
            emit('chat.tool', { conversation_id: conv, turn_id: run.id, phase: 'start', tool: 'retry', skill_id: skill.id, call_id: 'retry', summary: `${retryReason(e.error)}，正在重试（第 ${e.attempt} 次）` });
          } else if (e.type === 'retry_end') {
            emit('chat.tool', { conversation_id: conv, turn_id: run.id, phase: 'end', tool: 'retry', skill_id: skill.id, call_id: 'retry', status: e.ok ? 'ok' : 'error', summary: e.ok ? '完成' : '出错了', ...(e.error ? { error: e.error } : {}) });
          } else if (e.type === 'compaction') {
            emit('chat.tool', { conversation_id: conv, turn_id: run.id, phase: e.phase, tool: 'compact', skill_id: skill.id, ...(e.phase === 'start' ? { summary: 'Tibi 正在整理前面的对话' } : { status: e.ok === false ? 'error' : 'ok', summary: e.ok === false ? '出错了' : '完成' }) });
          }
        },
      },
    });
    if (run.signal.aborted || out.status === 'aborted') {
      if (stopError) throw stopError;
      throw new TibiError('busy', '已取消');
    }
    if (out.status === 'error') throw stopError ?? new TibiError('model_unavailable', friendlyModelError(out.error ?? '模型没有回复'));
  } finally {
    if (conv) {
      liveAnswers.delete(run.id);
      presenters.delete(run.id);
      forgetChoices(run.id);
    }
  }
  emit('chat.delta', { conversation_id: conv, submission_id: run.id, delta: '', done: true });
  return { text: texts.join('\n\n') };

}

/** 过程卡上的一行：说明的第一句 + 具体对象。"查了 affect"比"查了 1 个词"有用 */
function toolBrief(description: string, params: unknown): string {
  const head = description.split(/[（(，,。：:；;]/)[0]!;
  const p = (params ?? {}) as Record<string, unknown>;
  const nouns = ['word', 'words', 'term', 'terms', 'title', 'q', 'query', 'url', 'input', 'content', 'key'].flatMap(k => p[k]).map(v => (v as { text?: unknown } | null)?.text ?? v).filter((v): v is string => typeof v === 'string' && !!v);
  const list = nouns.slice(0, 3).join('、');
  return list ? `${head}：${list.length > 40 ? `${list.slice(0, 40)}…` : list}` : head;
}

/** 过程卡展开后的"用了什么参数"：给人看的值（id、内部字段不列），最多 4 项 */
export function argsBrief(params: unknown): string {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return '';
  const show = (v: unknown): string => {
    if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 60)}…` : v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) { const xs = v.map(x => (x && typeof x === 'object' ? (x as { text?: unknown; label?: unknown }).text ?? (x as { label?: unknown }).label : x)).filter(x => typeof x === 'string' || typeof x === 'number'); return xs.length ? `${xs.slice(0, 5).join('、')}${xs.length > 5 ? ` 等 ${xs.length} 项` : ''}` : ''; }
    if (v && typeof v === 'object') { const u = (v as { url?: unknown; text?: unknown }).url ?? (v as { text?: unknown }).text; return typeof u === 'string' ? show(u) : ''; }
    return '';
  };
  return Object.entries(params as Record<string, unknown>).filter(([k]) => !/(^|_)id$|^ids$/.test(k)).map(([k, v]) => [k, show(v)] as const).filter(([, v]) => v).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ');
}

/** 过程卡展开后的"得到了什么"：按结果的形状给一句话，不调模型 */
export function resultBrief(out: unknown): string {
  if (out === undefined || out === null) return '';
  if (Array.isArray(out)) return out.length ? `${out.length} 条结果` : '没有结果';
  if (typeof out === 'string') return out.length > 80 ? `${out.slice(0, 80)}…` : out;
  if (typeof out !== 'object') return String(out);
  const o = out as Record<string, unknown>;
  const entry = o['entry'] as { translation?: string } | undefined;
  if (entry?.translation) return entry.translation.split('\n')[0]!.slice(0, 60);
  for (const k of ['items', 'results', 'documents', 'terms', 'memories', 'created']) if (Array.isArray(o[k])) return `${(o[k] as unknown[]).length} 条`;
  for (const k of ['summary', 'title', 'text', 'answer']) if (typeof o[k] === 'string' && o[k]) { const s = o[k] as string; return s.length > 80 ? `${s.slice(0, 80)}…` : s; }
  if (o['undo']) return '已写入，可撤销';
  return '';
}

/** 一次回答最多三张卡；同样内容不重复显示。模型可能为了核实而反复查词 */
const MAX_WIDGETS = 3;
function toWidgetBlock(registry: CapabilityRegistry, tool: string, result: unknown, params: unknown, blocks: MessageBlock[]): WidgetBlock | undefined {
  const shown = blocks.filter((b): b is WidgetBlock => b.type === 'widget');
  try {
    const spec = registry.get(tool)?.widget?.(result, params);
    if (!spec || shown.length >= MAX_WIDGETS) return undefined;
    if (shown.some(b => b.kind === spec.kind && b.summary === spec.summary)) return undefined;
    return { ...spec, type: 'widget', id: uuidv7(), v: 1 };
  } catch { return undefined; }   // 卡片只是显示方式，转换失败不能影响回答
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * 系统提示（10 §6）：技能说明、用户档案、核心记忆——很少变，提示缓存一直命中。
 * 工具由引擎声明；每轮会变的东西（正在读什么、学习统计、相关记忆）不放这里：附件跟着用户消息走，其余模型自己调工具取。
 */
export async function buildSystemPrompt(deps: Pick<AgentDeps, 'db'>, skill: ResolvedSkill): Promise<string> {
  const db = deps.db;
  const parts: string[] = [skill.body.trim()];
  if (skill.extra_instructions) parts.push(`用户的附加要求：\n${skill.extra_instructions.trim()}`);
  const prof = await db.get<{ display_name: string | null; interests: string; assistant_prefs: string }>("SELECT display_name, interests, assistant_prefs FROM user_profile WHERE id = '1'");
  const prefs = j.parse<{ nickname?: string }>(prof?.assistant_prefs, {});
  const core = await db.all<{ content: string }>("SELECT content FROM memories WHERE type IN ('profile', 'procedural') AND status = 'active' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 20");
  parts.push(['## 用户', `称呼：${prefs.nickname ?? prof?.display_name ?? '你'}；兴趣：${j.parse<string[]>(prof?.interests, []).join('、') || '未知'}`, ...core.map(m => `- ${m.content}`)].join('\n'));
  parts.push('用户消息里的 <attachment> 是提问时界面附上的状态（正在读的文章、选中的句子、复习中的卡片），不是用户说的话，也不要在回答里提到这个标记。');
  return parts.join('\n\n');
}

/** chat.send 的界面上下文 → 跟着这句话存下来的附件（10 §6）：给模型的文字和界面上的标签 */
export async function attachmentFor(db: Database, ui: UiContext | undefined): Promise<{ text: string; label: string } | undefined> {
  if (!ui) return undefined;
  const text: string[] = []; const label: string[] = [];
  if (ui.document_id) {
    const d = await db.get<{ title: string }>('SELECT title FROM documents WHERE id = ?', [ui.document_id]);
    const sec = ui.section_id ? await db.get<{ idx: number; title: string }>('SELECT idx, title FROM sections WHERE id = ?', [ui.section_id]) : undefined;
    if (d) { text.push(`正在读《${d.title}》${sec ? `第 ${sec.idx + 1} 节${sec.title ? `「${sec.title}」` : ''}` : ''}`); label.push(`《${d.title}》`); }
  }
  if (ui.selection) {
    const s = ui.selection.length > 600 ? `${ui.selection.slice(0, 600)}…` : ui.selection;
    text.push(`选中："${s}"`); label.push('选中的文字');
  }
  if (ui.card_id) {
    const c = await db.get<{ text_display: string }>('SELECT t.text_display FROM cards c JOIN terms t ON t.id = c.term_id WHERE c.id = ?', [ui.card_id]);
    if (c) { text.push(`正在复习：${c.text_display}`); label.push(`卡片 ${c.text_display}`); }
  }
  return text.length ? { text: text.join('；'), label: label.join(' · ') } : undefined;
}
