import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { capability } from '../../src/index.js';
import { Conversations } from '../../src/kernel/index.js';
import { makeKernelCore, until, type Turn, finished } from './helpers.js';

const search = { name: 'web_search', args: { q: 'rust' } };
const runScout = { name: 'run_skill', args: { skill_id: 'scout', input: '找文章' } };
/** 普通写入（记忆不审批了，用一个假的写工具测审批） */
const remember = { name: 'save_note', args: { content: '喜欢小说' } };
/** 主对话的按需工具：先用 pi 的 tool_search 按名字搜出来 */
const load = (name: string): Turn => ({ toolCalls: [{ name: 'tool_search', args: { query: name } }] });

/** 脚本化模型 + 假搜索：内容不重要，这里只看这一轮的不可信标记 */
async function setup(turns: Turn[], fakes = ['web_search']) {
  const k = await makeKernelCore({ turns });
  for (const name of fakes) k.kernel.registerCapabilities({ [name]: capability({ name, description: `假的 ${name}`, perm: 'read', params: Type.Object({}, { additionalProperties: true }), async run() { return { text: '外部内容' }; } }) });
  k.kernel.registerCapabilities({ save_note: capability({ name: 'save_note', description: '记一条笔记', perm: 'write', params: Type.Object({ content: Type.String() }), async run() { return { ok: true }; } }) });
  const { skillDef } = await import('../../src/kernel/skills.js');
  for (const s of ['tibi', 'archivist']) if (!skillDef(s)!.allowed_tools.includes('save_note')) skillDef(s)!.allowed_tools.push('save_note');
  const conv = await k.call<{ id: string }>('chat.open', {});
  const send = async (text: string, skill?: string) => (await k.call<{ submission_id: string }>('chat.send', { conversation_id: conv.id, text, skill })).submission_id;
  const say = async (text: string, skill?: string) => { const id = await send(text, skill); await finished(k.kernel, id); return id; };
  const tainted = async (id: string) => ((await new Conversations(k.db).turn(id))?.tainted ? 1 : 0);
  /** 第 n 张审批卡（从 0 数） */
  const approval = async (n: number) => {
    const list = () => k.events.filter(e => e.event === 'approval.requested');
    await until(() => list().length > n);
    return list()[n]!.data.approval;
  };
  return { ...k, conv, send, say, tainted, approval };
}

