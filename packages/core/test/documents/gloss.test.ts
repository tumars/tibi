import { describe, expect, it } from 'vitest';
import { sectionContent } from '../../src/domain/documents/sections.js';
import { makeDoc, makeReviewCore, makeWord } from '../review/fixtures.js';

const TEXT = 'The compiler parses a token.';
const tok = (t: string) => ({ t, l: t, s: TEXT.indexOf(t), e: TEXT.indexOf(t) + t.length });

async function setup() {
  const { db } = await makeReviewCore();
  const doc = await makeDoc(db);
  const w = await makeWord(db, { text: 'compiler', meaning: '编译器', sentence: TEXT }, doc);
  const s = await db.get<{ sentence_id: string }>('SELECT sentence_id FROM term_contexts WHERE id = ?', [w.context_id!]);
  await db.run('UPDATE sentences SET tokens = ? WHERE id = ?', [JSON.stringify([tok('compiler'), tok('token')]), s!.sentence_id]);
  const gloss = async (word = 'compiler') => (await sectionContent(db, doc.section_id)).sentences[0]!.tokens.find(t => t.l === word)?.gloss;
  return { db, w, sentence_id: s!.sentence_id, gloss };
}

describe('行间释义', () => {
  it('没有语境义和用户释义时用词典短释义', async () => {
    const { db, w, gloss } = await setup();
    await db.run('UPDATE terms SET meaning = NULL, short_gloss = ? WHERE id = ?', ['编辑者', w.term_id]);
    expect(await gloss()).toBe('编辑者');
  });

  it('用户释义优先于短释义，并压成短注', async () => {
    const { db, w, gloss } = await setup();
    await db.run('UPDATE terms SET meaning = ?, short_gloss = ? WHERE id = ?', ['n. 编译器，编译程序', '编辑者', w.term_id]);
    expect(await gloss()).toBe('编译器');
  });

  it('短注去掉括号说明，不留半截', async () => {
    const { db, w, gloss } = await setup();
    await db.run('UPDATE terms SET meaning = ? WHERE id = ?', ['（编程语言的）语法', w.term_id]);
    expect(await gloss()).toBe('语法');
    await db.run('UPDATE terms SET meaning = ? WHERE id = ?', ['词法单元（token，最小的单位）', w.term_id]);
    expect(await gloss()).toBe('词法单元');
  });

  it('语境义优先：写回的语境义和预生成结果都算', async () => {
    const { db, w, sentence_id, gloss } = await setup();
    const t = Date.now();
    await db.run("INSERT INTO ai_results(id, scope, target_id, task, prompt_version, model, output, created_at, updated_at) VALUES ('a1', 'sentence', ?, 'context_meanings', '1', 'bundled', ?, ?, ?)", [sentence_id, JSON.stringify({ compiler: '预生成义' }), t, t]);
    expect(await gloss()).toBe('预生成义');
    await db.run('UPDATE term_contexts SET meaning_in_context = ? WHERE term_id = ?', ['写回义', w.term_id]);
    expect(await gloss()).toBe('写回义');
  });

  it('已知和忽略的词不带释义', async () => {
    const { db, w, gloss } = await setup();
    expect(await gloss('token')).toBeUndefined();
    for (const status of [97, 98]) {
      await db.run('UPDATE terms SET status = ? WHERE id = ?', [status, w.term_id]);
      expect(await gloss()).toBeUndefined();
    }
  });
});
