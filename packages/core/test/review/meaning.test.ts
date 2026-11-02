import { describe, expect, it } from 'vitest';
import type { ReviewSession } from '../../src/index.js';
import { makeDoc, makeReviewCore, makeWord } from './fixtures.js';

describe('复习的释义优先级', () => {
  it('语境义 > 用户释义 > 词典短释义', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    const a = await makeWord(db, { text: 'compiler', meaning: '编译器' }, doc);
    const b = await makeWord(db, { text: 'parser', meaning: '解析器' }, doc);
    const c = await makeWord(db, { text: 'token', meaning: '记号' }, doc);
    await db.run('UPDATE terms SET short_gloss = ? WHERE id = ?', ['编辑者', a.term_id]);
    await db.run('UPDATE terms SET meaning = NULL, short_gloss = ? WHERE id = ?', ['分析者', b.term_id]);
    await db.run('UPDATE term_contexts SET meaning_in_context = ? WHERE term_id = ?', ['令牌', c.term_id]);
    const s = await core.call<ReviewSession>('review.start', {});
    const hint = (id: string) => s.steps.find(x => x.card_id === id)!.hint;
    expect(hint(a.card_id)).toBe('编译器');
    expect(hint(b.card_id)).toBe('分析者');
    expect(hint(c.card_id)).toBe('令牌');
  });

  it('正确项只有一个义项时，干扰项也只留首义', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    const a = await makeWord(db, { text: 'compiler', meaning: '编译器' }, doc);
    for (const [text, meaning] of [['parser', '解析器，分析程序'], ['linker', '连接器；链接程序'], ['token', '记号，令牌'], ['lexer', '词法分析器，扫描器']] as const) await makeWord(db, { text, meaning }, doc);
    const s = await core.call<ReviewSession>('review.start', {});
    const texts = s.steps.find(x => x.card_id === a.card_id)!.options!.map(o => o.text);
    expect(texts).toHaveLength(4);
    expect(texts).toContain('编译器');
    expect(texts.every(t => !/[，；]/.test(t))).toBe(true);
  });

  it('拼写练习的题面用同样的优先级', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    const a = await makeWord(db, { text: 'compiler', meaning: '编译器' }, doc);
    await db.run('UPDATE terms SET short_gloss = ? WHERE id = ?', ['编辑者', a.term_id]);
    const r = await core.call<{ items: { sentence: string }[] }>('practice.start', { mode: 'spell', source: 'recent', count: 5 });
    expect(r.items[0]!.sentence).toBe('编译器');
  });
});

describe('练习成绩', () => {
  const logs = async (db: Awaited<ReturnType<typeof makeReviewCore>>['db']) => Number((await db.get<{ n: number }>('SELECT count(*) AS n FROM practice_logs'))?.n ?? 0);

  it('一题都没批改：不写成绩，也清掉这一轮的记录', async () => {
    const { core, db } = await makeReviewCore();
    await makeWord(db, { text: 'compiler', meaning: '编译器' }, await makeDoc(db));
    const r = await core.call<{ practice_id: string }>('practice.start', { mode: 'produce', source: 'recent', count: 5 });
    await core.call('practice.finish', { practice_id: r.practice_id, results: [] });
    expect(await logs(db)).toBe(0);
    expect(await db.get('SELECT key FROM settings WHERE key = ?', [`practice.pending.${r.practice_id}`])).toBeUndefined();
  });

  it('批改出来的 0 分照常记录', async () => {
    const { core, db } = await makeReviewCore();
    await makeWord(db, { text: 'compiler', meaning: '编译器' }, await makeDoc(db));
    const r = await core.call<{ practice_id: string; items: { id: string }[] }>('practice.start', { mode: 'produce', source: 'recent', count: 5 });
    await core.call('practice.finish', { practice_id: r.practice_id, results: [{ item_id: r.items[0]!.id, accuracy: 0, duration_ms: 1000 }] });
    expect(await logs(db)).toBe(1);
  });
});
