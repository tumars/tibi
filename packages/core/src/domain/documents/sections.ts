import { j, now, type Database } from '../../db/driver.js';
import type { Dict } from '../../dict/types.js';
import type { Ctx } from '../../rpc/define.js';
import { TibiError, type AiResult, type SectionBlock, type Sentence, type SectionContent, type Status, type Token } from '../../types.js';
import { uuidv7 } from '../../ids.js';
import { recordUndo, registerUndo } from '../shared/undo.js';
import { getTermsByTexts } from '../terms/repo.js';
import { shortGloss } from '../terms/views.js';
import { getSection, listSentences, getDocument, listSections } from './repo.js';
import { splitBlocks } from '../text/segment.js';

/** 这一章每句已有的语境义（句子 id → lemma → 释义）：预生成结果打底，term_contexts 里写回的优先 */
async function sentenceMeanings(db: Database, section_id: string): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  const ai = await db.all<{ target_id: string; output: string }>("SELECT a.target_id, a.output FROM ai_results a JOIN sentences s ON s.id = a.target_id WHERE a.scope = 'sentence' AND a.task = 'context_meanings' AND a.deleted_at IS NULL AND s.section_id = ? ORDER BY a.created_at", [section_id]);
  for (const a of ai) out.set(a.target_id, { ...out.get(a.target_id), ...j.parse<Record<string, string>>(a.output, {}) });
  const own = await db.all<{ sentence_id: string; text: string; meaning: string }>("SELECT tc.sentence_id, t.text, tc.meaning_in_context AS meaning FROM term_contexts tc JOIN terms t ON t.id = tc.term_id JOIN sentences s ON s.id = tc.sentence_id WHERE tc.meaning_in_context IS NOT NULL AND tc.deleted_at IS NULL AND s.section_id = ?", [section_id]);
  for (const c of own) out.set(c.sentence_id, { ...out.get(c.sentence_id), [c.text]: c.meaning });
  return out;
}

