import { j, now, type Database } from '../db/driver.js';
import { uuidv7 } from '../ids.js';
import { TibiError, type Approval, type SkillId, type TaskId, type TaskState, type TaskStep, type TaskSummary } from '../types.js';
import type { EventSink, JobContext, JobRunner, JobSpec } from './types.js';

/**
 * 任务运行器（05 §6，R9 自建）：
 * - 每个任务一行 jobs；每一步一行 job_steps，写完才算完成（检查点）；
 * - 重开时 resumeAll() 把 running / queued / waiting_approval / paused(不自动) 的任务按 pipeline 接着跑，
 *   step() 遇到已 done 的同名步骤直接返回保存的 output；
 * - 审批：status = waiting_approval，挂起等 tasks.approve；审批内容存在 jobs.approval，重开后能恢复；
 * - 事件：task.update（节流 ≤ 4 次/秒）、task.done、approval.requested / resolved。
 */

type Pipeline = (ctx: JobContext, input: any) => Promise<unknown>;

interface Active {
  ctrl: AbortController;
  pausing: boolean;
  promise: Promise<void>;
  ctx: JobContext;
  approval?: { resolve: (d: ApprovalDecision) => void };
  stepStack: string[];
}

export interface ApprovalDecision { decision: 'allow' | 'deny' | 'edit'; edited?: Record<string, unknown> }

interface JobRow {
  id: string; kind: string; skill_id: string | null; parent_job_id: string | null; conversation_id: string | null; status: string; trigger: string; title: string;
  input: string; output: string | null; error: string | null; created_at: number; started_at: number | null; finished_at: number | null; pipeline: string; tainted: number; approval: string | null; progress: string | null;
}

class PauseSignal extends Error { constructor() { super('paused'); this.name = 'PauseSignal'; } }
class CancelSignal extends Error { constructor() { super('cancelled'); this.name = 'CancelSignal'; } }

export const JOB_DEPTH_LIMIT = 1;

export class JobRunnerImpl implements JobRunner {
  private pipelines = new Map<string, Pipeline>();
  private active = new Map<TaskId, Active>();
  private lastUpdate = new Map<TaskId, number>();
  private updateTimer = new Map<TaskId, ReturnType<typeof setTimeout>>();

  constructor(private readonly db: Database, private readonly events: EventSink) {}

  register(name: string, fn: Pipeline) { this.pipelines.set(name, fn); }
  has(name: string) { return this.pipelines.has(name); }

  /** 正在运行的任务的上下文（能力层按 job_id 取 tainted、approve） */
  getContext(task_id: TaskId): JobContext | undefined { return this.active.get(task_id)?.ctx; }
  isActive(task_id: TaskId) { return this.active.has(task_id); }

  async submit(pipeline: string, spec: JobSpec): Promise<{ task_id: TaskId }> {
    if (!this.pipelines.has(pipeline)) throw new TibiError('not_found', `没有这个流水线：${pipeline}`);
    if (spec.parent_job_id) {
      const parent = await this.db.get<{ parent_job_id: string | null }>('SELECT parent_job_id FROM jobs WHERE id = ?', [spec.parent_job_id]);
      if (parent?.parent_job_id) throw new TibiError('permission_denied', '子任务不能再创建子任务（嵌套深度上限 1）');
    }
    const id = uuidv7(); const t = now();
    await this.db.run(
      'INSERT INTO jobs(id, kind, skill_id, parent_job_id, conversation_id, status, trigger, title, input, created_at, updated_at, pipeline) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, spec.kind, spec.skill_id ?? null, spec.parent_job_id ?? null, spec.conversation_id ?? null, 'queued', spec.trigger ?? 'user', spec.title, j.str(spec.input ?? {}), t, t, pipeline],
    );
    this.start(id);
    return { task_id: id };
  }

  /** 把一个已存在的任务（续跑 / 重试 / 恢复）跑起来 */
  private start(id: TaskId) {
    if (this.active.has(id)) return;
    const ctrl = new AbortController();
    const entry: Partial<Active> = { ctrl, pausing: false, stepStack: [] };
    entry.ctx = this.makeContext(id, entry as Active);
    entry.promise = this.run(id, entry as Active).catch(e => { console.error('[jobs] 任务异常', id, e); });
    this.active.set(id, entry as Active);
  }

