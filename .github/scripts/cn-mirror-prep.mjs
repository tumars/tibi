// 腾讯云分发的准备：输入可以是本机的签名产物，也可以是 CI 的 Release 文件。
// 输出 latest.json、版本目录与固定下载名各自的校验和、aliases.tsv。
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dist, out, rawBase, tag] = process.argv.slice(2);
if (!dist || !out || !rawBase || !tag) throw new Error('用法：cn-mirror-prep.mjs <dist> <out> <base-url> <tag>');
if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('tag 要是 v0.1.0 这样的正式版本号');
const base = rawBase.replace(/\/+$/, '');
if (new URL(base).protocol !== 'https:') throw new Error('分发源必须是 https：updater 在正式版里拒绝 http');
mkdirSync(out, { recursive: true });

const latest = JSON.parse(readFileSync(join(dist, 'latest.json'), 'utf8'));
if (latest.version !== tag.slice(1)) throw new Error('latest.json 的 version 和 tag 不一致');
const platforms = Object.values(latest.platforms ?? {});
if (platforms.length === 0) throw new Error('latest.json 里没有任何平台');
for (const p of platforms) {
  const name = new URL(p.url).pathname.split('/').pop();
  const file = decodeURIComponent(name);
  if (!file || /[\/\\]/.test(file) || file === '.' || file === '..') throw new Error('更新包文件名不合法');
  if (typeof p.signature !== 'string' || !p.signature.trim()) throw new Error(`${file} 缺少更新签名`);
  // 宁可同步失败，也不发一份指向不存在文件的 latest.json：用户会检查到新版本却下载不了
  if (!existsSync(join(dist, file))) throw new Error(`产物目录里没有 ${file}`);
  p.url = `${base}/${tag}/${name}`;
}
writeFileSync(join(out, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);

const files = readdirSync(dist).filter((f) => f !== 'latest.json' && f !== 'SHA256SUMS.txt').sort();
const sums = [];
const hashes = new Map();
for (const f of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(dist, f))) hash.update(chunk);
  const digest = hash.digest('hex');
  hashes.set(f, digest);
  sums.push(`${digest}  ${f}`);
}
writeFileSync(join(out, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);

// 去掉文件名里的版本号：Tibi_0.1.0_aarch64.dmg → Tibi_aarch64.dmg
const version = tag.replace(/^v/, '');
const aliases = files
  .filter((f) => /\.(dmg|exe|msi|AppImage|deb|apk)$/.test(f))
  .map((f) => [f, f.replace(`_${version}`, '').replace(`-v${version}`, '')]);
writeFileSync(join(out, 'aliases.tsv'), aliases.map(pair => pair.join('\t')).join('\n') + (aliases.length ? '\n' : ''));
// latest/ 里是去掉版本号的名字，校验和也必须用同一组名字，才能直接 sha256sum -c。
writeFileSync(join(out, 'SHA256SUMS-latest.txt'), aliases.map(([file, alias]) => `${hashes.get(file)}  ${alias}\n`).join(''));
