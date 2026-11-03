import { now, type Database } from '../../db/driver.js';
import { startOfToday } from '../shared/cards.js';

/**
 * daily_stats 汇总（01 §6）。按本地日期 YYYY-MM-DD；复习结束、导入后、统计页读取时调用（幂等）。
 * 已掌握（mastered_total）：只数用户自己标的——复习升到掌握（5）和标为已知（97）的词。
 * Tibi 不估词汇量，所以没有"已知词"推算；旧数据里规则标的行（status_source = auto_rule）不算。
 */
export function dateKey(t: number = now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function masteredCount(db: Database): Promise<number> {
  const r = await db.get<{ n: number }>("SELECT count(*) AS n FROM terms WHERE deleted_at IS NULL AND status IN (5, 97) AND status_source <> 'auto_rule'");
  return Number(r?.n ?? 0);
}

export async function rollupToday(db: Database, at: number = now()): Promise<void> {
  const day = startOfToday(at), end = day + 86_400_000;
  const read = await db.get<{ words: number; ms: number }>('SELECT COALESCE(sum(words_read), 0) AS words, COALESCE(sum(COALESCE(ended_at, ?) - started_at), 0) AS ms FROM reading_sessions WHERE started_at >= ? AND started_at < ?', [at, day, end]);
  const terms = await db.get<{ n: number }>('SELECT count(*) AS n FROM terms WHERE created_at >= ? AND created_at < ?', [day, end]);
  const reviews = await db.get<{ n: number; ok: number }>('SELECT count(*) AS n, COALESCE(sum(CASE WHEN rating > 1 THEN 1 ELSE 0 END), 0) AS ok FROM review_logs_valid WHERE reviewed_at >= ? AND reviewed_at < ?', [day, end]);
  const mastered = await masteredCount(db);
  await db.run(`INSERT INTO daily_stats(date, words_read, reading_ms, new_terms, mastered_total, reviews, review_correct)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET words_read = excluded.words_read, reading_ms = excluded.reading_ms, new_terms = excluded.new_terms,
      mastered_total = excluded.mastered_total, reviews = excluded.reviews, review_correct = excluded.review_correct`,
    [dateKey(at), Number(read?.words ?? 0), Number(read?.ms ?? 0), Number(terms?.n ?? 0), mastered, Number(reviews?.n ?? 0), Number(reviews?.ok ?? 0)]);
}
