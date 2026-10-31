import { Agent, type AgentTool, type StreamFn } from '@earendil-works/pi-agent-core';
import { calculateCost, createModels, createProvider, type Api, type AssistantMessage, type Message, type Model, type Usage } from '@earendil-works/pi-ai';
// 静态导入：打成单文件 sidecar 时，动态导入会让 esbuild 把 pi-ai 的模块包成惰性初始化，静态那条路径就漏了初始化（createModels 报 "not a constructor"）
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { j, now, type Database } from '../db/driver.js';
import type { Ctx } from '../rpc/define.js';
import { TibiError, type SkillId, type Tier } from '../types.js';
import type { CapabilityRegistry, UiContext } from './capabilities.js';
import { Conversations } from './conversations.js';
import type { JobRunnerImpl } from './jobs.js';
import { resolveSkill, type ResolvedSkill } from './skills.js';
import type { EventSink, JobContext } from './types.js';
import { checkBudget, recordUsage, USD_CNY } from './usage.js';

/**
 * pi-agent-core 桥接（05 §5–§6）：一次技能运行 = 一个 Agent；
 * 系统提示按 02 §4 的七个区块组装；工具 = 技能的 allowed-tools 经能力注册表转换；
 * 每轮模型调用记 job_steps(kind=model) 与 usage_records；流式文本与工具调用发 chat.* 事件。
 */

/** 设置里「Tibi 讲解用的语言」→ 写进系统提示的说法 */
const LANG_TEXT: Record<string, string> = { mixed: '中文为主，术语、例句保留英文', zh: '只用中文（英文原句除外）', en: 'English only（用户要求全英文讲解）' };

export interface ResolvedModel { model: Model<Api>; apiKey?: string; streamFn: StreamFn }

export interface AgentDeps {
  db: Database;
  events: EventSink;
  registry: CapabilityRegistry;
  runner: JobRunnerImpl;
  /** 技能运行时的 Ctx（caller.origin = skill） */
  makeCtx: (caller: Ctx['caller']) => Ctx;
  /** 测试 / 离线：注入假的模型与 streamFn */
  resolveModel?: (ctx: Ctx, tier: Tier, provider_id?: string) => Promise<ResolvedModel>;
  uiContext: () => UiContext | undefined;
}

export interface RunSkillArgs { skill_id: SkillId; input: string; conversation_id?: string; job: JobContext; tier?: Tier; context?: unknown }
export interface RunSkillResult { text: string; usage: { tokens_in: number; tokens_out: number; cost: number } }

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
  const models = createModels();
  let model: Model<Api> | undefined;
  if (isDeepseek) {
    const p = deepseekProvider(); models.setProvider(p);
    model = p.getModels().find(m => m.id === row.model) ?? { ...(p.getModels()[0] as Model<Api>), id: row.model, name: row.model };
    if (!p.getModels().some(m => m.id === row.model)) models.setProvider(createProvider({ id: 'deepseek', name: 'DeepSeek', baseUrl: p.baseUrl, auth: p.auth, models: [model], api: openAICompletionsApi() }));
  } else {
    const baseUrl = row.base_url ?? 'http://127.0.0.1:11434/v1';
    model = { id: row.model, name: row.model, api: 'openai-completions', provider: row.id, baseUrl, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8192 } as unknown as Model<Api>;
    models.setProvider(createProvider({ id: row.id, name: row.name, baseUrl, auth: { apiKey: { name: row.name, resolve: async () => ({ auth: { type: 'api_key', apiKey: apiKey ?? 'ollama' } }) } } as never, models: [model] as never, api: openAICompletionsApi() }));
  }
  return { model, apiKey, streamFn: models.streamSimple.bind(models) as StreamFn };
}

