// 从 public/logo.svg 生成各平台的应用图标（src-tauri/icons、gen/android，gen/apple 存在时也写）。
// gen/apple 不提交：tauri ios init 之后要再跑一次，否则 iOS 是 Tauri 默认图标。
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const logo = readFileSync(join(root, 'public/logo.svg'), 'utf8');
const inner = logo.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const bgRect = inner.match(/<rect[^>]*\/>/)?.[0];
const color = bgRect?.match(/fill="(#[0-9a-f]+)"/i)?.[1];
if (!color) throw new Error('logo.svg 第一个元素应是带底色的 rect');
const fox = inner.replace(bgRect, '');

const svg = (viewBox, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="1024" height="1024">${body}</svg>`;
const tmp = mkdtempSync(join(tmpdir(), 'tibi-icons-'));
const write = (name, content) => writeFileSync(join(tmp, name), content);

// 桌面：圆角方块占画布 824/1024，四周留透明边（macOS 图标网格），否则在 Dock 里比别的应用大一圈
write('desktop.svg', svg('0 0 1024 1024', `<g transform="translate(100 100) scale(12.875)">${inner}</g>`));
// Android：系统自己裁形状，用自适应图标的前景 + 背景两层
write('android-fg.svg', svg('0 0 64 64', fox));
write('android-bg.svg', svg('0 0 64 64', `<rect width="64" height="64" fill="${color}"/>`));
write('manifest.json', JSON.stringify({
  default: 'desktop.svg',
  android_fg: 'android-fg.svg',
  android_bg: 'android-bg.svg',
}));
// iOS：系统也自己裁圆角，不留边，由 bg_color 垫成满版
write('ios.svg', svg('0 0 64 64', inner));
write('ios.json', JSON.stringify({ default: 'ios.svg', bg_color: color }));

const icon = (...args) => execFileSync('pnpm', ['tauri', 'icon', ...args], { cwd: root, stdio: 'inherit' });

try {
  icon(join(tmp, 'manifest.json'));
  // 不打 Windows 商店包，这些用不上
  const icons = join(root, 'src-tauri/icons');
  for (const f of readdirSync(icons)) {
    if (/^(Square\d+x\d+Logo|StoreLogo|64x64)\.png$/.test(f)) rmSync(join(icons, f));
  }

  const appicon = join(root, 'src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset');
  if (existsSync(appicon)) {
    // 指定输出目录时 tauri icon 把 iOS 图标写到 <输出>/ios，不碰 gen/
    icon(join(tmp, 'ios.json'), '-o', join(tmp, 'out'));
    for (const f of readdirSync(join(tmp, 'out/ios'))) {
      const jpg = join(tmp, 'flat.jpg');
      // App Store 不收带透明通道的图标，tauri icon 垫了底色也还留着通道；转一次 JPEG 去掉（iOS 只在 Mac 上打包，sips 一定有）
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '100', join(tmp, 'out/ios', f), '--out', jpg], { stdio: 'ignore' });
      execFileSync('sips', ['-s', 'format', 'png', jpg, '--out', join(appicon, f)], { stdio: 'ignore' });
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
