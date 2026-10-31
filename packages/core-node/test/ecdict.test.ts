import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDict } from '../src/ecdict/ingest.js';
import { SqliteDict, openDictDb } from '../src/index.js';

function fakeCsv(): string {
  const rows = ['word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio'];
  const words: [string, string, string, number, string][] = [
    ['go', 'ɡəʊ', 'v. 去', 100, 'p:went/d:gone/i:going/3:goes'],
    ['leave', 'liːv', 'v. 离开', 400, 'p:left/d:left/i:leaving/3:leaves/s:leaves'],
    ['left', 'left', 'adj. 左边的', 350, '0:leave/1:pd'],
    ['verify', 'ˈverɪfaɪ', 'v. 核实', 2800, 'p:verified/d:verified/i:verifying/3:verifies'],
    ['city', 'ˈsɪti', 'n. 城市', 500, 's:cities'],
    ['big', 'bɪɡ', 'adj. 大的', 300, 'r:bigger/t:biggest'],
    ['upshot', 'ˈʌpʃɒt', '"n. 结果, 结局\n[网络] 最终结果"', 15000, ''],
  ];
  for (const [w, ph, tr, frq, ex] of words) rows.push(`${w},${ph},,${tr.startsWith('"') ? tr : '"' + tr + '"'},,3,1,cet4 ielts,${frq},${frq},${ex},,`);
  for (let i = 0; i < 43; i++) rows.push(`word${i},,,"n. 词${i}",,,,,${20000 + i},${20000 + i},s:word${i}s,,`);
  return rows.join('\n') + '\n';
}

describe('ECDICT 入库', () => {
  it('建 stardict 与 lemma_map，SqliteDict 能查', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibi-dict-'));
    const csv = join(dir, 'ecdict.csv'); writeFileSync(csv, fakeCsv());
    const out = join(dir, 'dict.db');
    const r = await buildDict(csv, out);
    expect(r.words).toBe(50);
    const dict = new SqliteDict((await openDictDb(out))!);
    const e = await dict.lookup('Upshot');
    expect(e).toMatchObject({ word: 'upshot', phonetic: 'ˈʌpʃɒt', exam: ['cet4', 'ielts'], frequency: 15000, oxford: true, collins: 3 });
    expect(e!.translation).toMatch(/^n\. 结果/);
    expect(await dict.lemmas('went')).toEqual(['go']);
    expect(await dict.lemmas('left')).toEqual(['left', 'leave']);     // 有自己词频的词头保留并排前面；挑哪个由 lemmatize 按词频定
    expect(await dict.lemmas('verifies')).toEqual(['verify']);
    expect(await dict.lemmas('cities')).toEqual(['city']);
    expect(await dict.lemmas('bigger')).toEqual(['big']);
    expect(await dict.lemmas('nothing')).toEqual([]);
    expect(await dict.frequencyRank('go')).toBe(100);
    const ranks = await dict.frequencyRanks(['go', 'city', 'nope']);
    expect([...ranks.entries()]).toEqual([['go', 100], ['city', 500]]);
    expect((await dict.lookup('go'))!.forms).toEqual(['went', 'gone', 'going', 'goes']);
  });
  it('--limit 只取前 N 行', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibi-dict-'));
    const csv = join(dir, 'ecdict.csv'); writeFileSync(csv, fakeCsv());
    const r = await buildDict(csv, join(dir, 'dict.db'), { limit: 3 });
    expect(r.words).toBe(3);
  });
});
