import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { capability } from '../../src/index.js';
import { Conversations } from '../../src/kernel/index.js';
import { makeKernelCore, until, finished } from './helpers.js';

/**
 * PiEngine 的契约（10 §11）：这些是 Tibi 依赖的 pi-coding-agent 行为，升级 SDK 时先过这里。
 * 模型是按脚本回复的假服务商，不联网。
 */
describe('PiEngine 契约', () => {
  it('只带 Tibi 的工具：没有 read / bash / edit / write；系统提示整段是 Tibi 的', async () => {
    const k = await makeKernelCore({ turns: [{ text: '好' }] });
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '你好' });
    expect((await finished(k.kernel, submission_id)).status).toBe('done');
    const sent = k.stream.contexts[0]!;
    for (const name of ['read', 'bash', 'edit', 'write', 'grep']) expect(sent).not.toContain(`"name":"${name}"`);
    expect(sent).toContain('"name":"tool_search"');   // 主对话有按需工具，pi 的 tool_search 打开
    expect(sent).not.toContain('coding assistant'); expect(sent).not.toContain('<cwd>'); expect(sent).not.toContain('Pi documentation');
    expect(sent).toContain('你是 Tibi');
  });

  it('pi 的工作目录始终是空的：不写会话文件、设置、凭据', async () => {
    const k = await makeKernelCore({ turns: [{ text: '一' }, { text: '二' }] });
    const conv = await k.call('chat.open', {});
    for (const text of ['第一句', '第二句']) { const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text }); await finished(k.kernel, submission_id); }
    const dir = (k.engine as unknown as { opts: { workDir: string } }).opts.workDir;
    expect(readdirSync(dir, { recursive: true })).toEqual([]);
  });

  it('常驻会话：同一段对话的第二句复用会话，不重建', async () => {
    const k = await makeKernelCore({ turns: [{ text: '一' }, { text: '二' }] });
    const conv = await k.call('chat.open', {});
    const a = await k.call('chat.send', { conversation_id: conv.id, text: '第一句' }); await finished(k.kernel, a.submission_id);
    const live = (k.engine as unknown as { live: Map<string, { session: unknown }> }).live;
    const first = live.get(conv.id)?.session;
    expect(first).toBeTruthy();
    const b = await k.call('chat.send', { conversation_id: conv.id, text: '第二句' }); await finished(k.kernel, b.submission_id);
    expect(live.get(conv.id)?.session).toBe(first);
  });

  it('撤销写成 note：常驻会话下一轮模型就能看到', async () => {
    const undo = { undo_id: 'u1', expires_at: Date.now() + 1000 };
    const k = await makeKernelCore({ turns: [{ toolCalls: [{ name: 'add_fake', args: { words: [{ text: 'upshot' }] } }] }, { text: '好' }, { text: '知道了' }] });
    k.kernel.registerCapabilities({ add_fake: capability({ name: 'add_fake', description: '把几个词加入生词本（建卡）', perm: 'write', params: Type.Object({ words: Type.Array(Type.Object({ text: Type.String() })) }), async run() { return { undo }; } }) });
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.allowed_tools.push('add_fake');
    const conv = await k.call('chat.open', {});
    const a = await k.call('chat.send', { conversation_id: conv.id, text: '记一下' }); await finished(k.kernel, a.submission_id);
    const msg = (await k.call('chat.history', { conversation_id: conv.id })).items[1];
    await k.call('chat.receipt_undone', { message_id: msg.id, undo_id: 'u1' });
    const b = await k.call('chat.send', { conversation_id: conv.id, text: '然后呢' }); await finished(k.kernel, b.submission_id);
    skillDef('tibi')!.allowed_tools.pop();
    const sent = k.stream.contexts[k.stream.contexts.length - 1]!;
    expect(sent).toContain('用户撤销了：已把几个词加入生词本：upshot');
    // note 排在用户这句之前（和库里的顺序一致），模型最后看到的是用户的话
    expect(sent.indexOf('用户撤销了')).toBeLessThan(sent.lastIndexOf('然后呢'));
  });

  it('过程看得见：思考过程和每步工具的参数、结果、用时，进行中有事件，说完写进历史', async () => {
    const k = await makeKernelCore({ turns: [{ thinking: '先查一下这个词', toolCalls: [{ name: 'look_fake', args: { word: 'upshot', id: 'x' } }] }, { text: '意思是结果' }] });
    k.kernel.registerCapabilities({ look_fake: capability({ name: 'look_fake', description: '查词：查一个词的意思', perm: 'read', params: Type.Object({ word: Type.String(), id: Type.String() }), async run() { return { entry: { translation: 'n. 结果, 结局' } }; } }) });
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.allowed_tools.push('look_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: 'upshot 什么意思' });
    expect((await finished(k.kernel, submission_id)).status).toBe('done');
    skillDef('tibi')!.allowed_tools.pop();
    expect(k.events.filter(e => e.event === 'chat.thinking').map(e => e.data.delta).join('')).toBe('先查一下这个词');
    const end = k.events.find(e => e.event === 'chat.tool' && e.data.phase === 'end')!.data;
    expect(end).toMatchObject({ tool: 'look_fake', status: 'ok', result: 'n. 结果, 结局' });
    expect(end.call_id).toBeTruthy();
    expect(k.events.find(e => e.event === 'chat.tool' && e.data.phase === 'start')!.data.detail).toBe('word: upshot');   // id 不给人看
    const a = (await k.call('chat.history', { conversation_id: conv.id })).items[1];
    expect(a.thinking).toBe('先查一下这个词');
    expect(a.steps[0]).toMatchObject({ tool: 'look_fake', detail: 'word: upshot', result: 'n. 结果, 结局', status: 'ok' });
    expect(typeof a.steps[0].duration_ms).toBe('number');
  });

  it('回答中又说了一句：插进当前这次回答，下一轮模型看得到', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const k = await makeKernelCore({ turns: [{ toolCalls: [{ name: 'slow_fake', args: {} }] }, { text: '好，换成例句' }] });
    k.kernel.registerCapabilities({ slow_fake: capability({ name: 'slow_fake', description: '慢工具', perm: 'read', params: Type.Object({}), async run() { await gate; return {}; } }) });
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.allowed_tools.push('slow_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '讲讲 affect' });
    await until(() => k.events.some(e => e.event === 'chat.tool' && e.data.tool === 'slow_fake'));
    const steered = await k.call('chat.send', { conversation_id: conv.id, text: '换成例句吧' });
    expect(steered).toEqual({ submission_id, steered: true });
    release();
    expect((await finished(k.kernel, submission_id)).status).toBe('done');
    skillDef('tibi')!.allowed_tools.pop();
    expect(k.stream.contexts[1]).toContain('换成例句吧');
    const items = (await k.call('chat.history', { conversation_id: conv.id })).items;
    expect(items.filter((m: { role: string }) => m.role === 'user').map((m: { text: string }) => m.text)).toEqual(['讲讲 affect', '换成例句吧']);
  });

  it('回答中补充过的话，出错后重试时也带上', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const k = await makeKernelCore({ turns: [{ toolCalls: [{ name: 'slow_fake', args: {} }] }, { error: '500 boom' }, { text: '重新回答' }] });
    k.kernel.registerCapabilities({ slow_fake: capability({ name: 'slow_fake', description: '慢工具', perm: 'read', params: Type.Object({}), async run() { await gate; return {}; } }) });
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.allowed_tools.push('slow_fake');
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '讲讲 affect' });
    await until(() => k.events.some(e => e.event === 'chat.tool' && e.data.tool === 'slow_fake'));
    await k.call('chat.send', { conversation_id: conv.id, text: '只要例句' });
    release();
    expect((await finished(k.kernel, submission_id)).status).not.toBe('done');
    k.stream.reset();
    skillDef('tibi')!.allowed_tools.pop();
    await k.call('chat.retry', { conversation_id: conv.id, turn_id: submission_id });
    await finished(k.kernel, submission_id);
    const sent = k.stream.contexts[k.stream.contexts.length - 1]!;
    expect(sent).toContain('讲讲 affect'); expect(sent).toContain('只要例句');
  });

  it('对话中途崩溃：重开后记为中断，不自动重跑；点继续从那句话重新回答', async () => {
    const k = await makeKernelCore({ turns: [{ text: '回答' }, { text: '重新回答' }] });
    const conv = await k.call('chat.open', {});
    const { submission_id } = await k.call('chat.send', { conversation_id: conv.id, text: '问题' });
    await finished(k.kernel, submission_id);
    // 模拟进程在回答中途被杀：这一轮还记着 running
    await new Conversations(k.db).setTurn(submission_id, { state: 'running' });
    expect(await k.kernel.recover()).toBe(1);
    expect((await finished(k.kernel, submission_id)).status).toBe('error');
    const calls = k.stream.calls;
    const items = (await k.call('chat.history', { conversation_id: conv.id })).items;
    expect(items[1].interrupted.message).toContain('中断');
    await k.call('chat.retry', { conversation_id: conv.id, turn_id: submission_id });
    expect((await finished(k.kernel, submission_id)).status).toBe('done');
    expect(k.stream.calls).toBe(calls + 1);
    const after = (await k.call('chat.history', { conversation_id: conv.id })).items;
    expect(after.map((m: { text: string }) => m.text)).toEqual(['问题', '重新回答']);
  });

  it('直接运行技能：在一段 kind = skill 的对话里跑一轮，不进"最近"', async () => {
    const k = await makeKernelCore({ turns: [{ text: '洞察' }] });
    const { conversation_id, submission_id } = await k.call('skills.runNow', { id: 'insight', input: '看看' });
    expect((await finished(k.kernel, submission_id)).status).toBe('done');
    expect((await k.call('chat.history', { conversation_id })).items.map((m: { text: string }) => m.text)).toEqual(['看看', '洞察']);
    expect((await k.call<{ id: string }[]>('chat.list', {})).some(c => c.id === conversation_id)).toBe(false);
  });
});