  private makeContext(id: TaskId, entry: Active): JobContext {
    const self = this;
    const ctx: JobContext = {
      job_id: id, signal: entry.ctrl.signal, tainted: false,
      markTainted() { if (!ctx.tainted) { ctx.tainted = true; void self.db.run('UPDATE jobs SET tainted = 1, updated_at = ? WHERE id = ?', [now(), id]); } },
      async step(name, fn, opts) {
        const full = entry.stepStack.length ? `${entry.stepStack[entry.stepStack.length - 1]}.${name}` : name;
        return self.runStep(id, entry, full, fn, opts) as Promise<never>;
      },
      async parallel(steps) {
        const out: Record<string, unknown> = {};
        await Promise.all(Object.entries(steps).map(async ([k, f]) => {
          try { out[k] = await ctx.step(k, () => f()); } catch (e) { if (e instanceof CancelSignal || e instanceof PauseSignal) throw e; out[k] = undefined; }
        }));
        return out as never;
      },
      progress(label, extra) {
        const p = { label, index: extra?.index, total: extra?.total };
        void self.db.run('UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?', [j.str(p), now(), id]);
        self.emitUpdate(id);
      },
      approve: (req) => self.requestApproval(id, entry, req),
      record: (kind, name, input, output, status = 'done') => self.recordStep(id, kind, name, input, output, status),
    };
    return ctx;
  }

  private async runStep<T>(job_id: TaskId, entry: Active, name: string, fn: (c: JobContext) => Promise<T>, opts?: { kind?: 'pipeline' | 'tool' | 'model'; input?: unknown; label?: string }): Promise<T> {
    this.checkSignal(entry);
    const existing = await this.db.get<{ id: string; status: string; output: string | null }>('SELECT id, status, output FROM job_steps WHERE job_id = ? AND name = ?', [job_id, name]);
    if (existing?.status === 'done') return j.parse<T>(existing.output, undefined as T);
    const t = now();
    let stepId = existing?.id;
    if (stepId) {
      await this.db.run('UPDATE job_steps SET status = ?, started_at = ?, finished_at = NULL, error = NULL, input = ? WHERE id = ?', ['running', t, opts?.input === undefined ? null : j.str(opts.input), stepId]);
    } else {
      stepId = uuidv7();
      const mx = await this.db.get<{ m: number | null }>('SELECT max(idx) AS m FROM job_steps WHERE job_id = ?', [job_id]);
      await this.db.run('INSERT INTO job_steps(id, job_id, idx, kind, name, status, input, started_at) VALUES (?,?,?,?,?,?,?,?)',
        [stepId, job_id, Number(mx?.m ?? 0) + 1, opts?.kind ?? 'pipeline', name, 'running', opts?.input === undefined ? null : j.str(opts.input), t]);
    }
    if (opts?.label) entry.ctx.progress(opts.label);
    entry.stepStack.push(name);
    try {
      const out = await fn(entry.ctx);
      await this.db.run('UPDATE job_steps SET status = ?, output = ?, finished_at = ? WHERE id = ?', ['done', j.str(out ?? null), now(), stepId]);
      this.emitUpdate(job_id);
      if (entry.pausing) throw new PauseSignal();
      this.checkSignal(entry);
      return out;
    } catch (e) {
      if (e instanceof PauseSignal) throw e;
      const cancelled = e instanceof CancelSignal || entry.ctrl.signal.aborted;
      await this.db.run('UPDATE job_steps SET status = ?, error = ?, finished_at = ? WHERE id = ?', [cancelled ? 'skipped' : 'failed', cancelled ? null : errMsg(e), now(), stepId]);
      throw cancelled ? new CancelSignal() : e;
    } finally {
      entry.stepStack.pop();
    }
  }

  private checkSignal(entry: Active) { if (entry.ctrl.signal.aborted) throw new CancelSignal(); }