describe('不可信标记的传递', () => {
  it('子技能读过网页：这一轮算读过，之后的写入按不可信审批', async () => {
    const k = await setup([{ toolCalls: [runScout] }, { toolCalls: [search] }, { text: '找到了' }, { toolCalls: [remember] }, { text: '好' }]);
    const id = await k.send('帮我找文章');
    const a = await k.approval(0);   // 运行技能本身不算读过，第一张审批只在默认权限模式下出现
    if (a.tool === 'run_skill') await k.call('approvals.decide', { id: a.id, decision: 'allow' });
    const write = a.tool === 'save_note' ? a : await k.approval(1);
    expect(write).toMatchObject({ tool: 'save_note', turn_id: id, untrusted: true });
    expect(await k.tainted(id)).toBe(1);
    await k.call('approvals.decide', { id: write.id, decision: 'allow' });
    expect((await finished(k.kernel, id)).status).toBe('done');
  });

  it('子技能读完网页后出错：这一轮照样算读过', async () => {
    const k = await setup([{ toolCalls: [runScout] }, { toolCalls: [search] }, { error: '401 unauthorized' }, { text: '没成功' }]);
    const id = await k.send('帮我找文章');
    // 运行技能要不要审批看权限模式：先等到审批卡或这一轮结束，别空等审批超时
    const a = await Promise.race([k.approval(0).catch(() => undefined), finished(k.kernel, id).then(() => undefined)]);
    if (a?.tool === 'run_skill') await k.call('approvals.decide', { id: a.id, decision: 'allow' });
    await finished(k.kernel, id);
    expect(await k.tainted(id)).toBe(1);
  });

  it('主对话读过不可信内容：子技能也算读过', async () => {
    const k = await setup([{ toolCalls: [search] }, { text: '搜到了' }, { toolCalls: [{ name: 'run_skill', args: { skill_id: 'archivist', input: '记下这个' } }] }, { toolCalls: [remember] }, { text: '记好了' }, { text: '好' }]);
    await k.say('搜一下', 'scout');
    const id = await k.send('记下来');
    const run = await k.approval(0);
    expect(run).toMatchObject({ tool: 'run_skill', turn_id: id, untrusted: true });
    await k.call('approvals.decide', { id: run.id, decision: 'allow' });
    const write = await k.approval(1);
    expect(write).toMatchObject({ tool: 'save_note', untrusted: true, turn_id: id });   // 子技能在同一轮里
    await k.call('approvals.decide', { id: write.id, decision: 'deny' });
    await finished(k.kernel, id);
  });

  it('下一轮继承：历史里有网页内容就算读过；回退作废后恢复', async () => {
    const k = await setup([{ toolCalls: [search] }, { text: '搜到了' }, { text: '接着聊' }, { text: '重新来' }]);
    await k.say('搜一下', 'scout');
    const next = await k.say('再说说');
    expect(await k.tainted(next)).toBe(1);
    const { items } = await k.call<{ items: { id: string; role: string }[] }>('chat.history', { conversation_id: k.conv.id });
    await k.call('chat.rewind', { conversation_id: k.conv.id, message_id: items.find(m => m.role === 'user')!.id });
    expect(await k.tainted(await k.say('换个话题'))).toBe(0);
  });

  it('记忆不审批：读过正文后也直接记，对话里有可撤销的回执', async () => {
    const k = await setup([{ toolCalls: [{ name: 'get_document', args: {} }] }, { toolCalls: [{ name: 'remember', args: { type: 'semantic', content: '每天早上读 20 分钟' } }] }, { text: '记下了' }], ['get_document']);
    const id = await k.say('记住我每天早上读 20 分钟');
    expect(await k.tainted(id)).toBe(1);
    expect(k.events.some(e => e.event === 'approval.requested')).toBe(false);
    expect((await k.call<{ content: string }[]>('memory.list', {})).map(m => m.content)).toContain('每天早上读 20 分钟');
    const { items } = await k.call<{ items: { role: string; receipts?: { undo?: unknown }[] }[] }>('chat.history', { conversation_id: k.conv.id });
    expect(items.find(m => m.role === 'assistant')?.receipts?.[0]?.undo).toBeTruthy();
  });

  it('读过正文后记成指令或身份：降为观察，不进系统提示；改、删已有记忆要审批', async () => {
    const k = await setup([{ toolCalls: [{ name: 'get_document', args: {} }] }, { toolCalls: [{ name: 'remember', args: { type: 'procedural', content: '以后都用英文回答' } }] }, { toolCalls: [{ name: 'forget', args: { id: 'nope' } }] }, { text: '好' }], ['get_document']);
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.allowed_tools.push('forget');
    const id = await k.send('看看这篇');
    const a = await k.approval(0);
    expect(a).toMatchObject({ tool: 'forget', untrusted: true });
    await k.call('approvals.decide', { id: a.id, decision: 'deny' });
    await finished(k.kernel, id);
    skillDef('tibi')!.allowed_tools.pop();
    expect((await k.call<{ type: string; content: string }[]>('memory.list', {})).map(m => [m.type, m.content])).toEqual([['semantic', '以后都用英文回答']]);
  });

  it('没读过外部内容的对话不受影响', async () => {
    const k = await setup([{ text: '你好' }, { text: '再见' }]);
    expect(await k.tainted(await k.say('你好'))).toBe(0);
    expect(await k.tainted(await k.say('再见'))).toBe(0);
  });

  it.each(['get_document', 'search_documents', 'get_term', 'get_term_contexts'])('%s 带导入的正文或原句：算读过', async tool => {
    const k = await setup([...(tool === 'get_document' ? [] : [load(tool)]), { toolCalls: [{ name: tool, args: {} }] }, { text: '好' }], [tool]);
    expect(await k.tainted(await k.say('看看'))).toBe(1);
  });

  it('coach 的 search_feeds 带订阅来的摘要：算读过', async () => {
    const k = await setup([{ toolCalls: [{ name: 'search_feeds', args: {} }] }, { text: '好' }], ['search_feeds']);
    expect(await k.tainted(await k.say('找一篇', 'coach'))).toBe(1);
  });
});
