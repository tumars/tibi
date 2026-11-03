// 把 skills/*/SKILL.md 内嵌成 src/kernel/skills.gen.ts（Core 不读文件系统，R11）。SKILL.md 是真相源，改了之后运行：
//   node scripts/build-skills.mjs
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'skills');
const ORDER = ['tibi', 'scout', 'tutor', 'coach', 'insight', 'archivist'];

/** 只支持 SKILL.md 用到的 YAML 子集：key: value、key: [a, b]、两空格缩进的一层嵌套 */
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('SKILL.md 缺少 frontmatter');
  const meta = {}; let current = null;
  for (const raw of m[1].split('\n')) {
    if (!raw.trim()) continue;
    const nested = /^\s{2,}/.test(raw);
    const [k, ...rest] = raw.trim().split(':');
    const v = rest.join(':').trim();
    const val = v === '' ? {} : v.startsWith('[') ? v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean) : v.replace(/^['"]|['"]$/g, '');
    if (nested && current) meta[current][k] = val; else { meta[k] = val; current = typeof val === 'object' && !Array.isArray(val) ? k : null; }
  }
  return { meta, body: m[2].trim() };
}

const defs = [];
for (const id of readdirSync(dir).filter(d => statSync(join(dir, d)).isDirectory()).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))) {
  const { meta, body } = parseFrontmatter(readFileSync(join(dir, id, 'SKILL.md'), 'utf8'));
  if (meta.name !== id) throw new Error(`${id}/SKILL.md 的 name 与目录不一致`);
  defs.push({
    id, title: meta.metadata?.title ?? id, description: meta.description ?? '', allowed_tools: meta['allowed-tools'] ?? [], deferred_tools: meta['deferred-tools'] ?? [],
    model: meta.metadata?.model === 'deep' ? 'deep' : 'fast', write: meta.metadata?.write === 'ask' ? 'ask' : 'inherit', body,
  });
}
const out = `// 由 scripts/build-skills.mjs 从 skills/*/SKILL.md 生成，不要手改。\nimport type { SkillDef } from './skills.js';\n\nexport const SKILL_DEFS: SkillDef[] = ${JSON.stringify(defs, null, 2)};\n`;
writeFileSync(join(root, 'src/kernel/skills.gen.ts'), out);
console.log(`skills.gen.ts：${defs.map(d => d.id).join(', ')}`);
