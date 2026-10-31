import { j, now, type Database, type Row } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import type { QueueItem, Rating, Status, Term } from '../../types.js';
import { CARD_COLUMNS, type CardRow } from './fsrs.js';

/** 复习相关的数据库读写（cards / review_sessions / review_logs / terms 的相关列） */

export interface TermRow extends Row { id: string; kind: string; text: string; text_display: string; status: number; status_source: string; meaning: string | null; short_gloss: string | null; note: string | null; in_wordbook: number; paused_until: number | null; encounter_count: number; last_seen_at: number | null; created_at: number }

export async function getCard(db: Database, card_id: string): Promise<CardRow | undefined> {
  return db.get<CardRow>(`SELECT ${CARD_COLUMNS} FROM cards WHERE id = ?`, [card_id]);
}
export async function getCardByTerm(db: Database, term_id: string): Promise<CardRow | undefined> {
  return db.get<CardRow>(`SELECT ${CARD_COLUMNS} FROM cards WHERE term_id = ?`, [term_id]);
}
export async function getTerm(db: Database, term_id: string): Promise<TermRow | undefined> {
  return db.get<TermRow>('SELECT * FROM terms WHERE id = ?', [term_id]);
}

export async function updateCard(db: Database, card_id: string, patch: Partial<CardRow>): Promise<void> {
  const keys = Object.keys(patch).filter(k => k !== 'id');
  if (!keys.length) return;
  await db.run(`UPDATE cards SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map(k => patch[k] as never), now(), card_id]);
}

export async function termForms(db: Database, term: TermRow): Promise<string[]> {
  const rows = await db.all<{ form: string }>('SELECT form FROM term_forms WHERE term_id = ?', [term.id]);
  const set = new Set<string>([term.text, term.text_display, ...rows.map(r => r.form)].map(s => s.toLowerCase()).filter(Boolean));
  return [...set];
}

/** 把 terms 行变成接口里的 Term（标签、词典字段这里不补，留给生词本模块） */
export function toTerm(t: TermRow, card?: CardRow): Term {
  return {
    id: t.id, kind: t.kind as 'word' | 'phrase', text: t.text, display: t.text_display, meaning: t.meaning ?? '', short_gloss: t.short_gloss ?? undefined,
    status: t.status as Status, forms: [], exam: [], tags: [], encounter_count: t.encounter_count, doc_count: 0,
    due: card?.due, lapses: card?.lapses ?? 0, added_at: t.created_at, last_seen_at: t.last_seen_at ?? undefined,
  };
}

/** 一条语境：优先 is_primary 的文章语境，其次任何文章语境，再词典 / 手动 */
export interface ContextRow extends Row { id: string; source: string; document_id: string | null; sentence_id: string | null; text: string | null; surface: string | null; meaning_in_context: string | null; is_primary: number; sentence_text: string | null; translation: string | null; document_title: string | null }

export async function termContexts(db: Database, term_id: string): Promise<ContextRow[]> {
  return db.all<ContextRow>(`SELECT tc.id, tc.source, tc.document_id, tc.sentence_id, tc.text, tc.surface, tc.meaning_in_context, tc.is_primary,
      s.text AS sentence_text, s.translation, d.title AS document_title
    FROM term_contexts tc LEFT JOIN sentences s ON s.id = tc.sentence_id LEFT JOIN documents d ON d.id = tc.document_id
    WHERE tc.term_id = ? AND tc.deleted_at IS NULL
    ORDER BY tc.is_primary DESC, CASE tc.source WHEN 'article' THEN 0 WHEN 'dictionary' THEN 1 ELSE 2 END, tc.created_at`, [term_id]);
}

export interface SessionRow extends Row { id: string; kind: string; graded: number; steps_json: string; cursor: number; status: string; started_at: number; updated_at: number; finished_at: number | null }

export async function openSession(db: Database): Promise<SessionRow | undefined> {
  return db.get<SessionRow>("SELECT * FROM review_sessions WHERE kind = 'review' AND status IN ('active', 'paused') ORDER BY started_at DESC LIMIT 1");
}
export async function getSession(db: Database, id: string): Promise<SessionRow | undefined> {
  return db.get<SessionRow>('SELECT * FROM review_sessions WHERE id = ?', [id]);
}
export function sessionSteps(s: SessionRow): QueueItem[] { return j.parse<QueueItem[]>(s.steps_json, []); }

export async function saveSession(db: Database, id: string, steps: QueueItem[], cursor: number, status?: string): Promise<void> {
  const t = now();
  await db.run(`UPDATE review_sessions SET steps_json = ?, cursor = ?, updated_at = ?${status ? ', status = ?' : ''}${status === 'finished' ? ', finished_at = ?' : ''} WHERE id = ?`,
    [j.str(steps), cursor, t, ...(status ? [status] : []), ...(status === 'finished' ? [t] : []), id]);
}

export async function insertSession(db: Database, kind: 'review' | 'drill', graded: boolean, steps: QueueItem[]): Promise<SessionRow> {
  const id = uuidv7(); const t = now();
  await db.run('INSERT INTO review_sessions(id, kind, graded, steps_json, cursor, status, started_at, updated_at) VALUES (?,?,?,?,0,?,?,?)', [id, kind, graded ? 1 : 0, j.str(steps), 'active', t, t]);
  return (await getSession(db, id))!;
}

export interface LogInput { card_id: string; rating: Rating; card_type: string; auto_graded: boolean; suggested_rating?: Rating; hints: number; correct?: boolean; session_id?: string; context_id?: string; context_snapshot?: string; fsrs: { state: number; due: number; stability: number; stability_fast: number; difficulty: number; elapsed_days: number; last_elapsed_days: number; scheduled_days: number; learning_steps: number }; duration_ms: number; reviewed_at: number }

export async function insertLog(db: Database, l: LogInput): Promise<string> {
  const id = uuidv7();
  await db.run(`INSERT INTO review_logs(id, card_id, rating, card_type, auto_graded, suggested_rating, hints, correct, session_id, context_id, context_snapshot,
      state, due, stability, stability_fast, difficulty, elapsed_days, last_elapsed_days, scheduled_days, learning_steps, duration_ms, reviewed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, l.card_id, l.rating, l.card_type, l.auto_graded ? 1 : 0, l.suggested_rating ?? null, l.hints, l.correct == null ? null : (l.correct ? 1 : 0), l.session_id ?? null, l.context_id ?? null, l.context_snapshot ?? null,
      l.fsrs.state, l.fsrs.due, l.fsrs.stability, l.fsrs.stability_fast, l.fsrs.difficulty, l.fsrs.elapsed_days, l.fsrs.last_elapsed_days, l.fsrs.scheduled_days, l.fsrs.learning_steps, l.duration_ms, l.reviewed_at]);
  return id;
}

