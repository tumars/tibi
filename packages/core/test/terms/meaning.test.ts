import { describe, expect, it } from 'vitest';
import type { ReviewSession } from '../../src/index.js';
import { fullMeaning, glossSummary, termsMethods } from '../../src/domain/terms/index.js';
import { reviewMethods } from '../../src/domain/review/index.js';
import type { Dict, DictEntry } from '../../src/dict/types.js';
import { makeCore } from '../helpers.js';

const TR = 'n. 编辑者\n[计] 编译程序';
const dict: Dict = {
  lookup: async w => (w === 'compiler' ? { word: w, translation: TR, oxford: false, exam: [] } as unknown as DictEntry : undefined),
  lemmas: async () => [],
  frequencyRank: async () => undefined,
};

describe('词典释义的形状', () => {
  it('完整释义保留所有义项，摘要带上领域义', () => {
    expect(fullMeaning(TR)).toBe('n. 编辑者；[计] 编译程序');
    expect(glossSummary(TR)).toBe('编辑者；编译程序');
    expect(glossSummary('vt. 编译, 编辑\n[计] 编译')).toBe('编译，编辑');
    expect(glossSummary('a. 弹回的, 有弹力的')).toBe('弹回的，有弹力的');
    expect(glossSummary('')).toBeUndefined();
  });
});

describe('各处都看得到领域义', () => {
  async function setup() {
    const m = await makeCore({ dict });
    m.core.use(termsMethods).use(reviewMethods);
    await m.core.call('terms.add', { entries: [{ text: 'compiler' }] });
    return m;
  }

  it('词卡、导出用完整释义，短释义不变', async () => {
    const { core } = await setup();
    const r = await core.call<{ term: { meaning: string; short_gloss: string } }>('terms.lookup', { text: 'compiler' });
    expect(r.term.meaning).toBe('n. 编辑者；[计] 编译程序');
    expect(r.term.short_gloss).toBe('编辑者');
    const csv = await core.call<{ text: string }>('terms.export', { format: 'csv' });
    expect(csv.text).toContain('[计] 编译程序');
  });

  it('复习提示用摘要，答案区用完整释义', async () => {
    const { core } = await setup();
    const s = await core.call<ReviewSession>('review.start', {});
    const step = s.steps.find(x => x.term.text === 'compiler')!;
    expect(step.hint).toBe('编辑者；编译程序');
    expect(step.term.meaning).toBe('n. 编辑者；[计] 编译程序');
  });

  it('用户写的释义优先于词典', async () => {
    const { core, db } = await setup();
    await db.run("UPDATE terms SET meaning = '编译器' WHERE text = 'compiler'");
    const csv = await core.call<{ text: string }>('terms.export', { format: 'csv' });
    expect(csv.text).toContain('编译器');
    expect(csv.text).not.toContain('[计]');
  });
});
