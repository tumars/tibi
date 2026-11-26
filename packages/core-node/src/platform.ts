import { mkdirSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { TibiError, web, type BackupStore, type FetchedPage, type Platform } from '@tibi/core';
import { linkedomParse } from './html2md.js';
import { extractFile } from './extract.js';
import { ocr, setOcrDataDir } from './ocr.js';
import { createMediaOps } from './media.js';
import { deviceName, syncFolder } from './syncfolder.js';

/** 桌面运行时的 Platform 实现（05 §8 的网址规则在这里落地） */
export interface NodePlatformOptions {
  app_version: string;
  db_path: string;
  /** 取密钥：sidecar 模式下经壳的通道；dev 模式读环境变量 */
  getSecret: (ref: string) => Promise<string | undefined>;
}

const MAX_FETCH_BYTES = 10 * 1024 * 1024; // 网页/订阅响应上限 10 MB，防超大响应打爆内存

function getLocalInterfaceIps(): Set<string> {
  const ips = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    if (!list) continue;
    for (const info of list) {
      if (info.address) ips.add(info.address.split('%')[0]!.toLowerCase());
    }
  }
  return ips;
}

export interface CheckUrlOptions {
  /** 测试注入用，默认走 node:dns/promises 的 lookup */
  lookupHost?: (host: string) => Promise<{ address: string }[]>;
  /** 测试注入用，默认读取本机网卡地址，防止 DNS 解析到本机 TUN 网关等自身地址 */
  localIps?: ReadonlySet<string>;
}

/** 校验网址：只收 http(s)，解析后拒绝回环、内网、链路本地与特殊保留地址（兼容 TUN 透明代理的 Fake-IP 解析结果） */
export async function checkUrl(raw: string, opts?: CheckUrlOptions): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new TibiError('invalid_source', '网址格式不对'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new TibiError('invalid_source', '只支持 http 和 https 网址');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (web.isBlockedHostname(host)) throw new TibiError('invalid_source', '不能抓取本机或局域网地址');
  if (isIP(host)) { if (web.isPrivateIp(host)) throw new TibiError('invalid_source', '不能抓取本机或局域网地址'); return u; }
  try {
    const addrs = opts?.lookupHost ? await opts.lookupHost(host) : await lookup(host, { all: true });
    if (addrs.length === 0) throw new TibiError('invalid_source', '不能抓取本机或局域网地址');
    if (addrs.some(a => web.isPrivateIp(a.address))) {
      const localIps = opts?.localIps ?? getLocalInterfaceIps();
      const hasFakeIpV4 = addrs.some(a => web.isFakeIpV4(a.address));
      const hasLocalFakeIpTun = [...localIps].some(ip => web.isFakeIpV4(ip));
      const allowFakeIpV6 = hasFakeIpV4 || hasLocalFakeIpTun;
      const blocked = addrs.some(a => {
        const addr = a.address.trim().replace(/^\[|\]$/g, '').split('%')[0]!.toLowerCase();
        const embedded = web.extractEmbeddedIpv4(addr);
        if (localIps.has(addr) || (embedded && localIps.has(embedded))) return true;
        return web.isPrivateIp(addr, { allowFakeIp: true, allowFakeIpV6 });
      });
      if (blocked) throw new TibiError('invalid_source', '不能抓取本机或局域网地址');
    }
  } catch (e) {
    if (e instanceof TibiError) throw e;
    throw new TibiError('offline', '解析不了这个域名。检查网络后再试');
  }
  return u;
}

async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  const len = Number(res.headers.get('content-length') ?? 0);
  if (Number.isFinite(len) && len > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new TibiError('invalid_source', `响应内容超过 ${Math.round(maxBytes / (1 << 20))} MB 上限`);
  }
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new TibiError('invalid_source', `响应内容超过 ${Math.round(maxBytes / (1 << 20))} MB 上限`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks, total));
}

function stripSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === 'authorization' || lk === 'cookie' || lk === 'proxy-authorization') continue;
    out[k] = v;
  }
  return out;
}

/** 备份放在 app.db 旁边的 backups/ 目录；内存库（测试）没有 */
function fileBackups(dbPath: string): BackupStore | undefined {
  if (!dbPath || dbPath === ':memory:') return undefined;
  const dir = join(dirname(dbPath), 'backups');
  return {
    pathFor(name) { mkdirSync(dir, { recursive: true }); return join(dir, name); },
    async list() {
      let names: string[] = [];
      try { names = await readdir(dir); } catch { return []; }
      const out = [];
      for (const name of names.filter(n => n.endsWith('.db'))) {
        const path = join(dir, name); const st = await stat(path).catch(() => undefined);
        if (st?.isFile()) out.push({ name, path, size: st.size, created_at: st.mtimeMs });
      }
      return out;
    },
    async remove(path) { if (dirname(path) === dir) await unlink(path).catch(() => undefined); },
  };
}

