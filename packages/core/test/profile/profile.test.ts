import { describe, expect, it } from 'vitest';
import type { Profile, Provider } from '../../src/index.js';
import { makeReviewCore } from '../review/fixtures.js';

describe('画像与设置', () => {
  it('profile.get / update：没有水平、目标、词汇量和讲解语言；设置键值', async () => {
    const { core, db } = await makeReviewCore();
    const p = await core.call<Profile>('profile.get', {});
    expect(p.assistant_prefs).toEqual({ nickname: '你', permission: 'default' });
    expect(p).not.toHaveProperty('vocab_estimate'); expect(p).not.toHaveProperty('level_self'); expect(p).not.toHaveProperty('goal');
    const p2 = await core.call<Profile>('profile.update', { patch: { display_name: '小明', interests: ['tech'], assistant_prefs: { nickname: '明' } } });
    expect(p2.display_name).toBe('小明'); expect(p2.interests).toEqual(['tech']); expect(p2.assistant_prefs).toEqual({ nickname: '明', permission: 'default' });
    // 多给的旧字段不落库
    const p3 = await core.call<Profile>('profile.update', { patch: { level_self: 'advanced', assistant_prefs: { language: 'en' } } });
    expect(p3).not.toHaveProperty('level_self'); expect(p3.assistant_prefs).not.toHaveProperty('language');
    // 旧数据里存过的 language 不再返回
    await db.run("UPDATE user_profile SET assistant_prefs = ? WHERE id = '1'", [JSON.stringify({ nickname: '明', language: 'en' })]);
    expect((await core.call<Profile>('profile.get', {})).assistant_prefs).toEqual({ nickname: '明', permission: 'default' });
    await expect(core.call('vocab.start', {})).rejects.toThrow();
    const s = await core.call<Record<string, unknown>>('settings.set', { patch: { 'reader.font_size': 20, 'review.recognize': true } });
    expect(s).toEqual({ 'reader.font_size': 20, 'review.recognize': true });
    const g = await core.call<Record<string, unknown>>('settings.get', { keys: ['reader.font_size', 'nope'] });
    expect(g).toEqual({ 'reader.font_size': 20 });
  });

  it('providers.upsert：每档一个、每类一个默认；test 占位', async () => {
    const { core } = await makeReviewCore();
    const a = await core.call<Provider>('providers.upsert', { provider: { kind: 'llm', name: 'DeepSeek', protocol: 'openai_compatible', base_url: 'https://api.deepseek.com', auth: 'api_key', tier: 'fast', model: 'deepseek-flash', is_default: true }, secret_ref: 'deepseek' });
    expect(a.has_secret).toBe(true); expect(a.is_default).toBe(true);
    const b = await core.call<Provider>('providers.upsert', { provider: { kind: 'llm', name: 'Other', protocol: 'openai_compatible', auth: 'api_key', tier: 'fast', model: 'x', is_default: true } });
    const list = await core.call<Provider[]>('providers.list', {});
    expect(list.filter(x => x.is_default)).toHaveLength(1); expect(list.find(x => x.id === a.id)?.tier).toBeUndefined(); expect(list.find(x => x.id === b.id)?.tier).toBe('fast');
    const t = await core.call<{ ok: boolean; error?: string }>('providers.test', { id: b.id });
    expect(t.ok).toBe(false); expect(t.error).toContain('API Key');
  });

  const deepseek = (tier: 'fast' | 'deep', model: string) => ({ provider: { kind: 'llm', name: 'DeepSeek', protocol: 'openai_compatible', base_url: 'https://api.deepseek.com', auth: 'api_key', tier, model, is_default: true }, secret_ref: 'deepseek' });

  it('providers.upsert：重复连接同一服务不新增，换模型也是更新', async () => {
    const { core } = await makeReviewCore();
    const fast = await core.call<Provider>('providers.upsert', deepseek('fast', 'deepseek-flash'));
    const deep = await core.call<Provider>('providers.upsert', deepseek('deep', 'deepseek-v4-pro'));
    const again = await core.call<Provider>('providers.upsert', deepseek('fast', 'deepseek-flash-2'));
    await core.call<Provider>('providers.upsert', deepseek('deep', 'deepseek-v4-pro'));
    const list = await core.call<Provider[]>('providers.list', {});
    expect(list.map(x => x.id).sort()).toEqual([fast.id, deep.id].sort());
    expect(again.id).toBe(fast.id); expect(again.model).toBe('deepseek-flash-2');
    expect(list.map(x => x.tier).sort()).toEqual(['deep', 'fast']);
  });

  it('providers.delete：默认交给剩下的一条；最后一条才返回 secret_ref', async () => {
    const { core } = await makeReviewCore();
    const fast = await core.call<Provider>('providers.upsert', deepseek('fast', 'deepseek-flash'));
    const deep = await core.call<Provider>('providers.upsert', deepseek('deep', 'deepseek-v4-pro'));
    const r1 = await core.call<{ ok: boolean; secret_ref?: string }>('providers.delete', { id: deep.id });
    expect(r1.secret_ref).toBeUndefined();
    const list = await core.call<Provider[]>('providers.list', {});
    expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ id: fast.id, is_default: true });
    const r2 = await core.call<{ ok: boolean; secret_ref?: string }>('providers.delete', { id: fast.id });
    expect(r2.secret_ref).toBe('deepseek');
    await expect(core.call('providers.delete', { id: fast.id })).rejects.toThrow();
  });
});
