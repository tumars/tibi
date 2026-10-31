// 开发用 sidecar 占位：Tauri 构建要求 binaries/tibi-core-<triple> 存在。
// 这里生成一个壳脚本，转去运行 node ../../packages/core-node/dist/tibi-core.js（先 pnpm --filter @tibi/core-node build）。
// 正式发布时用 Bun --compile / Node SEA 产出真正的二进制覆盖它。
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const triple = execSync('rustc -vV').toString().match(/host: (\S+)/)?.[1];
if (!triple) throw new Error('rustc -vV 里没有 host');
const dir = join(here, '../src-tauri/binaries');
mkdirSync(dir, { recursive: true });
const script = join(here, '../../../packages/core-node/dist/tibi-core.js');
if (process.platform === 'win32') {
  const p = join(dir, `tibi-core-${triple}.exe`);
  // Windows 上没有可执行脚本的概念：写一个说明，提示用真正的二进制
  writeFileSync(p + '.txt', `Windows 开发请用 scripts/sidecar.mjs 产出 ${p}\n`);
  console.log('Windows：请用 Bun --compile 产出 sidecar');
} else {
  const p = join(dir, `tibi-core-${triple}`);
  writeFileSync(p, `#!/bin/sh\nexec node "${script}" "$@"\n`);
  chmodSync(p, 0o755);
  console.log('写入', p);
}
