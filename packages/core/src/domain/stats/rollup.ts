import { now, type Database } from '../../db/driver.js';
import { startOfToday } from '../shared/cards.js';

/**
 * daily_stats 汇总（01 §6）。按本地日期 YYYY-MM-DD；复习结束、导入后、统计页读取时调用（幂等）。
 * 已知词口径（R8）：
 * - 实测（known_confirmed）：status ∈ {3,4,5,97} 且来源不是 auto_rule（用户亲手标、测试点亮、复习升上来的、Tibi 写的）；
 * - 估算（known_estimated）：status = 99（推断已知待确认）或 status ∈ {3,4,5,97} 但来源是 auto_rule。
 */
export function dateKey(t: number = now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function knownCounts(db: Database): Promise<{ total: number; confirmed: number; estimated: number }> {
  const c = await db.get<{ n: number }>("SELECT count(*) AS n FROM terms WHERE deleted_at IS NULL AND status IN (3,4,5,97) AND status_source != 'auto_rule'");
  const e = await db.get<{ n: number }>("SELECT count(*) AS n FROM terms WHERE deleted_at IS NULL AND (status = 99 OR (status IN (3,4,5,97) AND status_source = 'auto_rule'))");
  const confirmed = Number(c?.n ?? 0), estimated = Number(e?.n ?? 0);
  return { total: confirmed + estimated, confirmed, estimated };
}

export async function rollupToday(db: Database, at: number = now()): Promise<void> {
  const day = startOfToday(at), end = day + 86_400_000;
  const read = await db.get<{ words: number; ms: number }>('SELECT COALESCE(sum(words_read), 0) AS words, COALESCE(sum(COALESCE(ended_at, ?) - started_at), 0) AS ms FROM reading_sessions WHERE started_at >= ? AND started_at < ?', [at, day, end]);
  const terms = await db.get<{ n: number }>('SELECT count(*) AS n FROM terms WHERE created_at >= ? AND created_at < ?', [day, end]);
  const reviews = await db.get<{ n: number; ok: number }>('SELECT count(*) AS n, COALESCE(sum(CASE WHEN rating > 1 THEN 1 ELSE 0 END), 0) AS ok FROM review_logs WHERE reviewed_at >= ? AND reviewed_at < ?', [day, end]);
  const known = await knownCounts(db);
  await db.run(`INSERT INTO daily_stats(date, words_read, reading_ms, new_terms, known_terms_total, known_confirmed, known_estimated, reviews, review_correct)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET words_read = excluded.words_read, reading_ms = excluded.reading_ms, new_terms = excluded.new_terms,
      known_terms_total = excluded.known_terms_total, known_confirmed = excluded.known_confirmed, known_estimated = excluded.known_estimated,
      reviews = excluded.reviews, review_correct = excluded.review_correct`,
    [dateKey(at), Number(read?.words ?? 0), Number(read?.ms ?? 0), Number(terms?.n ?? 0), known.total, known.confirmed, known.estimated, Number(reviews?.n ?? 0), Number(reviews?.ok ?? 0)]);
}
