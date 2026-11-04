import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { capability } from '../../src/index.js';
import { documentsCapabilities, documentsMethods } from '../../src/domain/documents/index.js';
import { feedsCapabilities } from '../../src/domain/feeds/index.js';
import { configCapabilities, profileMethods } from '../../src/domain/profile/index.js';
import { termsCapabilities } from '../../src/domain/terms/index.js';
import { makeKernelCore, until, type Turn, finished } from './helpers.js';

async function setup(turns: Turn[], permission = 'default') {
  const k = await makeKernelCore({ turns });
  k.core.use(profileMethods).use(documentsMethods);
  k.kernel.registerCapabilities({ ...configCapabilities, ...documentsCapabilities, ...termsCapabilities, list_feeds: feedsCapabilities['list_feeds']!, manage_feed: feedsCapabilities['manage_feed']!, web_search: capability({ name: 'web_search', description: '假搜索', perm: 'read', params: Type.Object({}), async run() { return []; } }) });
  await k.db.run("UPDATE user_profile SET assistant_prefs = ? WHERE id = '1'", [JSON.stringify({ permission })]);
  const conv = await k.call<{ id: string }>('chat.open', {});
  const start = async (text: string, skill?: string) => (await k.call<{ submission_id: string }>('chat.send', { conversation_id: conv.id, text, skill })).submission_id;
  const setting = async (key: string) => (await k.call<Record<string, unknown>>('settings.get', { keys: [key] }))[key];
  const history = async () => (await k.call<{ items: any[] }>('chat.history', { conversation_id: conv.id })).items;
  return { ...k, conv, start, setting, history };
}
const set = (key: string, value: unknown) => ({ name: 'set_config', args: { key, value } });
/** 按需工具先用 pi 的 tool_search 按名字搜出来，下一轮才能调用；几个一起要时写在同一个 query 里 */
const load = (...names: string[]): Turn => ({ toolCalls: [{ name: 'tool_search', args: { query: names.join(' ') } }] });

describe('set_config', () => {
  it('普通项直接改，回执能撤销', async () => {
    const k = await setup([load('set_config'), { toolCalls: [set('tts.rate', 1.2)] }, { text: '改好了' }]);
    await finished(k.kernel, await k.start('语速快一点'));
    expect(await k.setting('tts.rate')).toBe(1.2);
    const receipt = (await k.history()).flatMap(m => m.receipts ?? [])[0];
    await k.call('system.undo', { undo_id: receipt.undo.undo_id });
    expect(await k.setting('tts.rate')).toBeUndefined();
  });

  it('改称呼走 profile，撤销恢复原值', async () => {
    const k = await setup([load('set_config'), { toolCalls: [set('nickname', '老张')] }, { toolCalls: [set('daily_new_cards', 30)] }, { text: '好' }]);
    const before = await k.call<{ daily_new_cards: number }>('profile.get', {});
    await finished(k.kernel, await k.start('叫我老张'));
    const p = await k.call<{ assistant_prefs: { nickname: string; permission: string }; daily_new_cards: number }>('profile.get', {});
    expect(p.assistant_prefs.nickname).toBe('老张'); expect(p.assistant_prefs.permission).toBe('default'); expect(p.daily_new_cards).toBe(30);
    const receipts = (await k.history()).flatMap(m => m.receipts ?? []);
    await k.call('system.undo', { undo_id: receipts[1].undo.undo_id });
    expect((await k.call<{ daily_new_cards: number }>('profile.get', {})).daily_new_cards).toBe(before.daily_new_cards);
  });

  it('值不合法：报错，不写入', async () => {
    const k = await setup([load('set_config'), { toolCalls: [set('tts.rate', 99)] }, { text: '好' }]);
    await finished(k.kernel, await k.start('语速'));
    expect(await k.setting('tts.rate')).toBeUndefined();
    expect((await k.history()).flatMap(m => m.steps ?? []).find(s => s.tool === 'set_config').status).toBe('error');
  });

  it.each(['mcp.enabled', 'mcp.write_tools', 'perm.auto.tibi.remember', 'permission', 'provider.price.x', 'secret'])('表外的键改不了：%s', async key => {
    const k = await setup([load('set_config'), { toolCalls: [set(key, true)] }, { text: '好' }], 'auto');
    await finished(k.kernel, await k.start('改'));
    expect(await k.setting(key)).toBeUndefined();
    expect(k.events.some(e => e.event === 'approval.requested')).toBe(false);
  });

  it('每次都问：全部自动也要问，"以后都允许"存不下来', async () => {
    const k = await setup([load('set_config'), { toolCalls: [set('memory.paused', true)] }, { text: '好' }, load('set_config'), { toolCalls: [set('memory.paused', false)] }, { text: '好' }], 'auto');
    const id = await k.start('先别记新的了');
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    const a = k.events.find(e => e.event === 'approval.requested')!.data.approval;
    expect(a.always_ask).toBe(true); expect(a.body).toContain('暂停记新的记忆');
    expect(await k.setting('memory.paused')).toBeUndefined();
    await k.call('approvals.decide', { id: a.id, decision: 'allow', always: true });
    await finished(k.kernel, id);
    expect(await k.setting('memory.paused')).toBe(true);
    expect((await k.db.all("SELECT key FROM settings WHERE key LIKE 'perm.auto.%'"))).toEqual([]);
    const id2 = await k.start('再改');
    await until(() => k.events.filter(e => e.event === 'approval.requested').length === 2);
    await k.call('approvals.decide', { id: k.events.filter(e => e.event === 'approval.requested')[1]!.data.approval.id, decision: 'deny' });
    await finished(k.kernel, id2);
    expect(await k.setting('memory.paused')).toBe(true);
  });

  it('读过网页内容的一轮：每次都问的项直接拒绝，普通项要审批', async () => {
    const { skillDef } = await import('../../src/kernel/skills.js');
    skillDef('tibi')!.deferred_tools.push('web_search');
    const k = await setup([load('web_search', 'set_config'), { toolCalls: [{ name: 'web_search', args: {} }] }, { toolCalls: [set('memory.paused', true)] }, { toolCalls: [set('tts.rate', 1.5)] }, { text: '好' }], 'auto');
    const id = await k.start('搜一下');
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    const a = k.events.find(e => e.event === 'approval.requested')!.data.approval;
    expect(a.body).toContain('朗读语速');   // 第一项已被拒绝，没有弹卡
    await k.call('approvals.decide', { id: a.id, decision: 'allow' });
    await finished(k.kernel, id);
    expect(await k.setting('memory.paused')).toBeUndefined();
    expect(await k.setting('tts.rate')).toBe(1.5);
    skillDef('tibi')!.deferred_tools.pop();
  });
});

