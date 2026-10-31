import { now, type Database } from '../../db/driver.js';
import type { Dict } from '../../dict/types.js';
import { startOfToday } from '../shared/cards.js';

/**
 * daily_stats 汇总（01 §6）。按本地日期 YYYY-MM-DD；复习结束、导入后、统计页读取时调用（幂等）。
 * 已知词口径（R8，00 §3.1）：
 * - 实测（known_confirmed）：status ∈ {3,4,5,97} 且来源不是 auto_rule（用户亲手标、测试点亮、复习升上来的）；
 * - 估算（known_estimated）：按预标注规则推断的已知词。词频排在词汇量估算 N 以内的常见词默认已知、不入库，
 *   所以估算 = N − 其中被用户标成 0–2 的 − 其中已经算进实测的 + 待确认（99）与来源为 auto_rule 的已知行。
 *   有词典时按词频精确判断"是否在 N 以内"；没有词典时把库里的行都当作在 N 以内（近似）。
 */
export function dateKey(t: number = now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function knownCounts(db: Database, dict?: Dict): Promise<{ total: number; confirmed: number; estimated: number }> {
  const prof = await db.get<{ v: number }>("SELECT vocab_estimate AS v FROM user_profile WHERE id = '1'");
  const N = Number(prof?.v ?? 0);
  const rows = await db.all<{ text: string; status: number; src: string }>("SELECT text, status, status_source AS src FROM terms WHERE deleted_at IS NULL AND kind = 'word' AND status IN (0,1,2,3,4,5,97,99)");
  const ranks = dict?.frequencyRanks ? await dict.frequencyRanks(rows.map(r => r.text)) : undefined;
  const within = (t: string) => { if (!ranks) return true; const r = ranks.get(t); return r !== undefined && r <= N; };
  let confirmed = 0, estimated = N;
  for (const r of rows) {
    const known = r.status >= 3 && r.status !== 99;
    if (known && r.src !== 'auto_rule') { confirmed++; if (within(r.text)) estimated--; }           // 从估算挪到实测
    else if (r.status <= 2) { if (within(r.text)) estimated--; }                                     // 常见词里被标成不认识的
    else if (!within(r.text)) estimated++;                                                           // 99 / auto_rule 的已知行在 N 以外
  }
  estimated = Math.max(0, estimated);
  return { total: confirmed + estimated, confirmed, estimated };
}

export async function rollupToday(db: Database, at: number = now(), dict?: Dict): Promise<void> {
  const day = startOfToday(at), end = day + 86_400_000;
  const read = await db.get<{ words: number; ms: number }>('SELECT COALESCE(sum(words_read), 0) AS words, COALESCE(sum(COALESCE(ended_at, ?) - started_at), 0) AS ms FROM reading_sessions WHERE started_at >= ? AND started_at < ?', [at, day, end]);
  const terms = await db.get<{ n: number }>('SELECT count(*) AS n FROM terms WHERE created_at >= ? AND created_at < ?', [day, end]);
  const reviews = await db.get<{ n: number; ok: number }>('SELECT count(*) AS n, COALESCE(sum(CASE WHEN rating > 1 THEN 1 ELSE 0 END), 0) AS ok FROM review_logs_valid WHERE reviewed_at >= ? AND reviewed_at < ?', [day, end]);
  const known = await knownCounts(db, dict);
  await db.run(`INSERT INTO daily_stats(date, words_read, reading_ms, new_terms, known_terms_total, known_confirmed, known_estimated, reviews, review_correct)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET words_read = excluded.words_read, reading_ms = excluded.reading_ms, new_terms = excluded.new_terms,
      known_terms_total = excluded.known_terms_total, known_confirmed = excluded.known_confirmed, known_estimated = excluded.known_estimated,
      reviews = excluded.reviews, review_correct = excluded.review_correct`,
    [dateKey(at), Number(read?.words ?? 0), Number(read?.ms ?? 0), Number(terms?.n ?? 0), known.total, known.confirmed, known.estimated, Number(reviews?.n ?? 0), Number(reviews?.ok ?? 0)]);
}
