import { describe, expect, it } from 'vitest';
import type { AnswerResult, ReviewSession } from '../../src/index.js';
import { gradeAnswer, intervalLabel, judgeTyped, nextStatus } from '../../src/domain/review/index.js';
import { makeDoc, makeReviewCore, makeWord } from './fixtures.js';

const DAY = 86_400_000;

describe('评分规则（G1）', () => {
  it('填空判定：正确 / 差一点 / 不对', () => {
    expect(judgeTyped(['overhead'], 'Overhead ')).toMatchObject({ correct: true, near_miss: false });
    expect(judgeTyped(['overhead'], 'overhaed')).toMatchObject({ correct: true, near_miss: true });
    expect(judgeTyped(['overhead'], 'overload')).toMatchObject({ correct: false });
    expect(judgeTyped(['go', 'went', 'gone'], 'went').correct).toBe(true);
  });
  it('系统评分阈值', () => {
    expect(gradeAnswer({ card_type: 'choice', correct: false, near_miss: false, hints: 0, duration_ms: 1000 }).rating).toBe(1);
    expect(gradeAnswer({ card_type: 'choice', correct: true, near_miss: false, hints: 0, duration_ms: 12_000 }).rating).toBe(2);
    expect(gradeAnswer({ card_type: 'choice', correct: true, near_miss: false, hints: 0, duration_ms: 4_000 }).rating).toBe(3);
    expect(gradeAnswer({ card_type: 'cloze', correct: true, near_miss: false, hints: 1, duration_ms: 4_000 }).rating).toBe(2);
    expect(gradeAnswer({ card_type: 'cloze', correct: true, near_miss: true, hints: 0, duration_ms: 4_000 }).rating).toBe(2);
    expect(gradeAnswer({ card_type: 'cloze', correct: true, near_miss: false, hints: 0, duration_ms: 5_000 }).rating).toBe(4);
    expect(gradeAnswer({ card_type: 'cloze', correct: true, near_miss: false, hints: 0, duration_ms: 9_000 }).rating).toBe(3);
    expect(gradeAnswer({ card_type: 'recognize', correct: true, near_miss: false, hints: 0, duration_ms: 0, self_rating: 4 }).rating).toBe(4);
  });
  it('熟练度联动', () => {
    expect(nextStatus(0, 1, 0)).toBe(1);      // 生词答错也至少是"见过"
    expect(nextStatus(3, 1, 10)).toBe(2);
    expect(nextStatus(2, 2, 10)).toBe(2);
    expect(nextStatus(2, 3, 10)).toBe(3);
    expect(nextStatus(1, 4, 10)).toBe(3);     // 低档轻松升两档
    expect(nextStatus(4, 4, 10)).toBe(4);     // 稳定性不够不能到掌握
    expect(nextStatus(4, 4, 90)).toBe(5);
    expect(nextStatus(97, 3, 90)).toBe(97);
  });
  it('间隔文案', () => {
    expect(intervalLabel(0.0007)).toBe('1 分钟后');
    expect(intervalLabel(3)).toBe('3 天后');
    expect(intervalLabel(15)).toBe('2 周后');
    expect(intervalLabel(45)).toBe('1.5 个月后');
    expect(intervalLabel(400)).toBe('1 年后');
  });
});

