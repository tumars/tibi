// 把 samples/*/article.md + ai.json 内嵌成 src/domain/documents/samples.gen.ts（Core 不读文件系统，R11）。
// article.md 与 ai.json 是真相源，改了之后运行：node scripts/build-samples.mjs（pnpm gen 会一起跑）
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'samples');
const GENRES = ['tech', 'news', 'lit', 'academic', 'general'];

const defs = [];
for (const id of readdirSync(dir).filter(d => statSync(join(dir, d)).isDirectory())) {
  const text = readFileSync(join(dir, id, 'article.md'), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${id}/article.md 缺少 frontmatter`);
  const meta = Object.fromEntries(m[1].split('\n').filter(l => l.trim()).map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  if (meta.id !== id) throw new Error(`${id}/article.md 的 id 与目录不一致`);
  if (!GENRES.includes(meta.genre)) throw new Error(`${id}：genre 不对`);
  const ai = JSON.parse(readFileSync(join(dir, id, 'ai.json'), 'utf8'));
  for (const k of ['summary', 'context_meanings']) if (!ai[k]) throw new Error(`${id}/ai.json 缺少 ${k}`);
  defs.push({ id, title: meta.title, author: meta.author || undefined, genre: meta.genre, source: meta.source ?? '', is_default: meta.default === 'true', order: Number(meta.order ?? 99), markdown: m[2].trim(), ai });
}
defs.sort((a, b) => a.order - b.order);
if (defs.filter(d => d.is_default).length !== 1) throw new Error('内置示例里要有且只有一篇 default: true');
const out = `// 由 scripts/build-samples.mjs 从 samples/*/ 生成，不要手改。\nimport type { SampleDef } from './samples.js';\n\nexport const SAMPLE_DEFS: SampleDef[] = ${JSON.stringify(defs, null, 2)};\n`;
writeFileSync(join(root, 'src/domain/documents/samples.gen.ts'), out);
console.log(`samples.gen.ts：${defs.map(d => d.id).join(', ')}`);
