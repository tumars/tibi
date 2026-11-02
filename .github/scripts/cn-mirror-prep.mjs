// 国内源同步的准备：node cn-mirror-prep.mjs <Release 文件目录> <输出目录> <公开地址> <tag>
// 输出 latest.json（下载地址换成国内源）、SHA256SUMS.txt、aliases.tsv（安装包的固定名字，给下载链接用）。
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dist, out, rawBase, tag] = process.argv.slice(2);
if (!dist || !out || !rawBase || !tag) throw new Error('用法：cn-mirror-prep.mjs <dist> <out> <base-url> <tag>');
const base = rawBase.replace(/\/+$/, '');
if (!base.startsWith('https://')) throw new Error('国内源必须是 https：updater 在正式版里拒绝 http');
mkdirSync(out, { recursive: true });

const latest = JSON.parse(readFileSync(join(dist, 'latest.json'), 'utf8'));
const platforms = Object.values(latest.platforms ?? {});
if (platforms.length === 0) throw new Error('latest.json 里没有任何平台');
for (const p of platforms) {
  const name = new URL(p.url).pathname.split('/').pop();
  // 宁可同步失败，也不发一份指向不存在文件的 latest.json：用户会检查到新版本却下载不了
  if (!existsSync(join(dist, decodeURIComponent(name)))) throw new Error(`Release 里没有 ${name}`);
  p.url = `${base}/${tag}/${name}`;
}
writeFileSync(join(out, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);

const files = readdirSync(dist).filter((f) => f !== 'latest.json').sort();
const sums = [];
for (const f of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(dist, f))) hash.update(chunk);
  sums.push(`${hash.digest('hex')}  ${f}`);
}
writeFileSync(join(out, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);

// 去掉文件名里的版本号：Tibi_0.1.0_aarch64.dmg → Tibi_aarch64.dmg
const version = tag.replace(/^v/, '');
const aliases = files
  .filter((f) => /\.(dmg|exe|msi|AppImage|deb|apk)$/.test(f))
  .map((f) => [f, f.replace(`_${version}`, '').replace(`-v${version}`, '')].join('\t'));
writeFileSync(join(out, 'aliases.tsv'), aliases.length ? `${aliases.join('\n')}\n` : '');
