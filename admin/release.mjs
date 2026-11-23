import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { olderThan } from '../apps/desktop/src/lib/notice-schema.ts';

const ARTIFACT = /\.(dmg|exe|msi|AppImage|deb|apk|zip|tar\.gz)(\.sig)?$/i;
const VERSION = /^\d+\.\d+\.\d+$/;
export async function digest(file, algorithm = 'sha256') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest();
}

async function verifyUpdate(file, encodedSignature, encodedKey) {
  const keyLines = Buffer.from(encodedKey, 'base64').toString().trim().split(/\r?\n/);
  const pk = Buffer.from(keyLines.at(-1), 'base64');
  const lines = Buffer.from(encodedSignature, 'base64').toString().trim().split(/\r?\n/);
  const signature = Buffer.from(lines[1] || '', 'base64');
  if (pk.length !== 42 || signature.length !== 74 || !pk.subarray(2, 10).equals(signature.subarray(2, 10))) {
    throw new Error(basename(file) + ' 更新签名或公钥不匹配');
  }
  const algorithm = signature.subarray(0, 2).toString();
  if (algorithm !== 'Ed' && algorithm !== 'ED') throw new Error('不支持的更新签名格式');
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pk.subarray(10)]),
    type: 'spki', format: 'der' });
  const message = algorithm === 'ED' ? await digest(file, 'blake2b512') : await readFile(file);
  if (!verify(null, message, key, signature.subarray(10))) throw new Error(basename(file) + ' 更新包验签失败');
  if (!lines[2]?.startsWith('trusted comment: ') || !verify(null,
    Buffer.concat([signature.subarray(10), Buffer.from(lines[2].slice('trusted comment: '.length))]),
    key, Buffer.from(lines[3] || '', 'base64'))) throw new Error(basename(file) + ' 签名附注验签失败');
}

export async function inspectRelease(directory, publicKey) {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('请填写本机发行目录');
  const dir = await realpath(resolve(directory));
  if (!(await stat(dir)).isDirectory()) throw new Error('发行路径不是目录');
  const raw = await readFile(join(dir, 'latest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  if (!VERSION.test(manifest.version || '')) throw new Error('latest.json 缺少正式版本号');
  const platforms = Object.entries(manifest.platforms || {});
  if (!platforms.length) throw new Error('更新清单没有平台');
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries.filter(e => e.isFile() && ARTIFACT.test(e.name)).map(e => e.name).sort();
  const updates = [];
  for (const [platform, data] of platforms) {
    if (!/^(darwin|windows|linux)-(aarch64|x86_64|i686)$/.test(platform)) throw new Error('未知更新平台：' + platform);
    const name = decodeURIComponent(new URL(data.url).pathname.split('/').pop());
    if (basename(name) !== name || !names.includes(name)) throw new Error('找不到更新包：' + name);
    if (typeof data.signature !== 'string') throw new Error(name + ' 缺少更新签名');
    await verifyUpdate(join(dir, name), data.signature, publicKey);
    updates.push({ platform, file: name, verified: true });
  }
  const installers = names.filter(name => /\.(dmg|exe|msi|AppImage|deb|apk)$/i.test(name));
  if (!installers.length) throw new Error('目录中没有安装包');
  for (const name of [...installers, ...updates.map(u => u.file)]) {
    if (!name.includes(manifest.version)) throw new Error('文件名未包含版本号：' + name);
  }
  const files = [];
  for (const name of ['latest.json', ...names]) {
    const file = join(dir, name);
    const size = (await stat(file)).size;
    if (!size) throw new Error('发行文件为空：' + name);
    files.push({ name, size, sha256: (await digest(file)).toString('hex') });
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return { directory: dir, version: manifest.version, tag: 'v' + manifest.version, notes: manifest.notes || '',
    platforms: updates, files, fingerprint };
}

export function requireNewVersion(version, current) {
  if (current && !olderThan(current, version)) throw new Error('只能发布高于线上 ' + current + ' 的新版本');
}
