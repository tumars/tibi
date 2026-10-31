import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { j, now, type Database } from '../db/driver.js';
import { capability, validateParams, type CapabilityDef, type CapabilityMap, type Ctx } from '../rpc/define.js';
import { TibiError, type Approval, type SkillId } from '../types.js';
import type { JobRunnerImpl } from './jobs.js';
import type { JobContext } from './types.js';
import { resolveSkill, skillDef } from './skills.js';

/**
 * 能力注册表（05 §4、06 §5）：一份定义，三种出口。
 * - call()：界面 / 内部直接调用（用户自己点的，直接执行、只记审计）；技能调用时按权限模式审批。
 * - toAgentTools()：转成 pi-agent-core 的工具，技能运行时用；每次调用是一条 job_steps(kind=tool)。
 * - listForMcp()：M5 给 MCP Server 用（不含 run_skill / tool_search）。
 */

/** 读过不可信内容后必须审批的外联能力（05 §8） */
const EXTERNAL = new Set(['fetch_url', 'web_search']);
/** 这些能力是技能内部调度用的，不暴露给 MCP */
const INTERNAL = new Set(['run_skill', 'tool_search']);

export type Authorization = { ok: true; approval: 'auto' | 'approved' | 'edited'; params: unknown } | { ok: false; reason: string };

export class CapabilityRegistry {
  private caps = new Map<string, CapabilityDef<any, any>>();
  /** 正在运行的 Agent（tool_search 命中后把工具加进对话） */
  readonly liveTools = new Map<string, { add(tools: AgentTool[]): void }>();

  constructor(private readonly db: Database, private readonly runner: JobRunnerImpl) {}

  register(map: CapabilityMap) {
    for (const [name, def] of Object.entries(map)) {
      if (def.name !== name) throw new Error(`能力名不一致：${name} / ${def.name}`);
      if (this.caps.has(name)) throw new Error(`能力重复注册：${name}`);
      this.caps.set(name, def);
    }
    return this;
  }

  get(name: string) { return this.caps.get(name); }
  has(name: string) { return this.caps.has(name); }
  list() { return [...this.caps.values()].map(c => ({ name: c.name, description: c.description, perm: c.perm })); }
  listForMcp() { return this.list().filter(c => !INTERNAL.has(c.name)); }

  /** 权限判定（02 §6、05 §8）；需要确认时在这里挂起等审批 */
  async authorize(def: CapabilityDef<any, any>, params: unknown, ctx: Ctx): Promise<Authorization> {
    const job = ctx.caller.job_id ? this.runner.getContext(ctx.caller.job_id) : undefined;
    const tainted = !!(job?.tainted || ctx.caller.tainted);
    const external = EXTERNAL.has(def.name);
    // 界面直接调用：用户自己点的，直接执行
    if (ctx.caller.origin === 'ui') return { ok: true, approval: 'auto', params };
    if (def.perm === 'read' && !(external && tainted)) return { ok: true, approval: 'auto', params };
    const mode = await ctx.permission();
    const skill = ctx.caller.skill_id ? await resolveSkill(this.db, ctx.caller.skill_id).catch(() => undefined) : undefined;
    const skillAsk = skill?.write_permission === 'ask';
    let needAsk: boolean;
    if (tainted && (def.perm !== 'read' || external)) needAsk = true;              // 读过不可信内容：写入与外联一律审批，全部自动也不放行
    else if (def.perm === 'confirm') needAsk = mode !== 'auto';
    else if (def.perm === 'write') needAsk = mode === 'ask' || skillAsk;
    else needAsk = false;
    if (!needAsk) return { ok: true, approval: 'auto', params };
    if (!job) return { ok: false, reason: '这个操作需要确认，但不在任务里，无法审批' };
    const req: Omit<Approval, 'task_id' | 'requested_at'> = {
      skill_id: ctx.caller.skill_id as SkillId | undefined, tool: def.name,
      title: `Tibi 想${def.description.replace(/[。.]$/, '')}`, body: summarize(params), impact: def.perm === 'confirm' ? '写入数据，需要你确认' : '写入数据，可撤销',
      undoable: !!def.undoable, untrusted: tainted,
    };
    const d = await job.approve(req);
    if (d.decision === 'deny') return { ok: false, reason: '用户拒绝了这个操作' };
    return { ok: true, approval: d.decision === 'edit' ? 'edited' : 'approved', params: d.decision === 'edit' && d.edited ? { ...(params as object), ...d.edited } : params };
  }

