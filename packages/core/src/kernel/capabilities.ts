import { Type, type TSchema } from '@sinclair/typebox';
import { j, now, type Database } from '../db/driver.js';
import { capability, validateParams, type CapabilityDef, type CapabilityMap, type Ctx } from '../rpc/define.js';
import { TibiError, type Approval, type SkillId } from '../types.js';
import type { ApprovalRequest } from './turns.js';
import type { EngineTool, EngineToolResult } from './engine.js';
import type { RunContext, Turns } from './turns.js';
import { resolveSkill, skillDef } from './skills.js';
import { isChosen } from './ask.js';
import { parseDeepLink } from '../deeplink.js';

/**
 * 能力注册表（05 §4、06 §5、10 §3.2）：一份定义，三种出口。
 * - call()：界面 / 内部直接调用（用户自己点的，直接执行、只记审计）；技能调用时按权限模式审批。
 * - toEngineTools()：交给 agent 引擎的工具，技能运行时用；审批也在这里。
 * - listForMcp()：给 MCP Server 用（不含 run_skill / ask_user）。
 */

/** 工具结果给模型和存库都截到这么长（10 §5.2） */
export const TOOL_RESULT_MAX = 16_000;

/** 读过不可信内容后必须审批的外联能力（05 §8）；web_search 不用审批 */
const EXTERNAL = new Set(['fetch_url']);
/** 结果带外部文本（网页、订阅、导入的正文和原句）的能力：调用后这一轮记为读过不可信内容 */
const UNTRUSTED_RESULT = new Set(['fetch_url', 'web_search', 'search_feeds', 'get_document', 'search_documents', 'get_term', 'get_term_contexts']);
/** 这些能力是技能内部调度用的，不暴露给 MCP */
const INTERNAL = new Set(['run_skill', 'tool_search', 'ask_user']);

export type Authorization = { ok: true; approval: 'auto' | 'approved' | 'edited'; params: unknown } | { ok: false; reason: string };

export class CapabilityRegistry {
  private caps = new Map<string, CapabilityDef<any, any>>();

  constructor(private readonly db: Database, private readonly turns: Turns) {}

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
  listForMcp() { return this.list().filter(c => !INTERNAL.has(c.name) && this.caps.get(c.name)!.mcp !== false); }

