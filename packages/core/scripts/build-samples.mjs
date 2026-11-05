// 把 samples/*/article.md + ai.json 内嵌成 src/domain/documents/samples.gen.ts（Core 不读文件系统，R11）。
// 正文和 AI 结果每篇单独一个 samples/<id>.gen.ts，用到时才 import（整本书有上百万字符，手机上 Core 跑在 WebView 里，不该随启动加载）。
// article.md 与 ai.json 是真相源，改了之后运行：node scripts/build-samples.mjs（pnpm gen 会一起跑）
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'samples');
const GENRES = ['tech', 'news', 'lit', 'academic', 'general'];
const KINDS = ['article', 'book'];

const defs = [];
for (const id of readdirSync(dir).filter(d => statSync(join(dir, d)).isDirectory())) {
  const text = readFileSync(join(dir, id, 'article.md'), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${id}/article.md 缺少 frontmatter`);
  const meta = Object.fromEntries(m[1].split('\n').filter(l => l.trim()).map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  if (meta.id !== id) throw new Error(`${id}/article.md 的 id 与目录不一致`);
  if (!GENRES.includes(meta.genre)) throw new Error(`${id}：genre 不对`);
  const kind = meta.kind || 'article';
  if (!KINDS.includes(kind)) throw new Error(`${id}：kind 不对`);
  const ai = JSON.parse(readFileSync(join(dir, id, 'ai.json'), 'utf8'));
  for (const k of ['summary', 'context_meanings']) if (!ai[k]) throw new Error(`${id}/ai.json 缺少 ${k}`);
  const markdown = m[2].trim();
  // 与 Core 的 countWords 同一个口径（列表里显示的分钟数用）
  const words = (markdown.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length;
  // 书：按一级标题数章（与切分一致）
  const chapters = kind === 'book' ? (markdown.match(/^# /gm) ?? []).length : undefined;
  defs.push({ meta: { id, title: meta.title, author: meta.author || undefined, genre: meta.genre, kind, source: meta.source ?? '', is_default: meta.default === 'true', order: Number(meta.order ?? 99), words, chapters }, body: { markdown, ai } });
}
defs.sort((a, b) => a.meta.order - b.meta.order);
if (defs.filter(d => d.meta.is_default).length !== 1) throw new Error('内置示例里要有且只有一篇 default: true');
const HEAD = '// 由 scripts/build-samples.mjs 从 samples/*/ 生成，不要手改。\n';
const genDir = join(root, 'src/domain/documents/samples');
rmSync(genDir, { recursive: true, force: true }); mkdirSync(genDir);
for (const d of defs) writeFileSync(join(genDir, `${d.meta.id}.gen.ts`), `${HEAD}import type { SampleBody } from '../samples.js';\n\nconst body: SampleBody = ${JSON.stringify(d.body, null, 2)};\nexport default body;\n`);
const entries = defs.map(d => `  ${JSON.stringify(d.meta).slice(0, -1)}, load: () => import('./samples/${d.meta.id}.gen.js').then(m => m.default) },`).join('\n');
writeFileSync(join(root, 'src/domain/documents/samples.gen.ts'), `${HEAD}import type { SampleDef } from './samples.js';\n\nexport const SAMPLE_DEFS: SampleDef[] = [\n${entries}\n];\n`);
console.log(`samples.gen.ts：${defs.map(d => d.meta.id).join(', ')}`);
