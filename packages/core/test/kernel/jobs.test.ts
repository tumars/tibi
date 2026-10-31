import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { capability, TibiError, type JobContext } from '../../src/index.js';
import { makeKernelCore, sleep, until } from './helpers.js';

describe('JobRunner：检查点与续跑', () => {
  it('第 2 步失败后重试：第 1 步不重复执行，第 2 步重跑', async () => {
    const { kernel, db } = await makeKernelCore();
    const ran: string[] = [];
    let fail = true;
    kernel.jobs.register('demo', async (job: JobContext) => {
      const a = await job.step('one', async () => { ran.push('one'); return { v: 1 }; });
      const b = await job.step('two', async () => { ran.push('two'); if (fail) throw new Error('boom'); return { v: a.v + 1 }; });
      return { summary: `done ${b.v}` };
    });
    const { task_id } = await kernel.jobs.submit('demo', { kind: 'import', title: '演示', input: {} });
    const r1 = await kernel.jobs.wait(task_id);
    expect(r1.status).toBe('failed'); expect(r1.error).toBe('boom');
    expect(ran).toEqual(['one', 'two']);
    const steps = await db.all<{ name: string; status: string }>('SELECT name, status FROM job_steps WHERE job_id = ? ORDER BY idx', [task_id]);
    expect(steps).toEqual([{ name: 'one', status: 'done' }, { name: 'two', status: 'failed' }]);

    fail = false;
    await kernel.jobs.retry(task_id);
    const r2 = await kernel.jobs.wait(task_id);
    expect(r2.status).toBe('done'); expect(r2.output).toEqual({ summary: 'done 2' });
    expect(ran).toEqual(['one', 'two', 'two']);
    const s = await kernel.jobs.summary(task_id);
    expect(s?.state).toBe('done'); expect(s?.step.index).toBe(2);
  });

  it('进程在第 2 步中途死掉：新进程 resumeAll 从检查点接着跑', async () => {
    const { kernel, db } = await makeKernelCore();
    const ran: string[] = [];
    let hang = true;
    const pipeline = async (job: JobContext) => {
      await job.step('one', async () => { ran.push('one'); return 1; });
      await job.step('two', async () => { ran.push('two'); if (hang) await new Promise<void>(() => {}); return 2; });   // 第一次永远不返回：模拟进程被杀
      await job.step('three', async () => { ran.push('three'); return 3; });
      return { summary: 'ok' };
    };
    kernel.jobs.register('slow', pipeline);
    const { task_id } = await kernel.jobs.submit('slow', { kind: 'import', title: '慢', input: {} });
    await until(() => ran.includes('two'));
    // 库里：jobs.status = running，step one done、step two running —— 就是进程死掉时的样子
    expect((await db.get<{ status: string }>('SELECT status FROM jobs WHERE id = ?', [task_id]))?.status).toBe('running');
    // 新进程：同一个库上再建一个内核
    hang = false;
    const { createKernel } = await import('../../src/kernel/index.js');
    const { EventBus } = await import('../../src/index.js');
    const k2 = createKernel(db, new EventBus());
    k2.jobs.register('slow', pipeline);
    const n = await k2.jobs.resumeAll();
    expect(n).toBe(1);
    const r = await k2.jobs.wait(task_id);
    expect(r.status).toBe('done');
    expect(ran).toEqual(['one', 'two', 'two', 'three']);   // one 没重跑，two 重跑，three 第一次
  });

  it('parallel：部分失败不影响其他，子步骤名带父前缀', async () => {
    const { kernel, db } = await makeKernelCore();
    kernel.jobs.register('par', async (job: JobContext) => {
      const r = await job.step('ai', async () => job.parallel({ summary: async () => 'S', phrases: async () => { throw new Error('x'); } }));
      return { summary: `${r.summary}/${r.phrases}` };
    });
    const { task_id } = await kernel.jobs.submit('par', { kind: 'import', title: '并行', input: {} });
    const r = await kernel.jobs.wait(task_id);
    expect(r.status).toBe('done'); expect(r.output).toEqual({ summary: 'S/undefined' });
    const names = (await db.all<{ name: string; status: string }>('SELECT name, status FROM job_steps WHERE job_id = ? ORDER BY idx', [task_id]));
    expect(names).toContainEqual({ name: 'ai.summary', status: 'done' });
    expect(names).toContainEqual({ name: 'ai.phrases', status: 'failed' });
    const tree = await kernel.jobs.steps(task_id);
    expect(tree[0]?.label).toBe('ai'); expect(tree[0]?.children?.map(c => c.label).sort()).toEqual(['phrases', 'summary']);
  });

  it('取消：status = cancelled，task.update 事件', async () => {
    const { kernel, events } = await makeKernelCore();
    kernel.jobs.register('forever', async (job: JobContext) => { await job.step('a', () => new Promise(r => setTimeout(r, 50))); await job.step('b', () => new Promise(r => setTimeout(r, 5000))); });
    const { task_id } = await kernel.jobs.submit('forever', { kind: 'import', title: '永', input: {} });
    await sleep(80);
    await kernel.jobs.cancel(task_id);
    const r = await kernel.jobs.wait(task_id);
    expect(r.status).toBe('cancelled');
    expect(events.some(e => e.event === 'task.update' && e.data.task.id === task_id && e.data.task.state === 'cancel')).toBe(true);
  });

  it('pause 完成当前步后停下，resume 接着跑', async () => {
    const { kernel } = await makeKernelCore();
    const ran: string[] = [];
    kernel.jobs.register('p', async (job: JobContext) => { await job.step('a', async () => { ran.push('a'); await sleep(60); }); await job.step('b', async () => { ran.push('b'); }); return { summary: 'ok' }; });
    const { task_id } = await kernel.jobs.submit('p', { kind: 'import', title: '暂停', input: {} });
    await sleep(10);
    await kernel.jobs.pause(task_id);
    const r = await kernel.jobs.wait(task_id);
    expect(r.status).toBe('paused'); expect(ran).toEqual(['a']);
    await kernel.jobs.resume(task_id);
    expect((await kernel.jobs.wait(task_id)).status).toBe('done'); expect(ran).toEqual(['a', 'b']);
  });

  it('模型不可用 / 预算超出 → deferred', async () => {
    const { kernel } = await makeKernelCore();
    kernel.jobs.register('d', async () => { throw new TibiError('budget_exceeded', '超了'); });
    const { task_id } = await kernel.jobs.submit('d', { kind: 'skill', title: 'x', input: {} });
    const r = await kernel.jobs.wait(task_id);
    expect(r.status).toBe('deferred'); expect((await kernel.jobs.summary(task_id))?.state).toBe('err');
  });

  it('嵌套深度上限 1', async () => {
    const { kernel } = await makeKernelCore();
    kernel.jobs.register('n', async () => 'ok');
    const { task_id: a } = await kernel.jobs.submit('n', { kind: 'skill', title: 'a', input: {} });
    const { task_id: b } = await kernel.jobs.submit('n', { kind: 'skill', title: 'b', parent_job_id: a, input: {} });
    await expect(kernel.jobs.submit('n', { kind: 'skill', title: 'c', parent_job_id: b, input: {} })).rejects.toThrow(/嵌套/);
  });
});

