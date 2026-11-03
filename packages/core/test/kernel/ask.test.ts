import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { capability, TibiError } from '../../src/index.js';
import { documentsCapabilities, documentsMethods } from '../../src/domain/documents/index.js';
import { makeKernelCore, until, type Turn, finished } from './helpers.js';

const URL_A = 'https://example.com/post-a'; const URL_B = 'https://example.org/post-b'; const URL_FAIL = 'https://example.net/fail';
const importOf = (url: string) => ({ name: 'import_document', args: { source: { type: 'url', url } } });
const askBoth = { name: 'ask_user', args: { question: '想读哪几篇？', multi: true, options: [{ label: '文章 A', url: URL_A }, { label: '文章 B', url: URL_B }] } };
const search = { name: 'web_search', args: { q: 'rust' } };

/** 脚本化模型 + 假搜索 + 假导入（权限照真的 import_document；网址里有 fail 的导入失败） */
async function setup(turns: Turn[]) {
  const k = { ...await makeKernelCore({ turns }), wrote: [] as string[] };
  k.core.use(documentsMethods);
  const imported: string[] = [];
  const real = documentsCapabilities['import_document']!;
  k.kernel.registerCapabilities({
    import_document: { ...real, async run(p: { source: { url: string } }) {
      imported.push(p.source.url);
      if (p.source.url.includes('fail')) throw new TibiError('invalid_source', '网页打不开（403）');
      return { document_id: 'd', title: 't', status: 'imported' };
    } } as typeof real,
    web_search: capability({ name: 'web_search', description: '假搜索', perm: 'read', params: Type.Object({ q: Type.String() }), async run() { return [{ url: URL_A, title: 'A' }, { url: URL_B, title: 'B' }, { url: URL_FAIL, title: 'F' }]; } }),
    write_thing: capability({ name: 'write_thing', description: '写东西', perm: 'write', params: Type.Object({}), async run() { k.wrote.push('x'); return { ok: true }; } }),
  });
  const conv = await k.call<{ id: string }>('chat.open', {});
  const send = async (text: string, skill?: string) => (await k.call<{ submission_id: string; answered?: boolean }>('chat.send', { conversation_id: conv.id, text, skill }));
  const say = async (text: string, skill?: string) => { const { submission_id } = await send(text, skill); await finished(k.kernel, submission_id); return submission_id; };
  /** 等反问卡显示出来（这一轮还在跑） */
  const shown = async () => {
    await until(() => k.events.some(e => e.event === 'chat.block' && e.data.block.kind === 'ask'));
    return [...k.events].reverse().find(e => e.event === 'chat.block' && e.data.block.kind === 'ask')!.data as { submission_id: string; block: any };
  };
  const card = async () => {
    const { items } = await k.call<{ items: { id: string; blocks?: any[] }[] }>('chat.history', { conversation_id: conv.id });
    for (const m of [...items].reverse()) { const b = m.blocks?.find(x => x.kind === 'ask'); if (b) return b; }
    throw new Error('没有反问卡');
  };
  return { ...k, conv, send, say, shown, card, imported };
}