  /** 不经 step() 的记录（模型调用这类已经发生的事） */
  private async recordStep(job_id: TaskId, kind: 'pipeline' | 'tool' | 'model', name: string, input: unknown, output: unknown, status: 'done' | 'failed'): Promise<string> {
    const id = uuidv7(); const t = now();
    const mx = await this.db.get<{ m: number | null }>('SELECT max(idx) AS m FROM job_steps WHERE job_id = ?', [job_id]);
    await this.db.run('INSERT INTO job_steps(id, job_id, idx, kind, name, status, input, output, started_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, job_id, Number(mx?.m ?? 0) + 1, kind, name, status, input === undefined ? null : j.str(input), output === undefined ? null : j.str(output), t, t]);
    return id;
  }

  private async run(id: TaskId, entry: Active) {
    const row = await this.db.get<JobRow>('SELECT * FROM jobs WHERE id = ?', [id]);
    if (!row) { this.active.delete(id); return; }
    const fn = this.pipelines.get(row.pipeline);
    const t = now();
    if (!fn) {
      await this.db.run("UPDATE jobs SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?", [`没有这个流水线：${row.pipeline}`, t, t, id]);
      this.active.delete(id); this.emitUpdate(id, true); return;
    }
    entry.ctx.tainted = !!row.tainted;
    await this.db.run("UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, ?), error = NULL, updated_at = ? WHERE id = ?", [t, t, id]);
    this.emitUpdate(id);
    let status: string; let output: unknown; let error: string | null = null;
    try {
      output = await fn(entry.ctx, j.parse(row.input, {}));
      status = 'done';
    } catch (e) {
      if (e instanceof PauseSignal) status = 'paused';
      else if (e instanceof CancelSignal || entry.ctrl.signal.aborted) status = 'cancelled';
      else if (e instanceof TibiError && (e.code === 'model_unavailable' || e.code === 'budget_exceeded' || e.code === 'offline')) { status = 'deferred'; error = e.message; }
      else { status = 'failed'; error = errMsg(e); }
    }
    const t2 = now();
    await this.db.run('UPDATE jobs SET status = ?, output = ?, error = ?, finished_at = ?, updated_at = ?, approval = NULL WHERE id = ?',
      [status, status === 'done' ? j.str(output ?? null) : null, error, status === 'paused' ? null : t2, t2, id]);
    this.active.delete(id);
    this.clearUpdateTimer(id);
    const summary = await this.summary(id);
    if (status === 'done') {
      const o = output as Record<string, unknown> | undefined;
      const result = o && typeof o === 'object' && typeof o['summary'] === 'string' ? o : { summary: `${row.title}完成` };
      this.events.emit('task.done', { task: summary, result });
    } else {
      this.events.emit('task.update', { task: summary });
    }
  }

  private emitUpdate(id: TaskId, immediate = false) {
    const last = this.lastUpdate.get(id) ?? 0; const t = now();
    const send = async () => { this.lastUpdate.set(id, now()); const s = await this.summary(id); if (s) this.events.emit('task.update', { task: s, steps: await this.steps(id) }); };
    if (immediate || t - last >= 250) { void send(); return; }
    if (!this.updateTimer.has(id)) this.updateTimer.set(id, setTimeout(() => { this.updateTimer.delete(id); void send(); }, 250 - (t - last)));
  }
  private clearUpdateTimer(id: TaskId) { const tm = this.updateTimer.get(id); if (tm) { clearTimeout(tm); this.updateTimer.delete(id); } }

  // ---------- 审批 ----------
  private async requestApproval(id: TaskId, entry: Active, req: Omit<Approval, 'task_id' | 'requested_at'>): Promise<ApprovalDecision> {
    const row = await this.db.get<{ skill_id: string | null; approval: string | null }>('SELECT skill_id, approval FROM jobs WHERE id = ?', [id]);
    // 重开前已经决定过（tasks.approve 在任务不在内存时写的）
    const stored = j.parse<{ decision?: string; edited?: Record<string, unknown>; tool?: string } | null>(row?.approval, null);
    if (stored?.decision && stored.tool === req.tool) {
      await this.db.run('UPDATE jobs SET approval = NULL, updated_at = ? WHERE id = ?', [now(), id]);
      return { decision: stored.decision as ApprovalDecision['decision'], edited: stored.edited };
    }
    // "以后这类都自动允许"：按技能 + 能力记的规则；读过不可信内容的任务不生效
    if (!entry.ctx.tainted && !req.untrusted) {
      const rule = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [autoRuleKey(row?.skill_id, req.tool)]);
      if (rule && j.parse(rule.value, false) === true) return { decision: 'allow' };
    }
    const approval: Approval = { ...req, task_id: id, untrusted: req.untrusted || entry.ctx.tainted, requested_at: now() };
    await this.db.run("UPDATE jobs SET status = 'waiting_approval', approval = ?, updated_at = ? WHERE id = ?", [j.str(approval), now(), id]);
    this.events.emit('approval.requested', { approval });
    this.emitUpdate(id, true);
    return new Promise<ApprovalDecision>((resolve, reject) => {
      entry.approval = { resolve };
      entry.ctrl.signal.addEventListener('abort', () => reject(new CancelSignal()), { once: true });
    }).then(async d => {
      await this.db.run("UPDATE jobs SET status = 'running', approval = NULL, updated_at = ? WHERE id = ?", [now(), id]);
      this.events.emit('approval.resolved', { task_id: id, decision: d.decision });
      return d;
    });
  }

