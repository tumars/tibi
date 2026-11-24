// 把 Core 打成 Tauri sidecar 单文件（T11）：esbuild 先打 dist/tibi-core.js，再 bun build --compile。
// 用法：node scripts/sidecar.mjs [--target <rust triple>] [--out <dir>]
//   默认 target = 本机；out = ../../apps/desktop/src-tauri/binaries；文件名 tibi-core-<triple>[.exe]（Tauri externalBin 的约定）
import { execSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkHostBun, smokeTestSidecar } from './sidecar-verify.mjs';

const TRIPLES = {
  'x86_64-unknown-linux-gnu': 'bun-linux-x64',
  'aarch64-unknown-linux-gnu': 'bun-linux-arm64',
  'aarch64-apple-darwin': 'bun-darwin-arm64',
  'x86_64-apple-darwin': 'bun-darwin-x64',
  'x86_64-pc-windows-msvc': 'bun-windows-x64',
};
const hostTriple = () => {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  return process.platform === 'darwin' ? `${arch}-apple-darwin` : process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : `${arch}-unknown-linux-gnu`;
};
const arg = n => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const triple = arg('target') ?? hostTriple();
const bunTarget = TRIPLES[triple];
if (!bunTarget) { console.error(`不支持的 target：${triple}`); process.exit(1); }

const { version: bunVersion, bunPath } = checkHostBun();
console.log(`bun ${bunVersion}${bunPath ? ` (${bunPath})` : ''}`);

const outDir = resolve(arg('out') ?? '../../apps/desktop/src-tauri/binaries');
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, `tibi-core-${triple}${triple.includes('windows') ? '.exe' : ''}`);

execSync('node build.mjs', { stdio: 'inherit' });
execSync(`bun build --compile --target=${bunTarget} --minify dist/tibi-core.js --outfile "${outfile}"`, { stdio: 'inherit' });
// macOS 上 bun --compile 写入 __BUN 段会使原 ad-hoc 签名失效；补一次 ad-hoc 签名，保证本地运行与冒烟测试不被系统 SIGKILL。
// 正式发布时 Developer ID / App Store 签名会覆盖这里的临时签名。
if (process.platform === 'darwin' && triple.includes('apple-darwin')) {
  const sign = spawnSync('codesign', ['--force', '--sign', '-', outfile], { stdio: 'inherit' });
  if (sign.status !== 0) throw new Error(`补签 sidecar ad-hoc 签名失败（exit ${sign.status}）`);
}
if (triple === hostTriple()) {
  await smokeTestSidecar(outfile);
  console.log(`sidecar 冒烟通过 → ${outfile}`);
} else {
  console.log(`sidecar → ${outfile}（跨平台目标，跳过本机冒烟）`);
}
// OCR：tesseract 的 worker 和 wasm 放进 binaries/ocr/，tauri.conf 的 bundle.resources 把它带进安装包（壳用 TIBI_RESOURCE_DIR 告诉 Core）
const ocrDir = join(outDir, 'ocr'); mkdirSync(ocrDir, { recursive: true });
for (const f of readdirSync('dist').filter(f => f === 'tesseract-worker.cjs' || f.endsWith('.wasm'))) copyFileSync(join('dist', f), join(ocrDir, f));
console.log(`ocr → ${ocrDir}`);