describe('反问 ask_user', () => {
  it('找文章：卡片显示后这一轮等着；选了之后模型在同一轮里导入，不再审批，导入结果交回模型', async () => {
    const k = await setup([{ toolCalls: [search] }, { toolCalls: [askBoth] }, { toolCalls: [importOf(URL_B)] }, { text: '放进书架了' }]);
    const { submission_id } = await k.send('找几篇 rust 文章', 'scout');
    const { block } = await k.shown();
    expect(block.data.untrusted).toBe(true);   // 搜过网页
    expect(block.data.options[1].url).toBe(URL_B);
    expect(k.stream.calls).toBe(2);
    expect((await k.call<{ active: string[] }>('chat.open', { conversation_id: k.conv.id })).active).toEqual([submission_id]);
    await k.call('chat.answer', { widget_id: block.id, option_ids: ['o2'] });
    await finished(k.kernel, submission_id);
    expect(k.imported).toEqual([URL_B]);
    expect(k.events.some(e => e.event === 'approval.requested')).toBe(false);
    expect(k.stream.contexts[2]).toContain(URL_B);   // 回答是工具结果，带着链接
    expect(k.stream.contexts[3]).toContain('imported');   // 导入跑完了才返回
    expect(k.stream.calls).toBe(4);   // 整个过程一轮，没有另开
    expect((await k.card()).state.answered.option_ids).toEqual(['o2']);
    await expect(k.call('chat.answer', { widget_id: block.id, option_ids: ['o1'] })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('导入失败：原因作为工具结果交回模型，同一轮里告诉用户', async () => {
    const ask = { name: 'ask_user', args: { question: '读这篇？', options: [{ label: '这篇', url: URL_FAIL }] } };
    const k = await setup([{ toolCalls: [search] }, { toolCalls: [ask] }, { toolCalls: [importOf(URL_FAIL)] }, { text: '没导入成功' }]);
    const { submission_id } = await k.send('找文章', 'scout');
    const { block } = await k.shown();
    await k.call('chat.answer', { widget_id: block.id, option_ids: ['o1'] });
    await finished(k.kernel, submission_id);
    expect(k.stream.contexts[3]).toContain('403');
    const { items } = await k.call<{ items: { role: string; text?: string; steps?: { tool: string; status: string; error?: string }[] }[] }>('chat.history', { conversation_id: k.conv.id });
    expect(items[items.length - 1]!.steps?.find(st => st.tool === 'import_document')).toMatchObject({ status: 'error' });
  });

  it('模型换了网址：不是用户选的，照常审批', async () => {
    const k = await setup([{ toolCalls: [search] }, { toolCalls: [askBoth] }, { toolCalls: [importOf(URL_A)] }, { text: '好' }]);
    const { submission_id } = await k.send('找文章', 'scout');
    const { block } = await k.shown();
    await k.call('chat.answer', { widget_id: block.id, option_ids: ['o2'] });
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    await k.call('approvals.decide', { id: k.events.find(e => e.event === 'approval.requested')!.data.approval.id, decision: 'deny' });
    await finished(k.kernel, submission_id);
    expect(k.imported).toEqual([]);
  });

  it('没出现在查询结果里的网址不能放进选项：报错后模型能改', async () => {
    const bad = { name: 'ask_user', args: { question: '选', options: [{ label: '编的', url: 'https://evil.example/x' }] } };
    const k = await setup([{ toolCalls: [search] }, { toolCalls: [bad] }, { toolCalls: [askBoth] }]);
    await k.send('找文章', 'scout');
    const { block } = await k.shown();
    expect(k.stream.calls).toBe(3);
    expect(block.data.options).toHaveLength(2);
  });

  it('不点卡片直接说话：这句就是回答，模型在同一轮接着做', async () => {
    const k = await setup([{ toolCalls: [{ name: 'ask_user', args: { question: '什么题材？', options: [{ label: '科技' }, { label: '小说' }] } }] }, { text: '好，找短一点的' }]);
    const { submission_id } = await k.send('找文章');
    await k.shown();
    const r = await k.send('要短一点');
    expect(r).toMatchObject({ submission_id, answered: true });
    await finished(k.kernel, submission_id);
    const last = k.stream.contexts[k.stream.contexts.length - 1]!;
    expect(last).toContain('用户说：要短一点'); expect(last).toContain('什么题材');
    expect((await k.card()).state.answered.text).toBe('要短一点');
  });

  it('子技能的反问显示在主对话里，主对话等着；选完主对话接着导入', async () => {
    const k = await setup([{ toolCalls: [{ name: 'run_skill', args: { skill_id: 'scout', input: '找 rust 文章' } }] }, { toolCalls: [search] }, { toolCalls: [askBoth] }, { text: '用户选了 A' }, { toolCalls: [importOf(URL_A)] }, { text: '开始导入了' }]);
    const { submission_id } = await k.send('帮我找文章');
    const shown = await k.shown();
    expect(shown.submission_id).toBe(submission_id);
    expect(shown.block.data.untrusted).toBe(true);
    await k.call('chat.answer', { widget_id: shown.block.id, option_ids: ['o1'] });
    await finished(k.kernel, submission_id);
    expect(k.imported).toEqual([URL_A]);
    expect(k.events.some(e => e.event === 'approval.requested')).toBe(false);
    expect((await k.card()).state.answered.option_ids).toEqual(['o1']);
  });

  it('等回答时取消：这一轮停下，卡片作废', async () => {
    const k = await setup([{ toolCalls: [{ name: 'ask_user', args: { question: '题材？', options: [{ label: '科技' }] } }] }]);
    const { submission_id } = await k.send('问');
    const { block } = await k.shown();
    await k.call('chat.cancel', { submission_id });
    await expect(k.call('chat.answer', { widget_id: block.id, option_ids: ['o1'] })).rejects.toMatchObject({ code: 'conflict' });
    expect((await k.card()).state).toEqual({ expired: true });
  });

  it('卡片不能走 chat.widget_update；MCP 看不到也调不了', async () => {
    const k = await setup([{ toolCalls: [{ name: 'ask_user', args: { question: '题材？', options: [{ label: '科技' }] } }] }, { text: '好' }]);
    const { submission_id } = await k.send('问');
    const { block } = await k.shown();
    await k.call('chat.answer', { widget_id: block.id, option_ids: ['o1'] });
    await finished(k.kernel, submission_id);
    const { items } = await k.call<{ items: { id: string; blocks?: any[] }[] }>('chat.history', { conversation_id: k.conv.id });
    const m = items.find(x => x.blocks?.some(b => b.id === block.id))!;
    await expect(k.call('chat.widget_update', { message_id: m.id, widget_id: block.id, state: { answered: {} } })).rejects.toMatchObject({ code: 'conflict' });
    await k.call('mcp.configure', { enabled: true, write_tools: ['ask_user'] });
    expect((await k.call<{ name: string }[]>('mcp.tools', {})).some(t => t.name === 'ask_user')).toBe(false);
    await expect(k.call('mcp.call', { name: 'ask_user', args: {} })).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('停止这一轮：还在等审批的子技能一起停（子技能在同一轮里）', async () => {
    // 记忆不再审批：子技能换一个要确认的写工具
    const k = await setup([{ toolCalls: [{ name: 'run_skill', args: { skill_id: 'archivist', input: '整理' } }] }, { toolCalls: [{ name: 'confirm_thing', args: {} }] }]);
    k.kernel.registerCapabilities({ confirm_thing: capability({ name: 'confirm_thing', description: '要确认的写入', perm: 'confirm', params: Type.Object({}), async run() { return { ok: true }; } }) });
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('archivist')!.allowed_tools.push('confirm_thing');
    const id = (await k.call<{ submission_id: string }>('chat.send', { conversation_id: k.conv.id, text: '整理记忆' })).submission_id;
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    const a = k.events.find(e => e.event === 'approval.requested')!.data.approval;
    expect(a).toMatchObject({ tool: 'confirm_thing', turn_id: id, conversation_id: k.conv.id });
    await k.call('chat.cancel', { submission_id: id });
    expect((await finished(k.kernel, id)).status).toBe('cancel');
    expect(await k.call('approvals.list', { conversation_id: k.conv.id })).toEqual([]);
    skillDef('archivist')!.allowed_tools.pop();
  });
});

describe('审批', () => {
  const req = (tool: string, body: string) => ({ tool, title: 't', body, impact: 'i', undoable: false, untrusted: false });

  it('一批里两个写操作：一个一个问，都能批，不会卡死', async () => {
    const { kernel, events, call } = await makeKernelCore();
    const got: string[] = [];
    kernel.turns.start({ id: 't1' }, async run => {
      await Promise.all(['A', 'B'].map(async n => { const d = await run.approve(req(`tool${n}`, n)); got.push(`${n}:${d.decision}`); }));
    });
    const asked = () => events.filter(e => e.event === 'approval.requested').map(e => e.data.approval);
    await until(() => asked().length === 1);
    await call('approvals.decide', { id: asked()[0].id, decision: 'allow' });
    await until(() => asked().length === 2);
    await call('approvals.decide', { id: asked()[1].id, decision: 'deny' });
    await kernel.turns.wait('t1');
    expect(got).toEqual(['A:allow', 'B:deny']);
  });

  it('停止时排队的审批不再弹出来，等着的那张也撤掉', async () => {
    const { kernel, events } = await makeKernelCore();
    kernel.turns.start({ id: 't1' }, async run => { await Promise.all(['A', 'B'].map(n => run.approve(req(`tool${n}`, n)))); });
    await until(() => events.some(e => e.event === 'approval.requested'));
    await kernel.turns.cancel('t1');
    expect(events.filter(e => e.event === 'approval.requested')).toHaveLength(1);
    expect(events.some(e => e.event === 'approval.resolved')).toBe(true);
    expect(kernel.turns.approvals()).toEqual([]);
  });

  it('"以后都允许"：同一技能的这项能力下次不再问；读过不可信内容的一轮不生效', async () => {
    const { kernel, call, events } = await makeKernelCore();
    const ask = (id: string, tainted = false) => new Promise<string>(resolve => { kernel.turns.start({ id, tainted }, async run => { resolve((await run.approve({ ...req('write_x', 'x'), skill_id: 'coach' })).decision); }); });
    const first = ask('t1');
    await until(() => events.some(e => e.event === 'approval.requested'));
    await call('approvals.decide', { id: kernel.turns.approvals()[0]!.id, decision: 'allow', always: true });
    expect(await first).toBe('allow');
    expect(await ask('t2')).toBe('allow');
    expect(events.filter(e => e.event === 'approval.requested')).toHaveLength(1);
    void ask('t3', true);
    await until(() => events.filter(e => e.event === 'approval.requested').length === 2);
    expect(kernel.turns.approvals()[0]).toMatchObject({ untrusted: true });
    await kernel.turns.cancel('t3');
  });
});
