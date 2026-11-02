import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { capability, EventBus, type JobContext } from '../../src/index.js';
import { documentsCapabilities, documentsMethods } from '../../src/domain/documents/index.js';
import { createKernel } from '../../src/kernel/index.js';
import { makeKernelCore, until, type Turn } from './helpers.js';

const URL_A = 'https://example.com/post-a'; const URL_B = 'https://example.org/post-b';
const importOf = (url: string) => ({ tool: 'import_document', params: { source: { type: 'url', url } } });
const askBoth = { name: 'ask_user', args: { question: '想读哪几篇？', multi: true, options: [{ label: '文章 A', action: importOf(URL_A) }, { label: '文章 B', action: importOf(URL_B) }] } };
const search = { name: 'web_search', args: { q: 'rust' } };

/** 脚本化模型 + 假搜索 + 假导入流水线 */
async function setup(turns: Turn[]) {
  const k = { ...await makeKernelCore({ turns }), wrote: [] as string[] };
  k.core.use(documentsMethods);
  k.kernel.registerCapabilities({
    import_document: documentsCapabilities['import_document']!,
    web_search: capability({ name: 'web_search', description: '假搜索', perm: 'read', params: Type.Object({ q: Type.String() }), async run() { return [{ url: URL_A, title: 'A' }, { url: URL_B, title: 'B' }]; } }),
    write_thing: capability({ name: 'write_thing', description: '写东西', perm: 'write', params: Type.Object({}), async run() { k.wrote.push('x'); return { ok: true }; } }),
  });
  const imported: string[] = [];
  k.kernel.jobs.register('import', async (_job: JobContext, input: { source: { url: string } }) => { imported.push(input.source.url); return { summary: 'ok' }; });
  const conv = await k.call<{ id: string }>('chat.open', {});
  const say = async (text: string, skill?: string) => {
    const { submission_id } = await k.call<{ submission_id: string }>('chat.send', { conversation_id: conv.id, text, skill });
    await k.kernel.jobs.wait(submission_id);
    return submission_id;
  };
  const card = async () => {
    const { items } = await k.call<{ items: { id: string; blocks?: any[] }[] }>('chat.history', { conversation_id: conv.id });
    for (const m of [...items].reverse()) { const b = m.blocks?.find(x => x.kind === 'ask'); if (b) return { message_id: m.id, widget_id: b.id as string, block: b }; }
    throw new Error('没有反问卡');
  };
  return { ...k, conv, say, card, imported };
}

