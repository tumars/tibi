import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function run(command, args, { env = process.env, cwd, emit = () => {}, timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('操作超时')); }, timeout);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-8_000_000); emit(String(chunk)); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16_000); emit(String(chunk)); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || command + ' 执行失败（' + code + '）'));
    });
  });
}

export async function createCloud(config = process.env) {
  for (const key of ['BUCKET', 'S3_ENDPOINT', 'AWS_DEFAULT_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) {
    if (!config[key]) throw new Error('缺少 ' + key + '，请配置本项目 .env.cos');
  }
  const dir = await mkdtemp(join(tmpdir(), 'tibi-admin-aws-'));
  const awsConfig = join(dir, 'config');
  await writeFile(awsConfig, '[default]\ns3 =\n  addressing_style = virtual\n  max_concurrent_requests = 1\n  multipart_chunksize = 5MB\n');
  const env = { ...config, AWS_CONFIG_FILE: awsConfig, AWS_RETRY_MODE: 'standard', AWS_MAX_ATTEMPTS: '5',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required', AWS_RESPONSE_CHECKSUM_VALIDATION: 'when_required', AWS_PAGER: '' };
  const bucket = config.BUCKET;
  const base = (config.BASE_URL || 'https://dl.ferecord.com').replace(/\/+$/, '');
  if (new URL(base).protocol !== 'https:') throw new Error('BASE_URL 必须为 https');
  const redact = value => [config.AWS_ACCESS_KEY_ID, config.AWS_SECRET_ACCESS_KEY].filter(Boolean)
    .reduce((s, secret) => s.replaceAll(secret, '[已隐藏]'), String(value));
  const aws = async (args, options) => {
    try { return await run('aws', ['--endpoint-url', config.S3_ENDPOINT, ...args], { env, ...options }); }
    catch (error) { throw new Error(redact(error.message)); }
  };
  const api = async (action, args = []) => JSON.parse(await aws(['s3api', action, '--bucket', bucket, ...args]) || '{}');
  const missing = error => /\b404\b|NoSuchKey|Not Found/.test(error.message);
  return {
    bucket, region: config.AWS_DEFAULT_REGION, base, env, redact,
    url: key => base + '/' + key.split('/').map(encodeURIComponent).join('/'),
    async list(prefix = '', token = '', delimiter = '/') {
      const data = await api('list-objects-v2', ['--prefix', prefix, '--delimiter', delimiter, '--max-keys', '100',
        ...(token ? ['--continuation-token', token] : [])]);
      return { dirs: (data.CommonPrefixes || []).map(p => p.Prefix),
        files: (data.Contents || []).filter(f => f.Key !== prefix).map(f => ({ key: f.Key, size: f.Size, modified: f.LastModified })),
        next: data.IsTruncated ? data.NextContinuationToken : null };
    },
    async head(key) {
      try { return await api('head-object', ['--key', key]); }
      catch (error) { if (missing(error)) return null; throw error; }
    },
    async getJson(key) {
      const out = join(await mkdtemp(join(dir, 'get-')), 'object');
      try {
        await api('get-object', ['--key', key, out]);
        return JSON.parse(await readFile(out, 'utf8'));
      } catch (error) { if (missing(error)) return null; throw error; }
      finally { await rm(join(out, '..'), { recursive: true, force: true }); }
    },
    async upload(key, file, emit) {
      await aws(['s3', 'cp', file, 's3://' + bucket + '/' + key, '--cache-control', 'no-cache', '--no-progress'],
        { emit, timeout: 3_600_000 });
      const result = await this.head(key);
      if (!result) throw new Error('上传后未找到文件');
      return result;
    },
    async delete(key) { await api('delete-object', ['--key', key]); },
    async close() { await rm(dir, { recursive: true, force: true }); },
  };
}