  /** 直接调用一项能力（校验参数 → 权限 → 执行） */
  async call<T = unknown>(name: string, raw: unknown, ctx: Ctx): Promise<T> {
    const def = this.caps.get(name);
    if (!def) throw new TibiError('not_found', `没有这项能力：${name}`);
    const params = validateParams(def.params, raw);
    const auth = await this.authorize(def, params, ctx);
    if (!auth.ok) throw new TibiError('permission_denied', auth.reason);
    return def.run(auth.params, ctx) as Promise<T>;
  }

  /** 转成 pi-agent-core 的工具：执行时记 job_steps(kind=tool)，权限在 execute 里走 authorize() */
  toAgentTools(names: string[], ctx: Ctx, job: JobContext): AgentTool[] {
    return names.filter(n => this.caps.has(n)).map(n => this.toAgentTool(this.caps.get(n)!, ctx, job));
  }

  toAgentTool(def: CapabilityDef<any, any>, ctx: Ctx, job: JobContext): AgentTool {
    const self = this;
    return {
      name: def.name, label: def.description, description: def.description,
      parameters: def.params as TSchema,
      async execute(toolCallId, params) {
        const name = `tool.${def.name}#${toolCallId}`;
        try {
          const out = await job.step(name, async () => {
            const p = validateParams(def.params, params);
            const auth = await self.authorize(def, p, ctx);
            if (!auth.ok) throw new TibiError('permission_denied', auth.reason);
            if (EXTERNAL.has(def.name)) job.markTainted();
            return def.run(auth.params, { ...ctx, caller: { ...ctx.caller, job_step_id: name } });
          }, { kind: 'tool', input: params });
          return { content: [{ type: 'text', text: JSON.stringify(out ?? null) }], details: out };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { content: [{ type: 'text', text: `错误：${msg}` }], details: { error: msg, code: e instanceof TibiError ? e.code : 'internal' }, isError: true };
        }
      },
    } as AgentTool;
  }
}

function summarize(params: unknown): string {
  try { const s = JSON.stringify(params); return s.length > 300 ? s.slice(0, 300) + '…' : s; } catch { return ''; }
}

/** 界面上下文（chat.send 的 context），内核缓存最近一次 */
export interface UiContext { page: string; document_id?: string; section_id?: string; sentence_id?: string; selection?: string; card_id?: string }

export interface BuiltinDeps {
  db: Database;
  registry: CapabilityRegistry;
  runner: JobRunnerImpl;
  uiContext: () => UiContext | undefined;
  runSkill: (args: { skill_id: SkillId; input: string; context?: unknown; wait?: boolean; parent: Ctx }) => Promise<{ task_id: string; result?: string }>;
}

