import { j, now, type Database, type Row } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import type { Status } from '../../types.js';

/** terms / term_forms / term_status_log / term_contexts 的仓储（01 §3） */

export interface TermRow extends Row {
  id: string; kind: 'word' | 'phrase'; text: string; text_display: string; status: number; status_source: string; category: string | null;
  meaning: string | null; short_gloss: string | null; note: string | null; in_wordbook: number; paused_until: number | null; encounter_count: number;
  first_seen_at: number | null; last_seen_at: number | null; status_changed_at: number | null; created_at: number; updated_at: number; deleted_at: number | null;
}

export const TERM_COLS = 'id, kind, text, text_display, status, status_source, category, meaning, short_gloss, note, in_wordbook, paused_until, encounter_count, first_seen_at, last_seen_at, status_changed_at, created_at, updated_at, deleted_at';

export async function getTerm(db: Database, id: string): Promise<TermRow | undefined> {
  return db.get<TermRow>(`SELECT ${TERM_COLS} FROM terms WHERE id = ?`, [id]);
}
export async function getTermByText(db: Database, text: string, kind: 'word' | 'phrase' = 'word'): Promise<TermRow | undefined> {
  return db.get<TermRow>(`SELECT ${TERM_COLS} FROM terms WHERE kind = ? AND text = ?`, [kind, text.toLowerCase()]);
}
/** 批量：lemma → 行（只查 word） */
export async function getTermsByTexts(db: Database, texts: string[]): Promise<Map<string, TermRow>> {
  const out = new Map<string, TermRow>();
  const uniq = [...new Set(texts)];
  for (let i = 0; i < uniq.length; i += 400) {
    const chunk = uniq.slice(i, i + 400);
    const rows = await db.all<TermRow>(`SELECT ${TERM_COLS} FROM terms WHERE kind = 'word' AND text IN (${chunk.map(() => '?').join(',')})`, chunk);
    for (const r of rows) out.set(r.text, r);
  }
  return out;
}

export interface NewTerm { kind?: 'word' | 'phrase'; text: string; display?: string; status: Status; status_source: string; category?: string; meaning?: string; short_gloss?: string; in_wordbook?: boolean; seen_at?: number }

export async function insertTerm(db: Database, t: NewTerm): Promise<TermRow> {
  const id = uuidv7(); const ts = now();
  await db.run(
    'INSERT INTO terms(id, kind, text, text_display, status, status_source, category, meaning, short_gloss, in_wordbook, encounter_count, first_seen_at, last_seen_at, status_changed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?)',
    [id, t.kind ?? 'word', t.text.toLowerCase(), t.display ?? t.text, t.status, t.status_source, t.category ?? null, t.meaning ?? null, t.short_gloss ?? null, t.in_wordbook ? 1 : 0, t.seen_at ?? null, t.seen_at ?? null, ts, ts, ts],
  );
  return (await getTerm(db, id))!;
}

export async function logStatus(db: Database, term_id: string, status: number, source: string, extra: { prelabel?: string | null; document_id?: string | null } = {}) {
  await db.run('INSERT INTO term_status_log(id, term_id, status, source, prelabel, document_id, created_at) VALUES (?,?,?,?,?,?,?)', [uuidv7(), term_id, status, source, extra.prelabel ?? null, extra.document_id ?? null, now()]);
}

/** 改状态：写 terms 与时间线。返回旧状态 */
export async function setTermStatus(db: Database, term: TermRow, status: Status, source: string, extra: { document_id?: string | null; in_wordbook?: boolean } = {}): Promise<Status> {
  const prev = term.status as Status;
  const ts = now();
  // 预标注标记（H1）：这个词还没被用户碰过时，记它此前是哪一类
  const touched = await db.get<{ n: number }>("SELECT count(*) AS n FROM term_status_log WHERE term_id = ? AND source NOT IN ('auto_rule', 'auto_vocab_test')", [term.id]);
  const prelabel = Number(touched?.n ?? 0) === 0 && (term.status_source === 'auto_rule' || term.status_source === 'auto_vocab_test') ? (prev === 99 ? 'unsure' : prev === 0 ? 'new' : 'known') : null;
  await db.run('UPDATE terms SET status = ?, status_source = ?, status_changed_at = ?, updated_at = ?, in_wordbook = COALESCE(?, in_wordbook) WHERE id = ?', [status, source, ts, ts, extra.in_wordbook === undefined ? null : extra.in_wordbook ? 1 : 0, term.id]);
  await logStatus(db, term.id, status, source, { prelabel, document_id: extra.document_id ?? null });
  return prev;
}

export async function upsertForm(db: Database, term_id: string, form: string, seen_at: number, n = 1) {
  await db.run(
    'INSERT INTO term_forms(term_id, form, encounter_count, first_seen_at, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(term_id, form) DO UPDATE SET encounter_count = encounter_count + excluded.encounter_count, updated_at = excluded.updated_at',
    [term_id, form.toLowerCase(), n, seen_at, seen_at],
  );
}

export async function bumpEncounter(db: Database, term_id: string, n: number, seen_at: number) {
  await db.run('UPDATE terms SET encounter_count = encounter_count + ?, last_seen_at = ?, first_seen_at = COALESCE(first_seen_at, ?), updated_at = ? WHERE id = ?', [n, seen_at, seen_at, seen_at, term_id]);
}

export interface NewContext { term_id: string; source?: 'article' | 'dictionary' | 'manual'; document_id?: string | null; sentence_id?: string | null; text?: string | null; surface?: string | null; meaning_in_context?: string | null; is_primary?: boolean }

export async function insertContext(db: Database, c: NewContext): Promise<string> {
  const id = uuidv7(); const ts = now();
  await db.run(
    'INSERT INTO term_contexts(id, term_id, source, document_id, sentence_id, text, surface, meaning_in_context, is_primary, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [id, c.term_id, c.source ?? 'article', c.document_id ?? null, c.sentence_id ?? null, c.text ?? null, c.surface ?? null, c.meaning_in_context ?? null, c.is_primary ? 1 : 0, ts, ts],
  );
  return id;
}

export async function hasPrimaryContext(db: Database, term_id: string): Promise<boolean> {
  const r = await db.get<{ n: number }>('SELECT count(*) AS n FROM term_contexts WHERE term_id = ? AND is_primary = 1 AND deleted_at IS NULL', [term_id]);
  return Number(r?.n ?? 0) > 0;
}

export async function contextExists(db: Database, term_id: string, sentence_id: string): Promise<boolean> {
  const r = await db.get<{ n: number }>('SELECT count(*) AS n FROM term_contexts WHERE term_id = ? AND sentence_id = ? AND deleted_at IS NULL', [term_id, sentence_id]);
  return Number(r?.n ?? 0) > 0;
}

/** 用户画像里标注要用的几项 */
export async function readProfile(db: Database): Promise<{ vocab_estimate: number; daily_new_cards: number; vocab_source: string; interests: string[] }> {
  const r = await db.get<{ vocab_estimate: number; daily_new_cards: number; vocab_source: string; interests: string }>("SELECT vocab_estimate, daily_new_cards, vocab_source, interests FROM user_profile WHERE id = '1'");
  return { vocab_estimate: Number(r?.vocab_estimate ?? 3500), daily_new_cards: Number(r?.daily_new_cards ?? 20), vocab_source: r?.vocab_source ?? 'self', interests: j.parse<string[]>(r?.interests, []) };
}

/** 本地日期 YYYY-MM-DD（daily_stats 的键） */
export function localDate(t: number = now()): string {
  const d = new Date(t); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