describe('反问 ask_user', () => {
  it('找文章：搜索 → 问完这一轮就结束 → 对话不再占用', async () => {
    const k = await setup([{ toolCalls: [search] }, { toolCalls: [askBoth] }, { text: '不该走到这里' }]);
    const id = await k.say('找几篇 rust 文章', 'scout');
    expect(k.stream.calls).toBe(2);
    expect((await k.kernel.jobs.wait(id)).status).toBe('done');
    const { block } = await k.card();
    expect(block.data.untrusted).toBe(true);   // 搜过网页
    expect(block.data.options[0].action.preview).toContain('example.com');
    expect(block.summary).toContain('文章 A');
    expect((await k.call<{ active: string[] }>('chat.open', { conversation_id: k.conv.id })).active).toEqual([]);
  });

  it('点选：内核直接导入选中的那篇，不再审批、不调模型；只能答一次', async () => {
    const k = await setup([{ toolCalls: [search] }, { toolCalls: [askBoth] }]);
    await k.say('找文章', 'scout');
    const { message_id, widget_id } = await k.card();
    const calls = k.stream.calls;
    const r = await k.call<{ state: any; submission_id?: string }>('chat.answer', { message_id, widget_id, option_ids: ['o2'] });
    expect(r.submission_id).toBeUndefined();
    expect(r.state.results).toMatchObject([{ option_id: 'o2', ok: true }]);
    await until(() => k.imported.length === 1);
    expect(k.imported).toEqual([URL_B]);
    expect(k.stream.calls).toBe(calls);
    expect(k.events.some(e => e.event === 'approval.requested')).toBe(false);
    await expect(k.call('chat.answer', { message_id, widget_id, option_ids: ['o1'] })).rejects.toMatchObject({ code: 'conflict' });
    expect((await k.card()).block.result).toContain('文章 B');
  });

  it('没出现在查询结果里的网址不能绑定：报错后模型能改', async () => {
    const bad = { name: 'ask_user', args: { question: '选', options: [{ label: '编的', action: importOf('https://evil.example/x') }] } };
    const k = await setup([{ toolCalls: [search] }, { toolCalls: [bad] }, { toolCalls: [askBoth] }]);
    await k.say('找文章', 'scout');
    expect(k.stream.calls).toBe(3);
    expect((await k.card()).block.data.options).toHaveLength(2);
  });

  it('不是 askable 的能力绑不上；本机地址也不行', async () => {
    const asTool = (action: unknown) => ({ name: 'ask_user', args: { question: '选', options: [{ label: '好的', action }] } });
    const k = await setup([{ toolCalls: [asTool({ tool: 'write_thing', params: {} })] }, { toolCalls: [asTool(importOf('http://127.0.0.1/x'))] }, { text: '算了' }]);
    await k.say('随便');
    const { items } = await k.call<{ items: { blocks?: any[]; text?: string }[] }>('chat.history', { conversation_id: k.conv.id });
    expect(items.flatMap(m => m.blocks ?? []).some(b => b.kind === 'ask')).toBe(false);
    expect(items[items.length - 1]!.text).toContain('算了');
  });

  it('选项没绑动作或写了补充：接着开一轮，继承不可信标记，模型看得到回答', async () => {
    const k = await setup([{ toolCalls: [search] }, { toolCalls: [{ name: 'ask_user', args: { question: '什么题材？', options: [{ label: '科技' }, { label: '小说' }] } }] }, { text: '好，找科技的' }]);
    await k.say('找文章', 'scout');
    const { message_id, widget_id } = await k.card();
    const r = await k.call<{ submission_id: string }>('chat.answer', { message_id, widget_id, option_ids: ['o1'], text: '要短一点' });
    await k.kernel.jobs.wait(r.submission_id);
    expect((await k.db.get<{ tainted: number; skill_id: string }>('SELECT tainted, skill_id FROM jobs WHERE id = ?', [r.submission_id]))).toMatchObject({ tainted: 1, skill_id: 'scout' });
    const last = k.stream.contexts[k.stream.contexts.length - 1]!;
    expect(last).toContain('我选：科技'); expect(last).toContain('要短一点'); expect(last).toContain('什么题材');
  });

  it('同一批的写操作不执行，读操作照常，这一轮照样结束', async () => {
    const k = await setup([{ toolCalls: [search, { name: 'write_thing', args: {} }, { name: 'ask_user', args: { question: '题材？', options: [{ label: '科技' }] } }] }, { text: '不该走到这里' }]);
    await k.say('找文章', 'scout');
    expect(k.stream.calls).toBe(1);
    expect(k.wrote).toEqual([]);
    const steps = (await k.call<{ items: { steps?: { tool: string; status: string }[] }[] }>('chat.history', { conversation_id: k.conv.id })).items.flatMap(m => m.steps ?? []);
    expect(steps.find(s => s.tool === 'web_search')?.status).toBe('ok');
  });

  it('两个反问一起来：只留第一个', async () => {
    const k = await setup([{ toolCalls: [{ name: 'ask_user', args: { question: '一', options: [{ label: 'a' }] } }, { name: 'ask_user', args: { question: '二', options: [{ label: 'b' }] } }] }]);
    await k.say('问');
    const { items } = await k.call<{ items: { blocks?: any[] }[] }>('chat.history', { conversation_id: k.conv.id });
    expect(items.flatMap(m => m.blocks ?? []).filter(b => b.kind === 'ask').map(b => b.data.question)).toEqual(['一']);
  });

  it('没回答接着说别的：卡片作废，不能再点，模型知道用户跳过了', async () => {
    const k = await setup([{ toolCalls: [{ name: 'ask_user', args: { question: '题材？', options: [{ label: '科技' }] } }] }, { text: '好' }]);
    await k.say('找文章');
    const { message_id, widget_id } = await k.card();
    await k.say('算了，讲讲 affect');
    expect((await k.card()).block.state).toEqual({ expired: true });
    await expect(k.call('chat.answer', { message_id, widget_id, option_ids: ['o1'] })).rejects.toMatchObject({ code: 'conflict' });
    expect(k.stream.contexts[k.stream.contexts.length - 1]).toContain('用户没有回答');
  });

  it('子技能的反问显示在主对话里，主对话也停下来', async () => {
    const k = await setup([{ toolCalls: [{ name: 'run_skill', args: { skill_id: 'scout', input: '找 rust 文章' } }] }, { toolCalls: [search] }, { toolCalls: [askBoth] }, { text: '不该走到这里' }]);
    await k.say('帮我找文章');
    expect(k.stream.calls).toBe(3);
    const { block, message_id, widget_id } = await k.card();
    expect(block.data.untrusted).toBe(true);
    await k.call('chat.answer', { message_id, widget_id, option_ids: ['o1'] });
    await until(() => k.imported.includes(URL_A));
  });

  it('主任务取消：还在等审批的子技能一起停', async () => {
    const k = await setup([{ toolCalls: [{ name: 'run_skill', args: { skill_id: 'archivist', input: '整理' } }] }, { toolCalls: [{ name: 'remember', args: { type: 'semantic', content: '喜欢小说' } }] }]);
    const id = (await k.call<{ submission_id: string }>('chat.send', { conversation_id: k.conv.id, text: '整理记忆' })).submission_id;
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    const child = k.events.find(e => e.event === 'approval.requested')!.data.approval.task_id as string;
    expect(child).not.toBe(id);
    await k.kernel.jobs.cancel(id);
    await until(async () => (await k.kernel.jobs.summary(child))?.state === 'cancel');
  });

  it('重启后卡片还在，还能答', async () => {
    const k = await setup([{ toolCalls: [search] }, { toolCalls: [askBoth] }]);
    await k.say('找文章', 'scout');
    const { message_id, widget_id } = await k.card();
    const fresh = createKernel(k.db, new EventBus());
    fresh.registerCapabilities({ import_document: documentsCapabilities['import_document']! });
    fresh.bind(caller => k.core.ctx(caller), k.core.events);
    expect(await fresh.jobs.resumeAll()).toBe(0);   // 没有任务挂着，重启不用重跑模型、重新搜索
    const r = await fresh.methods['chat.answer']!.handler({ message_id, widget_id, option_ids: ['o1'] }, k.core.ctx({ origin: 'ui' }));
    expect(r.state.results[0].ok).toBe(true);
    await until(() => k.imported.includes(URL_A));
  });

  it('卡片不能走 chat.widget_update；MCP 看不到也调不了', async () => {
    const k = await setup([{ toolCalls: [{ name: 'ask_user', args: { question: '题材？', options: [{ label: '科技' }] } }] }]);
    await k.say('问');
    const { message_id, widget_id } = await k.card();
    await expect(k.call('chat.widget_update', { message_id, widget_id, state: { answered: {} } })).rejects.toMatchObject({ code: 'conflict' });
    await k.call('mcp.configure', { enabled: true, write_tools: ['ask_user'] });
    expect((await k.call<{ name: string }[]>('mcp.tools', {})).some(t => t.name === 'ask_user')).toBe(false);
    await expect(k.call('mcp.call', { name: 'ask_user', args: {} })).rejects.toMatchObject({ code: 'permission_denied' });
  });
});

