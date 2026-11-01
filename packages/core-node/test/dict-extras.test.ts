import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleCore, fakePlatform, type DictEntryResult } from '@tibi/core';
import { strToU8, zipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDict } from '../src/ecdict/ingest.js';
import { openAppDb, openDictDb, SqliteDict } from '../src/index.js';

const ATLAS = [{ w: 'affect', ex: [{ en: 'It can affect sleep.', zh: '它会影响睡眠。' }], col: ['affect health｜影响健康'], fam: ['affected (adj.)'], syn: ['influence'], ant: [], tip: 'affect 是动词，effect 通常是名词。', cefr: 'B1' }];
const ENTRIES = {
  affect: { n: { sense: [{ id: 'affect%1', synset: 's-n' }] }, v: { sense: [{ id: 'affect%2', synset: 's-v' }, { id: 'affect%3', synset: 's-alone' }] } },
  impress: { v: { sense: [{ id: 'impress%1', synset: 's-v' }] } },
  good: { a: { sense: [{ id: 'good%1', synset: 's-good', antonym: ['bad%1'] }] } },
  bad: { a: { sense: [{ id: 'bad%1', synset: 's-good2' }] } },
  go: { v: { sense: [{ id: 'go%1', synset: 's-go' }] } },
  china: { n: { sense: [{ id: 'china%1', synset: 's-porcelain' }] } },
  China: { n: { sense: [{ id: 'China%1', synset: 's-country' }] } },
  Monday: { n: { sense: [{ id: 'Monday%1', synset: 's-monday' }] } },
  turkey: { n: { sense: [{ id: 'turkey%1', synset: 's-turkey' }] } },
};
const syn = (definition: string, members: string[], partOfSpeech: string, example?: (string | { text: string })[]) => ({ definition: [definition], members, partOfSpeech, ...(example ? { example } : {}) });
const SYNSETS = {
  's-n': syn('emotion', ['affect', 'feeling'], 'n'),
  's-v': syn('have an influence on', ['affect', 'impress'], 'v', ['the bad news will affect him', { text: 'from a corpus', source: 'x' } as never]),
  's-alone': syn('no synonym, no example', ['affect'], 'v'),
  's-good': syn('having desirable qualities', ['good'], 's', ['a good book']),
  's-good2': syn('not good', ['bad', 'poor'], 'a'),
  's-go': syn('move', ['go', 'travel'], 'v'),
  's-porcelain': syn('porcelain', ['china', 'porcelain'], 'n'),
  's-country': syn('a country', ['China', 'PRC'], 'n'),
  's-monday': syn('the second day', ['Monday', 'Mon'], 'n'),
  's-turkey': syn('a bird', ['turkey', 'gobbler'], 'n'),
};

let direct: SqliteDict;

async function make(extras = true) {
  const dir = mkdtempSync(join(tmpdir(), 'tibi-extras-'));
  const csv = join(dir, 'e.csv');
  writeFileSync(csv, ['word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange',
    'affect,,,v. 影响,v:90/n:10,,,,500,500,', 'go,,,v. 去,,,,,100,100,p:went', 'went,,,go的过去式,,,,,,,0:go/1:p', 'good,,,a. 好的,,,,,50,50,', 'china,,,n. 瓷器,,,,,900,900,', 'zebra,,,n. 斑马,,,,,9000,9000,'].join('\n') + '\n');
  const atlas = join(dir, 'a.json'); writeFileSync(atlas, JSON.stringify(ATLAS));
  const wordnet = join(dir, 'w.zip');
  writeFileSync(wordnet, zipSync({ 'entries-a.json': strToU8(JSON.stringify(ENTRIES)), 'noun.x.json': strToU8(JSON.stringify(SYNSETS)) }));
  await buildDict(csv, join(dir, 'dict.db'), extras ? { atlas, wordnet } : {});
  const db = await openAppDb(':memory:');
  const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  const dict = new SqliteDict((await openDictDb(join(dir, 'dict.db')))!);
  const { core } = await assembleCore({ db, dict, platform: fakePlatform({ isOnline: () => false }), resume: false });
  direct = dict;
  return (word: string) => core.call<DictEntryResult>('dict.entry', { word });
}

describe('词典补充内容（T32）', () => {
  let entry: Awaited<ReturnType<typeof make>>;
  beforeAll(async () => { entry = await make(); });
  // make(false) 换了 direct，所以「旧版」那条排最后

  it('词光：例句、拆开的搭配、辨析', async () => {
    const a = (await entry('affect')).extras!.atlas!;
    expect(a.cefr).toBe('B1');
    expect(a.collocations).toEqual([{ en: 'affect health', zh: '影响健康' }]);
    expect(a.examples[0]!.zh).toBe('它会影响睡眠。');
    expect(a.tip).toContain('effect');
  });
  it('WordNet 义项：常见词性在前，去掉自己，去掉没内容的，例句对象展开', async () => {
    const x = (await entry('affect')).extras!;
    expect(x.senses.map(s => s.pos)).toEqual(['v', 'n']);
    expect(x.senses[0]!.synonyms).toEqual(['impress']);
    expect(x.senses[0]!.examples).toEqual(['the bad news will affect him', 'from a corpus']);
  });
  it('反义词从义项 id 解析成词，s 归到形容词', async () => {
    const x = (await entry('good')).extras!;
    expect(x.antonyms).toEqual(['bad']);
    expect(x.senses[0]!.pos).toBe('a');
  });
  it('变形页没有内容时用原形的，并标出属于谁', async () => {
    expect((await entry('went')).extras!.word).toBe('go');
  });
  it('大小写不同是另一个词', async () => {
    expect((await entry('china')).extras!.senses.map(s => s.definition)).toEqual(['porcelain']);
  });
  it('小写可以退到大写词头，大写不退到小写词头', async () => {
    expect((await direct.extras('monday'))!.senses[0]!.definition).toBe('the second day');
    expect(await direct.extras('Turkey')).toBeUndefined();
  });
  it('两边都没有时不给', async () => {
    expect((await entry('zebra')).extras).toBeUndefined();
  });
  it('旧版 dict.db 没有这些表也能查词', async () => {
    const r = await (await make(false))('affect');
    expect(r.entry!.translation).toContain('影响');
    expect(r.extras).toBeUndefined();
  });
});