export async function runSkill(deps: AgentDeps, args: RunSkillArgs): Promise<RunSkillResult> {
  const { db, events, registry } = deps;
  const job = args.job;
  const skill = await resolveSkill(db, args.skill_id);
  if (!skill.enabled) throw new TibiError('permission_denied', `「${skill.title}」已关闭`);
  const ctx = deps.makeCtx({ origin: 'skill', job_id: job.job_id, skill_id: skill.id, tainted: job.tainted });
  const tier = args.tier ?? skill.model;
  const resolved = await (deps.resolveModel ?? resolveModelFromProviders)(ctx, tier);
  await checkBudget(db, job.job_id);

  const convs = new Conversations(db);
  const systemPrompt = await buildSystemPrompt(deps, ctx, skill, args);
  const history = args.conversation_id ? await convs.recent(args.conversation_id, 20) : [];
  const messages: Message[] = history.filter(m => m.role !== 'tool' && m.text).map(m => m.role === 'user'
    ? { role: 'user', content: m.text!, timestamp: m.created_at }
    : { role: 'assistant', content: [{ type: 'text', text: m.text! }], api: resolved.model.api, provider: resolved.model.provider, model: resolved.model.id, usage: emptyUsage(), stopReason: 'stop', timestamp: m.created_at } as AssistantMessage);
  // 最后一条如果就是这次的输入（chat.send 先写库），不要重复
  if (messages.length && messages[messages.length - 1]!.role === 'user' && (messages[messages.length - 1] as { content: unknown }).content === args.input) messages.pop();

  const tools: AgentTool[] = registry.toAgentTools(skill.allowed_tools, ctx, job);
  const agent = new Agent({
    initialState: { systemPrompt, model: resolved.model, tools, messages },
    streamFn: resolved.streamFn,
    getApiKey: () => resolved.apiKey,
    sessionId: job.job_id,
  });
  registry.liveTools.set(job.job_id, { add: (more) => { const have = new Set(agent.state.tools.map(t => t.name)); agent.state.tools = [...agent.state.tools, ...more.filter(t => !have.has(t.name))]; } });
  const onAbort = () => agent.abort();
  job.signal.addEventListener('abort', onAbort, { once: true });

  const usage = { tokens_in: 0, tokens_out: 0, cost: 0 };
  let turn = 0; let text = ''; let errorMessage: string | undefined;
  const toolStart = new Map<string, number>();
  const unsub = agent.subscribe(async ev => {
    if (ev.type === 'message_update' && ev.assistantMessageEvent.type === 'text_delta') {
      events.emit('chat.delta', { conversation_id: args.conversation_id, submission_id: job.job_id, delta: ev.assistantMessageEvent.delta });
    } else if (ev.type === 'message_end' && ev.message.role === 'assistant') {
      const m = ev.message as AssistantMessage; turn++;
      text = m.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text').map(c => c.text).join('');
      if (m.stopReason === 'error' || m.stopReason === 'aborted') errorMessage = m.errorMessage ?? m.stopReason;
      const u = m.usage ?? emptyUsage();
      const costUsd = safeCost(resolved.model, u);
      const cny = costUsd * USD_CNY;
      usage.tokens_in += u.input + u.cacheRead; usage.tokens_out += u.output; usage.cost += cny;
      const stepId = await job.record?.('model', `model.${turn}`, { model: m.model, tools: m.content.filter(c => c.type === 'toolCall').map(c => (c as { name: string }).name) }, { stop: m.stopReason, tokens_in: u.input, tokens_out: u.output, cost_cny: cny }, m.stopReason === 'error' ? 'failed' : 'done');
      await recordUsage(db, { job_id: job.job_id, job_step_id: stepId, skill_id: skill.id, model: m.model, input_tokens: u.input, cached_tokens: u.cacheRead, output_tokens: u.output, cost_cny: cny });
      events.emit('usage.updated', { skill_id: skill.id, month_cost: await skillMonth(db, skill.id), total: await monthTotal(db) });
    } else if (ev.type === 'tool_execution_start') {
      toolStart.set(ev.toolCallId, now());
      events.emit('chat.tool', { conversation_id: args.conversation_id, task_id: job.job_id, phase: 'start', tool: ev.toolName, skill_id: skill.id, summary: `Tibi 正在${registry.get(ev.toolName)?.description ?? ev.toolName}` });
    } else if (ev.type === 'tool_execution_end') {
      events.emit('chat.tool', { conversation_id: args.conversation_id, task_id: job.job_id, phase: 'end', tool: ev.toolName, skill_id: skill.id, summary: ev.isError ? '出错了' : '完成', duration_ms: ev.durationMs ?? (now() - (toolStart.get(ev.toolCallId) ?? now())) });
    }
  });

  try {
    await agent.prompt(args.input);
  } finally {
    unsub(); registry.liveTools.delete(job.job_id); job.signal.removeEventListener('abort', onAbort);
  }
  if (job.signal.aborted) throw new TibiError('busy', '已取消');
  if (errorMessage) throw new TibiError(/unauthorized|401|api key/i.test(errorMessage) ? 'model_unavailable' : 'model_unavailable', `模型调用失败：${errorMessage}`);
  events.emit('chat.delta', { conversation_id: args.conversation_id, submission_id: job.job_id, delta: '', done: true });
  if (args.conversation_id) await convs.addMessage(args.conversation_id, 'assistant', { text }, job.job_id);
  return { text, usage };
}

function emptyUsage(): Usage { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }; }
function safeCost(model: Model<Api>, u: Usage): number {
  if (u.cost?.total) return u.cost.total;
  try { return calculateCost(model, u).total; } catch { return 0; }
}
async function skillMonth(db: Database, skill_id: string) { const { skillMonthCost } = await import('./usage.js'); return skillMonthCost(db, skill_id); }
async function monthTotal(db: Database) { const { monthSpent } = await import('./usage.js'); return monthSpent(db); }