describe('管理能力', () => {
  it('open_settings 显示成卡片；get_config 不漏表外的设置', async () => {
    const k = await setup([load('get_config', 'open_settings'), { toolCalls: [{ name: 'get_config', args: {} }, { name: 'open_settings', args: { section: 'model', reason: '换 API Key' } }] }, { text: '去设置里改' }]);
    await k.db.run("INSERT INTO settings(key, value, updated_at) VALUES ('mcp.write_tools', '[\"secret-marker\"]', 1)");
    await finished(k.kernel, await k.start('换 Key'));
    expect((await k.history()).flatMap(m => m.blocks ?? []).find(b => b.kind === 'link').data).toMatchObject({ text: '换 API Key', links: [{ label: '打开设置 · 模型', href: 'tibi://settings?sec=model' }] });
    expect(k.stream.contexts[2]).not.toContain('secret-marker');
    expect(k.stream.contexts[2]).toContain('memory.paused');
  });

  it('管理工具平时不带给模型，tool_search 按名字搜到后才能用', async () => {
    const names = ['update_document', 'delete_documents', 'remove_terms', 'manage_feed', 'configure_skill', 'create_backup'];
    const k = await setup([load(...names), { text: '好' }]);
    await finished(k.kernel, await k.start('管理'));
    for (const name of names) expect(k.stream.contexts[0]).not.toContain(`"name":"${name}"`);
    for (const name of names) expect(k.stream.contexts[1]).toContain(`"name":"${name}"`);
  });

  it('批量删文章：工具经 tool_search 加载，卡片写标题，全部自动也要问，能一次撤销', async () => {
    const k = await setup([load('delete_documents'), { toolCalls: [{ name: 'delete_documents', args: { ids: ['d1', 'd2'] } }] }, { text: '删了' }], 'auto');
    const t = Date.now();
    for (const [id, title] of [['d1', 'Alpha'], ['d2', 'Beta']]) await k.db.run("INSERT INTO documents(id, kind, source_type, title, content_hash, created_at, updated_at) VALUES (?, 'article', 'text', ?, ?, ?, ?)", [id, title, id, t, t]);
    const left = async () => Number((await k.db.get<{ n: number }>('SELECT count(*) AS n FROM documents WHERE deleted_at IS NULL'))?.n);
    const id = await k.start('删掉这两篇');
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    const a = k.events.find(e => e.event === 'approval.requested')!.data.approval;
    expect(a.body).toContain('《Alpha》'); expect(a.body).toContain('《Beta》'); expect(a.always_ask).toBe(true);
    expect(await left()).toBe(2);
    await k.call('approvals.decide', { id: k.events.filter(e => e.event === 'approval.requested').pop()!.data.approval.id, decision: 'allow' });
    await finished(k.kernel, id);
    expect(await left()).toBe(0);
    const receipt = (await k.history()).flatMap(m => m.receipts ?? [])[0];
    await k.call('system.undo', { undo_id: receipt.undo.undo_id });
    expect(await left()).toBe(2);
  });

  it('configure_skill：每次都问，主对话不能关，撤销恢复', async () => {
    const k = await setup([load('configure_skill'), { toolCalls: [{ name: 'configure_skill', args: { id: 'scout', patch: { extra_instructions: '多找小说' } } }] }, { text: '好' }], 'auto');
    const id = await k.start('改技能');
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    await k.call('approvals.decide', { id: k.events.filter(e => e.event === 'approval.requested').pop()!.data.approval.id, decision: 'allow' });
    await finished(k.kernel, id);
    const skills = () => k.call<{ id: string; extra_instructions?: string }[]>('skills.list', {});
    expect((await skills()).find(s => s.id === 'scout')?.extra_instructions).toBe('多找小说');
    const receipt = (await k.history()).flatMap(m => m.receipts ?? [])[0];
    await k.call('system.undo', { undo_id: receipt.undo.undo_id });
    expect((await skills()).find(s => s.id === 'scout')?.extra_instructions ?? null).toBeNull();
  });

  it('配置和管理工具不对 MCP 开放', async () => {
    const k = await setup([{ text: '好' }]);
    await k.call('mcp.configure', { enabled: true, write_tools: ['set_config', 'delete_documents'] });
    const names = (await k.call<{ name: string }[]>('mcp.tools', {})).map(t => t.name);
    for (const n of ['get_config', 'set_config', 'open_settings', 'delete_documents', 'configure_skill', 'list_feeds']) expect(names).not.toContain(n);
    await expect(k.call('mcp.call', { name: 'get_config', args: {} })).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(k.call('mcp.call', { name: 'set_config', args: { key: 'budget.month', value: 1 } })).rejects.toMatchObject({ code: 'permission_denied' });
  });
});
