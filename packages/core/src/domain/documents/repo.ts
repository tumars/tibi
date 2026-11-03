import { j, now, type Database, type Row } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import type { AiStatus, Document, DocumentSummary, Genre, Kind, Token } from '../../types.js';

/** documents / sections / sentences / tags 的仓储（01 §2） */

export interface DocumentRow extends Row {
  id: string; title: string; author: string | null; kind: Kind; genre: Genre; source_type: string; source_uri: string | null; lang: string; content_hash: string;
  original_path: string | null; cover_path: string | null; published_at: number | null; word_count: number; section_count: number; status: string; process_error: string | null;
  ai_status: string; difficulty_cefr: string | null; rare_ratio: number | null; progress: number; last_section_id: string | null; is_favorite: number; is_archived: number;
  created_at: number; updated_at: number; last_read_at: number | null; finished_at: number | null; deleted_at: number | null;
}
export interface SectionRow extends Row { id: string; document_id: string; idx: number; title: string; content_md: string; word_count: number; status: string; ai_status: string; tokenizer_version: string | null; progress: number; last_sentence_id: string | null; finished_at: number | null }
export interface SentenceRow extends Row { id: string; section_id: string; paragraph_idx: number; block_type: string; idx: number; text: string; tokens: string; translation: string | null }

export const DOC_COLS = 'id, title, author, kind, genre, source_type, source_uri, lang, content_hash, original_path, cover_path, published_at, word_count, section_count, status, process_error, ai_status, difficulty_cefr, rare_ratio, progress, last_section_id, is_favorite, is_archived, created_at, updated_at, last_read_at, finished_at, deleted_at';
export const SEC_COLS = 'id, document_id, idx, title, content_md, word_count, status, ai_status, tokenizer_version, progress, last_sentence_id, finished_at';
export const TOKENIZER_VERSION = 'tibi-1';
export const WPM = 200;

export const getDocument = (db: Database, id: string) => db.get<DocumentRow>(`SELECT ${DOC_COLS} FROM documents WHERE id = ?`, [id]);
export const getDocumentByHash = (db: Database, hash: string) => db.get<DocumentRow>(`SELECT ${DOC_COLS} FROM documents WHERE content_hash = ? AND deleted_at IS NULL`, [hash]);
export const getSection = (db: Database, id: string) => db.get<SectionRow>(`SELECT ${SEC_COLS} FROM sections WHERE id = ?`, [id]);
export const listSections = (db: Database, document_id: string) => db.all<SectionRow>(`SELECT ${SEC_COLS} FROM sections WHERE document_id = ? AND deleted_at IS NULL ORDER BY idx`, [document_id]);
export const listSentences = (db: Database, section_id: string) => db.all<SentenceRow>('SELECT id, section_id, paragraph_idx, block_type, idx, text, tokens, translation FROM sentences WHERE section_id = ? AND deleted_at IS NULL ORDER BY idx', [section_id]);

export interface NewDocument { title: string; author?: string; kind: Kind; genre: Genre; source_type: string; source_uri?: string; lang: string; content_hash: string; word_count: number; section_count: number; published_at?: number; cover_path?: string; original_path?: string }

export async function insertDocument(db: Database, d: NewDocument): Promise<string> {
  const id = uuidv7(); const t = now();
  await db.run(
    'INSERT INTO documents(id, title, author, kind, genre, source_type, source_uri, lang, content_hash, original_path, cover_path, published_at, word_count, section_count, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, d.title, d.author ?? null, d.kind, d.genre, d.source_type, d.source_uri ?? null, d.lang, d.content_hash, d.original_path ?? null, d.cover_path ?? null, d.published_at ?? null, d.word_count, d.section_count, 'processing', t, t],
  );
  return id;
}