/** 02 §4：① 角色与规则 ② 用户身份与核心记忆 ③ 能力清单 ④ 学习快照 ⑤ 界面上下文 ⑥ 召回记忆（⑦ 会话历史走 messages） */
export async function buildSystemPrompt(deps: AgentDeps, ctx: Ctx, skill: ResolvedSkill, args: RunSkillArgs): Promise<string> {
  const db = deps.db;
  const parts: string[] = [];
  parts.push(skill.body.trim());
  if (skill.extra_instructions) parts.push(`用户的附加要求：\n${skill.extra_instructions.trim()}`);
  const prof = await db.get<{ display_name: string | null; level_self: string | null; goal: string | null; interests: string; vocab_estimate: number; assistant_prefs: string }>("SELECT display_name, level_self, goal, interests, vocab_estimate, assistant_prefs FROM user_profile WHERE id = '1'");
  const prefs = j.parse<{ nickname?: string; language?: string; permission?: string }>(prof?.assistant_prefs, {});
  const core = await db.all<{ content: string }>("SELECT content FROM memories WHERE type IN ('profile', 'procedural') AND status = 'active' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 20");
  parts.push(['## 用户', `称呼：${prefs.nickname ?? prof?.display_name ?? '你'}；水平：${prof?.level_self ?? '未知'}；估算词汇量：${prof?.vocab_estimate ?? '未知'}；目标：${prof?.goal ?? '未知'}；兴趣：${j.parse<string[]>(prof?.interests, []).join('、') || '未知'}；回答语言：${LANG_TEXT[prefs.language ?? 'mixed'] ?? LANG_TEXT.mixed}`, ...core.map(m => `- ${m.content}`)].join('\n'));
  parts.push(`## 可用工具\n${skill.allowed_tools.filter(t => deps.registry.has(t)).map(t => `- ${t}：${deps.registry.get(t)!.description}`).join('\n') || '（无）'}\n权限模式：${await ctx.permission()}`);
  try {
    const snap = await deps.registry.call<Record<string, unknown>>('get_context', {}, ctx);
    parts.push(`## 当前状态\n${JSON.stringify({ page: snap['page'], document: snap['document'], selection: snap['selection'], card: snap['card'], today: snap['today'], recent_documents: snap['recent_documents'] })}`);
  } catch { /* get_context 没注册时跳过 */ }
  // ④ 学习日志：最近 7 天的计数（不含具体的词和正文），让 Tibi 知道用户最近在做什么
  try {
    const since = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const w = await db.get<{ days: number; ms: number; words: number; newt: number; rev: number; ok: number }>('SELECT count(*) AS days, COALESCE(sum(reading_ms), 0) AS ms, COALESCE(sum(words_read), 0) AS words, COALESCE(sum(new_terms), 0) AS newt, COALESCE(sum(reviews), 0) AS rev, COALESCE(sum(review_correct), 0) AS ok FROM daily_stats WHERE date >= ? AND (reading_ms > 0 OR reviews > 0)', [since]);
    const docs = await db.all<{ title: string }>('SELECT title FROM documents WHERE deleted_at IS NULL AND last_read_at IS NOT NULL ORDER BY last_read_at DESC LIMIT 5');
    if (w && (Number(w.days) || docs.length)) parts.push(`## 最近 7 天\n学习 ${w.days} 天，阅读约 ${Math.round(Number(w.ms) / 60000)} 分钟、${w.words} 词；新认识 ${w.newt} 个词；复习 ${w.rev} 次${Number(w.rev) ? `，答对率 ${Math.round(Number(w.ok) / Number(w.rev) * 100)}%` : ''}。${docs.length ? `最近读的：${docs.map(d => `《${d.title}》`).join('、')}` : ''}`);
  } catch { /* 统计表还没有数据 */ }
  if (args.context !== undefined) parts.push(`## 调用方给的上下文\n${typeof args.context === 'string' ? args.context : JSON.stringify(args.context)}`);
  const q = args.input.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 8);
  if (q.length) {
    try {
      const rows = await db.all<{ content: string }>("SELECT m.content FROM memories_fts f JOIN memories m ON m.rowid = f.rowid WHERE memories_fts MATCH ? AND m.status = 'active' AND m.deleted_at IS NULL AND m.type IN ('semantic', 'episodic') ORDER BY bm25(memories_fts) LIMIT 5", [q.map(w => `"${w.replace(/"/g, '')}"`).join(' OR ')]);
      if (rows.length) parts.push(`## 相关记忆\n${rows.map(r => `- ${r.content}`).join('\n')}`);
    } catch { /* FTS 查询语法问题忽略 */ }
  }
  return parts.join('\n\n');
}
