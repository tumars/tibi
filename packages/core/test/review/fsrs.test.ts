import { describe, expect, it } from 'vitest';
import { schedule, type CardRow } from '../../src/domain/review/fsrs.js';

describe('FSRS 适配', () => {
  it('忘了之后（重学，state 3）还能接着排期', async () => {
    const t0 = Date.now() - 10 * 86_400_000;
    let row: CardRow = { id: 'c', term_id: 't', due: t0, stability: 0, stability_fast: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, forced_type: null, state: 0, last_review: null, suspended: 0, created_at: t0, updated_at: t0, deleted_at: null };
    for (const [rating, day] of [[3, 1], [1, 2], [4, 5], [3, 9]] as const) {
      const r = await schedule({ desired_retention: 0.9 }, row, rating, t0 + day * 86_400_000);
      row = { ...row, ...r.patch };
    }
    expect(row.reps).toBe(4); expect(row.lapses).toBe(1); expect(row.state).toBe(2);
  });
});
