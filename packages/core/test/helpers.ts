import { openAppDb } from '@tibi/core-node';
import { Core, fakePlatform, NullDict, uuidv7, type Approval, type Ctx, type Dict, type JobContext, type JobRunner, type JobSpec, type Platform } from '../src/index.js';

/**
 * 测试辅助：内存库 + 假平台 + 直接执行的任务运行器（没有检查点，步骤立即跑）。
 * 内核做好后测试可以换成真的 JobRunner。
 */
export class InlineJobRunner implements JobRunner {
  pipelines = new Map<string, (ctx: JobContext, input: any) => Promise<unknown>>();
  results = new Map<string, { status: string; output?: unknown; error?: string }>();
  approvals: Array<'allow' | 'deny'> = [];
  register(name: string, fn: (ctx: JobContext, input: any) => Promise<unknown>) { this.pipelines.set(name, fn); }
  async submit(pipeline: string, spec: JobSpec) {
    const fn = this.pipelines.get(pipeline); if (!fn) throw new Error(`没有流水线 ${pipeline}`);
    const task_id = uuidv7();
    const self = this;
    const ctx: JobContext = {
      job_id: task_id, signal: new AbortController().signal, tainted: false,
      markTainted() { ctx.tainted = true; },
      async step(_name, f) { return f(ctx); },
      async parallel(steps) {
        const out: Record<string, unknown> = {};
        await Promise.all(Object.entries(steps).map(async ([k, f]) => { try { out[k] = await f(); } catch { out[k] = undefined; } }));
        return out as never;
      },
      progress() {},
      async approve(_req: Omit<Approval, 'task_id' | 'requested_at'>) { return { decision: self.approvals.shift() ?? 'allow' }; },
    };
    const p = fn(ctx, spec.input).then(output => { this.results.set(task_id, { status: 'done', output }); }, e => { this.results.set(task_id, { status: 'failed', error: String(e?.message ?? e) }); });
    this.results.set(task_id, { status: 'running' });
    (this as any).pending = p;
    await p;
    return { task_id };
  }
  async resumeAll() { return 0; }
  async wait(task_id: string) { return this.results.get(task_id) ?? { status: 'unknown' }; }
  async cancel() {}
  async approve() {}
  async summary() { return undefined; }
  async steps() { return []; }
}

export async function makeCore(opts: { dict?: Dict; platform?: Partial<Platform> } = {}) {
  const db = await openAppDb(':memory:');
  const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  const jobs = new InlineJobRunner();
  const core = new Core({ db, dict: opts.dict ?? new NullDict(), platform: fakePlatform(opts.platform), jobs });
  return { core, db, jobs, ctx: core.ctx({ origin: 'ui' }) as Ctx };
}