describe('审批', () => {
  it('挂起 → approval.requested → tasks.approve allow 继续；deny 时能力抛 permission_denied', async () => {
    const { kernel, core, events, call } = await makeKernelCore();
    kernel.registerCapabilities({ write_thing: capability({ name: 'write_thing', description: '写一个东西', perm: 'confirm', params: Type.Object({ v: Type.Number() }), async run(p) { return { wrote: p.v }; } }) });
    const results: unknown[] = [];
    kernel.jobs.register('w', async (job: JobContext) => {
      const ctx = core.ctx({ origin: 'skill', job_id: job.job_id, skill_id: 'tutor' });
      try { results.push(await kernel.registry.call('write_thing', { v: 1 }, ctx)); } catch (e) { results.push(e instanceof TibiError ? e.code : 'other'); }
      return { summary: 'ok' };
    });
    const { task_id } = await kernel.jobs.submit('w', { kind: 'skill', skill_id: 'tutor', title: 'w', input: {} });
    await until(() => events.some(e => e.event === 'approval.requested'));
    const approval = events.find(e => e.event === 'approval.requested')!.data.approval;
    expect(approval.task_id).toBe(task_id); expect(approval.tool).toBe('write_thing'); expect(approval.title).toContain('Tibi 想');
    expect((await kernel.jobs.summary(task_id))?.state).toBe('appr');
    const list = await call('tasks.list', {});
    expect(list.pending.length).toBe(1); expect(list.running[0].state).toBe('appr');
    await call('tasks.approve', { id: task_id, decision: 'allow' });
    expect((await kernel.jobs.wait(task_id)).status).toBe('done');
    expect(results).toEqual([{ wrote: 1 }]);
    expect(events.some(e => e.event === 'approval.resolved' && e.data.decision === 'allow')).toBe(true);

    // 第二次：拒绝
    const { task_id: t2 } = await kernel.jobs.submit('w', { kind: 'skill', skill_id: 'tutor', title: 'w2', input: {} });
    await until(() => events.filter(e => e.event === 'approval.requested').length === 2);
    await call('tasks.approve', { id: t2, decision: 'deny' });
    await kernel.jobs.wait(t2);
    expect(results[1]).toBe('permission_denied');
  });

  it('always 规则：下次自动允许；读过不可信内容的任务不生效', async () => {
    const { kernel, core, events, call, db } = await makeKernelCore();
    kernel.registerCapabilities({ save_x: capability({ name: 'save_x', description: '保存 x', perm: 'confirm', params: Type.Object({}), async run() { return 1; } }) });
    let taint = false;
    kernel.jobs.register('w', async (job: JobContext) => {
      if (taint) job.markTainted();
      const ctx = core.ctx({ origin: 'skill', job_id: job.job_id, skill_id: 'coach' });
      await kernel.registry.call('save_x', {}, ctx);
      return { summary: 'ok' };
    });
    const { task_id } = await kernel.jobs.submit('w', { kind: 'skill', skill_id: 'coach', title: 'w', input: {} });
    await until(() => events.some(e => e.event === 'approval.requested'));
    await call('tasks.approve', { id: task_id, decision: 'allow', always: true });
    expect((await kernel.jobs.wait(task_id)).status).toBe('done');
    expect(await db.get('SELECT value FROM settings WHERE key = ?', ['perm.auto.coach.save_x'])).toBeTruthy();
    // 第二次不再问
    const { task_id: t2 } = await kernel.jobs.submit('w', { kind: 'skill', skill_id: 'coach', title: 'w2', input: {} });
    expect((await kernel.jobs.wait(t2)).status).toBe('done');
    expect(events.filter(e => e.event === 'approval.requested').length).toBe(1);
    // 读过不可信内容：规则不生效，照样问
    taint = true;
    const { task_id: t3 } = await kernel.jobs.submit('w', { kind: 'skill', skill_id: 'coach', title: 'w3', input: {} });
    await until(() => events.filter(e => e.event === 'approval.requested').length === 2);
    const a3 = events.filter(e => e.event === 'approval.requested')[1]!.data.approval;
    expect(a3.untrusted).toBe(true);
    await call('tasks.approve', { id: t3, decision: 'allow' });
    expect((await kernel.jobs.wait(t3)).status).toBe('done');
  });

  it('界面直接调用写能力不审批；默认模式下技能的 write 自动、confirm 要问', async () => {
    const { kernel, core } = await makeKernelCore();
    kernel.registerCapabilities({
      w: capability({ name: 'w', description: '写', perm: 'write', params: Type.Object({}), async run() { return 'w'; } }),
      c: capability({ name: 'c', description: '确认', perm: 'confirm', params: Type.Object({}), async run() { return 'c'; } }),
    });
    expect(await kernel.registry.call('c', {}, core.ctx({ origin: 'ui' }))).toBe('c');
    let asked = 0;
    kernel.jobs.register('t', async (job: JobContext) => {
      const ctx = core.ctx({ origin: 'skill', job_id: job.job_id, skill_id: 'tutor' });
      const a = await kernel.registry.call('w', {}, ctx);
      const p = kernel.registry.call('c', {}, ctx);
      await until(() => (kernel.jobs as unknown as { active: Map<string, { approval?: unknown }> }).active.get(job.job_id)?.approval !== undefined);
      asked++;
      await kernel.jobs.approve(job.job_id, 'allow');
      return { summary: `${a}${await p}` };
    });
    const { task_id } = await kernel.jobs.submit('t', { kind: 'skill', skill_id: 'tutor', title: 't', input: {} });
    const r = await kernel.jobs.wait(task_id);
    expect(r.status).toBe('done'); expect(r.output).toEqual({ summary: 'wc' }); expect(asked).toBe(1);
  });
});
