import { mkdirSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { TibiError, web, type BackupStore, type FetchedPage, type Platform } from '@tibi/core';
import { linkedomParse } from './html2md.js';
import { extractFile } from './extract.js';
import { ocr, setOcrDataDir } from './ocr.js';
import { deviceName, syncFolder } from './syncfolder.js';

/** 桌面运行时的 Platform 实现（05 §8 的网址规则在这里落地） */
export interface NodePlatformOptions {
  app_version: string;
  db_path: string;
  /** 取密钥：sidecar 模式下经壳的通道；dev 模式读环境变量 */
  getSecret: (ref: string) => Promise<string | undefined>;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_V4.some(r => r.test(ip));
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
}

/** 校验网址：只收 http(s)，解析后拒绝回环、内网、链路本地地址 */
export async function checkUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new TibiError('invalid_source', '网址格式不对'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new TibiError('invalid_source', '只支持 http 和 https 网址');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local')) throw new TibiError('invalid_source', '不能抓取本机或局域网地址');
  if (isIP(host)) { if (isPrivateAddress(host)) throw new TibiError('invalid_source', '不能抓取本机或局域网地址'); return u; }
  try {
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0 || addrs.some(a => isPrivateAddress(a.address))) throw new TibiError('invalid_source', '不能抓取本机或局域网地址');
  } catch (e) {
    if (e instanceof TibiError) throw e;
    throw new TibiError('offline', '解析不了这个域名。检查网络后再试');
  }
  return u;
}

/** 正文抽取前先删掉的块：导航、侧栏目录、面包屑、快捷键帮助、页脚 */


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
    await mkdir(dir, { recursive: true });
    await writeFile(p + '.tmp', data); await rename(p + '.tmp', p);
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
  return {
    backups: fileBackups(opts.db_path),
    syncFolder, deviceName,
    saveAsset, ...fileAssetDirs(opts.db_path),
    extractFile: (path) => extractFile(path, saveAsset),
    ocr: (input, o) => ocr(input, o),
    registerPaths(paths) { for (const p of paths) allowed.add(p); },
    isPathAllowed(path) { return allowed.has(path) || !!process.env.TIBI_DEV_ALLOW_ANY_PATH; },
    async fetchUrl(url, o = {}): Promise<FetchedPage> {
      let current = await checkUrl(url);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), o.timeout_ms ?? 20_000);
      o.signal?.addEventListener('abort', () => ctrl.abort());
      try {
        for (let hop = 0; hop < 5; hop++) {
          const res = await fetch(current, { redirect: 'manual', signal: ctrl.signal, method: o.post ? 'POST' : 'GET', body: o.post?.body, headers: { 'user-agent': `Tibi/${opts.app_version} (+https://github.com/tumars/tibi)`, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', ...o.headers, ...o.post?.headers } });
          if (!o.post && res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            current = await checkUrl(new URL(res.headers.get('location')!, current).toString());   // 重定向每跳重查
            continue;
          }
          const content_type = res.headers.get('content-type') ?? '';
          const body = res.status === 304 ? '' : await res.text();
          const etag = res.headers.get('etag') ?? undefined; const last_modified = res.headers.get('last-modified') ?? undefined;
          return { status: res.status, final_url: current.toString(), content_type, body, ...(etag || last_modified ? { headers: { ...(etag ? { etag } : {}), ...(last_modified ? { last_modified } : {}) } } : {}) };
        }
        throw new TibiError('invalid_source', '重定向次数太多');
      } finally { clearTimeout(timer); }
    },
    extractReadable: (html, url) => web.extractReadable(html, url, linkedomParse),
    htmlToMarkdown: (html, url) => web.htmlToMarkdown(html, url, linkedomParse),
    readFile: (path) => readFile(path).then(b => new Uint8Array(b)),
    getSecret: opts.getSecret,
    info: () => ({ app_version: opts.app_version, platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux', db_path: opts.db_path }),
    isOnline: () => true,
  };
}
