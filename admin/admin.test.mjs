import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createAdmin } from './server.mjs';
import { inspectRelease } from './release.mjs';

async function setup(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tibi-admin-test-'));
  await writeFile(join(root, 'notice.json'), '{"notices":[]}\n');
  const calls = [];
  const cloud = { bucket: 'test-bucket', region: 'test-region', base: 'https://distribution.test', env: {},
    redact: value => String(value).replaceAll('fake-private-key', '[已隐藏]'),
    getJson: async key => key === 'latest.json' ? { version: '0.1.0', platforms: {} } : { notices: [] },
    list: async () => ({ dirs: [], files: [], next: null }), head: async () => null,
    upload: async (key, file) => { calls.push(['upload', key]); return { ContentLength: (await readFile(file)).length }; },
    delete: async key => { calls.push(['delete', key]); }, ...overrides.cloud };
  const execute = overrides.execute || (async (command, args) => { calls.push(['execute', args]); });
  const server = await createAdmin({ root, cloud, execute, fetchPublic: async () => ({ ok: true, headers: new Headers({ 'content-length': '5' }) }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (path, { method = 'GET', data, headers, raw } = {}) => {
    const r = await fetch(base + '/api/' + path, { method, headers: { 'X-Tibi-Admin': '1', ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...((data || raw) ? { body: raw || JSON.stringify(data) } : {}) });
    return { status: r.status, body: await r.json() };
  };
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return { root, calls, cloud, server, base, request };
}
async function done(request) {
  for (let i = 0; i < 100; i++) {
    const jobs = (await request('jobs')).body;
    if (jobs.length && jobs.every(j => j.status !== 'running')) return jobs[0];
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('任务未结束');
}

async function releaseFixture(root, version = '0.2.0') {
  const dir = join(root, 'release');
  await mkdir(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const id = Buffer.from('12345678');
  const key = Buffer.concat([Buffer.from('Ed'), id, publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)]);
  const encodedKey = Buffer.from('untrusted comment: test\n' + key.toString('base64') + '\n').toString('base64');
  const name = 'Tibi_' + version + '_aarch64.app.tar.gz'; const message = Buffer.from('signed update file');
  const sig = sign(null, message, privateKey);
  const packet = Buffer.concat([Buffer.from('Ed'), id, sig]);
  const comment = 'timestamp:1\tfile:' + name + '\tversion:' + version;
  const trusted = sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey);
  const signature = Buffer.from('untrusted comment: test\n' + packet.toString('base64') + '\ntrusted comment: ' + comment + '\n' + trusted.toString('base64') + '\n').toString('base64');
  await writeFile(join(dir, name), message);
  await writeFile(join(dir, 'Tibi_' + version + '_aarch64.dmg'), 'installer');
  await writeFile(join(dir, 'private.env'), 'not a release artifact');
  await mkdir(join(dir, 'old-backup'), { recursive: true });
  await writeFile(join(dir, 'latest.json'), JSON.stringify({ version, platforms: { 'darwin-aarch64': { signature, url: 'https://example.test/' + name } } }));
  await mkdir(join(root, 'apps/desktop/src-tauri'), { recursive: true });
  await writeFile(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), JSON.stringify({ plugins: { updater: { pubkey: encodedKey } } }));
  return { dir, encodedKey, name };
}

test('本机接口拒绝跨站写入、伪造 Host、缺失请求头和任意静态文件读取', async t => {
  const { request, base } = await setup(t);
  assert.equal((await request('notices', { method: 'PUT', data: {}, headers: { Origin: 'https://evil.test' } })).status, 403);
  const fakeHost = await new Promise(resolve => {
    const req = httpRequest(base + '/api/status', { headers: { Host: 'evil.test', 'X-Tibi-Admin': '1' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); req.end();
  });
  assert.equal(fakeHost, 403);
  assert.equal((await fetch(base + '/api/status')).status, 403);
  assert.equal((await fetch(base + '/.env.cos')).status, 404);
  assert.equal((await fetch(base + '/')).status, 200);
});

test('普通上传与删除不能更改更新清单、公告、发行目录或路径穿越', async t => {
  const { request, calls } = await setup(t);
  for (const key of ['notice.json', 'latest.json', 'latest/Tibi.dmg', 'v0.1.0/file', 'uploads/../notice.json', 'uploads/a\\b']) {
    assert.equal((await request('storage?key=' + encodeURIComponent(key), { method: 'PUT', raw: 'hello' })).status, 403);
    assert.equal((await request('storage', { method: 'DELETE', data: { key, confirm: key } })).status, 403);
  }
  assert.deepEqual(calls, []);
});

test('草稿校验、版本冲突与发布快照：改草稿不会改正在发布的内容', async t => {
  let finish, snapshot;
  const { request, root } = await setup(t, { execute: async (command, args) => {
    snapshot = JSON.parse(await readFile(args[2], 'utf8'));
    await new Promise(resolve => { finish = resolve; });
  } });
  const original = (await request('notices')).body;
  assert.equal((await request('notices', { method: 'PUT', data: { revision: original.revision, data: { notices: [{ id: 'x' }] } } })).status, 400);
  const data = { notices: [{ id: 'a', message: '测试草稿' }] };
  const saved = await request('notices', { method: 'PUT', data: { revision: original.revision, data } });
  assert.equal(saved.status, 200);
  assert.equal((await request('notices', { method: 'PUT', data: { revision: original.revision, data } })).status, 409);
  assert.equal((await request('notices/publish', { method: 'POST', data: { revision: saved.body.revision, confirm: true } })).status, 202);
  for (let i = 0; i < 50 && !finish; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await request('notices', { method: 'PUT', data: { revision: saved.body.revision, data } })).status, 409);
  await writeFile(join(root, 'notice.json'), '{"notices":[]}');
  assert.deepEqual(snapshot, data);
  finish(); assert.equal((await done(request)).status, 'succeeded');
});

test('存储上传异步核对大小，删除需要完整文件名确认', async t => {
  const { request, calls } = await setup(t);
  assert.equal((await request('storage?key=uploads/test.txt', { method: 'PUT', raw: 'hello' })).status, 202);
  assert.equal((await done(request)).status, 'succeeded');
  assert.equal((await request('storage', { method: 'DELETE', data: { key: 'uploads/test.txt', confirm: 'other' } })).status, 400);
  assert.equal((await request('storage', { method: 'DELETE', data: { key: 'uploads/test.txt', confirm: 'uploads/test.txt' } })).status, 202);
  assert.equal((await done(request)).status, 'succeeded');
  assert.deepEqual(calls, [['upload', 'uploads/test.txt'], ['delete', 'uploads/test.txt']]);
});

test('发行验签识别篡改，排除日志、配置和目录', async t => {
  const { root } = await setup(t);
  const f = await releaseFixture(root);
  const preview = await inspectRelease(f.dir, f.encodedKey);
  assert.equal(preview.files.length, 3);
  await writeFile(join(f.dir, f.name), 'tampered');
  await assert.rejects(inspectRelease(f.dir, f.encodedKey), /验签失败/);
});

test('发布前再次检查文件与线上版本，阻止检查后被改包或覆盖同版本', async t => {
  const { request, root, calls, cloud } = await setup(t);
  const f = await releaseFixture(root);
  const preview = (await request('releases/inspect', { method: 'POST', data: { directory: f.dir } })).body;
  assert.equal(preview.blocked, null);
  await writeFile(join(f.dir, 'Tibi_0.2.0_aarch64.dmg'), 'changed installer');
  assert.equal((await request('releases/publish', { method: 'POST', data: { token: preview.token, confirm: preview.tag, validated: true } })).status, 202);
  const result = await done(request);
  assert.equal(result.status, 'failed'); assert.match(result.lines.join('\n'), /发生变化/);
  assert.equal(calls.length, 0);
  cloud.getJson = async () => ({ version: '0.2.0' });
  const checked = (await request('releases/inspect', { method: 'POST', data: { directory: f.dir } })).body;
  assert.match(checked.blocked, /只能发布高于/);
});

test('云端失败会写入失败日志并脱敏，公告草稿仍可读取', async t => {
  const { request } = await setup(t, { cloud: { getJson: async () => { throw new Error('fake-private-key 云端失败'); } },
    execute: async () => { throw new Error('fake-private-key 发布失败'); } });
  const local = (await request('notices')).body;
  assert.equal(local.data.notices.length, 0); assert.match(local.remoteError, /已隐藏/);
  await request('notices/publish', { method: 'POST', data: { revision: local.revision, confirm: true } });
  const result = await done(request);
  assert.equal(result.status, 'failed'); assert.ok(!JSON.stringify(result).includes('fake-private-key'));
});

test('新版本发布只传检查过的快照，既有版本目录被拦住', async t => {
  let staged;
  const { request, root, cloud } = await setup(t, { execute: async (command, args) => {
    const directory = args[2];
    staged = { manifest: JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8')),
      privateFileExists: await readFile(join(directory, 'private.env')).then(() => true, () => false),
      tag: args[3] };
  } });
  const f = await releaseFixture(root);
  const inspected = await request('releases/inspect', { method: 'POST', data: { directory: f.dir } });
  const p = inspected.body;
  assert.equal(p.blocked, null);
  assert.equal((await request('releases/publish', { method: 'POST', data: { token: p.token, confirm: p.tag, validated: true } })).status, 202);
  assert.equal((await done(request)).status, 'succeeded');
  assert.equal(staged.manifest.version, '0.2.0'); assert.equal(staged.tag, 'v0.2.0'); assert.equal(staged.privateFileExists, false);
  cloud.list = async () => ({ files: [{ key: 'v0.2.0/installer.dmg' }], dirs: [], next: null });
  const blocked = (await request('releases/inspect', { method: 'POST', data: { directory: f.dir } })).body;
  assert.match(blocked.blocked, /版本目录已存在/);
});
