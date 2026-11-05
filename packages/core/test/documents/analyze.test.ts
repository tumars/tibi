import { describe, expect, it } from 'vitest';
import { openAppDb } from '@tibi/core-node';
import { imported } from '../helpers.js';
import { idle } from '../../src/domain/documents/imports.js';
import { assembleCore, fakePlatform, type Dict, type SectionContent } from '../../src/index.js';
import type { ResolvedModel } from '../../src/kernel/index.js';
import { parseJsonLoose } from '../../src/domain/documents/analyze.js';
import { FAKE_MODEL, scriptedStream, type Turn } from '../kernel/helpers.js';

const dict: Dict = { async lookup() { return undefined; }, async lemmas() { return []; }, async frequencyRank() { return undefined; } };
const TEXT = 'Most teams underestimate how much latency their retry policy adds. A naive exponential backoff can amplify an outage instead of absorbing it, because every client retries at once.';
// 三个子任务读同一份 JSON 里各自的字段（并行调用的顺序不固定）
const ALL = JSON.stringify({
  summary: '文章说重试策略会放大故障。', advice: '生词不多，直接读。', keywords: ['retry', 'backoff'],
  phrases: [{ text: 'instead of', zh: '而不是' }, { text: 'made up phrase', zh: '不在原文里' }],
  hard_sentences: [{ s: 'A naive exponential backoff can amplify an outage instead of absorbing it.', zh: '……结构：主干 can amplify' }],
});

async function setup(turns: Turn[] | null) {
  const db = await openAppDb(':memory:');
  const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  if (turns) await db.run("INSERT INTO providers(id, kind, name, protocol, auth, tier, model, is_default, created_at, updated_at) VALUES ('p1','llm','Fake','openai_compatible','api_key','fast','fake-flash',1,?,?)", [t, t]);
  const stream = turns ? scriptedStream(turns) : undefined;
  const resolveModel = stream ? async (): Promise<ResolvedModel> => ({ model: FAKE_MODEL, apiKey: 'k', streamFn: stream }) : undefined;
  const { core } = await assembleCore({ db, dict, platform: fakePlatform({ isOnline: () => true, getSecret: async () => 'sk' }), resolveModel, resume: false });
  const imp = async (text = TEXT) => {
    const r = await imported(await core.call<{ import_id: string }>('documents.import', { source: { type: 'text', text } }));
    return (r as unknown as { document_id: string }).document_id;
  };
  return { core, db, stream, imp };
}

