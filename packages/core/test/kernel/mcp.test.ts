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
    const r = await core.call<{ status: string; task_id: string; approval?: { tool: string } }>('mcp.call', { name: 'remember', args: { type: 'semantic', content: '常混淆 affect / effect' }, client: 'Codex' });
    expect(r.status).toBe('pending_approval');
    expect(r.approval?.tool).toBe('remember');
    await core.call('tasks.approve', { id: r.task_id, decision: 'allow' });
    await core.jobs.wait(r.task_id);
    const s = await core.call<{ state: string }>('mcp.call', { name: 'tibi_task_status', args: { task_id: r.task_id } });
    expect(s.state).toBe('done');
    expect((await core.call<{ content: string }[]>('memory.list', {})).map(m => m.content)).toContain('常混淆 affect / effect');
  });
});
