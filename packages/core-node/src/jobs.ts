import type { JobRunner } from '@tibi/core';

/**
 * 任务运行器的装配点。内核（packages/core/src/kernel）做好后在这里换成真的实现；
 * 现在先放一个直接执行、无检查点的版本，让 Core 能启动。
 */
export function makeJobRunner(): JobRunner {
  const pipelines = new Map<string, (ctx: any, input: any) => Promise<unknown>>();
  const results = new Map<string, { status: string; output?: unknown; error?: string }>();
  return {
    register(name, fn) { pipelines.set(name, fn); },
    async submit(pipeline, spec) {
      const fn = pipelines.get(pipeline); if (!fn) throw new Error(`没有流水线 ${pipeline}`);
      const task_id = crypto.randomUUID();
      const ctx = {
        job_id: task_id, signal: new AbortController().signal, tainted: false,
        markTainted() { ctx.tainted = true; },
        async step(_n: string, f: (c: unknown) => Promise<unknown>) { return f(ctx); },
        async parallel(steps: Record<string, () => Promise<unknown>>) { const out: Record<string, unknown> = {}; await Promise.all(Object.entries(steps).map(async ([k, f]) => { try { out[k] = await f(); } catch { out[k] = undefined; } })); return out; },
        progress() {},
        async approve() { return { decision: 'allow' as const }; },
      };
      results.set(task_id, { status: 'running' });
      fn(ctx, spec.input).then(output => results.set(task_id, { status: 'done', output }), e => results.set(task_id, { status: 'failed', error: String(e?.message ?? e) }));
      return { task_id };
    },
    async resumeAll() { return 0; },
    async wait(task_id, timeout_ms = 60_000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout_ms) { const r = results.get(task_id); if (r && r.status !== 'running') return r; await new Promise(r => setTimeout(r, 20)); }
      return { status: 'timeout' };
    },
    async cancel() {}, async approve() {}, async summary() { return undefined; }, async steps() { return []; },
  };
}
