import { now, type Database } from '../../db/driver.js';
import type { Dict } from '../../dict/types.js';
import type { Id, Ts } from '../../types.js';
import { startOfToday } from '../shared/cards.js';
import { glossSummary } from '../terms/views.js';
import { firstMeaning, forecast } from './queue.js';
import { newCardsReviewedToday, openSession, sessionSteps } from './repo.js';

/**
 * 复习页的面板（00 §3.3"复习页入口"）：进页面先看今天要做什么，不建会话。
 * 到期 / 新词的口径与 buildSteps 一致（dueCards / newCards 的条件），开始复习时排出来的就是这些。
 */
export interface ReviewOverview {
  /** 现在到期的复习卡（不含新卡），其中 late 张是今天之前就到期的 */
  due: number; late: number;
  /** 今天还能学的新词（每日上限减去今天已学，再和排队的新卡取小）；new_waiting 是排队的新卡总数 */
  fresh: number; new_waiting: number; daily_new: number;
  /** 做到一半的一轮（G6） */
  open?: { session_id: Id; total: number; left: number; started_at: Ts; updated_at: Ts };
  /** 今天已经做的：计分作答次数、其中答对、用时（分钟）、学了几个新词 */
  today: { reviews: number; correct: number; minutes: number; new_learned: number };
  /** 今天剩下的时间里还会到期的（"提前复习"能做的） */
  later_today: number;
  /** 未来 7 天每天到期的卡数，第 0 天含逾期 */
  forecast: number[];
  leeches: number;
  /** 这周忘过的词，最近的在前 */
  mistakes: { term_id: Id; display: string; meaning: string; lapses: number }[];
}

const DAY = 86_400_000;
const LIVE = 'c.deleted_at IS NULL AND c.suspended = 0 AND t.deleted_at IS NULL AND t.in_wordbook = 1 AND t.status <= 5 AND (t.paused_until IS NULL OR t.paused_until <= ?)';

export async function reviewOverview(db: Database, dict: Dict, t: number = now()): Promise<ReviewOverview> {
  const dayStart = startOfToday(t);
  const n = async (sql: string, params: (string | number)[]) => Number((await db.get<{ n: number }>(sql, params))?.n ?? 0);
  const FROM = 'FROM cards c JOIN terms t ON t.id = c.term_id';
  const due = await n(`SELECT count(*) AS n ${FROM} WHERE ${LIVE} AND c.state != 0 AND c.due <= ?`, [t, t]);
  const late = await n(`SELECT count(*) AS n ${FROM} WHERE ${LIVE} AND c.state != 0 AND c.due < ?`, [t, dayStart]);
  const later_today = await n(`SELECT count(*) AS n ${FROM} WHERE ${LIVE} AND c.state != 0 AND c.due > ? AND c.due < ?`, [t, t, dayStart + DAY]);
  const new_waiting = await n(`SELECT count(*) AS n ${FROM} WHERE ${LIVE} AND c.state = 0 AND c.due <= ?`, [t, t]);
  const profile = await db.get<{ daily_new_cards: number }>("SELECT daily_new_cards FROM user_profile WHERE id = '1'");
  const daily_new = Number(profile?.daily_new_cards ?? 20);
  const new_learned = await newCardsReviewedToday(db, dayStart);
  const fresh = Math.min(new_waiting, Math.max(0, daily_new - new_learned));

  const s = await openSession(db);
  const steps = s ? sessionSteps(s) : [];
  const open = s && s.cursor < steps.length ? { session_id: s.id, total: steps.length, left: steps.length - s.cursor, started_at: s.started_at, updated_at: s.updated_at } : undefined;

  const td = await db.get<{ n: number; ok: number; ms: number }>('SELECT count(*) AS n, COALESCE(sum(correct), 0) AS ok, COALESCE(sum(duration_ms), 0) AS ms FROM review_logs_valid WHERE reviewed_at >= ?', [dayStart]);
  const leeches = await n(`SELECT count(*) AS n ${FROM} WHERE ${LIVE} AND c.lapses >= 3`, [t]);
  const mistakes = await db.all<{ term_id: string; display: string; meaning: string | null; short_gloss: string | null; lapses: number }>(
    `SELECT t.id AS term_id, t.text_display AS display, t.meaning, t.short_gloss, c.lapses, max(l.reviewed_at) AS last
     FROM review_logs_valid l JOIN cards c ON c.id = l.card_id JOIN terms t ON t.id = c.term_id
     WHERE l.rating = 1 AND l.reviewed_at >= ? AND t.deleted_at IS NULL AND t.status <= 5
     GROUP BY t.id ORDER BY last DESC LIMIT 8`, [t - 7 * DAY]);

  return {
    due, late, fresh, new_waiting, daily_new, ...(open ? { open } : {}),
    today: { reviews: Number(td?.n ?? 0), correct: Number(td?.ok ?? 0), minutes: Math.round(Number(td?.ms ?? 0) / 60000), new_learned },
    later_today, forecast: await forecast(db, 7, t), leeches,
    mistakes: await Promise.all(mistakes.map(async m => ({ term_id: m.term_id, display: m.display, meaning: firstMeaning(m.meaning) || glossSummary((await dict.lookup(m.display.toLowerCase()))?.translation) || m.short_gloss || '', lapses: Number(m.lapses) }))),
  };
}
