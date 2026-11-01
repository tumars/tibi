import { uuidv7 } from '../../ids.js';
import { now, type Database } from '../../db/driver.js';
import type { Dict } from '../../dict/types.js';
import type { Ctx } from '../../rpc/define.js';
import { TibiError, type Answer, type AnswerResult, type CardType, type QueueItem, type Rating, type ReviewSession, type Status, type Undo } from '../../types.js';
import { recordUndo, registerUndo } from '../shared/undo.js';
import { type CardRow, intervalLabel, loadParams, schedule, toCardState } from './fsrs.js';
import { gradeAnswer, judgeTyped, nextStatus, RATING_NAME, STATUS_NAME } from './grade.js';
import { makeStep, pickCardType, shuffle } from './queue.js';
import { addLearningEvent, getCard, getSession, getSetting, getTerm, insertLog, saveSession, sessionSteps, setTermStatus, updateCard, type SessionRow } from './repo.js';
import { rollupToday } from '../stats/rollup.js';

/**
 * 会话内的作答、评分、重练、撤销（G1、G3、G6）。
 * 步骤里的隐藏字段（不在接口类型里）：correct_option（选义正确项）、result._undo（作答前快照，撤销与改评分用）。
 */

export const RETRY_GAP = 3;
export const MAX_RETRY = 2;

type Step = QueueItem & { correct_option?: string; result?: QueueItem['result'] & { _undo?: UndoSnapshot; near_miss?: boolean; reason?: string; suggested_rating?: Rating; first?: boolean } };

interface UndoSnapshot { card: CardRow; log_id?: string; status_before: Status; status_after?: Status; retry_step?: number; hints: number; duration_ms: number; context_id?: string; context_snapshot?: string; audit_id?: string }

export function toReviewSession(s: SessionRow, steps: QueueItem[], resumed: boolean, forecast: number[]): ReviewSession {
  return { session_id: s.id, kind: s.kind as 'review' | 'drill', graded: !!s.graded, steps: steps.map(stripHidden), cursor: s.cursor, resumed, started_at: s.started_at, forecast };
}

/** 发给界面的步骤不带 _undo 快照 */
export function stripHidden(step: QueueItem): QueueItem {
  const s = step as Step;
  if (!s.result?._undo) return step;
  const { _undo, ...rest } = s.result;
  void _undo;
  return { ...s, result: rest as QueueItem['result'] };
}

async function loadSession(db: Database, session_id: string): Promise<{ s: SessionRow; steps: Step[] }> {
  const s = await getSession(db, session_id);
  if (!s) throw new TibiError('not_found', '找不到这轮复习');
  if (s.status === 'finished') throw new TibiError('conflict', '这轮复习已经结束');
  return { s, steps: sessionSteps(s) as Step[] };
}

/** 本会话里这张卡是否已经有过首次作答 */
function firstAttemptDone(steps: Step[], card_id: string, uptoStep: number): boolean {
  return steps.some((x, i) => i !== uptoStep && x.card_id === card_id && x.retry === 0 && !x.intro && !!x.result);
}

function judge(step: Step, answer: Answer): { correct: boolean; near_miss: boolean } {
  if (step.card_type === 'choice') {
    const ok = !!answer.choice && answer.choice === step.correct_option;
    return { correct: ok, near_miss: false };
  }
  if (step.card_type === 'cloze') return judgeTyped(step.context.answer, answer.typed ?? '');
  // recognize：自评
  const r = answer.self_rating ?? 1;
  return { correct: r >= 2, near_miss: false };
}

export interface AnswerInput { session_id: string; step: number; answer: Answer; hints: number; duration_ms: number }