/** 内核自带的三项能力：get_context / run_skill / tool_search */
export function builtinCapabilities(deps: BuiltinDeps): CapabilityMap {
  return {
    get_context: capability({
      name: 'get_context', description: '取当前界面上下文与学习快照', perm: 'read', params: Type.Object({}),
      async run(_p, ctx) {
        const db = ctx.db;
        const prof = await db.get<{ level_self: string | null; vocab_estimate: number; goal: string | null; interests: string; assistant_prefs: string }>("SELECT level_self, vocab_estimate, goal, interests, assistant_prefs FROM user_profile WHERE id = '1'");
        const ui = deps.uiContext();
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const minutes = await db.get<{ ms: number | null }>('SELECT sum(COALESCE(ended_at, started_at) - started_at) AS ms FROM reading_sessions WHERE started_at >= ?', [dayStart.getTime()]);
        const reviewed = await db.get<{ n: number }>('SELECT count(*) AS n FROM review_logs WHERE reviewed_at >= ?', [dayStart.getTime()]);
        const due = await db.get<{ n: number }>('SELECT count(*) AS n FROM cards WHERE deleted_at IS NULL AND suspended = 0 AND due <= ?', [now()]);
        const newWords = await db.get<{ n: number }>('SELECT count(*) AS n FROM terms WHERE created_at >= ? AND deleted_at IS NULL', [dayStart.getTime()]);
        const streak = await db.get<{ n: number }>('SELECT count(*) AS n FROM daily_stats WHERE reading_ms > 0 OR reviews > 0');
        const recent = await db.all<{ id: string; title: string }>('SELECT id, title FROM documents WHERE deleted_at IS NULL ORDER BY COALESCE(last_read_at, created_at) DESC LIMIT 3');
        let document: { id: string; title: string; section_id?: string; sentence_id?: string; progress: number } | undefined;
        if (ui?.document_id) {
          const d = await db.get<{ id: string; title: string; progress: number }>('SELECT id, title, progress FROM documents WHERE id = ?', [ui.document_id]);
          if (d) document = { id: d.id, title: d.title, section_id: ui.section_id, sentence_id: ui.sentence_id, progress: d.progress };
        }
        let card: { card_id: string; term: string } | undefined;
        if (ui?.card_id) {
          const c = await db.get<{ id: string; text_display: string }>('SELECT c.id, t.text_display FROM cards c JOIN terms t ON t.id = c.term_id WHERE c.id = ?', [ui.card_id]);
          if (c) card = { card_id: c.id, term: c.text_display };
        }
        return {
          page: ui?.page ?? 'home', document, selection: ui?.selection && ui.sentence_id ? { text: ui.selection, sentence_id: ui.sentence_id } : undefined, card,
          profile: { level_self: prof?.level_self ?? '', vocab_estimate: prof?.vocab_estimate ?? 0, goal: prof?.goal ?? '', interests: j.parse<string[]>(prof?.interests, []) },
          today: { minutes: Math.round(Number(minutes?.ms ?? 0) / 60000), due: Number(due?.n ?? 0), reviewed: Number(reviewed?.n ?? 0), new_words: Number(newWords?.n ?? 0), streak: Number(streak?.n ?? 0) },
          recent_documents: recent, permission: await ctx.permission(),
        };
      },
    }),
    run_skill: capability({
      name: 'run_skill', description: '运行一项技能（主对话专用）', perm: 'write',
      params: Type.Object({ skill_id: Type.String(), input: Type.String(), context: Type.Optional(Type.Unknown()), wait: Type.Optional(Type.Boolean()) }),
      async run(p, ctx) {
        if (!skillDef(p.skill_id) || p.skill_id === 'tibi') throw new TibiError('not_found', `没有这项技能：${p.skill_id}`);
        if (ctx.caller.job_id) {
          const parent = await ctx.db.get<{ parent_job_id: string | null }>('SELECT parent_job_id FROM jobs WHERE id = ?', [ctx.caller.job_id]);
          if (parent?.parent_job_id) throw new TibiError('permission_denied', '子对话不能再运行技能（嵌套深度上限 1）');
        }
        return deps.runSkill({ skill_id: p.skill_id as SkillId, input: p.input, context: p.context, wait: p.wait, parent: ctx });
      },
    }),
    tool_search: capability({
      name: 'tool_search', description: '按名称或说明搜索能力，命中的加载进当前对话', perm: 'read', params: Type.Object({ q: Type.String() }),
      async run(p, ctx) {
        const q = p.q.toLowerCase();
        const hits = deps.registry.list().filter(c => !INTERNAL.has(c.name) && (c.name.includes(q) || c.description.toLowerCase().includes(q))).slice(0, 10);
        const live = ctx.caller.job_id ? deps.registry.liveTools.get(ctx.caller.job_id) : undefined;
        if (live && ctx.caller.job_id) {
          const job = deps.runner.getContext(ctx.caller.job_id);
          if (job) live.add(deps.registry.toAgentTools(hits.map(h => h.name), ctx, job));
        }
        return hits.map(h => ({ name: h.name, description: h.description }));
      },
    }),
  };
}
