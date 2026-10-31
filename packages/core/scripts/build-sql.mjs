// 把 sql/NNNN_name.sql 内嵌成 src/db/migrations.gen.ts，Core 不读文件系统（R11），sidecar 也能打成单文件。
// 用法：node scripts/build-sql.mjs（改了 sql/ 之后运行；pnpm gen 也会调）
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'sql');
const files = readdirSync(dir).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
const items = files.map(f => ({ version: parseInt(f.slice(0, 4), 10), name: f.slice(5, -4), sql: readFileSync(join(dir, f), 'utf8') }));
const out = `// 由 scripts/build-sql.mjs 从 sql/*.sql 生成，不要手改。\nimport type { Migration } from './migrate.js';\n\nexport const MIGRATIONS: Migration[] = ${JSON.stringify(items, null, 2)};\n`;
writeFileSync(join(root, 'src/db/migrations.gen.ts'), out);
console.log(`migrations.gen.ts：${items.map(i => `${i.version} ${i.name}`).join(', ')}`);