describe('文章的 AI 分析（M2）', () => {
  it('导入时不自动生成总结，连了模型也一样', async () => {
    const { core, stream, imp } = await setup([{ text: ALL }]);
    const id = await imp();
    await idle();
    const doc = await core.call<{ ai_status: string; ai?: Record<string, unknown> }>('documents.get', { id });
    expect(doc.ai_status).toBe('none');
    expect(doc.ai?.summary).toBeUndefined();
    expect(stream!.calls).toBe(0);
  });

  it('手动生成：写入总结、建议、短语（只留原文里有的）、长难句，ai_status = done', async () => {
    const { core, stream, imp } = await setup([{ text: '```json\n' + ALL + '\n```' }]);
    const id = await imp();
    await core.call('documents.analyze', { id });
    await idle();
    const doc = await core.call<{ ai_status: string; ai?: Record<string, { output: unknown; model: string }> }>('documents.get', { id });
    expect(doc.ai_status).toBe('done');
    expect(doc.ai?.summary?.output).toBe('文章说重试策略会放大故障。');
    expect(doc.ai?.advice?.output).toBe('生词不多，直接读。');
    expect(doc.ai?.phrases?.output).toEqual([{ text: 'instead of', zh: '而不是' }]);
    expect((doc.ai?.hard_sentences?.output as unknown[]).length).toBe(1);
    expect(doc.ai?.summary?.model).toBe('fake-flash');
    expect(stream!.calls).toBe(3);
  });

  it('连上模型后也不自动补做', async () => {
    const none = await setup(null);
    const id = await none.imp();
    // 同一个库换成有模型的 Core：模拟"之后连上了模型"
    const stream = scriptedStream([{ text: ALL }]);
    const later = await assembleCore({ db: none.db, dict, platform: fakePlatform({ isOnline: () => true, getSecret: async () => 'sk' }), resolveModel: async () => ({ model: FAKE_MODEL, apiKey: 'k', streamFn: stream }), resume: false });
    await later.core.call('providers.upsert', { provider: { kind: 'llm', name: 'DeepSeek', protocol: 'openai_compatible', auth: 'api_key', tier: 'fast', model: 'deepseek-flash', is_default: true }, secret_ref: 'x' });
    await new Promise(r => setTimeout(r, 50));
    await idle();
    expect((await later.core.call<{ ai_status: string }>('documents.get', { id })).ai_status).toBe('none');
    expect(stream.calls).toBe(0);
  });

  it('译文：按批翻译并写回句子', async () => {
    const { core, imp } = await setup([{ text: '["大多数团队低估了重试策略增加的延迟。", "天真的指数退避会放大故障。"]' }]);
    const id = await imp();
    const doc = await core.call<{ sections: { id: string }[] }>('documents.get', { id });
    await core.call('sections.translate', { id: doc.sections[0]!.id });
    await idle();
    const sec = await core.call<SectionContent>('sections.get', { id: doc.sections[0]!.id, with: ['translations'] });
    expect(sec.sentences.map(s => s.translation)).toEqual(['大多数团队低估了重试策略增加的延迟。', '天真的指数退避会放大故障。']);
  });

  it('同一篇文章同时打开两次对话只建一个（阅读器 Tibi 面板）', async () => {
    const { core, imp } = await setup(null);
    const id = await imp();
    const [a, b] = await Promise.all([core.call<{ id: string }>('chat.open', { document_id: id }), core.call<{ id: string }>('chat.open', { document_id: id })]);
    expect(a.id).toBe(b.id);
    expect((await core.call<{ id: string }>('chat.open', { document_id: id })).id).toBe(a.id);
  });

  it('宽松解析 JSON', () => {
    expect(parseJsonLoose('好的：{"a":1} 以上')).toEqual({ a: 1 });
    expect(parseJsonLoose('```\n["x"]\n```')).toEqual(['x']);
    expect(parseJsonLoose('没有')).toBeUndefined();
  });
});

describe('练习批改与短文（M3）', () => {
  it('practice.grade 返回分数、点评、改好的句子', async () => {
    const { core } = await setup([{ text: '{"score": 82, "ok": true, "feedback": "用对了，amplify 后面接宾语。", "better": "Retries can amplify an outage."}' }]);
    const r = await core.call<{ score: number; ok: boolean; better?: string }>('practice.grade', { word: 'amplify', text: 'Retry can amplify outage.' });
    expect(r).toMatchObject({ score: 82, ok: true, better: 'Retries can amplify an outage.' });
  });
  it('review.story 写短文并作为 Tibi 写的文章导入', async () => {
    const story = 'The Quiet Retry\n\n' + 'Every engineer knows that a retry can amplify a small outage into a large one. '.repeat(6);
    const { core, db, imp } = await setup([{ text: story }]);
    await imp();
    await core.call('terms.add', { entries: [{ text: 'amplify' }] });   // 导入不建词条：用户自己加的生词
    const t = await db.get<{ id: string }>("SELECT id FROM terms LIMIT 1");
    const r = await imported(await core.call<{ import_id: string }>('review.story', { term_ids: [t!.id] }));
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    const doc = await db.get<{ title: string; source_type: string }>('SELECT title, source_type FROM documents WHERE id = ?', [(r as unknown as { document_id: string }).document_id]);
    expect(doc).toEqual({ title: 'The Quiet Retry', source_type: 'tibi_generated' });
  });
});
