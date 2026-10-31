import { DefaultScheduler, Rating as FsrsRating } from 'ts-fsrs';
import type { Database, Row } from '../../db/driver.js';
import type { CardState, CardType, IntervalPreview, Rating } from '../../types.js';

/**
 * FSRS 适配（00 §3.3 排期、01 §4）：卡片行 ↔ ts-fsrs 6（FSRS-7）卡片对象。
 * 调度器按 desired_retention + weights 缓存；参数来自 user_profile。
 */
export interface CardRow extends Row {
  id: string; term_id: string; due: number; stability: number; stability_fast: number; difficulty: number;
  elapsed_days: number; scheduled_days: number; learning_steps: number; reps: number; lapses: number;
  forced_type: string | null; state: number; last_review: number | null; suspended: number; created_at: number; updated_at: number; deleted_at: number | null;
}

type Scheduler = Awaited<ReturnType<typeof DefaultScheduler>>;
type FsrsCard = ReturnType<Scheduler['newCard']>;

const cache = new Map<string, Promise<Scheduler>>();

export interface FsrsParams { desired_retention: number; weights?: number[] }

export async function loadParams(db: Database): Promise<FsrsParams> {
  const row = await db.get<{ desired_retention: number; fsrs_params: string | null }>("SELECT desired_retention, fsrs_params FROM user_profile WHERE id = '1'");
  let weights: number[] | undefined;
  try {
    const p = row?.fsrs_params ? JSON.parse(row.fsrs_params) as { algorithm?: string; weights?: number[] } : undefined;
    if (p?.algorithm === 'FSRS-7' && Array.isArray(p.weights)) weights = p.weights;   // 权重不跨版本复用
  } catch { /* 忽略坏数据 */ }
  return { desired_retention: Number(row?.desired_retention ?? 0.9), weights };
}

export function getScheduler(params: FsrsParams): Promise<Scheduler> {
  const key = `${params.desired_retention}|${params.weights?.join(',') ?? ''}`;
  let p = cache.get(key);
  if (!p) {
    p = DefaultScheduler({ desiredRetention: params.desired_retention, ...(params.weights ? { weights: params.weights } : {}) });
    cache.set(key, p);
  }
  return p;
}

/** 卡片行 → ts-fsrs 卡片对象 */
export function toFsrsCard(row: CardRow): FsrsCard {
  const state = row.state as 0 | 1 | 2 | 3;
  const status = (['new', 'learning', 'review', 'relearning'] as const)[state] ?? 'new';
  return {
    cardId: row.id, stability: row.stability, stabilityFast: row.stability_fast, difficulty: row.difficulty,
    state, scheduleStatus: status, dueAt: new Date(row.due), lastReviewAt: row.last_review ? new Date(row.last_review) : null,
    reps: row.reps, lapses: row.lapses, scheduledDays: row.scheduled_days, learningStep: row.learning_steps,
  } as FsrsCard;
}

/** 调度后要写回卡片行的字段 */
export interface CardPatch { due: number; stability: number; stability_fast: number; difficulty: number; elapsed_days: number; scheduled_days: number; learning_steps: number; reps: number; lapses: number; state: number; last_review: number }

export function fromFsrsCard(c: FsrsCard, now: number, prevLastReview: number | null): CardPatch {
  const last = c.lastReviewAt ? new Date(c.lastReviewAt).getTime() : now;
  const elapsed = prevLastReview ? (now - prevLastReview) / 86_400_000 : 0;
  return {
    due: new Date(c.dueAt).getTime(), stability: c.stability, stability_fast: c.stabilityFast, difficulty: c.difficulty,
    elapsed_days: elapsed, scheduled_days: c.scheduledDays, learning_steps: c.learningStep, reps: c.reps, lapses: c.lapses, state: c.state, last_review: last,
  };
}

/** 作答后排期：返回新行字段 + review_logs 要记的"作答前"快照字段 */
export async function schedule(params: FsrsParams, row: CardRow, rating: Rating, now: number): Promise<{ patch: CardPatch; log: { state: number; due: number; stability: number; stability_fast: number; difficulty: number; elapsed_days: number; last_elapsed_days: number; scheduled_days: number; learning_steps: number } }> {
  const s = await getScheduler(params);
  const r = s.review({ card: toFsrsCard(row), grade: rating as unknown as typeof FsrsRating.Good, now: new Date(now) });
  const patch = fromFsrsCard(r.card as FsrsCard, now, row.last_review);
  return {
    patch,
    log: { state: row.state, due: row.due, stability: row.stability, stability_fast: row.stability_fast, difficulty: row.difficulty, elapsed_days: patch.elapsed_days, last_elapsed_days: row.elapsed_days, scheduled_days: row.scheduled_days, learning_steps: row.learning_steps },
  };
}

/** 四档评分各自的下次间隔（天，小数） */
export async function previewDays(params: FsrsParams, row: CardRow, now: number): Promise<Record<Rating, number>> {
  const s = await getScheduler(params);
  const out = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<Rating, number>;
  for (const item of s.preview({ card: toFsrsCard(row), now: new Date(now) })) {
    const c = item.card as FsrsCard;
    out[item.grade as Rating] = Math.max(0, (new Date(c.dueAt).getTime() - now) / 86_400_000);
  }
  return out;
}

export async function preview(params: FsrsParams, row: CardRow, now: number): Promise<IntervalPreview> {
  const d = await previewDays(params, row, now);
  return { 1: intervalLabel(d[1]), 2: intervalLabel(d[2]), 3: intervalLabel(d[3]), 4: intervalLabel(d[4]) };
}

/** 当前记得率 0–1；新卡为 0 */
export async function retention(params: FsrsParams, row: CardRow, now: number): Promise<number> {
  if (row.state === 0 || !row.last_review) return 0;
  const s = await getScheduler(params);
  const elapsed = Math.max(0, (now - row.last_review) / 86_400_000);
  const r = s.model.forgettingCurve(toFsrsCard(row) as never, elapsed);
  return typeof r === 'number' && Number.isFinite(r) ? r : 0;
}

/** 间隔文案：1 分钟后 / 10 分钟后 / 3 天后 / 2 周后 / 1.5 个月后 / 1 年后 */
export function intervalLabel(days: number): string {
  const minutes = days * 1440;
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `${Math.round(minutes)} 分钟后`;
  if (days < 1) return `${Math.round(minutes / 60)} 小时后`;
  if (days < 14) return `${Math.round(days)} 天后`;
  if (days < 60) return `${Math.round(days / 7)} 周后`;
  if (days < 365) { const m = days / 30; return `${m % 1 < 0.25 || m % 1 > 0.75 ? Math.round(m) : Math.round(m * 2) / 2} 个月后`; }
  const y = days / 365; return `${y < 1.75 ? 1 : Math.round(y * 2) / 2} 年后`;
}

export function toCardState(row: CardRow): CardState {
  return {
    card_id: row.id, term_id: row.term_id, state: row.state as 0 | 1 | 2 | 3, due: row.due, stability: row.stability, difficulty: row.difficulty,
    reps: row.reps, lapses: row.lapses, suspended: !!row.suspended, ...(row.forced_type ? { forced_type: row.forced_type as CardType } : {}),
  };
}

export const CARD_COLUMNS = 'id, term_id, due, stability, stability_fast, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, forced_type, state, last_review, suspended, created_at, updated_at, deleted_at';
