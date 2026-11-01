/**
 * 同步后端（08 §8）：一个能读写文件的共享文件夹。路径都是相对资料库根目录（Tibi Sync/）的 POSIX 路径。
 * - 文件夹（core-node 的 folderBackend）：本地路径；Mac 上的 iCloud Drive 也是一个本地文件夹
 * - WebDAV（这里的 webdavBackend）：只用 PROPFIND / GET / PUT / MKCOL / DELETE
 * - 内存（测试）
 */
export interface SyncBackend {
  kind: 'folder' | 'icloud' | 'webdav' | 'memory';
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, data: Uint8Array): Promise<void>;
  /** 目录下的文件名（不含子目录）；目录不存在时返回 [] */
  list(dir: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

export class SyncError extends Error {
  constructor(public code: 'offline' | 'auth' | 'quota' | 'format_newer' | 'not_found' | 'other', message: string) { super(message); }
}

export function memoryBackend(files: Map<string, Uint8Array> = new Map()): SyncBackend & { files: Map<string, Uint8Array> } {
  return {
    kind: 'memory', files,
    async read(p) { return files.get(p); },
    async write(p, d) { files.set(p, d); },
    async list(dir) { const pre = dir.replace(/\/?$/, '/'); return [...files.keys()].filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k => k.slice(pre.length)); },
    async remove(p) { files.delete(p); },
  };
}

/** WebDAV：url 是资料库根目录（如 https://dav.jianguoyun.com/dav/Tibi Sync/），密码由调用方从钥匙串取 */
export function webdavBackend(o: { url: string; user: string; password: string; fetch?: typeof fetch }): SyncBackend {
  const f = o.fetch ?? fetch;
  const base = o.url.replace(/\/?$/, '/').replace(/ /g, '%20');
  const auth = 'Basic ' + btoa(unescape(encodeURIComponent(`${o.user}:${o.password}`)));
  const url = (p: string) => base + p.split('/').map(encodeURIComponent).join('/');
  const req = async (method: string, p: string, init: RequestInit = {}) => {
    let r: Response;
    try { r = await f(url(p), { ...init, method, headers: { Authorization: auth, ...(init.headers ?? {}) } }); }
    catch { throw new SyncError('offline', '没连上网络。恢复后会自动同步。'); }
    if (r.status === 401 || r.status === 403) throw new SyncError('auth', 'WebDAV 登录失败。检查账号和应用密码。');
    if (r.status === 507) throw new SyncError('quota', '云盘空间不够了。可以关掉"同步导入的原始文件"。');
    return r;
  };
  const made = new Set<string>();
  // 资料库根目录（如 /dav/Tibi Sync/）可能还不存在：MKCOL 遇到 409（父目录也没有）就先建父目录，最多往上几级
  const mkcolAbs = async (u: string, depth = 0): Promise<void> => {
    let r: Response;
    try { r = await f(u, { method: 'MKCOL', headers: { Authorization: auth } }); } catch { throw new SyncError('offline', '没连上网络。恢复后会自动同步。'); }
    if (r.status === 401 || r.status === 403) throw new SyncError('auth', 'WebDAV 登录失败。检查账号和应用密码。');
    if (r.status === 409 && depth < 4) { const parent = u.replace(/[^/]+\/$/, ''); if (parent !== u && /^https?:\/\/[^/]+\/.+/.test(parent)) { await mkcolAbs(parent, depth + 1); await mkcolAbs(u, depth + 1); } }
  };
  let baseReady = false;
  const mkdirs = async (p: string) => {
    if (!baseReady) { await mkcolAbs(base); baseReady = true; }
    const parts = p.split('/').slice(0, -1); let cur = '';
    for (const part of parts) { cur = cur ? `${cur}/${part}` : part; if (made.has(cur)) continue; const r = await req('MKCOL', cur + '/'); if (r.ok || r.status === 405 || r.status === 301) made.add(cur); }
  };
  return {
    kind: 'webdav',
    async read(p) { const r = await req('GET', p); if (r.status === 404) return undefined; if (!r.ok) throw new SyncError('other', `WebDAV 读取失败（${r.status}）`); return new Uint8Array(await r.arrayBuffer()); },
    async write(p, d) {
      await mkdirs(p);
      const r = await req('PUT', p, { body: d as unknown as BodyInit, headers: { 'Content-Type': 'application/octet-stream' } });
      if (!r.ok) throw new SyncError('other', `WebDAV 写入失败（${r.status}）`);
    },
    async list(dir) {
      const r = await req('PROPFIND', dir.replace(/\/?$/, '/'), { headers: { Depth: '1', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>' });
      if (r.status === 404) return [];
      if (!r.ok && r.status !== 207) throw new SyncError('other', `WebDAV 列目录失败（${r.status}）`);
      const xml = await r.text();
      const out: string[] = [];
      const self = decodeURIComponent(new URL(url(dir.replace(/\/?$/, '/'))).pathname).replace(/\/$/, '');
      for (const m of xml.matchAll(/<(?:\w+:)?response\b[\s\S]*?<\/(?:\w+:)?response>/g)) {
        const href = /<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/.exec(m[0])?.[1]; if (!href) continue;
        if (/<(?:\w+:)?collection\s*\/>/.test(m[0])) continue;
        if (decodeURIComponent(href.replace(/^https?:\/\/[^/]+/, '')).replace(/\/$/, '') === self) continue;   // 目录自己
        const name = decodeURIComponent(href.replace(/\/$/, '').split('/').pop() ?? ''); if (name) out.push(name);
      }
      return out;
    },
    async remove(p) { const r = await req('DELETE', p); if (!r.ok && r.status !== 404) throw new SyncError('other', `WebDAV 删除失败（${r.status}）`); },
  };
}
