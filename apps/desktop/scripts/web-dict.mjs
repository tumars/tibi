#!/usr/bin/env node
/**
 * Web 版的精简词典（docs/design/12-web.md §4）：从完整的 dict.db（119 MB）挑出常用的部分，压成 gzip。
 * - stardict：有词频（frq / bnc）、柯林斯星级、牛津 3000、考试标签的词，加上 lemma_map 指向的原形
 * - lemma_map、word_atlas、meta 全留；WordNet 只留这些词的义项和用到的 synset
 * 输出 <out>/dict-lite-<哈希>.db.gz 和 <out>/manifest.json（Worker 据此判断要不要重新下载）；删掉旧版文件。
 *
 * 用法：node scripts/web-dict.mjs [源 dict.db] [输出目录]
 * 默认源：src-tauri/resources/dict.db，没有时用仓库根目录的 data/ecdict/dict.db；默认输出 .web-dict/（开发服务器从这里读）
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [process.argv[2], join(app, 'src-tauri/resources/dict.db'), join(app, '../../data/ecdict/dict.db')].filter(Boolean);
const src = candidates.find(p => existsSync(p) && statSync(p).size > 0);
if (!src) { console.error('找不到 dict.db，先运行 pnpm ecdict'); process.exit(1); }
const out = resolve(process.argv[3] ?? join(app, '.web-dict'));
mkdirSync(out, { recursive: true });

const tmp = join(out, 'dict-lite.tmp.db');
rmSync(tmp, { force: true });
const db = new Database(tmp);
db.exec(`ATTACH DATABASE '${src.replace(/'/g, "''")}' AS src`);
const has = name => !!db.prepare("SELECT 1 FROM src.sqlite_master WHERE type = 'table' AND name = ?").get(name);

// 表和索引按源库原样建
const schema = db.prepare("SELECT type, name, sql FROM src.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'index'").all();
for (const s of schema.filter(x => x.type === 'table')) db.exec(s.sql);

db.exec(`
  INSERT INTO main.stardict SELECT * FROM src.stardict
   WHERE frq > 0 OR bnc > 0 OR collins > 0 OR oxford = 1 OR coalesce(tag, '') <> ''
      OR lower(word) IN (SELECT lemma FROM src.lemma_map);
  INSERT INTO main.lemma_map SELECT * FROM src.lemma_map;
  INSERT INTO main.meta SELECT * FROM src.meta;
`);
if (has('word_atlas')) db.exec('INSERT INTO main.word_atlas SELECT * FROM src.word_atlas');
if (has('wn_sense')) {
  db.exec(`
    CREATE TEMP TABLE keep(word TEXT PRIMARY KEY COLLATE NOCASE);
    INSERT OR IGNORE INTO keep SELECT word FROM main.stardict;
    INSERT INTO main.wn_sense SELECT * FROM src.wn_sense WHERE word IN (SELECT word FROM keep);
    INSERT INTO main.wn_synset SELECT * FROM src.wn_synset WHERE id IN (SELECT synset FROM main.wn_sense);
  `);
}
db.prepare("INSERT OR REPLACE INTO main.meta(key, value) VALUES ('variant', 'lite')").run();
for (const s of schema.filter(x => x.type === 'index')) db.exec(s.sql);
const words = db.prepare('SELECT count(*) AS n FROM main.stardict').get().n;
db.exec('DETACH DATABASE src');
db.exec('VACUUM');
db.close();

const raw = readFileSync(tmp);
rmSync(tmp, { force: true });
const gz = gzipSync(raw, { level: 9 });
const hash = createHash('sha256').update(gz).digest('hex').slice(0, 12);
const file = `dict-lite-${hash}.db.gz`;
for (const f of readdirSync(out)) if (/^dict-lite-.*\.db\.gz$/.test(f) && f !== file) rmSync(join(out, f));
writeFileSync(join(out, file), gz);
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ file, bytes: gz.length, raw_bytes: raw.length, words }, null, 2) + '\n');
console.log(`${file}：${words} 词，${(raw.length / 1048576).toFixed(1)} MB → gzip ${(gz.length / 1048576).toFixed(1)} MB（${out}）`);