describe('复习会话', () => {
  it('队列：到期优先、新词 5 个一组、没见过的先初见', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    const due = await makeWord(db, { text: 'overhead', meaning: '开销', status: 2, state: 2, due: Date.now() - DAY }, doc);
    for (let i = 0; i < 7; i++) await makeWord(db, { text: `word${i}`, meaning: `释义${i}`, article: i % 2 === 0 }, doc);
    const s = await core.call<ReviewSession>('review.start', {});
    expect(s.resumed).toBe(false);
    expect(s.steps[0]!.card_id).toBe(due.card_id);
    expect(s.steps[0]!.card_type).toBe('cloze');
    expect(s.steps[0]!.context.sentence).toContain('overhead');
    // 第一组 5 个新词：没文章语境的 2 个先初见，再 5 个回忆；第二组 2 个
    const rest = s.steps.slice(1);
    const introCount = rest.filter(x => x.intro).length;
    expect(introCount).toBe(3);   // word1, word3, word5 没有文章语境
    expect(rest.filter(x => !x.intro).length).toBe(7);
    const firstGroup = rest.slice(0, 7);
    expect(firstGroup.slice(0, 2).every(x => x.intro)).toBe(true);
    expect(firstGroup.slice(2).every(x => !x.intro && x.card_type === 'choice')).toBe(true);
    expect(rest.filter(x => !x.intro).every(x => x.options?.length === 4)).toBe(true);
    expect(s.forecast).toHaveLength(7);
    expect(s.steps.every(x => !('result' in x && (x.result as { _undo?: unknown })?._undo))).toBe(true);
  });

  it('每日新卡上限', async () => {
    const { core, db } = await makeReviewCore();
    await db.run("UPDATE user_profile SET daily_new_cards = 3 WHERE id = '1'");
    const doc = await makeDoc(db);
    for (let i = 0; i < 6; i++) await makeWord(db, { text: `w${i}`, meaning: `m${i}` }, doc);
    const s = await core.call<ReviewSession>('review.start', {});
    expect(s.steps.filter(x => !x.intro).length).toBe(3);
  });

  it('选义答对计分、答错插入重练步、只有首次作答算数', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    const a = await makeWord(db, { text: 'upshot', meaning: '最终结果' }, doc);
    for (let i = 0; i < 5; i++) await makeWord(db, { text: `filler${i}`, meaning: `填充${i}` }, doc);
    const s = await core.call<ReviewSession>('review.start', {});
    const idx = s.steps.findIndex(x => x.card_id === a.card_id);
    const step = s.steps[idx]!;
    const wrong = step.options!.find(o => o.text !== '最终结果')!;
    const r1 = await core.call<AnswerResult>('review.answer', { session_id: s.session_id, step: idx, answer: { choice: wrong.id }, hints: 0, duration_ms: 3000 });
    expect(r1.correct).toBe(false); expect(r1.rating).toBe(1); expect(r1.auto).toBe(true);
    expect(r1.retry_step).toBe(Math.min(idx + 4, s.steps.length));
    expect(r1.status_change).toEqual({ from: 0, to: 1 });
    const logs = await db.all<{ rating: number; correct: number; state: number }>('SELECT rating, correct, state FROM review_logs WHERE card_id = ?', [a.card_id]);
    expect(logs).toEqual([{ rating: 1, correct: 0, state: 0 }]);
    const card = await db.get<{ state: number; lapses: number; reps: number }>('SELECT state, lapses, reps FROM cards WHERE id = ?', [a.card_id]);
    expect(card?.reps).toBe(1);
    // 重练步：换成填空，不计分
    const s2 = await core.call<ReviewSession>('review.start', {});
    expect(s2.resumed).toBe(true);
    const retry = s2.steps[r1.retry_step!]!;
    expect(retry.card_id).toBe(a.card_id); expect(retry.retry).toBe(1); expect(retry.card_type).toBe('cloze');
    expect(s2.steps.map(x => x.step)).toEqual(s2.steps.map((_, i) => i));
    const r2 = await core.call<AnswerResult>('review.answer', { session_id: s.session_id, step: r1.retry_step, answer: { typed: 'upshot' }, hints: 0, duration_ms: 2000 });
    expect(r2.correct).toBe(true); expect(r2.rating).toBeUndefined();
    const logs2 = await db.all('SELECT id FROM review_logs WHERE card_id = ?', [a.card_id]);
    expect(logs2).toHaveLength(1);
    await expect(core.call('review.answer', { session_id: s.session_id, step: idx, answer: { choice: wrong.id }, hints: 0, duration_ms: 1 })).rejects.toThrow();
  });

  it('填空差一点算模糊；改评分；撤销', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    const a = await makeWord(db, { text: 'deterministically', meaning: '确定性地', status: 2, state: 2, due: Date.now() - DAY, forms: ['deterministic'] }, doc);
    const s = await core.call<ReviewSession>('review.start', {});
    expect(s.steps[0]!.card_type).toBe('cloze');
    const r = await core.call<AnswerResult>('review.answer', { session_id: s.session_id, step: 0, answer: { typed: 'deterministicaly' }, hints: 0, duration_ms: 4000 });
    expect(r.correct).toBe(true); expect(r.near_miss).toBe(true); expect(r.rating).toBe(2);
    expect(r.status_change).toBeUndefined();
    expect(r.next?.label).toBeTruthy();
    const o = await core.call<AnswerResult>('review.override', { session_id: s.session_id, step: 0, rating: 4 });
    expect(o.rating).toBe(4); expect(o.status_change).toEqual({ from: 2, to: 4 });
    const log = await db.get<{ rating: number; suggested_rating: number }>('SELECT rating, suggested_rating FROM review_logs WHERE card_id = ?', [a.card_id]);
    expect(log).toEqual({ rating: 4, suggested_rating: 2 });
    const u = await core.call<AnswerResult>('review.undo', { session_id: s.session_id });
    expect(u.step).toBe(0);
    expect(await db.all('SELECT id FROM review_logs WHERE card_id = ?', [a.card_id])).toHaveLength(0);
    expect((await db.get<{ status: number }>('SELECT status FROM terms WHERE id = ?', [a.term_id]))?.status).toBe(2);
    expect((await db.get<{ reps: number }>('SELECT reps FROM cards WHERE id = ?', [a.card_id]))?.reps).toBe(1);   // 夹具里复习态卡片 reps 从 1 起
    const s2 = await core.call<ReviewSession>('review.start', {});
    expect(s2.cursor).toBe(0); expect(s2.steps[0]!.result).toBeUndefined();
  });

  it('system.undo 也能撤销一次评分', async () => {
    const { core, db } = await makeReviewCore();
    const { undoMethods } = await import('../../src/domain/shared/undo.js');
    core.use(undoMethods);
    const doc = await makeDoc(db);
    const a = await makeWord(db, { text: 'borrow', meaning: '借用', status: 3, state: 2, due: Date.now() - DAY }, doc);
    const s = await core.call<ReviewSession>('review.start', {});
    const r = await core.call<AnswerResult>('review.answer', { session_id: s.session_id, step: 0, answer: { typed: 'borrow' }, hints: 0, duration_ms: 3000 });
    expect(r.rating).toBe(4);
    await core.call('system.undo', { undo_id: r.undo.undo_id });
    expect(await db.all('SELECT id FROM review_logs WHERE card_id = ?', [a.card_id])).toHaveLength(0);
    expect((await db.get<{ status: number }>('SELECT status FROM terms WHERE id = ?', [a.term_id]))?.status).toBe(3);
  });

  it('暂停 / 续上 / 完成', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    await makeWord(db, { text: 'alpha', meaning: '甲', status: 2, state: 2, due: Date.now() - DAY }, doc);
    await makeWord(db, { text: 'beta', meaning: '乙', status: 2, state: 2, due: Date.now() - DAY }, doc);
    const s = await core.call<ReviewSession>('review.start', {});
    expect(s.steps).toHaveLength(2);
    await core.call('review.answer', { session_id: s.session_id, step: 0, answer: { typed: 'alpha' }, hints: 0, duration_ms: 3000 });
    await core.call('review.next', { session_id: s.session_id, step: 0 });
    await core.call('review.pause', { session_id: s.session_id });
    expect((await db.get<{ status: string }>('SELECT status FROM review_sessions WHERE id = ?', [s.session_id]))?.status).toBe('paused');
    const s2 = await core.call<ReviewSession>('review.start', {});
    expect(s2.session_id).toBe(s.session_id); expect(s2.resumed).toBe(true); expect(s2.cursor).toBe(1);
    expect(s2.steps[0]!.result?.correct).toBe(true);
    await core.call('review.answer', { session_id: s.session_id, step: 1, answer: { typed: 'nope' }, hints: 0, duration_ms: 3000 });
    const n = await core.call<{ finished?: boolean }>('review.next', { session_id: s.session_id, step: 1 });
    // 答错插入了重练步，所以还没结束
    expect(n.finished).toBeUndefined();
    const s3 = await core.call<ReviewSession>('review.start', {});
    expect(s3.steps).toHaveLength(3);
    await core.call('review.answer', { session_id: s.session_id, step: 2, answer: { choice: s3.steps[2]!.options!.find(o => !o.from)!.id }, hints: 0, duration_ms: 1000 });
    const end = await core.call<{ finished?: boolean }>('review.next', { session_id: s.session_id, step: 2 });
    expect(end.finished).toBe(true);
    expect((await db.get<{ status: string }>('SELECT status FROM review_sessions WHERE id = ?', [s.session_id]))?.status).toBe('finished');
    expect(await db.all("SELECT id FROM learning_events WHERE type = 'review_session'")).toHaveLength(1);
    const ds = await db.get<{ reviews: number; review_correct: number }>('SELECT reviews, review_correct FROM daily_stats');
    expect(ds).toEqual({ reviews: 2, review_correct: 1 });
    const s4 = await core.call<ReviewSession>('review.start', {});
    expect(s4.resumed).toBe(false); expect(s4.steps).toHaveLength(0);
  });

  it('review.preview 四档文案；review.quiz 不计分', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    const a = await makeWord(db, { text: 'gamma', meaning: '丙', status: 2, state: 2, due: Date.now() - DAY }, doc);
    for (let i = 0; i < 4; i++) await makeWord(db, { text: `q${i}`, meaning: `丁${i}` }, doc);
    const p = await core.call<Record<number, string>>('review.preview', { card_id: a.card_id });
    expect(Object.keys(p)).toEqual(['1', '2', '3', '4']);
    expect(p[3]).toMatch(/后$/);
    const q = await core.call<ReviewSession>('review.quiz', { count: 3 });
    expect(q.kind).toBe('drill'); expect(q.graded).toBe(false); expect(q.steps).toHaveLength(3);
    const r = await core.call<AnswerResult>('review.answer', { session_id: q.session_id, step: 0, answer: { typed: 'x', choice: 'a' }, hints: 0, duration_ms: 100 });
    expect(r.rating).toBeUndefined();
    expect(await db.all('SELECT id FROM review_logs')).toHaveLength(0);
  });

  it('能力：grade_answer / pick_distractors / record_review / get_review_stats', async () => {
    const { core, db, ctx } = await makeReviewCore();
    const { reviewCapabilities } = await import('../../src/domain/review/index.js');
    const doc = await makeDoc(db);
    const a = await makeWord(db, { text: 'delta', meaning: '三角洲', status: 2, state: 2, due: Date.now() - DAY }, doc);
    for (let i = 0; i < 4; i++) await makeWord(db, { text: `d${i}`, meaning: `干扰${i}` }, doc);
    const g = await reviewCapabilities.grade_answer!.run({ term_id: a.term_id, card_type: 'cloze', expected: ['delta'], answer: 'delta', hints: 0, duration_ms: 3000 }, ctx);
    expect(g).toMatchObject({ correct: true, rating: 4 });
    const pd = await reviewCapabilities.pick_distractors!.run({ term_id: a.term_id, card_type: 'choice', count: 3 }, ctx);
    expect(pd.options).toHaveLength(3); expect(pd.options.every((o: { text: string }) => o.text !== '三角洲')).toBe(true);
    const rr = await reviewCapabilities.record_review!.run({ card_id: a.card_id, card_type: 'cloze', rating: 3, auto: true }, ctx);
    expect(rr.card?.reps).toBe(2);
    const st = await reviewCapabilities.get_review_stats!.run({}, ctx);
    expect(st.today_reviews).toBe(1); expect(st.new_available).toBe(4); expect(st.forecast).toHaveLength(7);
    void core;
  });
});
