import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleCore, fakePlatform, type DictEntryResult, type DictSuggestResult } from '@tibi/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDict } from '../src/ecdict/ingest.js';
import { openAppDb, openDictDb, SqliteDict } from '../src/index.js';

const ROWS: [string, string, string, number, string][] = [
  ['go', 'ɡəʊ', 'v. 去, 走', 100, 'p:went/d:gone/i:going/3:goes'],
  ['went', 'went', 'go的过去式', 0, '0:go/1:p'],
  ['leave', 'liːv', 'v. 离开', 400, 'p:left/d:left/i:leaving/3:leaves/s:leaves'],
  ['left', 'left', 'a. 左边的\nleave的过去式和过去分词', 350, '0:leave/1:pd/d:left/p:left'],
  ['receive', 'rɪˈsiːv', 'vt. 收到, 接收', 800, 'd:received/p:received/3:receives/i:receiving'],
  ['city', 'ˈsɪti', 'n. 城市', 500, 's:cities'],
  ['apple', 'ˈæpl', 'n. 苹果, 家伙\n[医] 苹果', 2600, 's:apples'],
  ['cider', 'ˈsaɪdə', 'n. 苹果汁, 苹果酒', 9000, ''],
  ['pomaceous', '', 'a. 梨果状的; 似苹果的', 0, ''],
  ['redacted', '', ' [电影]波湾阴谋; 苹果', 10, ''],
  ['apply', 'əˈplaɪ', 'v. 申请, 应用', 700, 'p:applied/d:applied/3:applies/i:applying'],
  ['appliance', '', 'n. 器具', 5000, ''],
  ['take off', '', '起飞, 脱下', 0, ''],
  ['matter', 'ˈmætə', 'n. 事情', 300, ''],
  ['mat', 'mæt', 'n. 垫子', 6000, ''],
  ['interest', 'ˈɪntrəst', 'n. 兴趣', 400, ''],
  ['number', 'ˈnʌmbə', 'n. 数字', 200, '0:numb/1:r'],
  ['numb', 'nʌm', 'a. 麻木的', 9000, 'r:number'],
  ['APP', '', '[计] 应用程序', 16000, ''],
  ['app', 'æp', 'n. 应用', 9000, ''],
];

async function makeCore(withDict = true) {
  const dir = mkdtempSync(join(tmpdir(), 'tibi-dict-'));
  const csv = join(dir, 'ecdict.csv');
  writeFileSync(csv, ['word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio', ...ROWS.map(([w, ph, tr, frq, ex]) => `${w},${ph},,"${tr.replace(/\n/g, '\\n')}",,,,,${frq},${frq},${ex},,`)].join('\n') + '\n');
  await buildDict(csv, join(dir, 'dict.db'));
  const db = await openAppDb(':memory:');
  const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  const dict = withDict ? new SqliteDict((await openDictDb(join(dir, 'dict.db')))!) : undefined;
  const { core, kernel } = await assembleCore({ db, dict, platform: fakePlatform({ isOnline: () => false }), resume: false });
  return { core, kernel, db };
}
type M = Awaited<ReturnType<typeof makeCore>>;