/** review.answer：判分、首次作答记分、答错插重练步 */
export async function answerStep(ctx: Ctx, dict: Dict, input: AnswerInput): Promise<AnswerResult> {
  const db = ctx.db;
  return db.transaction(async tx => {
    const { s, steps } = await loadSession(tx, input.session_id);
    const step = steps[input.step];
    if (!step) throw new TibiError('not_found', '没有这一步');
    if (step.intro) throw new TibiError('conflict', '初见步不作答，用 review.next');
    if (step.result) throw new TibiError('conflict', '这一步已经答过了');
    const t = now();
    const { correct, near_miss } = judge(step, input.answer);
    const graded = !!s.graded && step.retry === 0 && !firstAttemptDone(steps, step.card_id, input.step);
    const { rating, reason } = gradeAnswer({ card_type: step.card_type, correct, near_miss, hints: input.hints, duration_ms: input.duration_ms, self_rating: input.answer.self_rating });
    let result: AnswerResult = { step: input.step, correct, near_miss, auto: step.card_type !== 'recognize', undo: { undo_id: '', expires_at: 0 }, ...(step.correct_option ? { correct_option: step.correct_option } : {}) };
    const stepResult: Step['result'] = { correct, answered_at: t, near_miss, first: graded };

    if (graded) {
      const applied = await applyRating(tx, ctx, step, rating, { suggested: rating, hints: input.hints, duration_ms: input.duration_ms, auto: step.card_type !== 'recognize', correct, session_id: s.id, t });
      result = { ...result, ...applied.result, rating, reason };
      stepResult.rating = rating; stepResult.reason = reason; stepResult.suggested_rating = rating; stepResult._undo = applied.snapshot;
    } else {
      stepResult.reason = step.retry > 0 ? '重练 · 不计分' : '不计分';
      result.undo = await recordUndo(tx, ctx, { tool: 'review.answer', args: { session_id: s.id, step: input.step }, undo_payload: { session_id: s.id, step: input.step } });
    }
    // 答错：3 张之后换题型重练（最多两次）
    if (!correct && s.graded && step.retry < MAX_RETRY && step.card_type !== 'recognize') {
      const retryIndex = Math.min(input.step + 1 + RETRY_GAP, steps.length);
      const card = await getCard(tx, step.card_id); const term = await getTerm(tx, step.term.id);
      if (card && term) {
        const swapped: CardType = step.card_type === 'choice' ? 'cloze' : 'choice';
        const retryStep = await makeStep(tx, dict, { card, term }, swapped, { retry: (step.retry + 1) as 1 | 2, preferContextId: step.context.id || undefined }) as Step;
        steps.splice(retryIndex, 0, { ...retryStep, step: retryIndex });
        steps.forEach((x, i) => { x.step = i; });
        result.retry_step = retryIndex;
        if (stepResult._undo) stepResult._undo.retry_step = retryIndex;
      }
    }
    step.result = stepResult;
    await saveSession(tx, s.id, steps, s.cursor);
    return result;
  });
}

interface ApplyOpts { suggested?: Rating; hints: number; duration_ms: number; auto: boolean; correct?: boolean; session_id?: string; t: number }

