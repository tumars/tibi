// 把 core-node 打成单文件 dist/tibi-core.js（better-sqlite3 的原生模块保持外部依赖）。
// Tauri sidecar 的可执行文件由 scripts/sidecar.mjs 再用 Bun --compile / Node SEA 封装。
import { build } from 'esbuild';

await build({
  entryPoints: ['src/bin.ts'],
  outfile: 'dist/tibi-core.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: "import { createRequire as __tibiCreateRequire } from 'node:module'; const require = __tibiCreateRequire(import.meta.url);" },
  external: ['better-sqlite3', 'bun:sqlite'],
  sourcemap: true,
  logLevel: 'info',
});

// OCR 的 worker（tesseract.js 在 worker_threads 里跑）：单独打成一个 CJS 文件，和 sidecar 放在一起（见 src/ocr.ts workerPath）
await build({
  entryPoints: [new URL('./node_modules/tesseract.js/src/worker-script/node/index.js', import.meta.url).pathname],
  outfile: 'dist/tesseract-worker.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  loader: { '.wasm': 'binary' },
  logLevel: 'info',
});

// tesseract.js-core 的 wasm 从 worker 所在目录读，一起拷过去（pnpm 的包在 node_modules/.pnpm 里，按版本目录找）
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join as __join } from 'node:path';
const pnpmDir = new URL('../../node_modules/.pnpm/', import.meta.url).pathname;
const coreVer = existsSync(pnpmDir) ? readdirSync(pnpmDir).filter(d => d.startsWith('tesseract.js-core@')).sort().pop() : undefined;
const coreDir = coreVer ? __join(pnpmDir, coreVer, 'node_modules', 'tesseract.js-core') : new URL('./node_modules/tesseract.js-core/', import.meta.url).pathname;
for (const f of readdirSync(coreDir).filter(f => f.endsWith('.wasm'))) copyFileSync(__join(coreDir, f), __join('dist', f));
console.log('dist/*.wasm（tesseract.js-core）');
