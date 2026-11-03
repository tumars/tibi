import { j, now, type Database } from '../db/driver.js';
import { uuidv7 } from '../ids.js';
import { TibiError, type Approval } from '../types.js';
import type { EventSink } from './types.js';

/**
 * 进行中的回答（只在内存里）：一轮回答是对话里的一段消息，这里只管它跑着的时候要的东西——
 * 停止信号、等用户确认、是否读过不可信内容。子技能在同一轮里跑，共用这一份。
 * 不存检查点：应用重启后还没答完的那一轮记成中断（Conversations.interruptRunning），由用户点重试。
 */

export interface ApprovalDecision { decision: 'allow' | 'deny' | 'edit'; edited?: Record<string, unknown> }
export type ApprovalRequest = Omit<Approval, 'id' | 'conversation_id' | 'turn_id' | 'requested_at'>;

export interface RunContext {
  /** 对话里是 turn_id；外部工具（MCP）的一次调用是一个临时 id */
  readonly id: string;
  readonly conversation_id?: string;
  readonly signal: AbortSignal;
  /** 读过不可信内容（抓取的网页、导入正文、搜索结果）：之后的写入与外联必须审批 */
  tainted: boolean;
  markTainted(): void;
  /** 这一轮的输入和工具结果：反问卡上的网址只能来自这里 */
  seen: string[];
  /** 等用户确认；同一轮的审批一个一个来 */
  approve(req: ApprovalRequest): Promise<ApprovalDecision>;
}

interface Active { run: RunContext; ctrl: AbortController; promise: Promise<void>; chain: Promise<unknown> }
interface Pending { approval: Approval; resolve(d: ApprovalDecision): void }

export class Turns {
  private active = new Map<string, Active>();
  private pending = new Map<string, Pending>();

  constructor(private readonly db: Database, private readonly events: EventSink) {}

  /** 开始跑：fn 结束（成功、出错、停止）时这一轮从内存里去掉 */
  start(o: { id: string; conversation_id?: string; tainted?: boolean; client?: string; onTaint?: () => void }, fn: (run: RunContext) => Promise<void>): RunContext {
    if (this.active.has(o.id)) throw new TibiError('busy', '这一轮还在回答');
    const ctrl = new AbortController();
    const self = this;
    const run: RunContext = {
      id: o.id, conversation_id: o.conversation_id, signal: ctrl.signal, tainted: !!o.tainted, seen: [],
      markTainted() { if (!run.tainted) { run.tainted = true; o.onTaint?.(); } },
      approve: req => {
        const entry = self.active.get(o.id)!;
        const asked = entry.chain.then(() => self.ask(run, req, o.client));
        entry.chain = asked.catch(() => undefined);
        return asked;
      },
    };
    const entry: Active = { run, ctrl, chain: Promise.resolve(), promise: Promise.resolve() };
    this.active.set(o.id, entry);
    entry.promise = fn(run).catch(e => { console.error('[turns] 回答异常', o.id, e); }).finally(() => {
      this.active.delete(o.id);
      for (const [id, p] of this.pending) if (p.approval.turn_id === o.id || id.startsWith(`${o.id}:`)) this.drop(id);
    });
    return run;
  }

  get(id: string | undefined): RunContext | undefined { return id ? this.active.get(id)?.run : undefined; }
  isActive(id: string) { return this.active.has(id); }
  /** 这段对话里正在跑的回答 */
  activeIn(conversation_id: string): string[] { return [...this.active.values()].filter(a => a.run.conversation_id === conversation_id).map(a => a.run.id); }

  async cancel(id: string) {
    const a = this.active.get(id);
    if (!a) return;
    a.ctrl.abort();
    await a.promise;
  }

  async wait(id: string) { await this.active.get(id)?.promise; }

  // ---------- 审批 ----------

  /** 等确认的审批；给 conversation_id 时只要这段对话的，给 null 只要不在对话里的（外部工具） */
  approvals(conversation_id?: string | null): Approval[] {
    const all = [...this.pending.values()].map(p => p.approval);
    if (conversation_id === undefined) return all;
    return all.filter(a => (a.conversation_id ?? null) === conversation_id);
  }

  private async ask(run: RunContext, req: ApprovalRequest, client?: string): Promise<ApprovalDecision> {
    if (run.signal.aborted) throw new TibiError('busy', '已取消');
    // "以后这类都自动允许"：按技能 + 能力记的规则；读过不可信内容的一轮不生效
    if (!run.tainted && !req.untrusted && !req.always_ask) {
      const rule = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [autoRuleKey(req.skill_id, req.tool)]);
      if (rule && j.parse<boolean>(rule.value, false)) return { decision: 'allow' };
    }
    const approval: Approval = {
      ...req, id: `${run.id}:${uuidv7()}`, ...(run.conversation_id ? { conversation_id: run.conversation_id, turn_id: run.id } : {}), ...(client ? { client } : {}),
      untrusted: req.untrusted || run.tainted, requested_at: now(),
    };
    this.events.emit('approval.requested', { approval });
    return new Promise<ApprovalDecision>((resolve, reject) => {
      this.pending.set(approval.id, { approval, resolve });
      run.signal.addEventListener('abort', () => { this.drop(approval.id); reject(new TibiError('busy', '已取消')); }, { once: true });
    });
  }

  async decide(id: string, decision: ApprovalDecision['decision'], edited?: Record<string, unknown>, always?: boolean) {
    const p = this.pending.get(id);
    if (!p) throw new TibiError('conflict', '这个操作已经不用确认了');
    const a = p.approval;
    if (always && decision === 'allow' && !a.untrusted && !a.always_ask) {
      await this.db.run('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [autoRuleKey(a.skill_id, a.tool), 'true', now()]);
    }
    this.pending.delete(id);
    this.events.emit('approval.resolved', { id, decision });
    p.resolve({ decision, edited });
  }

  private drop(id: string) {
    if (!this.pending.delete(id)) return;
    this.events.emit('approval.resolved', { id, decision: 'deny' });
  }
}

export function autoRuleKey(skill_id: string | null | undefined, tool: string) { return `perm.auto.${skill_id ?? '-'}.${tool}`; }
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
