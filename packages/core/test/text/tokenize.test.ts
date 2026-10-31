import { describe, expect, it } from 'vitest';
import type { Dict } from '../../src/index.js';
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
});
