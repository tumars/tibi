import { describe, expect, it } from 'vitest';
import { openAppDb } from '@tibi/core-node';
import { assembleCore, fakePlatform } from '../../src/index.js';

async function setup() {
  const db = await openAppDb(':memory:'); const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  return assembleCore({ db, resume: false, platform: fakePlatform({ isOnline: () => true }) });
}

describe('MCP（M5）', () => {
  it('没打开时拒绝；打开后读工具直接用，写工具要逐项开、按权限模式审批', async () => {
    const { core } = await setup();
    await expect(core.call('mcp.tools', {})).rejects.toMatchObject({ code: 'permission_denied' });
    await core.call('mcp.configure', { enabled: true });
    const tools = await core.call<{ name: string; write: boolean }[]>('mcp.tools', {});
    expect(tools.some(t => t.name === 'get_context')).toBe(true);
    expect(tools.some(t => t.name === 'run_skill' || t.name === 'tool_search')).toBe(false);
    expect(tools.filter(t => t.write)).toHaveLength(0);
    const ctx = await core.call<Record<string, unknown>>('mcp.call', { name: 'get_context', args: {} });
    expect(ctx).toHaveProperty('today');
    await expect(core.call('mcp.call', { name: 'remember', args: { type: 'semantic', content: '常混淆 affect / effect' } })).rejects.toMatchObject({ code: 'permission_denied' });
    await core.call('mcp.configure', { write_tools: ['remember'] });
    // 写调用等用户在 Tibi 里确认：审批不在对话里，注明是哪个外部工具
    const pending = () => core.call<{ id: string; tool: string; client?: string; conversation_id?: string }[]>('approvals.list', {});
    const waitApproval = async () => { for (let i = 0; i < 200; i++) { const l = await pending(); if (l.length) return l[0]!; await new Promise(r => setTimeout(r, 10)); } throw new Error('没有审批'); };
    const call1 = core.call<{ memory_id: string }>('mcp.call', { name: 'remember', args: { type: 'semantic', content: '常混淆 affect / effect' }, client: 'Codex' });
    const a = await waitApproval();
    expect(a).toMatchObject({ tool: 'remember', client: 'Codex' });
    expect(a.conversation_id).toBeUndefined();
    await core.call('approvals.decide', { id: a.id, decision: 'allow' });
    expect((await call1).memory_id).toBeTruthy();
    // 记忆在 Tibi 自己的对话里不问；外部工具写记忆，"全部自动"也要问
    await core.call('profile.update', { patch: { assistant_prefs: { nickname: '你', permission: 'auto' } } });
    const call2 = core.call('mcp.call', { name: 'remember', args: { type: 'semantic', content: '第二条' }, client: 'Codex' });
    await core.call('approvals.decide', { id: (await waitApproval()).id, decision: 'deny' });
    await expect(call2).rejects.toMatchObject({ code: 'permission_denied' });
    expect((await core.call<{ content: string }[]>('memory.list', {})).map(m => m.content)).toContain('常混淆 affect / effect');
  });
});
