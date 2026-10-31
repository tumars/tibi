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
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  external: ['better-sqlite3'],
  sourcemap: true,
  logLevel: 'info',
});
