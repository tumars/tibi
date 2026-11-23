import { createServer } from 'node:http';
import { existsSync, createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, readdir, mkdtemp, copyFile, rm, rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createCloud, run } from './cos.mjs';
import { inspectRelease, requireNewVersion } from './release.mjs';
import { parseNotices } from '../apps/desktop/src/lib/notice-schema.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const UI = fileURLToPath(new URL('./ui/', import.meta.url));
const MAX_UPLOAD = 2 * 1024 ** 3;
const hash = value => createHash('sha256').update(value).digest('hex');
const publicUrl = (cloud, key) => cloud.base + '/' + key.split('/').map(encodeURIComponent).join('/');
const writable = key => typeof key === 'string' && key.startsWith('uploads/') && key.length > 8 && key.length < 512
  && !key.endsWith('/') && !key.split('/').some(p => !p || p === '.' || p === '..') && !/[\x00-\x1f\\]/.test(key);
const error = (status, message) => Object.assign(new Error(message), { status });
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    if ((size += chunk.length) > 1024 * 1024) throw error(413, '请求内容过大');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw error(400, '请求不是有效 JSON'); }
}
async function atomicWrite(file, text) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try { await writeFile(temporary, text, { mode: 0o600 }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}

export async function createAdmin({ cloud, root = ROOT, dataDir = join(root, '.tibi/admin'), execute = run,
  releaseRoot = join(homedir(), 'Documents/releases/Tibi'), fetchPublic = fetch } = {}) {
  const history = join(dataDir, 'jobs');
  const snapshots = join(dataDir, 'notices');
  await mkdir(history, { recursive: true, mode: 0o700 });
  await mkdir(snapshots, { recursive: true, mode: 0o700 });
  const jobs = new Map(); let active = null, writing = false;
  let preview = null;
  const redact = text => cloud.redact ? cloud.redact(text) : String(text);
  for (const name of (await readdir(history)).filter(n => n.endsWith('.json')).sort().slice(-20)) {
    try {
      const job = JSON.parse(await readFile(join(history, name), 'utf8'));
      if (job.status === 'running') {
        job.status = 'failed'; job.finished = new Date().toISOString();
        job.lines.push('服务已重启，此任务中断；请检查线上状态后再操作。');
        await atomicWrite(join(history, name), JSON.stringify(job));
      }
      jobs.set(job.id, job);
    } catch { /* 单个损坏的本机日志不影响管理台启动 */ }
  }
  const available = () => { if (active || writing) throw error(409, '已有写入任务，请等待完成'); };
  function startJob(title, work) {
    available();
    const job = { id: Date.now() + '-' + randomUUID(), title, status: 'running',
      started: new Date().toISOString(), finished: null, lines: [] };
    active = job; jobs.set(job.id, job);
    let saving = Promise.resolve();
    const save = () => { saving = saving.then(() => atomicWrite(join(history, job.id + '.json'), JSON.stringify(job))); };
    const emit = text => {
      job.lines.push(...redact(text).trimEnd().split(/\r?\n/));
      job.lines = job.lines.slice(-500); save();
    };
    save();
    // 下一轮事件循环开始，接口先返回任务 ID，大文件上传不会阻塞其他只读接口。
    setImmediate(async () => {
      try { await work(emit); job.status = 'succeeded'; emit('操作完成，公开内容已核对。'); }
      catch (e) { job.status = 'failed'; emit(e.message || String(e)); }
      finally {
        job.finished = new Date().toISOString(); active = null; save();
        await saving.catch(e => console.error('任务日志保存失败：' + redact(e.message)));
      }
    });
    return job;
  }
  const draft = async () => {
    const raw = await readFile(join(root, 'notice.json'), 'utf8');
    return { data: JSON.parse(raw), revision: hash(raw) };
  };
  const unchangedDraft = async revision => {
    const local = await draft();
    if (revision !== local.revision) throw error(409, '草稿已被修改，请刷新后重新检查');
    parseNotices(local.data); return local;
  };
  const current = () => cloud.getJson('latest.json');
  async function releaseAvailable(version) {
    requireNewVersion(version, (await current())?.version);
    const existing = await cloud.list('v' + version + '/');
    if (existing.files.length || existing.dirs.length) throw error(409, '此版本目录已存在，不能覆盖；请使用新版本号');
  }
  const health = async () => {
    const out = { bucket: cloud.bucket, region: cloud.region, base: cloud.base, latest: null, notice: null,
      connected: false, error: null };
    try {
      [out.latest, out.notice] = await Promise.all([current(), cloud.getJson('notice.json')]);
      out.connected = true;
    } catch (e) { out.error = redact(e.message); }
    return out;
  };
  const server = createServer(async (req, res) => {
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
    };
    try {
      const port = server.address()?.port;
      const hosts = ['127.0.0.1:' + port, 'localhost:' + port];
      if (!hosts.includes(req.headers.host)) throw error(403, '仅允许本机访问');
      const url = new URL(req.url, 'http://' + req.headers.host);
      const api = url.pathname.startsWith('/api/');
      if (api && req.headers['x-tibi-admin'] !== '1') throw error(403, '请从 Tibi 管理页面操作');
      if (api && req.headers.origin && !hosts.some(host => req.headers.origin === 'http://' + host)) throw error(403, '不允许跨站请求');
      const route = req.method + ' ' + url.pathname;
      if (!api) {
        const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
          '/style.css': ['style.css', 'text/css; charset=utf-8'] };
        if (req.method !== 'GET' || !files[url.pathname]) throw error(404, '没有这个页面');
        const [file, type] = files[url.pathname];
        return send(200, await readFile(join(UI, file)), type);
      }
      if (route === 'GET /api/status') return send(200, await health());
      if (route === 'GET /api/jobs') return send(200, [...jobs.values()].sort((a, b) => b.started.localeCompare(a.started)).slice(0, 20));
      if (route === 'GET /api/storage') {
        const prefix = url.searchParams.get('prefix') || '';
        if (prefix.startsWith('/') || /[\x00-\x1f\\]/.test(prefix) || prefix.split('/').includes('..')) throw error(400, '目录不合法');
        const result = await cloud.list(prefix, url.searchParams.get('token') || '');
        return send(200, { ...result, files: result.files.map(f => ({ ...f, writable: writable(f.key), url: publicUrl(cloud, f.key) })) });
      }
      if (route === 'PUT /api/storage') {
        available();
        const key = url.searchParams.get('key');
        if (!writable(key)) throw error(403, '普通文件只能上传到 uploads/，发行文件请使用版本发布');
        if (Number(req.headers['content-length']) > MAX_UPLOAD) throw error(413, '单个文件最大 2 GB');
        writing = true;
        const dir = await mkdtemp(join(tmpdir(), 'tibi-admin-upload-'));
        const file = join(dir, 'upload'); let size = 0;
        try {
          if (await cloud.head(key)) throw error(409, '文件已存在，请换一个文件名');
          await pipeline(req, new Transform({ transform(chunk, encoding, callback) {
            size += chunk.length;
            callback(size > MAX_UPLOAD ? error(413, '单个文件最大 2 GB') : null, chunk);
          } }), createWriteStream(file));
          if (!size) throw error(400, '不能上传空文件');
          writing = false;
          const job = startJob('上传 ' + key, async emit => {
            try {
              emit('正在上传 ' + size + ' 字节到腾讯云');
              const result = await cloud.upload(key, file, emit);
              if (Number(result.ContentLength) !== size) throw new Error('云端文件大小与本机不一致');
              const response = await fetchPublic(publicUrl(cloud, key), { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
              if (!response.ok || Number(response.headers.get('content-length')) !== size) throw new Error('文件已上传，但公开读取校验未通过');
            } finally { await rm(dir, { recursive: true, force: true }); }
          });
          return send(202, job);
        } catch (e) { await rm(dir, { recursive: true, force: true }); throw e; }
        finally { writing = false; }
      }
      if (route === 'DELETE /api/storage') {
        available(); const input = await body(req);
        if (!writable(input.key)) throw error(403, '只允许删除 uploads/ 中的普通文件');
        if (input.confirm !== input.key) throw error(400, '请确认要删除的文件');
        return send(202, startJob('删除 ' + input.key, async emit => { await cloud.delete(input.key); emit('文件已删除'); }));
      }
      if (route === 'GET /api/notices') {
        const local = await draft(); let remote = null, remoteError = null;
        try { remote = await cloud.getJson('notice.json'); } catch (e) { remoteError = redact(e.message); }
        return send(200, { ...local, remote, remoteError });
      }
      if (route === 'PUT /api/notices') {
        available(); const input = await body(req);
        parseNotices(input.data);
        await unchangedDraft(input.revision);
        available();
        writing = true;
        try { await atomicWrite(join(root, 'notice.json'), JSON.stringify(input.data, null, 2) + '\n'); }
        finally { writing = false; }
        return send(200, await draft());
      }
      if (route === 'POST /api/notices/publish') {
        available(); const input = await body(req);
        if (input.confirm !== true) throw error(400, '请先确认发布公告');
        const local = await unchangedDraft(input.revision);
        const snapshot = join(snapshots, Date.now() + '-' + randomUUID() + '.json');
        await writeFile(snapshot, JSON.stringify(local.data, null, 2) + '\n', { mode: 0o600 });
        return send(202, startJob('发布公告 · ' + local.data.notices.length + ' 条', emit =>
          execute(process.execPath, [join(root, 'tools/publish-cos.mjs'), 'notice', snapshot],
            { cwd: root, env: cloud.env, emit: line => emit(redact(line)), timeout: 600_000 })));
      }
      if (route === 'GET /api/releases/local') {
        const dirs = [];
        if (existsSync(releaseRoot)) {
          for (const item of await readdir(releaseRoot, { withFileTypes: true })) {
            if (item.isDirectory() && existsSync(join(releaseRoot, item.name, 'latest.json'))) dirs.push(join(releaseRoot, item.name));
          }
        }
        return send(200, { directories: dirs.sort().reverse(), defaultRoot: releaseRoot });
      }
      if (route === 'POST /api/releases/inspect') {
        available(); const input = await body(req);
        const config = JSON.parse(await readFile(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
        const result = await inspectRelease(input.directory, config.plugins.updater.pubkey);
        let blocked = null;
        try { await releaseAvailable(result.version); } catch (e) { blocked = redact(e.message); }
        preview = { ...result, token: randomUUID(), publicKey: config.plugins.updater.pubkey };
        return send(200, { ...result, token: preview.token, blocked });
      }
      if (route === 'POST /api/releases/publish') {
        available(); const input = await body(req);
        if (!preview || input.token !== preview.token || input.confirm !== preview.tag || input.validated !== true) throw error(409, '请先检查并确认此版本及安装验证');
        const checked = preview; preview = null;
        return send(202, startJob('发布 Tibi ' + checked.tag, async emit => {
          await releaseAvailable(checked.version);
          const stage = await mkdtemp(join(tmpdir(), 'tibi-admin-release-'));
          try {
            emit('正在固定发行产物并重新校验签名');
            for (const file of checked.files) await copyFile(join(checked.directory, file.name), join(stage, file.name));
            const final = await inspectRelease(stage, checked.publicKey);
            if (final.fingerprint !== checked.fingerprint) throw new Error('检查后发行文件发生变化，请重新检查');
            await execute(process.execPath, [join(root, 'tools/publish-cos.mjs'), 'release', stage, checked.tag],
              { cwd: root, env: cloud.env, emit: line => emit(redact(line)), timeout: 3_600_000 });
          } finally { await rm(stage, { recursive: true, force: true }); }
        }));
      }
      throw error(404, '没有这个接口');
    } catch (e) { if (!res.headersSent) send(e.status || 400, { error: redact(e.message || String(e)) }); }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (existsSync(join(ROOT, '.env.cos'))) process.loadEnvFile(join(ROOT, '.env.cos'));
  const cloud = await createCloud();
  const server = await createAdmin({ cloud });
  const port = Number(process.env.ADMIN_PORT || 4311);
  server.on('error', async e => {
    console.error(e.code === 'EADDRINUSE' ? '端口 ' + port + ' 已被占用，可用 ADMIN_PORT 指定其他端口' : e.message);
    await cloud.close(); process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => console.log('Tibi 管理台：http://127.0.0.1:' + server.address().port));
  const stop = () => server.close(async () => { await cloud.close(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