/** 把一次评分落到卡片、日志、熟练度上；返回结果与可撤销的快照 */
export async function applyRating(db: Database, ctx: Ctx, step: Pick<Step, 'card_id' | 'card_type' | 'context' | 'term'>, rating: Rating, o: ApplyOpts): Promise<{ result: Partial<AnswerResult>; snapshot: UndoSnapshot }> {
  const card = await getCard(db, step.card_id);
  if (!card) throw new TibiError('not_found', '卡片不存在');
  const term = await getTerm(db, step.term.id);
  if (!term) throw new TibiError('not_found', '词条不存在');
  const params = await loadParams(db);
  const { patch, log } = await schedule(params, card, rating, o.t);
  await updateCard(db, card.id, patch as Partial<CardRow>);
  const log_id = await insertLog(db, {
    card_id: card.id, rating, card_type: step.card_type, auto_graded: o.auto, suggested_rating: o.suggested, hints: o.hints, correct: o.correct,
    session_id: o.session_id, context_id: step.context.id || undefined, context_snapshot: step.context.sentence, fsrs: log, duration_ms: o.duration_ms, reviewed_at: o.t,
  });
  const status_before = term.status as Status;
  const status_after = nextStatus(status_before, rating, patch.stability);
  if (status_after !== status_before) await setTermStatus(db, term, status_after, 'srs');
  const newCard = { ...card, ...patch } as CardRow;
  const days = Math.max(0, (patch.due - o.t) / 86_400_000);
  const snapshot: UndoSnapshot = { card, log_id, status_before, status_after, hints: o.hints, duration_ms: o.duration_ms, context_id: step.context.id || undefined, context_snapshot: step.context.sentence };
  const undo = await recordUndo(db, ctx, { tool: 'record_review', args: { card_id: card.id, rating }, undo_payload: { card, log_id, term_id: term.id, status_before } });
  snapshot.audit_id = undo.undo_id;
  ctx.events.emit('data.changed', { table: 'cards', ids: [card.id] });
  if (status_after !== status_before) ctx.events.emit('data.changed', { table: 'terms', ids: [term.id] });
  return {
    result: { card: toCardState(newCard), next: { days, label: intervalLabel(days) }, undo, ...(status_after !== status_before ? { status_change: { from: status_before, to: status_after } } : {}) },
    snapshot,
  };
}

/** 撤销一次评分（record_review 的撤销函数；system.undo 与 review.undo 共用） */
async function revertRating(db: Database, payload: { card: CardRow; log_id?: string; term_id: string; status_before: Status }): Promise<void> {
  const { card } = payload;
  const { id, deleted_at, created_at, updated_at, ...rest } = card; void id; void deleted_at; void created_at; void updated_at;
  await updateCard(db, card.id, rest as Partial<CardRow>);
  // 只追加（0003）：写一条撤销记录，不删原来那条
  if (payload.log_id) await db.run(`INSERT INTO review_logs(id, card_id, rating, card_type, auto_graded, session_id, undoes_id, reviewed_at)
    SELECT ?, card_id, 0, card_type, auto_graded, session_id, id, ? FROM review_logs WHERE id = ? AND NOT EXISTS (SELECT 1 FROM review_logs WHERE undoes_id = ?)`, [uuidv7(), now(), payload.log_id, payload.log_id]);
  const term = await getTerm(db, payload.term_id);
  if (term && term.status !== payload.status_before) await setTermStatus(db, term, payload.status_before, 'srs');
}
registerUndo<{ card: CardRow; log_id?: string; term_id: string; status_before: Status }>('record_review', async (p, ctx) => revertRating(ctx.db, p));
registerUndo('review.answer', async () => { /* 不计分步的作答没有副作用 */ });

/** review.override：用户改系统给的评分 */
export async function overrideRating(ctx: Ctx, session_id: string, stepIndex: number, rating: Rating): Promise<AnswerResult> {
  return ctx.db.transaction(async tx => {
    const { s, steps } = await loadSession(tx, session_id);
    const step = steps[stepIndex];
    if (!step?.result) throw new TibiError('conflict', '这一步还没作答');
    const snap = step.result._undo;
    if (!snap) throw new TibiError('conflict', '这一步不计分，改不了评分');
    await revertRating(tx, { card: snap.card, log_id: snap.log_id, term_id: step.term.id, status_before: snap.status_before });
    if (snap.audit_id) await tx.run('UPDATE skill_audit SET undone_at = ? WHERE id = ?', [now(), snap.audit_id]);
    const applied = await applyRating(tx, ctx, step, rating, { suggested: step.result.suggested_rating, hints: snap.hints, duration_ms: snap.duration_ms, auto: step.card_type !== 'recognize', correct: step.result.correct, session_id: s.id, t: now() });
    applied.snapshot.retry_step = snap.retry_step;
    step.result = { ...step.result, rating, reason: `改为${RATING_NAME[rating]}`, _undo: applied.snapshot };
    await saveSession(tx, s.id, steps, s.cursor);
    return { step: stepIndex, correct: step.result.correct, near_miss: !!step.result.near_miss, rating, reason: step.result.reason, auto: false, ...applied.result, undo: applied.result.undo!, ...(step.correct_option ? { correct_option: step.correct_option } : {}) };
  });
}

