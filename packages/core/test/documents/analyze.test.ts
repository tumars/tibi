import { describe, expect, it } from 'vitest';
import { openAppDb } from '@tibi/core-node';
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
  const { core, kernel } = await assembleCore({ db, dict, platform: fakePlatform({ isOnline: () => true, getSecret: async () => 'sk' }), resolveModel, resume: false });
  const imp = async (text = TEXT) => {
    const { task_id } = await core.call<{ task_id: string }>('documents.import', { source: { type: 'text', text } }); const r = await kernel.jobs.wait(task_id);
    const a = await db.get<{ id: string }>("SELECT id FROM jobs WHERE pipeline = 'analyze' ORDER BY created_at DESC LIMIT 1");   // 导入完成后另起的分析任务
    if (a) await kernel.jobs.wait(a.id);
    return (r.output as { document_id: string }).document_id;
  };
  return { core, kernel, db, stream, imp };
}

describe('导入后的 AI 分析（M2）', () => {
  it('连了模型：写入总结、建议、短语（只留原文里有的）、长难句，ai_status = done', async () => {
    const { core, db, imp } = await setup([{ text: '```json\n' + ALL + '\n```' }]);
    const id = await imp();
    const doc = await core.call<{ ai_status: string; ai?: Record<string, { output: unknown; model: string }> }>('documents.get', { id });
    expect(doc.ai_status).toBe('done');
    expect(doc.ai?.summary?.output).toBe('文章说重试策略会放大故障。');
    expect(doc.ai?.advice?.output).toBe('生词不多，直接读。');
    expect(doc.ai?.phrases?.output).toEqual([{ text: 'instead of', zh: '而不是' }]);
    expect((doc.ai?.hard_sentences?.output as unknown[]).length).toBe(1);
    expect(doc.ai?.summary?.model).toBe('fake-flash');
    const usage = await db.get<{ n: number }>("SELECT count(*) AS n FROM usage_records WHERE skill_id = 'importer'");
    expect(usage?.n).toBe(3);
  });

  it('没连模型：deferred；连上后 analyze_deferred 补做', async () => {
    const none = await setup(null);
    const id = await none.imp();
    expect((await none.core.call<{ ai_status: string }>('documents.get', { id })).ai_status).toBe('deferred');
    // 同一个库换成有模型的 Core：模拟"之后连上了模型"
    const later = await assembleCore({ db: none.db, dict, platform: fakePlatform({ isOnline: () => true, getSecret: async () => 'sk' }), resolveModel: async () => ({ model: FAKE_MODEL, apiKey: 'k', streamFn: scriptedStream([{ text: ALL }]) }), resume: false });
    expect(await later.core.call('documents.analyze_deferred', {})).toEqual({ queued: 0 });   // 还没有 provider
    await later.core.call('providers.upsert', { provider: { kind: 'llm', name: 'DeepSeek', protocol: 'openai_compatible', auth: 'api_key', tier: 'fast', model: 'deepseek-flash', is_default: true }, secret_ref: 'x' });
    await new Promise(r => setTimeout(r, 50));
    const job = await none.db.get<{ id: string }>("SELECT id FROM jobs WHERE pipeline = 'analyze' ORDER BY created_at DESC LIMIT 1");
    await later.kernel.jobs.wait(job!.id);
    expect((await later.core.call<{ ai_status: string }>('documents.get', { id })).ai_status).toBe('done');
  });

  it('译文：按批翻译并写回句子', async () => {
    const { core, kernel, imp } = await setup([{ text: ALL }, { text: ALL }, { text: ALL }, { text: '["大多数团队低估了重试策略增加的延迟。", "天真的指数退避会放大故障。"]' }]);
    const id = await imp();
    const doc = await core.call<{ sections: { id: string }[] }>('documents.get', { id });
    const { task_id } = await core.call<{ task_id: string }>('sections.translate', { id: doc.sections[0]!.id });
    expect((await kernel.jobs.wait(task_id)).status).toBe('done');
    const sec = await core.call<SectionContent>('sections.get', { id: doc.sections[0]!.id, with: ['translations'] });
    expect(sec.sentences.map(s => s.translation)).toEqual(['大多数团队低估了重试策略增加的延迟。', '天真的指数退避会放大故障。']);
  });

  it('宽松解析 JSON', () => {
    expect(parseJsonLoose('好的：{"a":1} 以上')).toEqual({ a: 1 });
    expect(parseJsonLoose('```\n["x"]\n```')).toEqual(['x']);
    expect(parseJsonLoose('没有')).toBeUndefined();
  });
});
