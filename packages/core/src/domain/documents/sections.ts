import { j, now, type Database } from '../../db/driver.js';
import type { Ctx } from '../../rpc/define.js';
import { TibiError, type AiResult, type SectionBlock, type Sentence, type SectionContent, type Status, type Token } from '../../types.js';
import { recordUndo, registerUndo } from '../shared/undo.js';
import { getTermsByTexts } from '../terms/repo.js';
import { applyStatus } from '../terms/service.js';
import { getSection, listSentences, getDocument, listSections } from './repo.js';
import { splitBlocks } from '../text/segment.js';

/** sections.get：阅读器一次取齐——句子、tokens、词状态、短语、计数（06 §3） */
export async function sectionContent(db: Database, section_id: string, opts: { translations?: boolean; ai?: boolean } = {}): Promise<SectionContent> {
  const sec = await getSection(db, section_id);
  if (!sec || sec.deleted_at) throw new TibiError('not_found', '找不到这一章');
  const rows = await listSentences(db, section_id);
  const lemmas = [...new Set(rows.flatMap(r => j.parse<Token[]>(r.tokens, []).map(t => t.l)))];
  const terms = await getTermsByTexts(db, lemmas);
  const counts = { new: 0, learning: 0, unsure: 0 };
  const seenCount = new Set<string>();
  // 短语：这一章里登记过语境的短语
  const phraseRows = await db.all<{ id: string; text: string; sentence_id: string }>("SELECT t.id, t.text, tc.sentence_id FROM terms t JOIN term_contexts tc ON tc.term_id = t.id AND tc.deleted_at IS NULL JOIN sentences s ON s.id = tc.sentence_id WHERE t.kind = 'phrase' AND t.deleted_at IS NULL AND t.status NOT IN (98) AND s.section_id = ?", [section_id]);
  const phraseMap = new Map<string, { id: string; text: string; sentence_ids: string[] }>();
  for (const p of phraseRows) { const e = phraseMap.get(p.id) ?? { id: p.id, text: p.text, sentence_ids: [] }; e.sentence_ids.push(p.sentence_id); phraseMap.set(p.id, e); }
  const sentences: Sentence[] = rows.map(r => {
    const tokens = j.parse<Token[]>(r.tokens, []).map(t => {
      const term = terms.get(t.l);
      const out: Token = { t: t.t, l: t.l, s: t.s, e: t.e };
      if (term && !term.deleted_at && term.status !== 5 && term.status !== 97) {
        out.status = term.status as Status;
        if (!seenCount.has(term.id)) { seenCount.add(term.id); if (term.status === 0) counts.new++; else if (term.status >= 1 && term.status <= 4) counts.learning++; else if (term.status === 99) counts.unsure++; }
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
  // 块：按 content_md 的段落顺序，代码块直接取原文，其余段落引用句子
  const paras = splitBlocks(sec.content_md);
  const byPara = new Map<number, Sentence[]>();
  for (const s of sentences) { const a = byPara.get(s.paragraph_idx) ?? []; a.push(s); byPara.set(s.paragraph_idx, a); }
  const blocks: SectionBlock[] = [];
  for (const p of paras) {
    if (p.block_type === 'code') { blocks.push({ type: 'code', lang: p.lang, code: p.text }); continue; }
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

/** sections.progress：阅读位置（节流后调用）；同时更新文档级进度与 last_read_at */
export async function setProgress(db: Database, section_id: string, sentence_id: string, progress: number): Promise<void> {
  const sec = await getSection(db, section_id); if (!sec) throw new TibiError('not_found', '找不到这一章');
  const t = now(); const p = Math.max(0, Math.min(1, progress));
  await db.transaction(async tx => {
    await tx.run('UPDATE sections SET progress = ?, last_sentence_id = ?, updated_at = ? WHERE id = ?', [p, sentence_id, t, section_id]);
    const secs = await listSections(tx, sec.document_id);
    const total = secs.reduce((a, s) => a + Number(s.word_count), 0) || 1;
    const docProgress = secs.reduce((a, s) => a + Number(s.id === section_id ? p : s.progress) * Number(s.word_count), 0) / total;
    await tx.run('UPDATE documents SET progress = ?, last_section_id = ?, last_read_at = ?, updated_at = ? WHERE id = ?', [docProgress, section_id, t, t, sec.document_id]);
  });
}

/**
 * sections.finish：读完一章。mark_rest_known 只把 status = 0 的词设为 97（R5）：
 * 不动待确认（99）、不设为 5；没有行的词本来就是已知，不用管。带撤销。
 */
export async function finishSection(ctx: Ctx, section_id: string, mark_rest_known: boolean): Promise<{ marked: number; undo?: import('../../types.js').Undo }> {
  const sec = await getSection(ctx.db, section_id); if (!sec) throw new TibiError('not_found', '找不到这一章');
  const t = now();
  await ctx.db.transaction(async tx => {
    await tx.run('UPDATE sections SET progress = 1, finished_at = COALESCE(finished_at, ?), updated_at = ? WHERE id = ?', [t, t, section_id]);
    const secs = await listSections(tx, sec.document_id);
    const allDone = secs.every(s => s.id === section_id || s.finished_at != null);
    await tx.run('UPDATE documents SET progress = ?, last_section_id = ?, last_read_at = ?, finished_at = CASE WHEN ? THEN COALESCE(finished_at, ?) ELSE finished_at END, updated_at = ? WHERE id = ?', [allDone ? 1 : secs.reduce((a, s) => a + (s.id === section_id ? 1 : Number(s.progress)) * Number(s.word_count), 0) / (secs.reduce((a, s) => a + Number(s.word_count), 0) || 1), section_id, t, allDone ? 1 : 0, t, t, sec.document_id]);
    await tx.run('INSERT INTO learning_events(id, type, payload, created_at) VALUES (?,?,?,?)', [crypto.randomUUID(), 'section_finished', j.str({ document_id: sec.document_id, section_id, all_done: allDone }), t]);
  });
  let marked = 0; let undo: import('../../types.js').Undo | undefined;
  if (mark_rest_known) {
    const rows = await ctx.db.all<{ id: string }>("SELECT DISTINCT t.id FROM terms t JOIN term_contexts tc ON tc.term_id = t.id AND tc.deleted_at IS NULL JOIN sentences s ON s.id = tc.sentence_id WHERE s.section_id = ? AND t.status = 0 AND t.kind = 'word' AND t.deleted_at IS NULL", [section_id]);
    if (rows.length) {
      const r = await applyStatus(ctx, rows.map(x => x.id), 97, 'page_done', sec.document_id);
      marked = r.changed; undo = r.undo;
    }
  }
  ctx.events.emit('data.changed', { table: 'documents', ids: [sec.document_id] });
  return { marked, undo };
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
