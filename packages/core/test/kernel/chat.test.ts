import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { capability } from '../../src/index.js';
import { makeKernelCore, until } from './helpers.js';

describe('chat.* 与 pi 桥接', () => {
  it('chat.send：选定的模型传给模型解析；不选时按技能档位', async () => {
    const { kernel, call, resolved } = await makeKernelCore({ turns: [{ text: '一' }, { text: '二' }] });
    const conv = await call('chat.open', {});
    const a = await call('chat.send', { conversation_id: conv.id, text: '第一句', provider_id: 'p1' });
    await kernel.jobs.wait(a.submission_id);
    const b = await call('chat.send', { conversation_id: conv.id, text: '第二句' });
    await kernel.jobs.wait(b.submission_id);
    expect(resolved.map(r => r.provider_id)).toEqual(['p1', undefined]);
  });

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

describe('对话卡片', () => {
  async function run(turns: Parameters<typeof makeKernelCore>[0]) {
    const k = await makeKernelCore(turns);
    k.kernel.registerCapabilities({
      card_fake: capability({ name: 'card_fake', description: '假卡片', perm: 'read', params: Type.Object({ w: Type.String() }), async run(p) { return { w: p.w }; }, widget: r => r.w === 'none' ? undefined : r.w === 'boom' ? (() => { throw new Error('boom'); })() : { kind: 'word', summary: `词 ${r.w}`, data: { word: r.w, translation: 'n. 结果', in_wordbook: false } } }),
    });
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.allowed_tools.push('card_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '查一下' });
    const r = await k.kernel.jobs.wait(submission_id);
    skillDef('tibi')!.allowed_tools.pop();
    return { ...k, conv, submission_id, r };
  }
  const call = (w: string) => ({ name: 'card_fake', args: { w } });

  it('工具结果变成卡片：按顺序保存所有文字，发事件，失败或不适合时不出卡', async () => {
    const { call: rpc, conv, events, r } = await run({ turns: [{ text: '我查一下。', toolCalls: [call('a'), call('none'), call('boom')] }, { text: '这是结果。' }] });
    expect(r.status).toBe('done');
    const [, msg] = (await rpc('chat.history', { conversation_id: conv.id })).items;
    expect(msg.text).toBe('我查一下。\n\n这是结果。');
    expect(msg.blocks.map((b: { type: string }) => b.type)).toEqual(['text', 'widget', 'text']);
    expect(events.filter(e => e.event === 'chat.block').map(e => e.data.block.id)).toEqual([msg.blocks[1].id]);
  });

  it('同样的卡不重复，一次回答最多三张；没有卡片时不写 blocks', async () => {
    const { call: rpc, conv } = await run({ turns: [{ toolCalls: ['a', 'a', 'b', 'c', 'd'].map(call) }, { text: '好' }] });
    const [, msg] = (await rpc('chat.history', { conversation_id: conv.id })).items;
    expect(msg.blocks.filter((b: { type: string }) => b.type === 'widget').length).toBe(3);
    const plain = await run({ turns: [{ text: '好' }] });
    expect((await plain.call('chat.history', { conversation_id: plain.conv.id })).items[1].blocks).toBeUndefined();
  });

  it('操作结果能保存，下一轮的模型历史里有卡片摘要和结果', async () => {
    const { call: rpc, conv, kernel, stream } = await run({ turns: [{ toolCalls: [call('a')] }, { text: '' }, { text: '接着说' }] });
    const [, msg] = (await rpc('chat.history', { conversation_id: conv.id })).items;
    expect(msg.text).toBe('');
    await rpc('chat.widget_update', { message_id: msg.id, widget_id: msg.blocks[0].id, state: { added: true }, result: '已加入生词本' });
    const opened = await rpc('chat.open', { conversation_id: conv.id });
    expect(opened.messages[1].blocks[0].state).toEqual({ added: true });
    await expect(rpc('chat.widget_update', { message_id: msg.id, widget_id: 'nope', state: {} })).rejects.toThrow();
    const { messageForModel } = await import('../../src/kernel/conversations.js');
    expect(messageForModel(opened.messages[1])).toBe('[界面上显示了卡片：词 a；用户操作：已加入生词本]');
    const { submission_id } = await rpc('chat.send', { conversation_id: conv.id, text: '第二句' });
    expect((await kernel.jobs.wait(submission_id)).status).toBe('done');
    void stream;
  });
});

describe('中断与接续', () => {
  const pushTool = async (skill: string, tool: string) => {
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef(skill)!.allowed_tools.push(tool);
    return () => { skillDef(skill)!.allowed_tools.pop(); };
  };

  it('模型出错：已成功轮次的文字留下来并标记中断；重试时替换', async () => {
    const k = await makeKernelCore({ turns: [{ text: '先说一半', toolCalls: [{ name: 'noop_fake', args: {} }] }, { error: '401 unauthorized' }, { text: '完整回答' }] });
    k.kernel.registerCapabilities({ noop_fake: capability({ name: 'noop_fake', description: '空操作', perm: 'read', params: Type.Object({}), async run() { return {}; } }) });
    const off = await pushTool('tibi', 'noop_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '问题' });
    expect((await k.kernel.jobs.wait(submission_id)).status).toBe('deferred');
    let items = (await k.call('chat.history', { conversation_id: conv.id })).items;
    expect(items[1].text).toBe('先说一半');
    expect(items[1].interrupted.reason).toBe('error');
    expect(items[1].interrupted.message).toContain('401');
    await k.call('tasks.retry', { id: submission_id });
    expect((await k.kernel.jobs.wait(submission_id)).status).toBe('done');
    off();
    items = (await k.call('chat.history', { conversation_id: conv.id })).items;
    expect(items.map((m: { text: string }) => m.text)).toEqual(['问题', '完整回答']);
    expect(items[1].interrupted).toBeUndefined();
  });

  it('什么都没说就失败：错误留在对话里，不进模型历史；没连模型也一样', async () => {
    const k = await makeKernelCore({ turns: [{ error: '401 unauthorized' }] });
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '问题' });
    await k.kernel.jobs.wait(submission_id);
    const [, msg] = (await k.call('chat.history', { conversation_id: conv.id })).items;
    expect(msg.text).toBe(''); expect(msg.interrupted.message).toContain('401');
    const { messageForModel } = await import('../../src/kernel/conversations.js');
    expect(messageForModel(msg)).toBe('');
    const none = await makeKernelCore({ noModel: true });
    const c2 = await none.call('chat.open', {});
    const { submission_id: s2 } = await none.call('chat.send', { conversation_id: c2.id, text: '问题' });
    await none.kernel.jobs.wait(s2);
    expect((await none.call('chat.history', { conversation_id: c2.id })).items[1].interrupted.message).toContain('模型');
  });

  it('同一段对话一次只答一句；答完可以再发', async () => {
    const k = await makeKernelCore({ turns: [{ toolCalls: [{ name: 'mark_fake', args: {} }] }, { text: '好' }] });
    k.kernel.registerCapabilities({ mark_fake: capability({ name: 'mark_fake', description: '标记', perm: 'confirm', params: Type.Object({}), async run() { return {}; } }) });
    const off = await pushTool('tibi', 'mark_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '一' });
    await expect(k.call('chat.send', { conversation_id: conv.id, text: '二' })).rejects.toThrow('还在回答');
    expect((await k.call('chat.history', { conversation_id: conv.id })).items.length).toBe(1);
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    await k.call('tasks.approve', { id: submission_id, decision: 'allow' });
    await k.kernel.jobs.wait(submission_id);
    off();
    const again = await k.call('chat.send', { conversation_id: conv.id, text: '二' });
    await k.kernel.jobs.wait(again.submission_id);
  });

  it('自定义模型的单价按人民币填，换算后花费对得上', async () => {
    const k = await makeKernelCore();
    const { customModelCost } = await import('../../src/kernel/agent.js');
    expect((await customModelCost(k.db, 'p1')).input).toBe(0);
    await k.db.run("INSERT INTO settings(key, value, updated_at) VALUES ('provider.price.p1', ?, 0)", [JSON.stringify({ input: 7.2, output: 14.4 })]);
    const cost = await customModelCost(k.db, 'p1');
    expect(cost.input).toBeCloseTo(1); expect(cost.output).toBeCloseTo(2);
  });

  it('翻历史：同一毫秒的消息不跳过', async () => {
    const k = await makeKernelCore();
    const conv = await k.call('chat.open', {});
    for (let i = 0; i < 5; i++) await k.db.run("INSERT INTO messages(id, conversation_id, role, content, created_at, updated_at) VALUES (?, ?, 'user', ?, 1000, 1000)", [`m${i}`, conv.id, JSON.stringify({ text: String(i) })]);
    const a = await k.call('chat.history', { conversation_id: conv.id, limit: 2 });
    const b = await k.call('chat.history', { conversation_id: conv.id, limit: 2, cursor: a.cursor });
    const c = await k.call('chat.history', { conversation_id: conv.id, limit: 2, cursor: b.cursor });
    expect([...c.items, ...b.items, ...a.items].map((m: { text: string }) => m.text)).toEqual(['0', '1', '2', '3', '4']);
    expect(c.cursor).toBeUndefined();
  });

  it('停止：已有内容留下来；等审批时重开对话能接上', async () => {
    const k = await makeKernelCore({ turns: [{ text: '我先记一下', toolCalls: [{ name: 'mark_fake', args: { term: 'upshot' } }] }, { text: '不该出现' }] });
    k.kernel.registerCapabilities({ mark_fake: capability({ name: 'mark_fake', description: '标记一个词', perm: 'confirm', params: Type.Object({ term: Type.String() }), async run() { return { ok: true }; } }) });
    const off = await pushTool('tibi', 'mark_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '问题' });
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    const opened = await k.call('chat.open', { conversation_id: conv.id });
    expect(opened.active).toEqual([submission_id]);
    expect(opened.approvals.map((a: { task_id: string }) => a.task_id)).toEqual([submission_id]);
    expect(opened.approvals[0].conversation_id).toBe(conv.id);
    await k.call('chat.cancel', { submission_id });
    off();
    const after = await k.call('chat.open', { conversation_id: conv.id });
    expect(after.active).toEqual([]); expect(after.approvals).toEqual([]);
    expect(after.messages[1].text).toBe('我先记一下');
    expect(after.messages[1].interrupted).toEqual({ reason: 'cancel' });
  });

  it('子任务的审批算在父任务的对话上', async () => {
    const k = await makeKernelCore({ turns: [
      { toolCalls: [{ name: 'run_skill', args: { skill_id: 'scout', input: '找文章', wait: true } }] },
      { toolCalls: [{ name: 'save_fake', args: { url: 'u' } }] },
      { text: '子任务好了' },
      { text: '都好了' },
    ] });
    k.kernel.registerCapabilities({ save_fake: capability({ name: 'save_fake', description: '存一篇', perm: 'confirm', params: Type.Object({ url: Type.String() }), async run() { return { ok: true }; } }) });
    const off = await pushTool('scout', 'save_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '找点文章' });
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    const appr = k.events.find(e => e.event === 'approval.requested')!.data.approval;
    expect(appr.task_id).not.toBe(submission_id);
    expect(appr.conversation_id).toBe(conv.id);
    expect((await k.call('chat.open', { conversation_id: conv.id })).approvals.map((a: { task_id: string }) => a.task_id)).toEqual([appr.task_id]);
    await k.call('tasks.approve', { id: appr.task_id, decision: 'allow' });
    expect((await k.kernel.jobs.wait(submission_id)).status).toBe('done');
    off();
  });

  it('工具结束事件带结果：成功、失败、拒绝', async () => {
    const k = await makeKernelCore({ turns: [{ toolCalls: [{ name: 'ok_fake', args: {} }, { name: 'bad_fake', args: {} }, { name: 'ask_fake', args: {} }] }, { text: '好' }] });
    k.kernel.registerCapabilities({
      ok_fake: capability({ name: 'ok_fake', description: '成功', perm: 'read', params: Type.Object({}), async run() { return {}; } }),
      bad_fake: capability({ name: 'bad_fake', description: '失败', perm: 'read', params: Type.Object({}), async run() { throw new Error('坏了'); } }),
      ask_fake: capability({ name: 'ask_fake', description: '要确认', perm: 'confirm', params: Type.Object({}), async run() { return {}; } }),
    });
    const offs = [await pushTool('tibi', 'ok_fake'), await pushTool('tibi', 'bad_fake'), await pushTool('tibi', 'ask_fake')];
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '问题' });
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    await k.call('tasks.approve', { id: submission_id, decision: 'deny' });
    await k.kernel.jobs.wait(submission_id);
    offs.forEach(off => off());
    const ends = k.events.filter(e => e.event === 'chat.tool' && e.data.phase === 'end');
    expect(Object.fromEntries(ends.map(e => [e.data.tool, e.data.status]))).toEqual({ ok_fake: 'ok', bad_fake: 'error', ask_fake: 'denied' });
  });
});

describe('过程卡、审批卡、压缩、上下文', () => {
  const addTool = async (name: string) => {
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.allowed_tools.push(name);
    return () => { skillDef('tibi')!.allowed_tools.pop(); };
  };

  it('步骤写进回答，带具体对象；重开还在', async () => {
    const k = await makeKernelCore({ turns: [{ toolCalls: [{ name: 'look_fake', args: { word: 'affect' } }] }, { text: '好' }] });
    k.kernel.registerCapabilities({ look_fake: capability({ name: 'look_fake', description: '查一个词（查词典）', perm: 'read', params: Type.Object({ word: Type.String() }), async run() { return {}; } }) });
    const off = await addTool('look_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '问' });
    await k.kernel.jobs.wait(submission_id);
    off();
    expect(k.events.find(e => e.event === 'chat.tool')!.data.summary).toBe('Tibi 正在查一个词：affect');
    expect((await k.call('chat.history', { conversation_id: conv.id })).items[1].steps).toEqual([{ tool: 'look_fake', summary: '查一个词：affect', status: 'ok' }]);
  });

  it('审批卡正文可读；修改后允许用改过的内容，且要过校验', async () => {
    let saved = '';
    const k = await makeKernelCore({ turns: [{ toolCalls: [{ name: 'rem_fake', args: { content: '总把 affect 和 effect 搞混', memory_id: 'x1' } }] }, { text: '好' }] });
    k.kernel.registerCapabilities({ rem_fake: capability({ name: 'rem_fake', description: '记住一件事', perm: 'confirm', params: Type.Object({ content: Type.String({ maxLength: 50 }), memory_id: Type.String() }), async run(p) { saved = p.content; return {}; } }) });
    const off = await addTool('rem_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '问' });
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    const a = k.events.find(e => e.event === 'approval.requested')!.data.approval;
    expect(a.body).toBe('总把 affect 和 effect 搞混');
    expect(a.editable).toEqual({ field: 'content', value: '总把 affect 和 effect 搞混' });
    expect(a.impact).toBe('写入数据');
    await k.call('tasks.approve', { id: submission_id, decision: 'edit', edited: { content: '总把两个词搞混' } });
    await k.kernel.jobs.wait(submission_id);
    off();
    expect(saved).toBe('总把两个词搞混');
  });

  it('易变上下文在用户消息前缀，不在系统提示，也不写进历史', async () => {
    const k = await makeKernelCore({ turns: [{ text: '一' }, { text: '二' }] });
    const conv = await k.call('chat.open', {});
    const a = await k.call('chat.send', { conversation_id: conv.id, text: '第一句', context: { page: 'reader' } });
    await k.kernel.jobs.wait(a.submission_id);
    const b = await k.call('chat.send', { conversation_id: conv.id, text: '第二句' });
    await k.kernel.jobs.wait(b.submission_id);
    const sent = k.stream.contexts[1]!;
    expect(sent.match(/<context>/g)!.length).toBe(2);   // 只有这一轮的前缀，外加系统提示里的说明
    expect(sent).toContain('第一句');
    expect(sent.indexOf('## 当前状态')).toBeGreaterThan(sent.indexOf('第一句'));
    expect((await k.call('chat.history', { conversation_id: conv.id })).items[0].text).toBe('第一句');
  });

  it('长对话：旧内容摘要进系统提示，原文保留；摘要失败不影响回答', async () => {
    const k = await makeKernelCore({ turns: [{ text: '摘要：查过 affect' }, { text: '回答' }, { error: '500' }, { text: '回答二' }] });
    const conv = await k.call('chat.open', {});
    const seed = async (from: number, n: number) => { for (let i = 0; i < n; i++) await k.db.run("INSERT INTO messages(id, conversation_id, role, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [`m${from + i}`, conv.id, i % 2 ? 'assistant' : 'user', JSON.stringify({ text: `旧${from + i}` }), 1000 + from + i, 1000]); };
    await seed(0, 40);
    const a = await k.call('chat.send', { conversation_id: conv.id, text: '新问题' });
    await k.kernel.jobs.wait(a.submission_id);
    expect(k.stream.calls).toBe(2);
    expect(k.stream.contexts[1]).toContain('摘要：查过 affect');
    expect(k.stream.contexts[0]).toContain('旧0');
    expect(k.stream.contexts[1]).not.toContain('"旧0"');
    const msgs = await k.db.get<{ n: number }>('SELECT count(*) AS n FROM messages WHERE conversation_id = ?', [conv.id]);
    expect(msgs?.n).toBe(42);
    const { items } = await k.call('chat.history', { conversation_id: conv.id, limit: 1 });
    expect(items[0].steps[0]).toEqual({ tool: 'compact', summary: '整理前面的对话', status: 'ok' });
    // 再攒够一批，这次摘要失败：回答照常，旧摘要还在
    await seed(100, 20);
    await k.db.run('UPDATE messages SET created_at = 2000 + rowid WHERE id LIKE ?', ['m1__']);
    const b = await k.call('chat.send', { conversation_id: conv.id, text: '再问' });
    expect((await k.kernel.jobs.wait(b.submission_id)).status).toBe('done');
    expect(k.stream.contexts[k.stream.contexts.length - 1]).toContain('摘要：查过 affect');
  });
});

describe('消息操作与写入回执', () => {
  it('回到某句话之前：后面的作废，返回原话和技能；回答中不能改；摘要失效', async () => {
    const k = await makeKernelCore({ turns: [{ text: '一' }, { text: '二' }] });
    const conv = await k.call('chat.open', {});
    const a = await k.call('chat.send', { conversation_id: conv.id, text: '第一句', skill: 'tutor' });
    await k.kernel.jobs.wait(a.submission_id);
    const b = await k.call('chat.send', { conversation_id: conv.id, text: '第二句' });
    await k.kernel.jobs.wait(b.submission_id);
    const { items } = await k.call('chat.history', { conversation_id: conv.id });
    await k.db.run('UPDATE conversations SET summary = ? WHERE id = ?', [JSON.stringify({ text: '旧', upto: Date.now() + 1000 }), conv.id]);
    expect(await k.call('chat.rewind', { conversation_id: conv.id, message_id: items[0].id })).toEqual({ text: '第一句', skill: 'tutor' });
    expect((await k.call('chat.history', { conversation_id: conv.id })).items).toEqual([]);
    expect((await k.db.get<{ summary: string | null }>('SELECT summary FROM conversations WHERE id = ?', [conv.id]))?.summary).toBeNull();
    await expect(k.call('chat.rewind', { conversation_id: conv.id, message_id: items[2].id })).rejects.toThrow('找不到');
  });

  it('写操作留回执；撤销后记下来，模型历史里也有', async () => {
    const undo = { undo_id: 'u1', expires_at: Date.now() + 1000 };
    const k = await makeKernelCore({ turns: [{ toolCalls: [{ name: 'add_fake', args: { words: [{ text: 'upshot' }] } }] }, { text: '好' }] });
    k.kernel.registerCapabilities({ add_fake: capability({ name: 'add_fake', description: '把几个词加入生词本（建卡）', perm: 'write', params: Type.Object({ words: Type.Array(Type.Object({ text: Type.String() })) }), async run() { return { undo }; } }) });
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.allowed_tools.push('add_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '记一下' });
    await k.kernel.jobs.wait(submission_id);
    skillDef('tibi')!.allowed_tools.pop();
    const msg = (await k.call('chat.history', { conversation_id: conv.id })).items[1];
    expect(msg.receipts).toEqual([{ summary: '已把几个词加入生词本：upshot', undo }]);
    await k.call('chat.receipt_undone', { message_id: msg.id, undo_id: 'u1' });
    const after = (await k.call('chat.history', { conversation_id: conv.id })).items[1];
    expect(after.receipts[0].undone).toBe(true);
    const { messageForModel } = await import('../../src/kernel/conversations.js');
    expect(messageForModel(after)).toContain('[用户撤销了：已把几个词加入生词本：upshot]');
  });
});

describe('接续与学习事件', () => {
  it('回答中重开对话：拿到已经说出来的部分', async () => {
    const k = await makeKernelCore({ turns: [{ text: '先说一半', toolCalls: [{ name: 'ask_fake', args: {} }] }, { text: '好' }] });
    k.kernel.registerCapabilities({ ask_fake: capability({ name: 'ask_fake', description: '要确认', perm: 'confirm', params: Type.Object({}), async run() { return {}; } }) });
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.allowed_tools.push('ask_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '问' });
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    const opened = await k.call('chat.open', { conversation_id: conv.id });
    expect(opened.live).toEqual([{ id: submission_id, blocks: [{ type: 'text', text: '先说一半' }], steps: [] }]);
    await k.call('tasks.approve', { id: submission_id, decision: 'allow' });
    await k.kernel.jobs.wait(submission_id);
    skillDef('tibi')!.allowed_tools.pop();
    expect((await k.call('chat.open', { conversation_id: conv.id })).live).toEqual([]);
  });

  it('上一句没有回答：历史里补占位，用户消息不连着', async () => {
    const k = await makeKernelCore({ turns: [{ error: '500' }, { text: '好' }] });
    const conv = await k.call('chat.open', {});
    const a = await k.call('chat.send', { conversation_id: conv.id, text: '第一句' });
    await k.kernel.jobs.wait(a.submission_id);
    const b = await k.call('chat.send', { conversation_id: conv.id, text: '第二句' });
    await k.kernel.jobs.wait(b.submission_id);
    const msgs = JSON.parse(k.stream.contexts[k.stream.contexts.length - 1]!) as { role: string }[];
    const roles = msgs.map(m => m.role).filter(r => r !== 'system');
    expect(roles).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(msgs)).toContain('这句没有得到回答');
  });

  it('练习做完记 quiz_done，只记一次；再做一遍算新的', async () => {
    const k = await makeKernelCore();
    const conv = await k.call('chat.open', {});
    const block = { type: 'widget', id: 'w1', v: 1, kind: 'quiz', summary: 's', data: { items: [{ term: 'upshot', type: 'choice', prompt: 'upshot', options: ['结果', '原因'], answer: ['结果'] }, { term: 'borrow', type: 'choice', prompt: 'borrow', options: ['借', '还'], answer: ['借'] }] } };
    await k.db.run("INSERT INTO messages(id, conversation_id, role, content, created_at, updated_at) VALUES ('m1', ?, 'assistant', ?, 1, 1)", [conv.id, JSON.stringify({ text: '', blocks: [block] })]);
    const update = (picks: string[]) => k.call('chat.widget_update', { message_id: 'm1', widget_id: 'w1', state: { picks } });
    const events = async () => k.db.all<{ payload: string }>("SELECT payload FROM learning_events WHERE type = 'quiz_done'");
    await update(['原因']);
    expect(await events()).toEqual([]);
    await update(['原因', '借']);
    await update(['原因', '借']);
    expect((await events()).map(e => JSON.parse(e.payload))).toEqual([{ total: 2, correct: 1, wrong: ['upshot'] }]);
    await update([]);
    await update(['结果', '借']);
    expect((await events()).length).toBe(2);
  });
});

describe('崩溃恢复', () => {
  it('恢复后模型重新发起同样的写操作：不再执行一遍', async () => {
    const k = await makeKernelCore({ turns: [{ toolCalls: [{ name: 'record_fake', args: { card: 'c1', rating: 3 } }] }, { text: '记好了' }] });
    let runs = 0;
    k.kernel.registerCapabilities({ record_fake: capability({ name: 'record_fake', description: '记一次复习', perm: 'write', replay: 'never', params: Type.Object({ card: Type.String(), rating: Type.Integer() }), async run() { runs++; return { n: runs }; } }) });
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.allowed_tools.push('record_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '复习' });
    await k.kernel.jobs.wait(submission_id);
    expect(runs).toBe(1);
    // 写完之后、任务结束之前进程崩溃：任务回到 running，模型重新回答（工具调用 id 不同）
    await k.db.run("UPDATE jobs SET status = 'running', finished_at = NULL WHERE id = ?", [submission_id]);
    await k.db.run("DELETE FROM messages WHERE role = 'assistant'");
    k.stream.reset();
    await k.kernel.jobs.resumeAll();
    await k.kernel.jobs.wait(submission_id);
    skillDef('tibi')!.allowed_tools.pop();
    expect(runs).toBe(1);
  });
});

describe('练习卡片的题目', () => {
  it('只保留能作答的选择题和填空题；一题都没有就不出卡', async () => {
    const { reviewCapabilities } = await import('../../src/domain/review/capabilities.js');
    const widget = reviewCapabilities.create_quiz!.widget!;
    const base = { term_id: 't', term: 'upshot', answer: ['upshot'], options: undefined, context: undefined };
    const spec = widget({ items: [
      { ...base, card_type: 'cloze', prompt: 'The ____ is clear.' },
      { ...base, card_type: 'cloze', prompt: '____' },
      { ...base, card_type: 'recognize', prompt: 'upshot' },
      { ...base, card_type: 'choice', prompt: 'upshot', answer: ['结果'], options: [{ text: '结果', from: 'a' }, { text: '原因', from: 'b' }] },
    ] }, {}) as { data: { items: { type: string; options?: string[] }[] } };
    expect(spec.data.items.map(i => i.type)).toEqual(['cloze', 'choice']);
    expect(spec.data.items[1]!.options).toEqual(['结果', '原因']);
    expect(widget({ items: [{ ...base, card_type: 'cloze', prompt: '____' }] }, {})).toBeUndefined();
  });
});
