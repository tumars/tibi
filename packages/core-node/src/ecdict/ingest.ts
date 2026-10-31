/**
 * ECDICT 入库（01 §8）：下载 ecdict.csv → 生成 data/dict.db（stardict 表 + lemma_map）。
 *   pnpm ecdict                       下载并入库（约 66 MB，77 万词条，几分钟）
 *   pnpm ecdict --csv path/to.csv     用本地 CSV
 *   pnpm ecdict --limit 2000          只取前 N 行（试跑）
 *   pnpm ecdict --out data/dict.db
 * 来源：https://github.com/skywind3000/ECDICT（MIT）。
 */
import BetterSqlite3 from 'better-sqlite3';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseCsv } from './csv.js';

const CSV_URL = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv';
const COLS = ['word', 'phonetic', 'definition', 'translation', 'pos', 'collins', 'oxford', 'tag', 'bnc', 'frq', 'exchange'] as const;

export async function downloadCsv(dest: string, log: (s: string) => void = () => {}): Promise<string> {
  if (existsSync(dest) && statSync(dest).size > 1_000_000) { log(`已有 ${dest}`); return dest; }
  mkdirSync(dirname(dest), { recursive: true });
  log(`下载 ${CSV_URL} …`);
  const res = await fetch(CSV_URL);
  if (!res.ok || !res.body) throw new Error(`下载失败：${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
  log(`已保存到 ${dest}（${(statSync(dest).size / 1e6).toFixed(1)} MB）`);
  return dest;
}

/** exchange 字段：`p:went/d:gone/i:going/3:goes/s:…/0:原形/1:类型` */
function parseExchangeForms(ex: string): { type: string; form: string }[] {
  if (!ex) return [];
  return ex.split('/').map(p => { const i = p.indexOf(':'); return i > 0 ? { type: p.slice(0, i), form: p.slice(i + 1) } : null; }).filter((x): x is { type: string; form: string } => !!x && !!x.form);
}

/** 规则能还原的变形算"规则"（rank 2），其余算不规则（rank 1） */
function regularForm(lemma: string, type: string, form: string): boolean {
  const w = lemma.toLowerCase(), f = form.toLowerCase();
  switch (type) {
    case 's': return f === w + 's' || f === w + 'es' || (w.endsWith('y') && f === w.slice(0, -1) + 'ies');
    case '3': return f === w + 's' || f === w + 'es' || (w.endsWith('y') && f === w.slice(0, -1) + 'ies');
    case 'p': case 'd': return f === w + 'ed' || f === w + 'd' || (w.endsWith('y') && f === w.slice(0, -1) + 'ied') || f === w + w.slice(-1) + 'ed';
    case 'i': return f === w + 'ing' || (w.endsWith('e') && f === w.slice(0, -1) + 'ing') || f === w + w.slice(-1) + 'ing';
    case 'r': return f === w + 'er' || f === w + 'r' || (w.endsWith('y') && f === w.slice(0, -1) + 'ier') || f === w + w.slice(-1) + 'er';
    case 't': return f === w + 'est' || f === w + 'st' || (w.endsWith('y') && f === w.slice(0, -1) + 'iest') || f === w + w.slice(-1) + 'est';
    default: return true;
  }
}

export interface BuildOptions { limit?: number; log?: (s: string) => void }

/** CSV → dict.db */
export async function buildDict(csvPath: string, outPath: string, opts: BuildOptions = {}): Promise<{ words: number; forms: number }> {
  const log = opts.log ?? (() => {});
  mkdirSync(dirname(outPath), { recursive: true });
  const tmp = outPath + '.tmp';
  if (existsSync(tmp)) { const { unlinkSync } = await import('node:fs'); unlinkSync(tmp); }
  const db = new BetterSqlite3(tmp);
  db.pragma('journal_mode = OFF'); db.pragma('synchronous = OFF');
  db.exec(`
    CREATE TABLE stardict (word TEXT NOT NULL, phonetic TEXT, definition TEXT, translation TEXT, pos TEXT, collins INTEGER, oxford INTEGER, tag TEXT, bnc INTEGER, frq INTEGER, exchange TEXT);
    CREATE TABLE lemma_map (form TEXT NOT NULL, lemma TEXT NOT NULL, rank INTEGER NOT NULL, PRIMARY KEY (form, lemma));
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  const ins = db.prepare('INSERT INTO stardict(word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const insForm = db.prepare('INSERT OR IGNORE INTO lemma_map(form, lemma, rank) VALUES (?,?,?)');
  let header: string[] | undefined; let n = 0; let forms = 0;
  const headwords = new Set<string>();
  const pending: [string, string, number][] = [];
  const toInt = (s: string | undefined) => { const v = Number(s); return s && Number.isFinite(v) ? v : null; };
  db.exec('BEGIN');
  for await (const row of parseCsv(createReadStream(csvPath, { encoding: 'utf8' }))) {
    if (!header) { header = row; continue; }
    const rec: Record<string, string> = {}; header.forEach((h, i) => rec[h] = row[i] ?? '');
    const word = (rec.word ?? '').trim(); if (!word) continue;
    ins.run(word, rec.phonetic || null, rec.definition || null, rec.translation || null, rec.pos || null, toInt(rec.collins), toInt(rec.oxford), rec.tag || null, toInt(rec.bnc), toInt(rec.frq), rec.exchange || null);
    const lw = word.toLowerCase(); headwords.add(lw);
    for (const { type, form } of parseExchangeForms(rec.exchange ?? '')) {
      if (type === '0' || type === '1') continue;                 // 0:原形 1:类型，不是变形
      const f = form.toLowerCase(); if (f === lw) continue;
      pending.push([f, lw, regularForm(lw, type, form) ? 2 : 1]);
    }
    n++;
    if (n % 50_000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); log(`${n} 词条…`); }
    if (opts.limit && n >= opts.limit) break;
  }
  // 变形里本身也是词头的（left 既是 leave 的过去式也是词头），加一条指向自己的 rank 0
  for (const [f, lemma, rank] of pending) {
    insForm.run(f, lemma, rank); forms++;
    if (headwords.has(f)) insForm.run(f, f, 0);
  }
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('source', CSV_URL);
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('built_at', new Date().toISOString());
  db.exec('COMMIT');
  log('建索引…');
  db.exec('CREATE INDEX stardict_word ON stardict(word COLLATE NOCASE); CREATE INDEX lemma_map_form ON lemma_map(form);');
  db.exec('VACUUM');
  db.close();
  const { renameSync } = await import('node:fs');
  renameSync(tmp, outPath);
  void COLS;
  return { words: n, forms };
}

async function main() {
  const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  const root = resolve(process.cwd(), process.cwd().endsWith('core-node') ? '../..' : '.');
  const csv = arg('csv') ?? await downloadCsv(resolve(root, 'data/ecdict/ecdict.csv'), s => console.error(s));
  const out = resolve(root, arg('out') ?? 'data/dict.db');
  const limit = arg('limit') ? Number(arg('limit')) : undefined;
  const t0 = Date.now();
  const r = await buildDict(csv, out, { limit, log: s => console.error(s) });
  console.error(`完成：${r.words} 词条，${r.forms} 条词形，${((Date.now() - t0) / 1000).toFixed(1)} 秒 → ${out}`);
}

if (process.argv[1] && /ingest\.(ts|js)$/.test(process.argv[1])) main().catch(e => { console.error(e); process.exit(1); });