/** sections.get：阅读器一次取齐——句子、tokens、词状态、短语、计数（06 §3） */
export async function sectionContent(db: Database, section_id: string, opts: { translations?: boolean; ai?: boolean; dict?: Dict } = {}): Promise<SectionContent> {
  const sec = await getSection(db, section_id);
  if (!sec || sec.deleted_at) throw new TibiError('not_found', '找不到这一章');
  const rows = await listSentences(db, section_id);
  const lemmas = [...new Set(rows.flatMap(r => j.parse<Token[]>(r.tokens, []).map(t => t.l)))];
  const terms = await getTermsByTexts(db, lemmas);
  const counts = { new: 0, learning: 0 };
  const seenCount = new Set<string>();
  // 短语：这一章里登记过语境的短语
  const phraseRows = await db.all<{ id: string; text: string; sentence_id: string }>("SELECT t.id, t.text, tc.sentence_id FROM terms t JOIN term_contexts tc ON tc.term_id = t.id AND tc.deleted_at IS NULL JOIN sentences s ON s.id = tc.sentence_id WHERE t.kind = 'phrase' AND t.deleted_at IS NULL AND t.status NOT IN (98) AND s.section_id = ?", [section_id]);
  const phraseMap = new Map<string, { id: string; text: string; sentence_ids: string[] }>();
  for (const p of phraseRows) { const e = phraseMap.get(p.id) ?? { id: p.id, text: p.text, sentence_ids: [] }; e.sentence_ids.push(p.sentence_id); phraseMap.set(p.id, e); }
  const inContext = await sentenceMeanings(db, section_id);
  // 行没存短释义（旧数据、标过已知 / 忽略又标回来的词）：当场查词典补上，不然高亮了却没有行间释义
  const dictGloss = new Map<string, string | undefined>();
  if (opts.dict) for (const term of terms.values()) {
    if (term.deleted_at || term.status < 0 || term.status > 4 || shortGloss(term.meaning) || term.short_gloss) continue;
    dictGloss.set(term.text, shortGloss((await opts.dict.lookup(term.text))?.translation));
  }
  const sentences: Sentence[] = rows.map(r => {
    const tokens = j.parse<Token[]>(r.tokens, []).map(t => {
      const term = terms.get(t.l);
      const out: Token = { t: t.t, l: t.l, s: t.s, e: t.e };
      // 只有用户标过的生词 / 学习中（0–4）和忽略（98）带状态；5、97 不标；旧数据里的 99（待确认）当作没有行
      if (term && !term.deleted_at && ((term.status >= 0 && term.status <= 4) || term.status === 98)) {
        out.status = term.status as Status;
        // 行间释义：这句里的语境义 > 用户写的释义 > 词典短释义
        const gloss = term.status === 98 ? undefined : shortGloss(inContext.get(r.id)?.[t.l]) || shortGloss(term.meaning) || term.short_gloss || dictGloss.get(term.text);
        if (gloss) out.gloss = gloss;
        if (!seenCount.has(term.id)) { seenCount.add(term.id); if (term.status === 0) counts.new++; else if (term.status <= 4) counts.learning++; }
      }
      return out;
    });
    // 短语标记：按文本位置给 token 打 phrase_id
    for (const ph of phraseMap.values()) {
      if (!ph.sentence_ids.includes(r.id)) continue;
      const lower = r.text.toLowerCase(); let from = 0;
      while (true) {
        const at = lower.indexOf(ph.text, from); if (at < 0) break;
        for (const t of tokens) if (t.s >= at && t.e <= at + ph.text.length) t.phrase_id = ph.id;
        from = at + ph.text.length;
      }
    }
    return { id: r.id, idx: r.idx, paragraph_idx: r.paragraph_idx, block_type: r.block_type as Sentence['block_type'], text: r.text, tokens, translation: opts.translations ? r.translation ?? undefined : undefined };
  });
  // 块：按 content_md 的段落顺序，代码块、图片直接取原文，其余段落引用句子
  const paras = splitBlocks(sec.content_md);
  const byPara = new Map<number, Sentence[]>();
  for (const s of sentences) { const a = byPara.get(s.paragraph_idx) ?? []; a.push(s); byPara.set(s.paragraph_idx, a); }
  const blocks: SectionBlock[] = [];
  for (const p of paras) {
    if (p.block_type === 'code') { blocks.push({ type: 'code', lang: p.lang, code: p.text }); continue; }
    if (p.block_type === 'image') { blocks.push({ type: 'image', src: p.src!, alt: p.text }); continue; }
    const ss = byPara.get(p.idx);
    if (ss?.length) blocks.push({ type: 'sentences', ids: ss.map(s => s.id), block_type: ss[0]!.block_type, paragraph_idx: p.idx });
  }
  let ai: Record<string, AiResult> | undefined;
  if (opts.ai) {
    ai = {};
    for (const r of await db.all<{ task: string; output: string; model: string; prompt_version: string; created_at: number }>("SELECT task, output, model, prompt_version, created_at FROM ai_results WHERE scope = 'section' AND target_id = ? AND deleted_at IS NULL", [section_id])) ai[r.task] = { task: r.task, output: j.parse(r.output, null), model: r.model, prompt_version: r.prompt_version, created_at: Number(r.created_at) };
  }
  return { id: sec.id, document_id: sec.document_id, title: sec.title, blocks, sentences, phrases: [...phraseMap.values()], counts, ai };
}

/** 两次进度上报隔得超过这么久，算新的一次阅读（中间离开了） */
const READING_IDLE = 5 * 60_000;

/**
 * 记阅读时长和词数（reading_sessions，统计和"今日阅读"都读它）：接着上一次的会话延长，隔太久就新开一次。
 * 词数只算往后读的部分（进度增加 × 本章词数），往回翻不扣。
 */
async function recordReading(tx: Database, sec: { id: string; document_id: string; word_count: number }, from: number, to: number, t: number) {
  const words = Math.round(Math.max(0, to - from) * Number(sec.word_count));
  const last = await tx.get<{ id: string }>('SELECT id FROM reading_sessions WHERE section_id = ? AND ended_at >= ? ORDER BY ended_at DESC LIMIT 1', [sec.id, t - READING_IDLE]);
  if (last) await tx.run('UPDATE reading_sessions SET ended_at = ?, words_read = words_read + ?, updated_at = ? WHERE id = ?', [t, words, t, last.id]);
  else await tx.run('INSERT INTO reading_sessions(id, document_id, section_id, started_at, ended_at, words_read, updated_at) VALUES (?,?,?,?,?,?,?)', [uuidv7(), sec.document_id, sec.id, t, t, words, t]);
}

