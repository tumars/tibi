import { uuidv7, type Database } from '../../src/index.js';
import { reviewMethods } from '../../src/domain/review/index.js';
import { statsMethods } from '../../src/domain/stats/index.js';
import { profileMethods } from '../../src/domain/profile/index.js';
import { makeCore } from '../helpers.js';

/** 复习 / 统计 / 画像测试共用的 Core 与造数工具（不依赖文本流水线） */
export async function makeReviewCore() {
  const c = await makeCore();
  c.core.use(reviewMethods).use(statsMethods).use(profileMethods);
  return c;
}

export interface WordSpec { text: string; meaning: string; status?: number; sentence?: string; translation?: string; forms?: string[]; article?: boolean; due?: number; state?: number }

/** 造一篇文档 + 句子，供语境引用 */
export async function makeDoc(db: Database, title = 'Doc'): Promise<{ document_id: string; section_id: string }> {
  const t = Date.now(); const document_id = uuidv7(), section_id = uuidv7();
  await db.run("INSERT INTO documents(id, title, kind, genre, source_type, content_hash, status, created_at, updated_at, word_count, last_read_at) VALUES (?,?,'article','tech','text',?,'ready',?,?,500,?)", [document_id, title, document_id, t, t, t]);
  await db.run("INSERT INTO sections(id, document_id, idx, title, content_md, status, created_at, updated_at) VALUES (?,?,0,?,'','ready',?,?)", [section_id, document_id, title, t, t]);
  return { document_id, section_id };
}

/** 造一个词：terms + （可选）文章语境 + 卡片 */
export async function makeWord(db: Database, w: WordSpec, doc?: { document_id: string; section_id: string }): Promise<{ term_id: string; card_id: string; context_id?: string }> {
  const t = Date.now(); const term_id = uuidv7(), card_id = uuidv7();
  await db.run('INSERT INTO terms(id, kind, text, text_display, status, status_source, meaning, short_gloss, in_wordbook, encounter_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,1,1,?,?)',
    [term_id, 'word', w.text, w.text, w.status ?? 0, 'user', w.meaning, w.meaning, t, t]);
  for (const f of w.forms ?? []) await db.run('INSERT INTO term_forms(term_id, form, encounter_count, first_seen_at, updated_at) VALUES (?,?,1,?,?)', [term_id, f, t, t]);
  let context_id: string | undefined;
  if (w.article !== false && doc) {
    const sid = uuidv7(); context_id = uuidv7();
    const sentence = w.sentence ?? `The word ${w.text} appears here.`;
    await db.run('INSERT INTO sentences(id, section_id, paragraph_idx, block_type, idx, text, tokens, translation, created_at, updated_at) VALUES (?,?,0,?,0,?,?,?,?,?)', [sid, doc.section_id, 'prose', sentence, '[]', w.translation ?? '这个词出现在这里。', t, t]);
    await db.run("INSERT INTO term_contexts(id, term_id, source, document_id, sentence_id, surface, is_primary, created_at, updated_at) VALUES (?,?,'article',?,?,?,1,?,?)", [context_id, term_id, doc.document_id, sid, w.text, t, t]);
  }
  const state = w.state ?? 0;
  await db.run('INSERT INTO cards(id, term_id, due, state, stability, stability_fast, difficulty, reps, last_review, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [card_id, term_id, w.due ?? t - 1000, state, state ? 5 : 0, state ? 4 : 0, state ? 5 : 0, state ? 1 : 0, state ? t - 5 * 86_400_000 : null, t, t]);
  return { term_id, card_id, context_id };
}
