/**
 * 词典的补充数据（T32）：词光 Word Atlas（例句、搭配、词族、辨析）和 Open English WordNet（英文义项、近反义词）。
 * 都写进 dict.db，版本钉死，换版本时改这里的地址，CI 的词典缓存按本目录的文件内容失效。
 * 署名：Word Atlas contributors（CC BY 4.0）；Open English WordNet（CC BY 4.0）。入库时只筛字段、合并存放，不改文字。
 */
import type BetterSqlite3 from 'better-sqlite3';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { strFromU8, unzipSync } from 'fflate';

export const ATLAS_URL = 'https://raw.githubusercontent.com/designfuchen/word-atlas/19a9bd889d2f642fef1d8d0eef85a3f35e1a66ff/data/word-atlas.json';
export const WORDNET_URL = 'https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025-json.zip';

export async function downloadTo(url: string, dest: string, log: (s: string) => void = () => {}): Promise<string> {
  if (existsSync(dest) && statSync(dest).size > 0) { log(`已有 ${dest}`); return dest; }
  mkdirSync(dirname(dest), { recursive: true });
  log(`下载 ${url} …`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`下载失败：${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
  return dest;
}

interface AtlasEntry { w: string; ex?: { en: string; zh?: string }[]; col?: string[]; fam?: string[]; syn?: string[]; ant?: string[]; tip?: string; cefr?: string }

/** 词光 JSON → word_atlas 表；`public library｜公共图书馆` 拆成英文和中文 */
export function ingestAtlas(db: BetterSqlite3.Database, path: string): number {
  const rows = JSON.parse(readFileSync(path, 'utf8')) as AtlasEntry[];
  db.exec('CREATE TABLE word_atlas (word TEXT PRIMARY KEY COLLATE NOCASE, cefr TEXT, tip TEXT, examples TEXT NOT NULL, collocations TEXT NOT NULL, family TEXT NOT NULL, synonyms TEXT NOT NULL, antonyms TEXT NOT NULL)');
  const ins = db.prepare('INSERT OR IGNORE INTO word_atlas VALUES (?,?,?,?,?,?,?,?)');
  const col = (s: string) => { const [en, zh] = s.split('｜'); return { en: en!.trim(), zh: zh?.trim() }; };
  db.exec('BEGIN');
  for (const r of rows) ins.run(r.w, r.cefr || null, r.tip || null, JSON.stringify(r.ex ?? []), JSON.stringify((r.col ?? []).map(col)), JSON.stringify(r.fam ?? []), JSON.stringify(r.syn ?? []), JSON.stringify(r.ant ?? []));
  db.exec('COMMIT');
  return rows.length;
}

interface WnSense { id: string; synset: string; antonym?: string[] }
interface WnSynset { definition: string[]; example?: (string | { text: string })[]; members: string[]; partOfSpeech: string }

/** OEWN 的 JSON 压缩包 → wn_sense(词 → 义项，rank 是 WordNet 的义项顺序)、wn_synset。只留义项用得上的字段，上下位等关系不要 */
export function ingestWordnet(db: BetterSqlite3.Database, zipPath: string): { senses: number; synsets: number } {
  const files = unzipSync(readFileSync(zipPath));
  const entries: [string, string, WnSense[]][] = [];
  const senseWord = new Map<string, string>();
  const synsets: [string, WnSynset][] = [];
  for (const [name, bytes] of Object.entries(files)) {
    const base = name.split('/').pop()!;
    if (!base.endsWith('.json')) continue;
    if (/^(noun|verb|adj|adv)\./.test(base)) { synsets.push(...Object.entries(JSON.parse(strFromU8(bytes)) as Record<string, WnSynset>)); continue; }
    if (!base.startsWith('entries-')) continue;
    for (const [word, byPos] of Object.entries(JSON.parse(strFromU8(bytes)) as Record<string, Record<string, { sense: WnSense[] }>>)) {
      for (const [pos, v] of Object.entries(byPos)) {
        // 词头里 pos 可能写成 n-1（同形异义）
        entries.push([word, pos[0]!, v.sense]);
        for (const s of v.sense) senseWord.set(s.id, word);
      }
    }
  }
  db.exec(`
    CREATE TABLE wn_synset (id TEXT PRIMARY KEY, pos TEXT NOT NULL, definition TEXT NOT NULL, examples TEXT NOT NULL, members TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE wn_sense (word TEXT NOT NULL COLLATE NOCASE, pos TEXT NOT NULL, rank INTEGER NOT NULL, synset TEXT NOT NULL, antonyms TEXT);
  `);
  const insSyn = db.prepare('INSERT INTO wn_synset VALUES (?,?,?,?,?)');
  const insSense = db.prepare('INSERT INTO wn_sense VALUES (?,?,?,?,?)');
  db.exec('BEGIN');
  for (const [id, s] of synsets) {
    insSyn.run(id, s.partOfSpeech === 's' ? 'a' : s.partOfSpeech, s.definition.join('; '), JSON.stringify((s.example ?? []).map(e => (typeof e === 'string' ? e : e.text))), JSON.stringify(s.members));
  }
  let senses = 0;
  for (const [word, pos, list] of entries) {
    list.forEach((s, i) => {
      const ant = (s.antonym ?? []).map(id => senseWord.get(id)).filter((w): w is string => !!w);
      insSense.run(word, pos === 's' ? 'a' : pos, i, s.synset, ant.length ? JSON.stringify(ant) : null);
      senses++;
    });
  }
  db.exec('COMMIT');
  db.exec('CREATE INDEX wn_sense_word ON wn_sense(word)');
  return { senses, synsets: synsets.length };
}