  async approve(task_id: TaskId, decision: 'allow' | 'deny' | 'edit', edited?: Record<string, unknown>, always?: boolean) {
    const row = await this.db.get<{ status: string; skill_id: string | null; approval: string | null; tainted: number }>('SELECT status, skill_id, approval, tainted FROM jobs WHERE id = ?', [task_id]);
    if (!row) throw new TibiError('not_found', '找不到这个任务');
    const pending = j.parse<Approval | null>(row.approval, null);
    if (row.status !== 'waiting_approval' || !pending) throw new TibiError('conflict', '这个任务没有等待确认的操作');
    if (always && decision === 'allow' && !row.tainted && !pending.untrusted) {
      await this.db.run('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [autoRuleKey(row.skill_id, pending.tool), 'true', now()]);
    }
    const entry = this.active.get(task_id);
    if (entry?.approval) {
      const r = entry.approval; entry.approval = undefined;
      r.resolve({ decision, edited });
    } else {
      // 任务不在内存里（重开后还没跑到）：把决定存下来，跑到 approve() 时消费
      await this.db.run("UPDATE jobs SET approval = ?, status = 'running', updated_at = ? WHERE id = ?", [j.str({ decision, edited, tool: pending.tool }), now(), task_id]);
      this.events.emit('approval.resolved', { task_id, decision });
      this.start(task_id);
    }
  }

  // ---------- 生命周期 ----------
  async resumeAll(): Promise<number> {
    const rows = await this.db.all<{ id: string }>("SELECT id FROM jobs WHERE status IN ('queued', 'running', 'waiting_approval') AND deleted_at IS NULL ORDER BY created_at");
    for (const r of rows) this.start(r.id);
    return rows.length;
  }

  async wait(task_id: TaskId, timeout_ms = 60_000) {
    const entry = this.active.get(task_id);
    if (entry) await Promise.race([entry.promise, new Promise(r => setTimeout(r, timeout_ms))]);
    const row = await this.db.get<{ status: string; output: string | null; error: string | null }>('SELECT status, output, error FROM jobs WHERE id = ?', [task_id]);
    if (!row) return { status: 'unknown' };
    return { status: row.status, output: j.parse(row.output, undefined), error: row.error ?? undefined };
  }

  async cancel(task_id: TaskId) {
    const entry = this.active.get(task_id);
    if (entry) { entry.ctrl.abort(); await entry.promise; return; }
    const t = now();
    await this.db.run("UPDATE jobs SET status = 'cancelled', finished_at = ?, updated_at = ?, approval = NULL WHERE id = ? AND status IN ('queued', 'running', 'waiting_approval', 'paused')", [t, t, task_id]);
    this.emitUpdate(task_id, true);
  }

  /** 完成当前步骤后停下 */
  async pause(task_id: TaskId) {
    const entry = this.active.get(task_id);
    if (!entry) throw new TibiError('conflict', '任务没有在运行');
    entry.pausing = true;
  }

  async resume(task_id: TaskId) {
    const row = await this.db.get<{ status: string }>('SELECT status FROM jobs WHERE id = ?', [task_id]);
    if (!row) throw new TibiError('not_found', '找不到这个任务');
    if (!['paused', 'deferred', 'failed', 'cancelled'].includes(row.status)) throw new TibiError('conflict', '任务不在可以继续的状态');
    await this.db.run("UPDATE jobs SET status = 'queued', finished_at = NULL, updated_at = ? WHERE id = ?", [now(), task_id]);
    this.start(task_id);
  }

  /** 从失败的那一步继续（已完成的步骤保留） */
  async retry(task_id: TaskId) { return this.resume(task_id); }

  // ---------- 查询 ----------
  async summary(task_id: TaskId): Promise<TaskSummary | undefined> {
    const row = await this.db.get<JobRow>('SELECT * FROM jobs WHERE id = ?', [task_id]);
    if (!row) return undefined;
    const steps = await this.db.all<{ status: string; name: string }>('SELECT status, name FROM job_steps WHERE job_id = ? ORDER BY idx', [task_id]);
    const usage = await this.db.get<{ cost: number | null; model: string | null }>('SELECT sum(cost) AS cost, max(model) AS model FROM usage_records WHERE job_id = ?', [task_id]);
    const progress = j.parse<{ label?: string; index?: number; total?: number } | null>(row.progress, null);
    const done = steps.filter(s => s.status === 'done').length;
    const last = steps[steps.length - 1];
    const docTitle = row.conversation_id ? undefined : undefined;
    return {
      id: row.id, state: toState(row.status), skill_id: (row.skill_id ?? (row.kind === 'import' ? 'importer' : 'tibi')) as SkillId, title: row.title, document_title: docTitle,
      trigger: row.trigger, model: usage?.model ?? '',
      step: { index: progress?.index ?? done, total: progress?.total ?? Math.max(steps.length, done), label: progress?.label ?? last?.name ?? '' },
      started_at: row.started_at ?? row.created_at, duration_ms: (row.finished_at ?? now()) - (row.started_at ?? row.created_at),
      cost: Number(usage?.cost ?? 0), error: row.error ?? (row.status === 'deferred' ? '稍后补做' : undefined),
    };
  }

  async steps(task_id: TaskId): Promise<TaskStep[]> {
    const rows = await this.db.all<{ id: string; name: string; status: string; started_at: number; finished_at: number | null; kind: string }>('SELECT id, name, status, started_at, finished_at, kind FROM job_steps WHERE job_id = ? ORDER BY idx', [task_id]);
    const job = await this.db.get<{ status: string; skill_id: string | null }>('SELECT status, skill_id FROM jobs WHERE id = ?', [task_id]);
    const nodes = new Map<string, TaskStep>();
    const roots: TaskStep[] = [];
    for (const r of rows) {
      const step: TaskStep = { id: r.id, label: r.name.includes('.') ? r.name.slice(r.name.lastIndexOf('.') + 1) : r.name, state: r.status === 'done' ? 'ok' : r.status === 'failed' ? 'err' : r.status === 'running' ? (job?.status === 'waiting_approval' ? 'appr' : 'run') : 'wait', duration_ms: r.finished_at ? r.finished_at - r.started_at : undefined, skill_id: (job?.skill_id ?? undefined) as SkillId | undefined };
      nodes.set(r.name, step);
      const parentName = r.name.includes('.') ? r.name.slice(0, r.name.lastIndexOf('.')) : undefined;
      const parent = parentName ? nodes.get(parentName) : undefined;
      if (parent) (parent.children ??= []).push(step); else roots.push(step);
    }
    return roots;
  }
}

export function autoRuleKey(skill_id: string | null | undefined, tool: string) { return `perm.auto.${skill_id ?? '-'}.${tool}`; }
export function toState(status: string): TaskState {
  switch (status) {
    case 'queued': case 'running': return 'run';
    case 'waiting_approval': return 'appr';
    case 'paused': return 'paused';
    case 'done': return 'done';
    case 'cancelled': return 'cancel';
    default: return 'err';
  }
}
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
