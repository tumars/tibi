// 出安装包前的准备（M6，CI 和本地都用这一份）：
//   1. sidecar：scripts/sidecar.mjs 按 target 打出 binaries/tibi-core-<triple>[.exe] 和 binaries/ocr/
//   2. 词典：没有 data/ecdict/dict.db 就跑 pnpm ecdict 生成，拷到 src-tauri/resources/dict.db
// 之后 tauri build --config src-tauri/tauri.bundle.conf.json 把词典也带进安装包（主配置里不写，免得开发时没有词典就编不过）。
// 用法：node scripts/bundle-prep.mjs [--target <rust triple>] [--skip-dict] [--skip-sidecar]
//   手机（M7）只要词典：--skip-sidecar
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const target = arg('target');
const run = (cmd, cwd = root) => { console.log(`$ ${cmd}`); execSync(cmd, { stdio: 'inherit', cwd }); };

if (!process.argv.includes('--skip-sidecar')) run(`node scripts/sidecar.mjs${target ? ` --target ${target}` : ''}`, join(root, 'packages/core-node'));

if (!process.argv.includes('--skip-dict')) {
  const dict = join(root, 'data/ecdict/dict.db');
  if (!existsSync(dict)) run('pnpm ecdict');
  const dest = join(here, '../src-tauri/resources/dict.db');
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(dict, dest);
  console.log(`dict → ${dest}（${(statSync(dest).size / 1e6).toFixed(1)} MB）`);
}