describe('审批', () => {
  const req = (tool: string, body: string) => ({ tool, title: 't', body, impact: 'i', undoable: false, untrusted: false });

  it('一批里两个写操作：一个一个问，都能批，不会卡死', async () => {
    const { kernel, events } = await makeKernelCore();
    const got: string[] = [];
    kernel.jobs.register('p', async (job: JobContext) => {
      await Promise.all(['A', 'B'].map(async n => { const d = await job.approve(req(`tool${n}`, n)); got.push(`${n}:${d.decision}`); }));
      return { summary: 'ok' };
    });
    const { task_id } = await kernel.jobs.submit('p', { kind: 'skill', title: 'p', input: {} });
    const asked = () => events.filter(e => e.event === 'approval.requested').length;
    await until(() => asked() === 1);
    await kernel.jobs.approve(task_id, 'allow');
    await until(() => asked() === 2);
    await kernel.jobs.approve(task_id, 'deny');
    expect((await kernel.jobs.wait(task_id)).status).toBe('done');
    expect(got).toEqual(['A:allow', 'B:deny']);
  });

  it('取消时排队的审批不再弹出来', async () => {
    const { kernel, events } = await makeKernelCore();
    kernel.jobs.register('p', async (job: JobContext) => { await Promise.all(['A', 'B'].map(n => job.approve(req(`tool${n}`, n)))); return { summary: 'ok' }; });
    const { task_id } = await kernel.jobs.submit('p', { kind: 'skill', title: 'p', input: {} });
    await until(() => events.some(e => e.event === 'approval.requested'));
    await kernel.jobs.cancel(task_id);
    expect(events.filter(e => e.event === 'approval.requested')).toHaveLength(1);
    expect((await kernel.jobs.summary(task_id))?.state).toBe('cancel');
  });

  it('重启后批的决定只抵同一份参数：参数变了要重新问', async () => {
    const { kernel, db, events } = await makeKernelCore();
    let body = 'A'; const got: string[] = [];
    const p = async (job: JobContext) => { const d = await job.approve(req('forget', body)); got.push(`${body}:${d.decision}`); return { summary: 'ok' }; };
    kernel.jobs.register('p', p);
    const { task_id } = await kernel.jobs.submit('p', { kind: 'skill', title: 'p', input: {} });
    await until(() => events.some(e => e.event === 'approval.requested'));
    const bus2 = new EventBus(); const seen: any[] = []; bus2.on((event, data) => { if (event === 'approval.requested') seen.push(data); });
    const k2 = createKernel(db, bus2); k2.jobs.register('p', p);
    body = 'B';
    await k2.jobs.approve(task_id, 'allow');
    await until(() => seen.length === 1);
    expect(got).toEqual([]);
    expect(seen[0].approval.body).toBe('B');
    await k2.jobs.approve(task_id, 'deny');
    await k2.jobs.wait(task_id);
    expect(got).toEqual(['B:deny']);
  });

  it('重启后参数没变：决定照常生效', async () => {
    const { kernel, db, events } = await makeKernelCore();
    const got: string[] = [];
    const p = async (job: JobContext) => { const d = await job.approve(req('forget', 'A')); got.push(d.decision); return { summary: 'ok' }; };
    kernel.jobs.register('p', p);
    const { task_id } = await kernel.jobs.submit('p', { kind: 'skill', title: 'p', input: {} });
    await until(() => events.some(e => e.event === 'approval.requested'));
    const k2 = createKernel(db, new EventBus()); k2.jobs.register('p', p);
    await k2.jobs.approve(task_id, 'allow');
    await k2.jobs.wait(task_id);
    expect(got).toEqual(['allow']);
  });
});
