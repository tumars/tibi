import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { capability } from '../../src/index.js';
import { makeKernelCore, until } from './helpers.js';

describe('chat.* 与 pi 桥接', () => {
  it('chat.open / send：消息落库、流式事件、工具调用经审批、用量入账', async () => {
    const { kernel, call, events, db, stream } = await makeKernelCore({ turns: [
      { toolCalls: [{ name: 'lookup_fake', args: { word: 'upshot' } }] },
      { toolCalls: [{ name: 'mark_fake', args: { term: 'upshot', status: 1 } }] },
      { text: 'upshot 在这里是"结果"的意思。' },
    ] });
    kernel.registerCapabilities({
      lookup_fake: capability({ name: 'lookup_fake', description: '查词', perm: 'read', params: Type.Object({ word: Type.String() }), async run(p) { return { word: p.word, meaning: '结果' }; } }),
      mark_fake: capability({ name: 'mark_fake', description: '标记一个词', perm: 'confirm', params: Type.Object({ term: Type.String(), status: Type.Integer() }), async run(p) { return { ok: true, term: p.term }; } }),
    });
    // tibi 技能的 allowed-tools 里没有这两个假能力；用 skills 表外的办法：直接改定义
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.allowed_tools.push('lookup_fake', 'mark_fake');

    const conv = await call('chat.open', {});
    expect(conv.kind).toBe('chat');
    const { submission_id } = await call('chat.send', { conversation_id: conv.id, text: 'upshot 是什么意思？', context: { page: 'reader', document_id: 'doc1', selection: 'The upshot is…', sentence_id: 's1' } });
    await until(() => events.some(e => e.event === 'approval.requested'));
    const appr = events.find(e => e.event === 'approval.requested')!.data.approval;
    expect(appr.tool).toBe('mark_fake'); expect(appr.skill_id).toBe('tibi');
    await call('tasks.approve', { id: submission_id, decision: 'allow' });
    const r = await kernel.jobs.wait(submission_id);
    expect(r.status).toBe('done');
    expect(stream.calls).toBe(3);

    // 消息：user + assistant
    const hist = await call('chat.history', { conversation_id: conv.id });
    expect(hist.items.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(hist.items[1].text).toContain('结果');
    expect(hist.items[0].task_id).toBe(submission_id);
    // 事件
    const deltas = events.filter(e => e.event === 'chat.delta' && e.data.submission_id === submission_id);
    expect(deltas.map(d => d.data.delta).join('')).toContain('结果');
    expect(deltas[deltas.length - 1]!.data.done).toBe(true);
    const tools = events.filter(e => e.event === 'chat.tool');
    expect(tools.map(t => `${t.data.tool}:${t.data.phase}`)).toEqual(['lookup_fake:start', 'lookup_fake:end', 'mark_fake:start', 'mark_fake:end']);
    // 步骤：两个 tool + 三个 model
    const steps = await db.all<{ kind: string; name: string; status: string }>('SELECT kind, name, status FROM job_steps WHERE job_id = ? ORDER BY idx', [submission_id]);
    expect(steps.filter(s => s.kind === 'tool').length).toBe(2);
    expect(steps.filter(s => s.kind === 'model').length).toBe(3);
    expect(steps.every(s => s.status === 'done')).toBe(true);
    // 用量
    const usage = await db.all<{ model: string; input_tokens: number; output_tokens: number; cost: number; skill_id: string }>('SELECT model, input_tokens, output_tokens, cost, skill_id FROM usage_records WHERE job_id = ?', [submission_id]);
    expect(usage.length).toBe(3); expect(usage[0]!.model).toBe('fake-flash'); expect(usage[0]!.skill_id).toBe('tibi');
    expect(usage[0]!.cost).toBeCloseTo(0.00014 * 7.2, 6);
    expect(events.some(e => e.event === 'usage.updated')).toBe(true);
    // 任务详情
    const task = await call('tasks.get', { id: submission_id });
    expect(task.state).toBe('done'); expect(task.usage.tokens_out).toBe(60); expect(task.transcript.length).toBe(2); expect(task.steps.length).toBe(5);
    const diag = await call('tasks.diagnostics', { id: submission_id });
    expect(diag.text).toContain('tool.mark_fake'); expect(diag.text).not.toContain('upshot 在这里');
    // 对话列表与改名、删除
    expect((await call('chat.list', {})).length).toBe(1);
    expect((await call('chat.rename', { conversation_id: conv.id, title: '关于 upshot' })).title).toBe('关于 upshot');
    await call('chat.delete', { conversation_id: conv.id });
    expect((await call('chat.list', {})).length).toBe(0);
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM messages'))?.n).toBe(0);
    skillDef('tibi')!.allowed_tools.splice(-2, 2);
  });

  it('chat.list 只列说过话的；删除对话时取消进行中的任务', async () => {
    const { kernel, call, events, db } = await makeKernelCore({ turns: [{ toolCalls: [{ name: 'mark_fake', args: { term: 'upshot' } }] }, { text: '不该写回' }] });
    kernel.registerCapabilities({ mark_fake: capability({ name: 'mark_fake', description: '标记一个词', perm: 'confirm', params: Type.Object({ term: Type.String() }), async run() { return { ok: true }; } }) });
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.allowed_tools.push('mark_fake');

    await call('chat.open', {});
    expect(await call('chat.list', {})).toEqual([]);
    const conv = await call('chat.open', {});
    const { submission_id } = await call('chat.send', { conversation_id: conv.id, text: 'upshot 是什么意思？' });
    expect((await call('chat.list', {})).map((c: { id: string }) => c.id)).toEqual([conv.id]);

    await until(() => events.some(e => e.event === 'approval.requested'));
    await call('chat.delete', { conversation_id: conv.id });
    expect((await kernel.jobs.wait(submission_id)).status).toBe('cancelled');
    expect(await call('chat.list', {})).toEqual([]);
    expect((await db.get<{ n: number }>('SELECT count(*) AS n FROM messages'))?.n).toBe(0);
    skillDef('tibi')!.allowed_tools.pop();
  });

  it('chat.open：document_id 续线程；today 一天一条', async () => {
    const { call, db } = await makeKernelCore();
    const t = Date.now();
    await db.run("INSERT INTO documents(id, title, kind, source_type, content_hash, created_at, updated_at) VALUES ('d1', '一篇文章', 'article', 'text', 'h', ?, ?)", [t, t]);
    const a = await call('chat.open', { document_id: 'd1' });
    const b = await call('chat.open', { document_id: 'd1' });
    expect(a.id).toBe(b.id); expect(a.kind).toBe('document'); expect(a.title).toBe('一篇文章'); expect(a.document_id).toBe('d1');
    const d1 = await call('chat.open', { today: true });
    const d2 = await call('chat.open', { today: true });
    expect(d1.id).toBe(d2.id); expect(d1.kind).toBe('day'); expect(d1.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('没有模型：任务 deferred（model_unavailable）；预算超出：budget_exceeded', async () => {
    const { kernel, call, db } = await makeKernelCore({ noModel: true });
    const conv = await call('chat.open', {});
    const { submission_id } = await call('chat.send', { conversation_id: conv.id, text: 'hi' });
    const r = await kernel.jobs.wait(submission_id);
    expect(r.status).toBe('deferred'); expect(r.error).toContain('模型');

    const k2 = await makeKernelCore();
    await k2.db.run("INSERT INTO settings(key, value, updated_at) VALUES ('budget.month', '0.001', 0)");
    await k2.db.run("INSERT INTO usage_records(id, model, cost, created_at) VALUES ('u1', 'm', 0.002, ?)", [Date.now()]);
    const c2 = await k2.call('chat.open', {});
    const { submission_id: s2 } = await k2.call('chat.send', { conversation_id: c2.id, text: 'hi' });
    const r2 = await k2.kernel.jobs.wait(s2);
    expect(r2.status).toBe('deferred'); expect(r2.error).toContain('上限');
    void db;
  });

  it('模型报错：任务失败并带错误信息；取消：cancelled', async () => {
    const { kernel, call } = await makeKernelCore({ turns: [{ error: '401 unauthorized' }] });
    const conv = await call('chat.open', {});
    const { submission_id } = await call('chat.send', { conversation_id: conv.id, text: 'hi' });
    const r = await kernel.jobs.wait(submission_id);
    expect(r.status).toBe('deferred'); expect(r.error).toContain('401');
  });

  it('run_skill：主对话运行技能（子任务），子对话不能再运行', async () => {
    const { kernel, call, db } = await makeKernelCore({ turns: [
      { toolCalls: [{ name: 'run_skill', args: { skill_id: 'insight', input: '看看我的情况', wait: true } }] },
      { text: '（insight）你最近读得不少。' },
      { text: '洞察说：你最近读得不少。' },
    ] });
    const conv = await call('chat.open', {});
    const { submission_id } = await call('chat.send', { conversation_id: conv.id, text: '给我一点洞察' });
    const r = await kernel.jobs.wait(submission_id);
    expect(r.status).toBe('done'); expect((r.output as { text: string }).text).toContain('洞察说');
    const child = await db.get<{ id: string; skill_id: string; status: string }>('SELECT id, skill_id, status FROM jobs WHERE parent_job_id = ?', [submission_id]);
    expect(child?.skill_id).toBe('insight'); expect(child?.status).toBe('done');
    const list = await call('tasks.list', {});
    expect(list.history.map((t: { id: string }) => t.id)).toEqual([submission_id]);   // 子任务不单独列
    expect(list.kpis.top_skill.id).toBe('tibi');
  });

  it('skills.*：列表、更新、重置；runNow 起任务', async () => {
    const { kernel, call } = await makeKernelCore({ turns: [{ text: '找到两篇。' }] });
    const list = await call('skills.list', {});
    expect(list.map((s: { id: string }) => s.id)).toEqual(['tibi', 'scout', 'tutor', 'coach', 'insight', 'archivist']);
    expect(list.find((s: { id: string }) => s.id === 'scout').write_permission).toBe('ask');
    const u = await call('skills.update', { id: 'tutor', patch: { model_tier: 'deep', extra_instructions: '多举例' } });
    expect(u.model_tier).toBe('deep'); expect(u.extra_instructions).toBe('多举例');
    const s2 = await call('skills.update', { id: 'scout', patch: { write_permission: 'inherit' } });
    expect(s2.write_permission).toBe('ask');   // SKILL.md 的 ask 不能放宽
    expect((await call('skills.reset', { id: 'tutor' })).model_tier).toBe('fast');
    const { task_id } = await call('skills.runNow', { id: 'scout', input: '找点 Rust 的文章' });
    expect((await kernel.jobs.wait(task_id)).status).toBe('done');
    expect((await call('skills.list', {})).find((s: { id: string }) => s.id === 'scout').month_cost).toBeGreaterThan(0);
  });

  it('get_context 聚合画像、今天、最近文章与界面上下文', async () => {
    const { kernel, core, db } = await makeKernelCore();
    const t = Date.now();
    await db.run("UPDATE user_profile SET level_self = 'cet6', vocab_estimate = 6200, goal = 'work', interests = '[\"tech\"]' WHERE id = '1'");
    await db.run("INSERT INTO documents(id, title, kind, source_type, content_hash, progress, created_at, updated_at) VALUES ('d1', 'Doc', 'article', 'text', 'h', 0.4, ?, ?)", [t, t]);
    kernel.setUiContext({ page: 'reader', document_id: 'd1', selection: 'hello', sentence_id: 's1' });
    const c = await kernel.registry.call<Record<string, any>>('get_context', {}, core.ctx({ origin: 'skill' }));
    expect(c.page).toBe('reader'); expect(c.document.title).toBe('Doc'); expect(c.selection.text).toBe('hello');
    expect(c.profile.vocab_estimate).toBe(6200); expect(c.recent_documents.length).toBe(1); expect(c.permission).toBe('default');
    const hits = await kernel.registry.call<{ name: string }[]>('tool_search', { q: '记忆' }, core.ctx({ origin: 'skill' }));
    expect(hits.map(h => h.name)).toContain('search_memory');
    expect(kernel.registry.listForMcp().some(c => c.name === 'run_skill')).toBe(false);
  });
});
