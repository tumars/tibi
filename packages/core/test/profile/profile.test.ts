import { describe, expect, it } from 'vitest';
import { uuidv7, type Profile, type Provider } from '../../src/index.js';
import { estimateVocab, cefrOf } from '../../src/domain/profile/index.js';
import { makeReviewCore } from '../review/fixtures.js';

describe('画像与设置', () => {
  it('profile.get / update：自评水平重算估算；设置键值', async () => {
    const { core } = await makeReviewCore();
    const p = await core.call<Profile>('profile.get', {});
    expect(p.vocab_estimate).toBe(3500); expect(p.assistant_prefs.permission).toBe('default');
    const p2 = await core.call<Profile>('profile.update', { patch: { level_self: 'advanced', display_name: '小明', assistant_prefs: { nickname: '明' } } });
    expect(p2.vocab_estimate).toBe(9000); expect(p2.display_name).toBe('小明'); expect(p2.assistant_prefs).toMatchObject({ nickname: '明', language: 'mixed' });
    const p3 = await core.call<Profile>('profile.update', { patch: { vocab_estimate: 7200 } });
    expect(p3.vocab_source).toBe('manual');
    const p4 = await core.call<Profile>('profile.update', { patch: { level_self: 'beginner' } });
    expect(p4.vocab_estimate).toBe(7200);   // 不再来自自评，不重算
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
});

describe('词汇量测试（R8）', () => {
  it('7 组、每组含 2 个伪词；估算与 CEFR', async () => {
    const { core, db } = await makeReviewCore();
    const s = await core.call<{ bands: { label: string; words: string[] }[] }>('vocab.start', {});
    expect(s.bands).toHaveLength(7);
    expect(s.bands.map(b => b.words.length)).toEqual([10, 10, 10, 12, 12, 12, 10]);
    const pending = JSON.parse((await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'vocab.pending'"))!.value) as { words: string[]; pseudo: string[] }[];
    // 全部认识前 4 组、后面不认识，不点伪词
    const picks = s.bands.map((b, i) => i < 4 ? b.words.filter(w => !pending[i]!.pseudo.includes(w)) : []);
    const r = await core.call<{ estimate: number; cefr: string; bands: number[]; pseudo_hits: number }>('vocab.submit', { picks });
    expect(r.estimate).toBe(6000); expect(r.cefr).toBe('C1'); expect(r.pseudo_hits).toBe(0); expect(r.bands.slice(0, 4)).toEqual([1, 1, 1, 1]);
    const prof = await db.get<{ vocab_estimate: number; vocab_source: string; vocab_tested_at: number }>("SELECT vocab_estimate, vocab_source, vocab_tested_at FROM user_profile WHERE id = '1'");
    expect(prof).toMatchObject({ vocab_estimate: 6000, vocab_source: 'test' }); expect(prof?.vocab_tested_at).toBeGreaterThan(0);
    expect(await db.all("SELECT id FROM learning_events WHERE type = 'vocab_test'")).toHaveLength(1);
    await expect(core.call('vocab.submit', { picks })).rejects.toThrow();
  });

  it('点中伪词按比例下调', () => {
    const bands = [{ label: 'a', lo: 0, hi: 1000, words: ['x1', 'x2', 'p1', 'p2'], pseudo: ['p1', 'p2'] }, { label: 'b', lo: 1000, hi: 2000, words: ['y1', 'y2', 'p3', 'p4'], pseudo: ['p3', 'p4'] }];
    expect(estimateVocab(bands, [['x1', 'x2'], ['y1', 'y2']]).estimate).toBe(2000);
    expect(estimateVocab(bands, [['x1', 'x2', 'p1'], ['y1', 'y2', 'p3']])).toMatchObject({ estimate: 1000, pseudo_hits: 2 });
    expect(cefrOf(1999)).toBe('A2'); expect(cefrOf(9000)).toBe('C2');
    void uuidv7;
  });
});