/** 文档图片放在 app.db 旁边的 assets/<key>/<name>（界面经 Tauri 的 asset 协议读，范围 $APPDATA）；内存库（测试）没有 */
export function fileAssets(dbPath: string): Platform['saveAsset'] {
  if (!dbPath || dbPath === ':memory:') return undefined;
  const root = join(dirname(dbPath), 'assets');
  return async (key, name, data) => {
    if (!/^[\w-]+$/.test(key) || !/^[\w-][\w.-]*$/.test(name)) throw new Error('图片名不对');
    const dir = join(root, key); const p = join(dir, name);
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(dir, { recursive: true });
    try { await writeFile(tmp, data); await rename(tmp, p); }
    catch (e) { await unlink(tmp).catch(() => undefined); throw e; }
    return `asset:${key}/${name}`;
  };
}

/** assets/ 下的目录（listAssets / removeAssets，启动时清掉没文档用的） */
export function fileAssetDirs(dbPath: string): Pick<Platform, 'listAssets' | 'removeAssets'> {
  if (!dbPath || dbPath === ':memory:') return {};
  const root = join(dirname(dbPath), 'assets');
  return {
    async listAssets() {
      const names = await readdir(root).catch(() => [] as string[]);
      const out: { key: string; modified_at: number }[] = [];
      for (const key of names.filter(n => /^[\w-]+$/.test(n))) { const s = await stat(join(root, key)).catch(() => undefined); if (s?.isDirectory()) out.push({ key, modified_at: s.mtimeMs }); }
      return out;
    },
    async removeAssets(key) { if (!/^[\w-]+$/.test(key)) throw new Error('目录名不对'); await rm(join(root, key), { recursive: true, force: true }); },
  };
}

export function nodePlatform(opts: NodePlatformOptions): Platform {
  const allowed = new Set<string>();
  if (opts.db_path && opts.db_path !== ':memory:') setOcrDataDir(dirname(opts.db_path));   // 语言包缓存在 app.db 旁边
  const saveAsset = fileAssets(opts.db_path);
  const mediaOps = createMediaOps(opts.db_path, opts.app_version);
  return {
    backups: fileBackups(opts.db_path),
    syncFolder, deviceName,
    saveAsset, ...fileAssetDirs(opts.db_path),
    ...mediaOps,
    extractFile: (path) => extractFile(path, saveAsset),
    ocr: (input, o) => ocr(input, o),
    registerPaths(paths) { for (const p of paths) allowed.add(p); },
    isPathAllowed(path) { return allowed.has(path) || !!process.env.TIBI_DEV_ALLOW_ANY_PATH; },
    async fetchUrl(url, o = {}): Promise<FetchedPage> {
      let current = await checkUrl(url);
      let reqHeaders: Record<string, string> = { 'user-agent': `Tibi/${opts.app_version} (+https://github.com/tumars/tibi)`, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', ...o.headers, ...o.post?.headers };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), o.timeout_ms ?? 20_000);
      const onAbort = () => ctrl.abort();
      if (o.signal?.aborted) ctrl.abort();
      else o.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        for (let hop = 0; hop < 5; hop++) {
          const res = await fetch(current, { redirect: 'manual', signal: ctrl.signal, method: o.post ? 'POST' : 'GET', body: o.post?.body, headers: reqHeaders });
          if (!o.post && res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            await res.body?.cancel().catch(() => undefined);
            const next = await checkUrl(new URL(res.headers.get('location')!, current).toString());   // 重定向每跳重查
            if (next.origin !== current.origin) reqHeaders = stripSensitiveHeaders(reqHeaders);
            current = next;
            continue;
          }
          const content_type = res.headers.get('content-type') ?? '';
          const body = res.status === 304 ? '' : await readTextCapped(res, MAX_FETCH_BYTES);
          const etag = res.headers.get('etag') ?? undefined; const last_modified = res.headers.get('last-modified') ?? undefined;
          return { status: res.status, final_url: current.toString(), content_type, body, ...(etag || last_modified ? { headers: { ...(etag ? { etag } : {}), ...(last_modified ? { last_modified } : {}) } } : {}) };
        }
        throw new TibiError('invalid_source', '重定向次数太多');
      } finally {
        clearTimeout(timer);
        o.signal?.removeEventListener('abort', onAbort);
      }
    },
    extractReadable: (html, url) => web.extractReadable(html, url, linkedomParse),
    htmlToMarkdown: (html, url) => web.htmlToMarkdown(html, url, linkedomParse),
    readFile: (path) => readFile(path).then(b => new Uint8Array(b)),
    getSecret: opts.getSecret,
    info: () => ({ app_version: opts.app_version, platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux', db_path: opts.db_path }),
    isOnline: () => true,
  };
}
