// 本机或 CI 直接发布到腾讯云，不调用 GitHub API。配置与操作见 docs/dev/tencent-distribution.md。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AWS_S3_CONFIG_INI, buildAwsEnv, validateCosConfig } from '../admin/cos.mjs';
import { parseNotices } from '../apps/desktop/src/lib/notice-schema.ts';
import { verifyMacAppArchive } from '../packages/core-node/scripts/sidecar-verify.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// 本机使用 Tibi 自己的凭据；CI 已注入的环境变量优先，不读取其他项目配置。
const localConfig = join(root, '.env.cos');
if (existsSync(localConfig)) process.loadEnvFile(localConfig);
const [mode, dist, tag] = process.argv.slice(2);
if ((mode !== 'release' && mode !== 'notice') || (mode === 'release' && (!dist || !tag))) {
  throw new Error('用法：node tools/publish-cos.mjs release <产物目录> <v版本号> | notice');
}
const { bucket: bucketName, endpoint, base } = validateCosConfig(process.env, '见 docs/dev/tencent-distribution.md');
const bucket = `s3://${bucketName}`;
const out = mkdtempSync(join(tmpdir(), 'tibi-cos-'));
// 只配置这个进程，避免修改开发机的全局 AWS 配置。小分片、单并发减少跨境上传停滞。
const config = join(out, 'aws-config');
writeFileSync(config, AWS_S3_CONFIG_INI);
const env = buildAwsEnv(process.env, config);
const aliasContentType = name =>
  name.endsWith('.dmg') ? 'application/x-apple-diskimage' :
  name.endsWith('.exe') ? 'application/vnd.microsoft.portable-executable' :
  name.endsWith('.tar.gz') || name.endsWith('.tgz') ? 'application/gzip' :
  name.endsWith('.zip') ? 'application/zip' :
  'application/octet-stream';
function run(command, args) {
  const r = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${command} 执行失败（${r.status}），未继续发布`);
}
const s3 = (...args) => run('aws', ['s3', '--endpoint-url', endpoint, ...args, '--no-progress']);
async function readPublic(path, method = 'GET') {
  const r = await fetch(`${base}/${path}`, { method, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`公开地址 ${path} 返回 ${r.status}`);
  return r;
}
try {
  run('aws', ['--version']);
  if (mode === 'notice') {
    // 管理台发布保存后的快照，避免上传过程中本机草稿被编辑。
    const notice = dist || join(root, 'notice.json');
    if (resolve(notice) === resolve(root, 'notice.json')) {
      // 发布仓库内公告时，顺带用客户端现有测试校验所有字段。
      run('pnpm', ['exec', 'vitest', 'run', 'apps/desktop/test/notice.test.ts']);
    }
    parseNotices(JSON.parse(readFileSync(notice, 'utf8')));
    s3('cp', notice, `${bucket}/notice.json`, '--cache-control', 'no-cache', '--content-type', 'application/json');
    if (await (await readPublic('notice.json')).text() !== readFileSync(notice, 'utf8')) throw new Error('线上 notice.json 与本地不一致');
  } else {
    run(process.execPath, [join(root, '.github/scripts/cn-mirror-prep.mjs'), dist, out, base, tag]);
    const manifest = readFileSync(join(out, 'latest.json'), 'utf8');
    const parsedManifest = JSON.parse(manifest);
    // 上传前在 macOS 上校验签名并真正启动 tibi-core 冒烟测试，避免把坏包推到线上。
    if (process.platform === 'darwin' && process.env.TIBI_SKIP_BUNDLE_VERIFY !== '1') {
      for (const [platformKey, p] of Object.entries(parsedManifest.platforms ?? {})) {
        if (!platformKey.startsWith('darwin-')) continue;
        const file = decodeURIComponent(new URL(p.url).pathname.split('/').pop());
        if (!file.endsWith('.tar.gz')) continue;
        await verifyMacAppArchive(join(dist, file), { platformKey });
      }
    }
    s3('cp', dist, `${bucket}/${tag}/`, '--recursive', '--exclude', 'latest.json', '--exclude', 'SHA256SUMS.txt');
    s3('cp', join(out, 'SHA256SUMS.txt'), `${bucket}/${tag}/SHA256SUMS.txt`);
    const aliases = readFileSync(join(out, 'aliases.tsv'), 'utf8').trim();
    for (const line of aliases ? aliases.split('\n') : []) {
      const [file, alias] = line.split('\t');
      s3('cp', `${bucket}/${tag}/${file}`, `${bucket}/latest/${alias}`, '--cache-control', 'no-cache', '--metadata-directive', 'REPLACE', '--content-type', aliasContentType(alias));
    }
    s3('cp', join(out, 'SHA256SUMS-latest.txt'), `${bucket}/latest/SHA256SUMS.txt`, '--cache-control', 'no-cache');
    // 安装包和更新包都能公开读取后，最后切换更新指针；失败时旧版本仍可用。
    for (const p of Object.values(parsedManifest.platforms)) {
      const path = new URL(p.url).pathname.split('/').slice(-2).join('/');
      await readPublic(path, 'HEAD');
    }
    for (const line of aliases ? aliases.split('\n') : []) await readPublic(`latest/${encodeURIComponent(line.split('\t')[1])}`, 'HEAD');
    s3('cp', join(out, 'latest.json'), `${bucket}/latest.json`, '--cache-control', 'no-cache', '--content-type', 'application/json');
    if (await (await readPublic('latest.json')).text() !== manifest) throw new Error('线上 latest.json 与本地不一致');
  }
  console.log(`已发布并验证：${base}（${mode}）`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
