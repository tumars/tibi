import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tibi-distribution-test-')); dirs.push(dir);
  const manifest = { version: '0.2.0', platforms: { 'darwin-aarch64': { signature: 'original-signature', url: 'https://github.com/tumars/tibi/releases/download/v0.2.0/Tibi_0.2.0_aarch64.app.tar.gz' } } };
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'Tibi_0.2.0_aarch64.app.tar.gz'), 'signed-update');
  writeFileSync(join(dir, 'Tibi_0.2.0_aarch64.dmg'), 'installer');
  writeFileSync(join(dir, 'SHA256SUMS.txt'), 'old-checksums');
  return { dir, manifest };
}

// 运行真实发布工具，仅替换 AWS CLI 和公开网络；不接触任何云账号。
function publish(dir: string, extra: Record<string, string | undefined> = {}) {
  // CLI 与网络桩放在另一个目录，避免被当成待上传产物。
  const mocks = mkdtempSync(join(tmpdir(), 'tibi-cos-mocks-')); dirs.push(mocks);
  const log = join(mocks, 'calls.jsonl');
  const aws = join(mocks, 'aws');
  writeFileSync(aws, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify({ aws: args }) + '\\n');
const cp = args.indexOf('cp');
if (process.env.UPLOAD_FAIL && args.includes('--recursive')) process.exit(1);
if (cp >= 0 && args[cp + 2] === 's3://test-bucket/latest.json') fs.copyFileSync(args[cp + 1], process.env.PUBLIC_MANIFEST);
if (cp >= 0 && args[cp + 2] === 's3://test-bucket/latest/SHA256SUMS.txt') fs.copyFileSync(args[cp + 1], process.env.PUBLIC_SUMS);
`);
  chmodSync(aws, 0o755);
  const preload = join(mocks, 'fetch.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
globalThis.fetch = async (url, opts) => {
  fs.appendFileSync(process.env.CALLS, JSON.stringify({ url, method: opts.method || 'GET' }) + '\\n');
  return { ok: !process.env.PUBLIC_MISSING, status: process.env.PUBLIC_MISSING ? 404 : 200, text: async () => fs.readFileSync(process.env.PUBLIC_MANIFEST, 'utf8') };
};
`);
  const manifest = join(mocks, 'public.json');
  const sums = join(mocks, 'sums.txt');
  const result = spawnSync(process.execPath, ['--import', preload, 'tools/publish-cos.mjs', 'release', dir, 'v0.2.0'], {
    cwd: root, encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, PATH: `${mocks}:${process.env.PATH}`, BUCKET: 'test-bucket', S3_ENDPOINT: 'https://cos.example.com', BASE_URL: 'https://dl.ferecord.com', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_DEFAULT_REGION: 'test-region', TIBI_SKIP_BUNDLE_VERIFY: '1', CALLS: log, PUBLIC_MANIFEST: manifest, PUBLIC_SUMS: sums, ...extra },
  });
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { aws?: string[]; url?: string; method?: string });
  return { result, calls, manifest, sums };
}
const updatesPointer = (call: { aws?: string[] }) => call.aws?.includes('s3://test-bucket/latest.json');

describe('腾讯云分发', () => {
  it('更新地址全部改到 COS，保留原签名，公开包可读后最后发布更新信息', () => {
    const { dir, manifest: original } = fixture();
    const { result, calls, manifest, sums } = publish(dir);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(manifest, 'utf8'))).toEqual({ ...original, platforms: { 'darwin-aarch64': { signature: 'original-signature', url: 'https://dl.ferecord.com/v0.2.0/Tibi_0.2.0_aarch64.app.tar.gz' } } });
    expect(readFileSync(sums, 'utf8')).toBe(`${createHash('sha256').update('installer').digest('hex')}  Tibi_aarch64.dmg\n`);
    const pointer = calls.findIndex(updatesPointer);
    const checks = calls.flatMap((c, i) => c.method === 'HEAD' ? [i] : []);
    expect(checks).toHaveLength(2);
    expect(checks.every(i => i < pointer)).toBe(true);
    expect(calls.at(-1)?.url).toBe('https://dl.ferecord.com/latest.json');
  });

  it('版本号不匹配时不上传任何文件', () => {
    const { dir, manifest } = fixture();
    writeFileSync(join(dir, 'latest.json'), JSON.stringify({ ...manifest, version: '0.3.0' }));
    const { result, calls } = publish(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('version 和 tag 不一致');
    expect(calls.some(c => c.aws?.includes('cp'))).toBe(false);
  });

  it.each([{ UPLOAD_FAIL: '1' }, { PUBLIC_MISSING: '1' }])('上传或公开访问失败时不切换更新信息：%j', extra => {
    const { dir } = fixture();
    const { result, calls } = publish(dir, extra);
    expect(result.status).not.toBe(0);
    expect(calls.some(updatesPointer)).toBe(false);
  });

  it.skipIf(process.platform !== 'darwin')('macOS 更新包校验失败时在上传前拦截', () => {
    const { dir } = fixture();
    const { result, calls } = publish(dir, { TIBI_SKIP_BUNDLE_VERIFY: '0' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('解压');
    expect(calls.some(c => c.aws?.includes('cp'))).toBe(false);
  });
});
