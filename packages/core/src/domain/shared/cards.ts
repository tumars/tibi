import { now, type Database } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';

/**
 * 建卡（一词一卡，D3）。被 terms.lookup（R5：点词自动建卡）、terms.add、review 共用。
 * 新卡 = FSRS 的 New：due = now，其余 0。已有卡（含软删的）则恢复并返回原卡。
 * 每日新卡上限（R5）：超出的卡 due 顺延到之后几天——由调用方传 due。
 */
export async function ensureCard(db: Database, term_id: string, opts: { due?: number } = {}): Promise<{ card_id: string; created: boolean }> {
  const t = now();
  const existing = await db.get<{ id: string; deleted_at: number | null }>('SELECT id, deleted_at FROM cards WHERE term_id = ?', [term_id]);
  if (existing) {
    if (existing.deleted_at) await db.run('UPDATE cards SET deleted_at = NULL, updated_at = ? WHERE id = ?', [t, existing.id]);
    return { card_id: existing.id, created: false };
  }
  const id = uuidv7();
  await db.run('INSERT INTO cards(id, term_id, due, state, created_at, updated_at) VALUES (?,?,?,0,?,?)', [id, term_id, opts.due ?? t, t, t]);
  return { card_id: id, created: true };
}

/** 今天已建的新卡数（每日新卡上限用，本地时区按毫秒算当天 0 点） */
export async function newCardsToday(db: Database, dayStart: number): Promise<number> {
  const r = await db.get<{ n: number }>('SELECT count(*) AS n FROM cards WHERE created_at >= ? AND deleted_at IS NULL', [dayStart]);
  return Number(r?.n ?? 0);
}

export function startOfToday(t: number = now()): number { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
