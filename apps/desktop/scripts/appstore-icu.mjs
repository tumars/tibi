// 商店版 Bun 不能链接 Apple 未公开的 libicucore；随包提供上游 ICU 实现。
// 在 tauri build 之后、最终签名之前运行：node scripts/appstore-icu.mjs <Tibi.app>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';

const version = '78.3';
const sha256 = '3a2e7a47604ba702f345878308e6fefeca612ee895cf4a5f222e7955fabfe0c0';
const app = process.argv[2] && resolve(process.argv[2]);
if (process.platform !== 'darwin' || process.arch !== 'arm64' || !app?.endsWith('.app')) {
  throw new Error('用法（Apple Silicon macOS）：node scripts/appstore-icu.mjs <Tibi.app>');
}
const core = join(app, 'Contents/MacOS/tibi-core');
if (!existsSync(core)) throw new Error(`缺少 ${core}`);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri/target', `appstore-icu-${version}`);
const source = join(root, 'icu/source');
const build = join(root, 'build');
const output = join(root, 'libTibiICU.dylib');
const libraryPath = '@executable_path/../Frameworks/libTibiICU.dylib';
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...options });
const read = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });
mkdirSync(root, { recursive: true });
if (!existsSync(output)) {
  const archive = join(root, 'icu.tgz');
  if (!existsSync(archive)) {
    const tmpArchive = archive + '.tmp';
    rmSync(tmpArchive, { force: true });
    try {
      run('curl', ['--fail', '--location', '--connect-timeout', '20', '--max-time', '300', '--retry', '3', '-o', tmpArchive,
        `https://github.com/unicode-org/icu/releases/download/release-${version}/icu4c-${version}-sources.tgz`]);
      if (createHash('sha256').update(readFileSync(tmpArchive)).digest('hex') !== sha256) {
        throw new Error('ICU 源码 SHA-256 不匹配');
      }
      renameSync(tmpArchive, archive);
    } finally {
      rmSync(tmpArchive, { force: true });
    }
  } else if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== sha256) {
    rmSync(archive, { force: true });
    throw new Error('缓存的 ICU 源码 SHA-256 不匹配，已清理，请重试');
  }
  if (!existsSync(source)) run('tar', ['-xzf', archive, '-C', root]);
  mkdirSync(build, { recursive: true });
  const env = { ...process.env, MACOSX_DEPLOYMENT_TARGET: '13.0',
    CC: 'clang', CXX: 'clang++', CFLAGS: '-O2 -fPIC -mmacosx-version-min=13.0',
    CXXFLAGS: '-O2 -fPIC -mmacosx-version-min=13.0' };
  // Bun 使用不带版本后缀的 ICU C ABI；所有实现和数据都链接进同一个自有 dylib。
  run(join(source, 'configure'), ['--disable-shared', '--enable-static', '--disable-renaming',
    '--with-data-packaging=static', '--disable-tests', '--disable-samples', '--disable-extras',
    '--disable-icuio'], { cwd: build, env });
  run('make', [`-j${Math.min(availableParallelism(), 8)}`], { cwd: build, env });
  run('clang++', ['-dynamiclib', '-mmacosx-version-min=13.0', '-Wl,-all_load',
    join(build, 'lib/libicui18n.a'), join(build, 'lib/libicuuc.a'), join(build, 'lib/libicudata.a'),
    '-Wl,-install_name,' + libraryPath, '-Wl,-compatibility_version,1', '-Wl,-current_version,' + version,
    '-o', output]);
}
const frameworks = join(app, 'Contents/Frameworks');
mkdirSync(frameworks, { recursive: true });
copyFileSync(output, join(frameworks, 'libTibiICU.dylib'));
copyFileSync(join(root, 'icu/LICENSE'), join(app, 'Contents/Resources/ICU-LICENSE.txt'));
run('install_name_tool', ['-change', '/usr/lib/libicucore.A.dylib', libraryPath, core]);
for (const binary of [core, join(frameworks, 'libTibiICU.dylib')]) {
  const dependencies = read('otool', ['-L', binary]);
  if (dependencies.includes('/usr/lib/libicucore') || dependencies.includes('/opt/homebrew/')) {
    throw new Error(`商店包仍依赖系统 ICU 或开发机库：${binary}`);
  }
}
if (!read('otool', ['-L', core]).includes(libraryPath)) throw new Error('Core 未链接包内 ICU');
const imports = [...read('nm', ['-m', '-u', core]).matchAll(/external (\S+) \(from libTibiICU\)/g)].map(m => m[1]);
const exports = new Set(read('nm', ['-gU', output]).split('\n').map(line => line.trim().split(/\s+/).at(-1)));
if (!imports.length || imports.some(name => !exports.has(name))) {
  throw new Error(`包内 ICU 未实现全部 Core 导入：${imports.filter(name => !exports.has(name)).join(', ')}`);
}
console.log(`已核对 ${imports.length} 个 ICU 导入，全部由包内库实现。`);
console.log('商店版 ICU 已打包；请重新签名 dylib、Core 和 App 后再生成 pkg。');