export async function setTermStatus(db: Database, term: TermRow, status: Status, source: string): Promise<void> {
  const t = now();
  await db.run('UPDATE terms SET status = ?, status_source = ?, status_changed_at = ?, updated_at = ? WHERE id = ?', [status, source, t, t, term.id]);
  await db.run('INSERT INTO term_status_log(id, term_id, status, source, prelabel, document_id, created_at) VALUES (?,?,?,?,NULL,NULL,?)', [uuidv7(), term.id, status, source, t]);
}

export async function addLearningEvent(db: Database, type: string, payload: unknown): Promise<void> {
  await db.run('INSERT INTO learning_events(id, type, payload, consolidated, created_at) VALUES (?,?,?,0,?)', [uuidv7(), type, j.str(payload), now()]);
}

/** 今天已经出过的新卡数（review_logs 里作答前 state = 0 的条数） */
export async function newCardsReviewedToday(db: Database, dayStart: number): Promise<number> {
  const r = await db.get<{ n: number }>('SELECT count(DISTINCT card_id) AS n FROM review_logs WHERE state = 0 AND reviewed_at >= ?', [dayStart]);
  return Number(r?.n ?? 0);
}

export async function getSetting<T>(db: Database, key: string, fallback: T): Promise<T> {
  const r = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return r ? j.parse<T>(r.value, fallback) : fallback;
}
