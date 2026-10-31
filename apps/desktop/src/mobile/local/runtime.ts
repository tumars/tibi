import { assembleCore, documents, SqliteDict, sync, TibiError, web, type Core, type Platform } from '@tibi/core';
import { RpcError, type Transport } from '../../rpc/client';
import { openLocalDbs, type Invoke } from './driver';

/**
 * 手机上的 Core（00 §3.13、R11、T28）：同一个 @tibi/core 跑在 WebView 里，没有 sidecar。
 * - SQLite：壳里的 rusqlite（local_db.rs），经 InvokeDriver
 * - 网络：http 插件的 fetch（不受 CORS 限制）；全局 fetch 也换成它，模型调用（pi-ai）、WebDAV 都走这里
 * - 网页正文：DOMParser + Readability（web/html.ts，和桌面同一份）
 * - 密钥：壳的钥匙串命令；同步：WebDAV（iCloud 要 Swift 插件，还没写）
 * 界面的 rpc 直接调这个 Core（localTransport），协议和桌面一样。
 */
let started: Promise<Transport> | undefined;

export function localTransport(): Promise<Transport> {
  started ??= start();
  return started;
}

async function start(): Promise<Transport> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { fetch: httpFetch } = await import('@tauri-apps/plugin-http');
  const inv: Invoke = (cmd, args) => invoke(cmd, args);

  // 跨域请求一律走 http 插件（模型 API、网页、WebDAV 大多不给 CORS）
  const pageFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return /^https?:/i.test(url) && !url.startsWith(location.origin) ? httpFetch(input, init) : pageFetch(input, init);
  }) as typeof fetch;

  const { db, dict, path } = await openLocalDbs(inv);
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const platform: Platform = {
    async fetchUrl(url, opts) {
      const shape = documents.checkUrlShape(url); if (!shape.ok) throw new TibiError('invalid_source', '网址不对');
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), opts?.timeout_ms ?? 20_000);
      opts?.signal?.addEventListener('abort', () => ctrl.abort());
      try {
        const r = await httpFetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Tibi' } });
        return { status: r.status, final_url: r.url || url, content_type: r.headers.get('content-type') ?? '', body: await r.text() };
      } finally { clearTimeout(t); }
    },
    extractReadable: (html, url) => web.extractReadable(html, url, web.domParser),
    async getSecret(ref) { return (await inv<{ secret?: string | null }>('keyring_get', { ref })).secret ?? undefined; },
    info: () => ({ app_version: import.meta.env.VITE_APP_VERSION ?? '0.1.0', platform: isIos ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'ios', db_path: path }),
    isOnline: () => navigator.onLine,
    // 手机上的文件都来自系统的文件选择，不另做白名单
    registerPaths() {}, isPathAllowed: () => true,
    // 读本地文件（EPUB / PDF / 图片导入）要 fs 插件和 iOS 的安全作用域书签，还没接：先只支持网址和粘贴
    async readFile() { throw new TibiError('conflict', '手机上暂时只能导入网址和粘贴的文字，文件请在电脑上导入后同步过来'); },
    async syncFolder(o) {
      if (o.kind === 'icloud') throw new sync.SyncError('other', '这个版本还不能用 iCloud Drive 同步（需要原生插件），请先用 WebDAV。');
      throw new sync.SyncError('other', '手机上不能选同步文件夹，请用 iCloud Drive 或 WebDAV。');
    },
    deviceName: () => (isIos ? 'iPhone' : 'Android'),
  };
  const { core } = await assembleCore({ db, dict: dict ? new SqliteDict(dict) : undefined, platform, device: 'mobile' });
  startAutoSync(core);
  return {
    kind: 'tauri',
    async call(method, params) {
      try { return await core.call(method, params ?? {}, { origin: 'ui' }); }
      catch (e) { const x = e as { code?: string; message?: string }; throw new RpcError(x.message ?? String(e), x.code ?? 'internal', -32000); }
    },
    onEvent(fn) { return core.events.on((event, data) => fn(event, data)); },
  };
}

/** 自动同步（08 §5）：启动后、每 5 分钟、改动后 30 秒、回到前台时 */
function startAutoSync(core: Core) {
  const run = () => void core.call('sync.auto', {}, { origin: 'ui' }).catch(() => undefined);
  setTimeout(run, 5_000); setInterval(run, 5 * 60_000);
  let t: ReturnType<typeof setTimeout> | undefined;
  core.events.on((event, data) => {
    if (event !== 'data.changed' || (data as { source?: string }).source === 'sync') return;
    if (t) clearTimeout(t); t = setTimeout(run, 30_000);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); });
}
