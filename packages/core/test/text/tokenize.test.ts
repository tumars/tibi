import { describe, expect, it } from 'vitest';
import { NullDict, type Dict } from '../../src/index.js';
import { annotateSentences, lemmatize, prelabel, ruleLemma, tokenize } from '../../src/domain/text/index.js';

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

describe('prelabel', () => {
  it('中间带：前 N 已知，N..N+3000 待确认，之后与无词频生词', () => {
    expect(prelabel(100, 6000)).toBe('known');
    expect(prelabel(6000, 6000)).toBe('known');
    expect(prelabel(6001, 6000)).toBe('unsure');
    expect(prelabel(9000, 6000)).toBe('unsure');
    expect(prelabel(9001, 6000)).toBe('new');
    expect(prelabel(undefined, 6000)).toBe('new');
    expect(prelabel(0, 6000)).toBe('new');
  });
});

describe('annotateSentences', () => {
  it('按词库与规则定状态，专有名词与缩写不标', async () => {
    const freq: Record<string, number> = { the: 1, to: 5, yesterday: 800, compiler: 2000, enforce: 7000, deterministic: 12000, rule: 500, go: 100 };
    const dict: Dict = { async lookup() { return undefined; }, async lemmas() { return []; }, async frequencyRank(l) { return freq[l]; } };
    const r = await annotateSentences({
      sentences: ['The compiler enforces rules deterministically.', 'Yesterday Alice went to NASA.'],
      dict, vocab_estimate: 6000,
      statusOf: l => (l === 'rule' ? 2 : undefined),
    });
    const t0 = r.sentences[0]!.tokens;
    expect(t0.map(x => [x.l, x.status])).toEqual([['the', undefined], ['compiler', undefined], ['enforce', 99], ['rule', 2], ['deterministically', 0]]);
    const t1 = r.sentences[1]!.tokens;
    expect(t1.find(x => x.t === 'Alice')?.proper).toBe(true);
    expect(t1.find(x => x.t === 'NASA')?.status).toBeUndefined();
    expect(t1.find(x => x.t === 'went')?.l).toBe('go');
    expect([...r.newTerms.keys()].sort()).toEqual(['deterministically', 'enforce']);
    expect(r.counts).toMatchObject({ new: 1, unsure: 1, learning: 1 });
    expect(r.prelabel_total).toBe(7);
  });
  it('缩略不算词；cannot 还原成 can', async () => {
    const dict: Dict = { async lookup() { return undefined; }, async lemmas() { return []; }, async frequencyRank(l) { return l === 'can' ? 50 : undefined; } };
    const r = await annotateSentences({ sentences: ["We don't, and I’m sure it’s five o’clock.", 'You cannot.'], dict, vocab_estimate: 6000, statusOf: () => undefined });
    expect([...r.newTerms.keys()].filter(l => /['’]|cannot/.test(l))).toEqual([]);
  });
  it('没有词典：判断不了生熟，整篇都不标', async () => {
    const r = await annotateSentences({ sentences: ['The compiler enforces rules.'], dict: new NullDict(), vocab_estimate: 6000, statusOf: () => undefined });
    expect(r.newTerms.size).toBe(0);
    expect(r.unknown_ratio).toBe(0);
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