/** sections.progress：阅读位置（节流后调用）；同时更新文档级进度与 last_read_at，并记阅读时长 */
export async function setProgress(db: Database, section_id: string, sentence_id: string, progress: number): Promise<void> {
  const sec = await getSection(db, section_id); if (!sec) throw new TibiError('not_found', '找不到这一章');
  const t = now(); const p = Math.max(0, Math.min(1, progress));
  await db.transaction(async tx => {
    await recordReading(tx, sec, Number(sec.progress), p, t);
    await tx.run('UPDATE sections SET progress = ?, last_sentence_id = ?, updated_at = ? WHERE id = ?', [p, sentence_id, t, section_id]);
    const secs = await listSections(tx, sec.document_id);
    const total = secs.reduce((a, s) => a + Number(s.word_count), 0) || 1;
    const docProgress = secs.reduce((a, s) => a + Number(s.id === section_id ? p : s.progress) * Number(s.word_count), 0) / total;
    await tx.run('UPDATE documents SET progress = ?, last_section_id = ?, last_read_at = ?, updated_at = ? WHERE id = ?', [docProgress, section_id, t, t, sec.document_id]);
  });
}

/**
 * sections.finish：读完一章。只记进度和事件，不改任何词的状态——生词都是用户自己标的，读完不等于认识了。
 */
export async function finishSection(ctx: Ctx, section_id: string): Promise<{ ok: true }> {
  const sec = await getSection(ctx.db, section_id); if (!sec) throw new TibiError('not_found', '找不到这一章');
  const t = now();
  await ctx.db.transaction(async tx => {
    await recordReading(tx, sec, Number(sec.progress), 1, t);
    await tx.run('UPDATE sections SET progress = 1, finished_at = COALESCE(finished_at, ?), updated_at = ? WHERE id = ?', [t, t, section_id]);
    const secs = await listSections(tx, sec.document_id);
    const allDone = secs.every(s => s.id === section_id || s.finished_at != null);
    await tx.run('UPDATE documents SET progress = ?, last_section_id = ?, last_read_at = ?, finished_at = CASE WHEN ? THEN COALESCE(finished_at, ?) ELSE finished_at END, updated_at = ? WHERE id = ?', [allDone ? 1 : secs.reduce((a, s) => a + (s.id === section_id ? 1 : Number(s.progress)) * Number(s.word_count), 0) / (secs.reduce((a, s) => a + Number(s.word_count), 0) || 1), section_id, t, allDone ? 1 : 0, t, t, sec.document_id]);
    await tx.run('INSERT INTO learning_events(id, type, payload, created_at) VALUES (?,?,?,?)', [crypto.randomUUID(), 'section_finished', j.str({ document_id: sec.document_id, section_id, all_done: allDone }), t]);
  });
  ctx.events.emit('data.changed', { table: 'documents', ids: [sec.document_id] });
  return { ok: true };
}

/** documents.delete：软删，可撤销 */
export async function softDeleteDocument(ctx: Ctx, id: string) {
  const d = await getDocument(ctx.db, id); if (!d || d.deleted_at) throw new TibiError('not_found', '文章不在了');
  const t = now();
  await ctx.db.run('UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ?', [t, t, id]);
  const undo = await recordUndo(ctx.db, ctx, { tool: 'documents.delete', args: { id }, undo_payload: { id } });
  ctx.events.emit('data.changed', { table: 'documents', ids: [id] });
  return undo;
}
registerUndo<{ id: string }>('documents.delete', async (p, ctx) => {
  await ctx.db.run('UPDATE documents SET deleted_at = NULL, updated_at = ? WHERE id = ?', [now(), p.id]);
  ctx.events.emit('data.changed', { table: 'documents', ids: [p.id] });
});