export async function insertSection(db: Database, s: { document_id: string; idx: number; title: string; content_md: string; word_count: number }): Promise<string> {
  const id = uuidv7(); const t = now();
  await db.run('INSERT INTO sections(id, document_id, idx, title, content_md, word_count, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, s.document_id, s.idx, s.title, s.content_md, s.word_count, 'pending', t, t]);
  return id;
}

export async function insertSentence(db: Database, s: { section_id: string; paragraph_idx: number; block_type: string; idx: number; text: string; tokens?: Token[] }): Promise<string> {
  const id = uuidv7(); const t = now();
  await db.run('INSERT INTO sentences(id, section_id, paragraph_idx, block_type, idx, text, tokens, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, s.section_id, s.paragraph_idx, s.block_type, s.idx, s.text, j.str(s.tokens ?? []), t, t]);
  return id;
}

export async function documentTags(db: Database, document_id: string): Promise<string[]> {
  return (await db.all<{ name: string }>('SELECT tg.name FROM document_tags dt JOIN tags tg ON tg.id = dt.tag_id WHERE dt.document_id = ? AND dt.deleted_at IS NULL AND tg.deleted_at IS NULL ORDER BY tg.name', [document_id])).map(r => r.name);
}

/** 加标签（没有的标签新建；大小写不敏感去重） */
export async function setDocumentTags(db: Database, document_id: string, names: string[], opts: { source?: 'user' | 'tibi'; replace?: boolean } = {}): Promise<string[]> {
  const t = now();
  const clean = [...new Set(names.map(n => n.trim()).filter(Boolean))];
  if (opts.replace) await db.run('UPDATE document_tags SET deleted_at = ?, updated_at = ? WHERE document_id = ? AND deleted_at IS NULL', [t, t, document_id]);
  for (const name of clean) {
    let tag = await db.get<{ id: string; deleted_at: number | null }>('SELECT id, deleted_at FROM tags WHERE name = ? COLLATE NOCASE', [name]);
    if (tag?.deleted_at) { await db.run('UPDATE tags SET deleted_at = NULL, updated_at = ? WHERE id = ?', [t, tag.id]); }
    if (!tag) { const id = uuidv7(); await db.run('INSERT INTO tags(id, name, created_at, updated_at) VALUES (?,?,?,?)', [id, name, t, t]); tag = { id, deleted_at: null }; }
    await db.run('INSERT INTO document_tags(document_id, tag_id, source, created_at, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(document_id, tag_id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at', [document_id, tag.id, opts.source ?? 'user', t, t]);
  }
  return documentTags(db, document_id);
}

/** 书架卡片上的"开头一句"：第一个 prose 句子（01 待定事项：不另存字段） */
export async function excerptOf(db: Database, document_id: string): Promise<string> {
  const r = await db.get<{ text: string }>("SELECT s.text FROM sentences s JOIN sections sec ON sec.id = s.section_id WHERE sec.document_id = ? AND s.block_type = 'prose' AND s.deleted_at IS NULL ORDER BY sec.idx, s.idx LIMIT 1", [document_id]);
  return r?.text ?? '';
}

export async function toSummary(db: Database, d: DocumentRow): Promise<DocumentSummary> {
  const tags = await documentTags(db, d.id);
  const out: DocumentSummary = {
    id: d.id, kind: d.kind, genre: d.genre, title: d.title, author: d.author ?? undefined, source: sourceOf(d), source_type: d.source_type, source_url: d.source_type === 'url' && d.source_uri ? d.source_uri : undefined, tags,
    minutes: Math.max(1, Math.round(Number(d.word_count) / WPM)), level: d.difficulty_cefr ?? undefined, progress: Number(d.progress),
    status: d.status as DocumentSummary['status'], ai_status: d.ai_status as AiStatus,
    excerpt: await excerptOf(db, d.id), cover_path: d.cover_path ?? undefined, added_at: Number(d.created_at), opened_at: d.last_read_at != null ? Number(d.last_read_at) : undefined, finished_at: d.finished_at != null ? Number(d.finished_at) : undefined,
  };
  if (d.kind === 'book') {
    const secs = await listSections(db, d.id);
    const cur = secs.find(s => s.id === d.last_section_id) ?? secs[0];
    out.book = { chapter: (cur?.idx ?? 0) + 1, chapters: secs.length, chapter_progress: Number(cur?.progress ?? 0) };
  }
  return out;
}

export async function toDocument(db: Database, d: DocumentRow): Promise<Document> {
  const base = await toSummary(db, d);
  const sections = (await listSections(db, d.id)).map(s => ({ id: s.id, idx: s.idx, title: s.title, status: s.status, progress: Number(s.progress), word_count: Number(s.word_count) }));
  const ai: Document['ai'] = {};
  for (const task of ['summary', 'advice', 'phrases', 'hard_sentences', 'glossary', 'characters'] as const) {
    const r = await db.get<{ output: string; model: string; prompt_version: string; created_at: number }>("SELECT output, model, prompt_version, created_at FROM ai_results WHERE scope = 'document' AND target_id = ? AND task = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [d.id, task]);
    if (r) ai[task] = { task, output: j.parse(r.output, null), model: r.model, prompt_version: r.prompt_version, created_at: Number(r.created_at) };
  }
  return { ...base, sections, ai: Object.keys(ai).length ? ai : undefined };
}

export function safeHost(uri: string): string { try { return new URL(uri).hostname.replace(/^www\./, ''); } catch { return uri; } }
/** 书架和阅读页显示的来源：网址显示域名，文件、图片显示原文件名，其余显示来源类型 */
export function sourceOf(d: Pick<DocumentRow, 'source_type' | 'source_uri'>): string {
  if (!d.source_uri) return sourceLabel(d.source_type);
  if (d.source_type === 'url') return safeHost(d.source_uri);
  if (d.source_type === 'file' || d.source_type === 'image') return d.source_uri;
  return sourceLabel(d.source_type);
}
export function sourceLabel(t: string): string { return { text: '粘贴的文字', file: '文件', image: '图片', sample: '内置示例', tibi_generated: 'Tibi 写的' }[t] ?? t; }