/** review.next：推进游标；到末尾则结束会话 */
export async function nextStep(ctx: Ctx, session_id: string, stepIndex: number): Promise<{ ok: true; finished?: boolean }> {
  return ctx.db.transaction(async tx => {
    const { s, steps } = await loadSession(tx, session_id);
    const step = steps[stepIndex];
    if (!step) throw new TibiError('not_found', '没有这一步');
    if (step.intro && !step.result) step.result = { correct: true, answered_at: now() };
    const cursor = Math.max(s.cursor, stepIndex + 1);
    if (cursor >= steps.length) {
      await saveSession(tx, s.id, steps, cursor, 'finished');
      const first = steps.filter(x => x.result?.first);
      await addLearningEvent(tx, 'review_session', { session_id: s.id, kind: s.kind, steps: steps.length, graded: first.length, first_correct: first.filter(x => x.result!.correct).length });
      await rollupToday(tx, undefined, ctx.dict);
      return { ok: true as const, finished: true };
    }
    await saveSession(tx, s.id, steps, cursor, s.status === 'paused' ? 'active' : undefined);
    return { ok: true as const };
  });
}

/** review.undo：撤销上一张（恢复卡片、删日志、移除插入的重练步、游标回退） */
export async function undoLast(ctx: Ctx, session_id: string): Promise<AnswerResult> {
  return ctx.db.transaction(async tx => {
    const { s, steps } = await loadSession(tx, session_id);
    let idx = -1;
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i]!.result && !steps[i]!.intro) { idx = i; break; }
    if (idx < 0) throw new TibiError('conflict', '还没有可以撤销的作答');
    const step = steps[idx]!;
    const snap = step.result!._undo;
    if (snap) {
      await revertRating(tx, { card: snap.card, log_id: snap.log_id, term_id: step.term.id, status_before: snap.status_before });
      if (snap.audit_id) await tx.run('UPDATE skill_audit SET undone_at = ? WHERE id = ?', [now(), snap.audit_id]);
      ctx.events.emit('data.changed', { table: 'cards', ids: [step.card_id] });
    }
    // 移除因这次答错插入的重练步（它一定在 idx 之后且还没作答）
    const retryAt = snap?.retry_step ?? findRetry(steps, idx);
    if (retryAt != null && steps[retryAt] && steps[retryAt]!.card_id === step.card_id && steps[retryAt]!.retry > 0 && !steps[retryAt]!.result) steps.splice(retryAt, 1);
    delete step.result;
    steps.forEach((x, i) => { x.step = i; });
    await saveSession(tx, s.id, steps, idx, 'active');
    const card = await getCard(tx, step.card_id);
    const undo: Undo = { undo_id: '', expires_at: 0 };
    return { step: idx, correct: false, near_miss: false, auto: true, reason: '已撤销', ...(card ? { card: toCardState(card) } : {}), undo };
  });
}

function findRetry(steps: Step[], idx: number): number | undefined {
  for (let i = idx + 1; i < steps.length; i++) if (steps[i]!.card_id === steps[idx]!.card_id && steps[i]!.retry > 0 && !steps[i]!.result) return i;
  return undefined;
}

/** 统计一轮里的首次作答情况（完成页用） */
export function sessionSummary(steps: QueueItem[]): { total: number; graded: number; first_correct: number; ratings: [number, number, number, number] } {
  const first = steps.filter(x => (x as Step).result?.first);
  const ratings: [number, number, number, number] = [0, 0, 0, 0];
  for (const x of first) { const r = (x as Step).result!.rating; if (r) ratings[r - 1]!++; }
  return { total: steps.length, graded: first.length, first_correct: first.filter(x => x.result!.correct).length, ratings };
}

export { STATUS_NAME, pickCardType, shuffle, getSetting };
