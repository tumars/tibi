// 界面文案检查（T25）：从 src 里收集所有 tl('…') 的中文键，对照 src/locales/en.json。
//   node scripts/i18n-check.mjs          列出没翻译的、用不到的；有没翻译的就以 1 退出（CI 用）
//   node scripts/i18n-check.mjs --write  把缺的键补成 ""、删掉用不到的，按源码里出现的顺序重排
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '../src');
const enPath = join(src, 'locales/en.json');
const keys = [];
const walk = d => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) collect(readFileSync(p, 'utf8')); } };
const collect = text => { for (const m of text.matchAll(/\btl\('((?:[^'\\]|\\.)*)'/g)) { const k = m[1].replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c)); if (!keys.includes(k)) keys.push(k); } };
walk(src);
const en = JSON.parse(readFileSync(enPath, 'utf8'));
const missing = keys.filter(k => !en[k]);
const unused = Object.keys(en).filter(k => !keys.includes(k));
if (process.argv.includes('--write')) {
  const out = {}; for (const k of keys) out[k] = en[k] ?? '';
  writeFileSync(enPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`en.json：${keys.length} 条，缺 ${missing.length}，删掉 ${unused.length}`);
} else {
  for (const k of missing) console.log(`缺：${k}`);
  for (const k of unused) console.log(`多余：${k}`);
  console.log(`共 ${keys.length} 条，缺 ${missing.length}，多余 ${unused.length}`);
  if (missing.length) process.exit(1);
}
