import { describe, expect, it } from 'vitest';
import { NullDict, type Dict } from '../../src/index.js';
import { annotateSentences, isRare, lemmatize, levelOfRatio, ruleLemma, tokenize } from '../../src/domain/text/index.js';

describe('tokenize', () => {
  it('偏移正确，跳过行内代码、网址、数字', () => {
    const s = "Rust's borrow-checker verifies `foo()` at https://x.y/z and 42 isn't slow.";
    const t = tokenize(s);
    expect(t.map(x => x.t)).toEqual(['Rust', 'borrow-checker', 'verifies', 'at', 'and', "isn't", 'slow']);
    for (const x of t) expect(s.slice(x.s, x.e)).toBe(x.t);
  });
});

describe('ruleLemma', () => {
  it('保守规则', () => {
    const cases: [string, string][] = [['verifies', 'verify'], ['cities', 'city'], ['bus', 'bus'], ['this', 'this'], ['boxes', 'box'], ['dogs', 'dog'],
      ['stopped', 'stop'], ['moved', 'move'], ['running', 'run'], ['making', 'make'], ['walking', 'walk'], ['went', 'go'], ['children', 'child'],
      ['bigger', 'big'], ['computer', 'computer'], ['need', 'need'], ['walked', 'walk'], ['used', 'use'], ['created', 'create'], ['writing', 'write'], ['agreed', 'agree'], ['limited', 'limit'], ['thing', 'thing'], ["don't", 'not'], ['was', 'be'], ['process', 'process'], ['leaves', 'leaf']];
    for (const [a, b] of cases) expect(ruleLemma(a), a).toBe(b);
  });
  it('词典优先', async () => {
    const dict: Dict = { async lookup() { return undefined; }, async frequencyRank() { return undefined; }, async lemmas(f) { return f === 'left' ? ['left', 'leave'] : []; } };
    expect(await lemmatize('left', dict)).toBe('left');
    expect(await lemmatize('verifies', dict)).toBe('verify');
    expect(ruleLemma('ubiquitous')).toBe('ubiquitous'); expect(ruleLemma('status')).toBe('status'); expect(ruleLemma('cats')).toBe('cat');
  });
});

describe('levelOfRatio / isRare：文本级别只看词频', () => {
  it('常用 3000 词以外的占比 → CEFR', () => {
    expect(levelOfRatio(0.02)).toBe('A2'); expect(levelOfRatio(0.05)).toBe('B1'); expect(levelOfRatio(0.08)).toBe('B2');
    expect(levelOfRatio(0.12)).toBe('C1'); expect(levelOfRatio(0.2)).toBe('C2');
    expect(isRare(100)).toBe(false); expect(isRare(3000)).toBe(false); expect(isRare(3001)).toBe(true); expect(isRare(undefined)).toBe(true);
  });
});