describe('词典页 dict.*（00 §3.14）', () => {
  let m: M;
  const suggest = (q: string) => m.core.call<DictSuggestResult>('dict.suggest', { q });
  const entry = (word: string) => m.core.call<DictEntryResult>('dict.entry', { word });
  beforeAll(async () => { m = await makeCore(); });

  it('前缀联想：常用词在前，不分大小写', async () => {
    const r = await suggest('APP');
    expect(r.mode).toBe('prefix');
    expect(r.items.map(i => i.word)).toEqual(['app', 'apply', 'apple', 'appliance']);   // APP 和 app 只留一个
    expect(r.items[2]!.gloss).toBe('n. 苹果, 家伙；[医] 苹果');
  });
  it('输入正好是词头时排第一，哪怕别的词更常用', async () => {
    expect((await suggest('mat')).items.map(i => i.word)).toEqual(['mat', 'matter']);
  });
  it('输入是变形：词头本身在前，原形紧跟', async () => {
    const r = await suggest('went');
    expect(r.items.map(i => i.word)).toEqual(['went', 'go']);
    expect((await suggest('cities')).items.map(i => i.word)).toEqual(['city']);
  });
  it('中文反查：义项正好是它的排最前，冷门词也能找到，标注行排最后', async () => {
    const r = await suggest('苹果');
    expect(r.mode).toBe('zh');
    expect(r.items.map(i => i.word)).toEqual(['apple', 'cider', 'pomaceous', 'redacted']);
  });
  it('拼错了：给拼写相近的词', async () => {
    const r = await suggest('recieve');
    expect(r.mode).toBe('similar');
    expect(r.items[0]!.word).toBe('receive');
  });
  it('词条：带类型的词形；变形词头指向原形；没有词头时用原形并标出来', async () => {
    const go = await entry('go');
    expect(go.entry?.inflections).toContainEqual({ type: 'p', form: 'went' });
    expect(go.entry?.base).toBeUndefined();
    const went = await entry('went');
    expect(went).toMatchObject({ lemma: 'go', entry: { word: 'went', base: 'go' } });
    expect(went.via).toBeUndefined();
    const cities = await entry('cities');
    expect(cities).toMatchObject({ lemma: 'city', via: 'cities', entry: { word: 'city' } });
    expect((await entry('take off')).entry?.word).toBe('take off');
  });
  it('词形还原不改写词典里的词头（matter 不是 mat）；只在真的按原形算时才提变形', async () => {
    expect(await entry('matter')).toMatchObject({ lemma: 'matter', entry: { word: 'matter' } });
    expect((await entry('interest')).lemma).toBe('interest');
    const number = await entry('number');
    expect(number.lemma).toBe('number');
    expect(number.entry?.base).toBeUndefined();
  });
  it('大小写不同的词头：优先完全一样的', async () => {
    expect((await entry('app')).entry?.word).toBe('app');
    expect((await entry('APP')).entry?.word).toBe('app');
  });
  it('查不到：entry 为空，给拼写建议', async () => {
    const r = await entry('recieve');
    expect(r.entry).toBeUndefined();
    expect(r.similar[0]!.word).toBe('receive');
  });
  it('只读：查词不建词条；加入生词本后带上 term；能搜到读过的文章', async () => {
    const { task_id } = await m.core.call<{ task_id: string }>('documents.import', { source: { type: 'text', text: 'A short walk\n\nShe went to the city. Later the cities grew and everyone went home.' } });
    const doc = (await m.kernel.jobs.wait(task_id)).output as { document_id: string };
    const before = await m.db.get<{ n: number }>("SELECT count(*) AS n FROM terms WHERE in_wordbook = 1");
    const cards = await m.db.get<{ n: number }>('SELECT count(*) AS n FROM cards');
    const r = await entry('go');
    expect(r.readings[0]).toMatchObject({ document_id: doc.document_id });
    expect(r.readings[0]!.snippet).toContain('⟦went⟧');
    expect(r.readings).toHaveLength(1);
    expect((await m.db.get<{ n: number }>("SELECT count(*) AS n FROM terms WHERE in_wordbook = 1"))!.n).toBe(before!.n);
    expect((await m.db.get<{ n: number }>('SELECT count(*) AS n FROM cards'))!.n).toBe(cards!.n);
    await m.core.call('terms.add', { entries: [{ text: 'went' }] });
    expect(await entry('went')).toMatchObject({ in_wordbook: true, term: { text: 'go' } });
  });
  it('奇怪的输入不报错', async () => {
    for (const q of ['"(*', '%_', "o'", '  ', '100%']) await expect(suggest(q)).resolves.toBeTruthy();
    await expect(entry('"(*')).resolves.toMatchObject({ entry: undefined });
  });
});

describe('没装词典', () => {
  it('available = false，不报错', async () => {
    const m = await makeCore(false);
    expect(await m.core.call('dict.suggest', { q: 'go' })).toEqual({ available: false, mode: 'prefix', items: [] });
    expect(await m.core.call('dict.entry', { word: 'go' })).toMatchObject({ available: false, entry: undefined, similar: [] });
  });
});