  /** 权限判定（02 §6、05 §8）；需要确认时在这里挂起等审批 */
  async authorize(def: CapabilityDef<any, any>, params: unknown, ctx: Ctx): Promise<Authorization> {
    const run = this.turns.get(ctx.caller.turn_id);
    const tainted = !!(run?.tainted || ctx.caller.tainted);
    const external = EXTERNAL.has(def.name);
    // 界面直接调用：用户自己点的，直接执行
    if (ctx.caller.origin === 'ui') return { ok: true, approval: 'auto', params };
    // 记忆这类 Tibi 自己的笔记：直接写，对话里给回执，用户随时撤销。
    // 读过网页、文章正文的一轮：只能新记"观察"（不进系统提示），不能记成身份或指令，也不能自动改、删已有的（走下面的审批）——防注入的内容变成长期指令
    if (def.autoApprove && def.undoable && ctx.caller.origin === 'skill') {
      if (!tainted) return { ok: true, approval: 'auto', params };
      if (def.name === 'remember') {
        const p = params as { type?: string };
        return { ok: true, approval: 'auto', params: p.type === 'profile' || p.type === 'procedural' ? { ...p, type: 'semantic' } : params };
      }
    }
    // 用户刚在反问卡上选中的网址：用户自己看着选的，这次不再问（模型换了网址照常走下面的审批）
    const url = def.chosenUrl?.(params);
    if (url && ctx.caller.origin === 'skill' && isChosen(ctx.caller.turn_id, url)) return { ok: true, approval: 'approved', params };
    // 外部工具（MCP）写记忆：每次都问，"全部自动"也不放行
    const perm = def.autoApprove ? (ctx.caller.origin === 'skill' ? 'confirm' : 'always') : def.permFor?.(params) ?? def.perm;
    if (perm === 'read' && !(external && tainted)) return { ok: true, approval: 'auto', params };
    if (perm === 'always' && tainted) return { ok: false, reason: '这一轮读过网页内容，不能做这项改动。请用户自己到设置里改' };
    const mode = await ctx.permission();
    const skill = ctx.caller.skill_id ? await resolveSkill(this.db, ctx.caller.skill_id).catch(() => undefined) : undefined;
    const skillAsk = skill?.write_permission === 'ask';
    let needAsk: boolean;
    if (perm === 'always' || (tainted && (perm !== 'read' || external))) needAsk = true;   // 读过不可信内容：写入与外联一律审批，全部自动也不放行
    else if (perm === 'confirm') needAsk = mode !== 'auto';
    else if (perm === 'write') needAsk = mode === 'ask' || skillAsk;
    else needAsk = false;
    if (!needAsk) return { ok: true, approval: 'auto', params };
    if (!run) return { ok: false, reason: '这个操作需要确认，但这里没法问用户' };
    const req: ApprovalRequest = {
      skill_id: ctx.caller.skill_id as SkillId | undefined, tool: def.name,
      title: `Tibi 想${def.description.replace(/^管理[^：]*：/, '').split(/[（，]/)[0]!.replace(/[。.]$/, '')}`, body: def.describe ? await def.describe(params, ctx) : summarize(params), impact: external ? '访问外部网络' : '写入数据',
      undoable: !!def.undoable, untrusted: tainted, editable: def.describe ? undefined : editableField(params), always_ask: perm === 'always',
    };
    const d = await run.approve(req);
    if (d.decision === 'deny') return { ok: false, reason: '用户拒绝了这个操作' };
    // 改过的参数和模型给的一样要过校验
    return { ok: true, approval: d.decision === 'edit' ? 'edited' : 'approved', params: d.decision === 'edit' && d.edited ? validateParams(def.params, { ...(params as object), ...d.edited }) : params };
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

  /**
   * 交给引擎的工具：权限在 execute 里走 authorize()。
   * deferred 里的按需加载；details 里是原始结果 { out } 或错误 { error, code }，给 Core 生成卡片和回执。
   */
  toEngineTools(names: string[], ctx: Ctx, run: RunContext, deferred: string[] = []): EngineTool[] {
    const seen = new Set<string>();
    return [...names.map(n => [n, false] as const), ...deferred.map(n => [n, true] as const)]
      .filter(([n]) => this.caps.has(n) && !seen.has(n) && seen.add(n))
      .map(([n, d]) => this.toEngineTool(this.caps.get(n)!, ctx, run, d));
  }

  toEngineTool(def: CapabilityDef<any, any>, ctx: Ctx, run: RunContext, deferred = false): EngineTool {
    const self = this;
    return {
      name: def.name, description: def.description, parameters: def.params as TSchema,
      readOnly: def.perm === 'read', deferred,
      async execute(toolCallId, params): Promise<EngineToolResult> {
        const name = `tool.${def.name}#${toolCallId}`;
        try {
          if (run.signal.aborted) throw new TibiError('busy', '已取消');
          const p = validateParams(def.params, params);
          const auth = await self.authorize(def, p, ctx);
          if (!auth.ok) throw new TibiError('permission_denied', auth.reason);
          if (UNTRUSTED_RESULT.has(def.name)) run.markTainted();
          const out = await def.run(auth.params, { ...ctx, caller: { ...ctx.caller, call_id: name } });
          const text = clip(JSON.stringify(out ?? null));
          run.seen.push(text);
          return { text, details: { out } };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { text: `错误：${msg}`, details: { error: msg, code: e instanceof TibiError ? e.code : 'internal' }, isError: true };
        }
      },
    };
  }

}

function clip(s: string): string {
  return s.length > TOOL_RESULT_MAX ? `${s.slice(0, TOOL_RESULT_MAX)}…（结果太长，后面截掉了）` : s;
}

/** 审批卡正文：把参数里给人看的值列出来（id 这类不列）；没有就退回 JSON */
function summarize(params: unknown): string {
  const cut = (s: string) => (s.length > 300 ? s.slice(0, 300) + '…' : s);
  try {
    const main = editableField(params);
    if (main) return cut(main.value);   // 类型这类枚举值对人没意义
    if (params && typeof params === 'object' && !Array.isArray(params)) {
      const vals = Object.entries(params).filter(([k]) => !/(^|_)id$/.test(k)).map(([, v]) => (typeof v === 'string' ? v : Array.isArray(v) && v.every(x => typeof x === 'string') ? v.join('、') : '')).filter(Boolean);
      if (vals.length) return cut(vals.join('\n'));
    }
    return cut(JSON.stringify(params));
  } catch { return ''; }
}

/** 用户可以在审批卡上直接改的那段文字 */
function editableField(params: unknown): Approval['editable'] {
  const p = params as Record<string, unknown> | null;
  const field = ['content', 'text', 'meaning', 'title'].find(k => typeof p?.[k] === 'string');
  return field ? { field, value: p![field] as string } : undefined;
}

/** 界面上下文（chat.send 的 context），内核缓存最近一次 */
export interface UiContext { page: string; document_id?: string; section_id?: string; sentence_id?: string; selection?: string; card_id?: string }

export interface BuiltinDeps {
  db: Database;
  registry: CapabilityRegistry;
  uiContext: () => UiContext | undefined;
  /** 在调用方这一轮里跑一项子技能，等它说完 */
  runSkill: (args: { skill_id: SkillId; input: string; context?: unknown; parent: Ctx }) => Promise<{ result: string }>;
}

/** 内核自带的能力：get_context / run_skill（ask_user 在 ask.ts；tool_search 由引擎提供） */
export function builtinCapabilities(deps: BuiltinDeps): CapabilityMap {
  return {
    get_context: capability({
      name: 'get_context', description: '取用户现在在看什么（页面、文章和位置、选中的句子、复习中的卡片）和今天的学习数据', perm: 'read', params: Type.Object({}),
      async run(_p, ctx) {
        const db = ctx.db;
        const prof = await db.get<{ interests: string }>("SELECT interests FROM user_profile WHERE id = '1'");
        const ui = deps.uiContext();
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const minutes = await db.get<{ ms: number | null }>('SELECT sum(COALESCE(ended_at, started_at) - started_at) AS ms FROM reading_sessions WHERE started_at >= ?', [dayStart.getTime()]);
        const reviewed = await db.get<{ n: number }>('SELECT count(*) AS n FROM review_logs_valid WHERE reviewed_at >= ?', [dayStart.getTime()]);
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
          profile: { interests: j.parse<string[]>(prof?.interests, []) },
          today: { minutes: Math.round(Number(minutes?.ms ?? 0) / 60000), due: Number(due?.n ?? 0), reviewed: Number(reviewed?.n ?? 0), new_words: Number(newWords?.n ?? 0), streak: Number(streak?.n ?? 0) },
          recent_documents: recent, permission: await ctx.permission(),
        };
      },
    }),
    show_link: capability({
      name: 'show_link', description: '在对话里放一张卡片，按钮跳到应用里的某处（读某篇文章、书架、生词本、复习、词典、统计、设置）', perm: 'read', mcp: false,
      params: Type.Object({
        text: Type.String({ minLength: 1, maxLength: 200, description: '卡片上的一句话：为什么去那里' }),
        links: Type.Array(Type.Object({
          label: Type.String({ minLength: 1, maxLength: 20 }),
          href: Type.String({ description: 'tibi://read/<文章 id>、tibi://library、tibi://words、tibi://review、tibi://dict?q=<词>、tibi://stats、tibi://settings?sec=<general|model|learning|memory|advanced|data|about>' }),
        }), { minItems: 1, maxItems: 3 }),
      }),
      async run(p, ctx) {
        for (const l of p.links) {
          const d = parseDeepLink(l.href);
          if (!d) throw new TibiError('invalid_params', `不认识这个链接：${l.href}`);
          if (d.to === 'read' && !await ctx.db.get('SELECT 1 AS hit FROM documents WHERE id = ? AND deleted_at IS NULL', [d.document_id])) throw new TibiError('not_found', `书架里没有这篇：${d.document_id}`);
        }
        return { shown: true };
      },
      widget: (_r, p) => ({ kind: 'link', summary: `给了入口：${p.text}（${p.links.map(l => l.label).join('、')}）`, data: { text: p.text, links: p.links } }),
    }),
    run_skill: capability({
      name: 'run_skill', description: '运行一项技能（主对话专用）', perm: 'write',
      params: Type.Object({ skill_id: Type.String(), input: Type.String(), context: Type.Optional(Type.Unknown()) }),
      async run(p, ctx) {
        if (!skillDef(p.skill_id) || p.skill_id === 'tibi') throw new TibiError('not_found', `没有这项技能：${p.skill_id}`);
        if (ctx.caller.depth) throw new TibiError('permission_denied', '子技能不能再运行技能（嵌套深度上限 1）');
        // 在同一轮里跑完再返回：结果交给主对话的模型（子技能的反问直接显示在主对话里）
        return deps.runSkill({ skill_id: p.skill_id as SkillId, input: p.input, context: p.context, parent: ctx });
      },
    }),
  };
}