describe('annotateSentences', () => {
  const freq: Record<string, number> = { the: 1, to: 5, yesterday: 800, compiler: 2000, enforce: 7000, deterministic: 12000, rule: 500, go: 100 };
  const dict: Dict = { async lookup() { return undefined; }, async lemmas() { return []; }, async frequencyRank(l) { return freq[l]; } };
  it('只有词库里有行的词带状态（不按词频猜生词）；专有名词与缩写不标', async () => {
    const r = await annotateSentences({
      sentences: ['The compiler enforces rules deterministically.', 'Yesterday Alice went to NASA.'],
      dict,
      statusOf: l => (l === 'rule' ? 2 : undefined),
    });
    const t0 = r.sentences[0]!.tokens;
    // enforce（7000）、deterministically（没有词频）很生僻，但用户没标过：不着色
    expect(t0.map(x => [x.l, x.status])).toEqual([['the', undefined], ['compiler', undefined], ['enforce', undefined], ['rule', 2], ['deterministically', undefined]]);
    const t1 = r.sentences[1]!.tokens;
    expect(t1.find(x => x.t === 'Alice')?.proper).toBe(true);
    expect(t1.find(x => x.t === 'NASA')?.status).toBeUndefined();
    expect(t1.find(x => x.t === 'went')?.l).toBe('go');
    expect(r.counts).toEqual({ total: 8, new: 0, learning: 1 });
    // 级别：8 个词里 2 个在常用 3000 以外 → 25% → C2（与用户无关）
    expect(r.rare_ratio).toBe(0.25); expect(r.level).toBe('C2');
    expect(r).not.toHaveProperty('newTerms');
  });
  it('用户标的生词 / 学习中带状态；旧数据里的待确认（99）当作没有行', async () => {
    const st: Record<string, number> = { compiler: 0, enforce: 99, rule: 97 };
    const r = await annotateSentences({ sentences: ['The compiler enforces rules.'], dict, statusOf: l => st[l] as never });
    expect(r.sentences[0]!.tokens.map(x => [x.l, x.status])).toEqual([['the', undefined], ['compiler', 0], ['enforce', undefined], ['rule', 97]]);
    expect(r.counts).toEqual({ total: 4, new: 1, learning: 0 });
  });
  it('缩略不算词；cannot 还原成 can', async () => {
    const d: Dict = { async lookup() { return undefined; }, async lemmas() { return []; }, async frequencyRank(l) { return l === 'can' ? 50 : undefined; } };
    const r = await annotateSentences({ sentences: ["We don't, and I’m sure it’s five o’clock.", 'You cannot.'], dict: d, statusOf: () => undefined });
    const lemmas = r.sentences.flatMap(s => s.tokens.map(t => t.l));
    expect(lemmas).toContain('can'); expect(lemmas).not.toContain('cannot');
    // 缩略不进统计：we and sure it five you can = 7（it’s 还原成 it；don't / I’m / o’clock 不算）
    expect(r.counts.total).toBe(7);
  });
  it('没有词典：不估级别，整篇都不标', async () => {
    const r = await annotateSentences({ sentences: ['The compiler enforces rules.'], dict: new NullDict(), statusOf: () => undefined });
    expect(r.sentences[0]!.tokens.every(t => t.status === undefined)).toBe(true);
    expect(r.level).toBeUndefined(); expect(r.rare_ratio).toBeUndefined();
  });
});

describe('lemmatize：规则还原要词典认可', () => {
  it('词典收了这个词头、又没说它是变形：规则不改写', async () => {
    const heads: Dict = { async lookup(w) { return ['interest', 'matter', 'summer', 'people'].includes(w) ? { word: w, translation: 'n. 义', exam: [], forms: [] } : undefined; }, async lemmas() { return []; }, async frequencyRank() { return 100; } };
    expect(await lemmatize('interest', heads)).toBe('interest');
    expect(await lemmatize('matter', heads)).toBe('matter');
    expect(await lemmatize('summer', heads)).toBe('summer');
    expect(await lemmatize('people', heads)).toBe('person');   // 人工列的不规则词不受影响
    expect(await lemmatize('walks', heads)).toBe('walk');      // 词典里没有的词头仍走规则
  });
  const entries: Record<string, { translation: string; forms: string[] }> = {
    lex: { translation: '[法] 法, 法律, 法律实体', forms: [] },
    walk: { translation: 'v. 走, 步行\nn. 散步', forms: ['walks', 'walked', 'walking'] },
    bake: { translation: 'vt. 烘焙', forms: [] },
  };
  const dict = { async lookup(w: string) { const e = entries[w]; return e ? { word: w, exam: [], ...e } : undefined; }, async lemmas() { return []; }, async frequencyRank() { return undefined; } };
  it('碰巧撞上不相干的名词时不还原，动词照常还原', async () => {
    expect(await lemmatize('lexing', dict)).toBe('lexing');
    expect(await lemmatize('walking', dict)).toBe('walk');
    expect(await lemmatize('baked', dict)).toBe('bake');
    expect(await lemmatize('tokenizing', dict)).toBe('tokenize');   // 词典里没有：保留规则的结果
  });
});

