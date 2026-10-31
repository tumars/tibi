import { describe, expect, it } from 'vitest';
import { openAppDb } from '@tibi/core-node';
import { assembleCore, fakePlatform, type Dict, type SectionContent } from '../../src/index.js';
import type { ResolvedModel } from '../../src/kernel/index.js';
import { cleanMeaning } from '../../src/domain/terms/methods.js';
import { FAKE_MODEL, scriptedStream, type Turn } from '../kernel/helpers.js';

const FREQ: Record<string, number> = { the: 1, compiler: 2000, enforce: 7000, rule: 500, a: 3, set: 80, of: 4 };
const dict: Dict = { async lookup(w) { return FREQ[w] ? { word: w, translation: `v. ${w}的词典义`, exam: [], forms: [] } : undefined; }, async lemmas() { return []; }, async frequencyRank(l) { return FREQ[l]; } };

async function setup(turns: Turn[] | null, online = true) {
  const db = await openAppDb(':memory:');
  const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  await db.run("UPDATE user_profile SET vocab_estimate = 3000 WHERE id = '1'");
  const stream = turns ? scriptedStream(turns) : undefined;
  const resolveModel = stream ? async (): Promise<ResolvedModel> => ({ model: FAKE_MODEL, apiKey: 'k', streamFn: stream }) : undefined;
  const { core, kernel } = await assembleCore({ db, dict, platform: fakePlatform({ isOnline: () => online, getSecret: async () => 'sk-test' }), resolveModel, resume: false });
  const { task_id } = await core.call<{ task_id: string }>('documents.import', { source: { type: 'text', text: 'The compiler enforces a small set of rules at compile time.' } });
  const r = await kernel.jobs.wait(task_id);
  const doc = await core.call<{ sections: { id: string }[] }>('documents.get', { id: (r.output as { document_id: string }).document_id });
  const sec = await core.call<SectionContent>('sections.get', { id: doc.sections[0]!.id });
  return { core, db, stream, sentence: sec.sentences[0]! };
}

describe('语境释义（M1：固定的模型调用）', () => {
  it('没有缓存时调用快速档模型，写回 term_contexts，第二次直接用缓存', async () => {
    const { core, db, stream, sentence } = await setup([{ text: '“v. 强制执行”。' }]);
    await core.call('terms.lookup', { text: 'enforces', sentence_id: sentence.id });   // 点词：建词条与语境
    const a = await core.call<{ meaning: string; cached: boolean }>('terms.context_meaning', { text: 'enforces', sentence_id: sentence.id });
    expect(a).toEqual({ meaning: 'v. 强制执行', cached: false });
    const b = await core.call<{ meaning: string; cached: boolean }>('terms.context_meaning', { text: 'enforces', sentence_id: sentence.id });
    expect(b.cached).toBe(true);
    expect(stream!.calls).toBe(1);
    const look = await core.call<{ context_meaning?: string }>('terms.lookup', { text: 'enforces', sentence_id: sentence.id });
    expect(look.context_meaning).toBe('v. 强制执行');
    const usage = await db.get<{ n: number }>("SELECT count(*) AS n FROM usage_records WHERE skill_id = 'tutor'");
    expect(usage?.n).toBe(1);
  });

  it('没连模型 → model_unavailable；离线 → offline', async () => {
    const none = await setup(null);
    await expect(none.core.call('terms.context_meaning', { text: 'enforces', sentence_id: none.sentence.id })).rejects.toMatchObject({ code: 'model_unavailable' });
    const off = await setup([{ text: '强制' }], false);
    await expect(off.core.call('terms.context_meaning', { text: 'enforces', sentence_id: off.sentence.id })).rejects.toMatchObject({ code: 'offline' });
  });

  it('providers.test 走真实调用路径', async () => {
    const { core } = await setup([{ text: 'OK' }]);
    const p = await core.call<{ id: string }>('providers.upsert', { provider: { kind: 'llm', name: 'DeepSeek', protocol: 'openai_compatible', base_url: 'https://api.deepseek.com', auth: 'api_key', tier: 'fast', model: 'deepseek-flash', is_default: true }, secret_ref: 'provider.deepseek.llm' });
    const r = await core.call<{ ok: boolean; model?: string }>('providers.test', { id: p.id });
    expect(r).toMatchObject({ ok: true, model: 'fake-flash' });
  });

  it('清理模型输出', () => {
    expect(cleanMeaning('释义：「强制执行」。\n多余的解释')).toBe('强制执行');
  });
});
