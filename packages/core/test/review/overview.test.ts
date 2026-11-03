import { describe, expect, it } from 'vitest';
import type { ReviewSession } from '../../src/index.js';
import type { ReviewOverview } from '../../src/domain/review/index.js';
import { makeDoc, makeReviewCore, makeWord } from './fixtures.js';

const DAY = 86_400_000;

describe('复习页面板（review.overview）', () => {
  it('到期 / 逾期 / 新词的口径和开始复习排出来的一致，且不建会话', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    await makeWord(db, { text: 'overhead', meaning: '开销', status: 2, state: 2, due: Date.now() - 2 * DAY }, doc);
    await makeWord(db, { text: 'upshot', meaning: '最终结果', status: 2, state: 2, due: Date.now() - 1000 }, doc);
    for (let i = 0; i < 3; i++) await makeWord(db, { text: `word${i}`, meaning: `释义${i}`, article: true }, doc);
    const o = await core.call<ReviewOverview>('review.overview', {});
    expect(o).toMatchObject({ due: 2, fresh: 3, new_waiting: 3, daily_new: 20 });
    expect(o.late).toBeGreaterThanOrEqual(1);
    expect(o.open).toBeUndefined();
    expect(o.forecast).toHaveLength(7);
    const n = await db.get<{ n: number }>('SELECT count(*) AS n FROM review_sessions');
    expect(Number(n?.n)).toBe(0);

    const s = await core.call<ReviewSession>('review.start', {});
    expect(s.steps.filter(x => !x.intro)).toHaveLength(o.due + o.fresh);
    const o2 = await core.call<ReviewOverview>('review.overview', {});
    expect(o2.open).toMatchObject({ session_id: s.session_id, total: s.steps.length, left: s.steps.length });
  });

  it('什么都没到期时建的空会话不会挡住之后到期的卡', async () => {
    const { core, db } = await makeReviewCore();
    const empty = await core.call<ReviewSession>('review.start', {});
    expect(empty.steps).toHaveLength(0);
    expect((await core.call<ReviewOverview>('review.overview', {})).open).toBeUndefined();
    const doc = await makeDoc(db);
    await makeWord(db, { text: 'overhead', meaning: '开销', status: 2, state: 2, due: Date.now() - 1000 }, doc);
    const s = await core.call<ReviewSession>('review.start', {});
    expect(s.session_id).not.toBe(empty.session_id);
    expect(s.steps).toHaveLength(1);
  });
});
