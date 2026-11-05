import { assembleCore, documents, SqliteDict, sync, TibiError, web, type Core, type Platform } from '@tibi/core';
import { RpcError, type Transport } from '../../rpc/client';
import { openLocalDbs, type Invoke } from './driver';
import { browserExtractDeps, ocrImages, ocrPdf, takeMemFile } from './files';
import { invokeFolderBackend } from './syncfs';

/**
 * 手机上的 Core（00 §3.13、R11、T28）：同一个 @tibi/core 跑在 WebView 里，没有 sidecar。
 * - SQLite：壳里的 rusqlite（local_db.rs），经 InvokeDriver
 * - 网络：http 插件的 fetch（不受 CORS 限制）；全局 fetch 也换成它，模型调用（pi-ai）、WebDAV 都走这里
 * - 网页正文：DOMParser + Readability（web/html.ts，和桌面同一份）
 * - 密钥：壳的密钥命令；同步：WebDAV（iCloud 要 Swift 插件，还没写）
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
  const bytesOf = async (cmd: string, args: Record<string, unknown>) => new Uint8Array(await invoke<ArrayBuffer>(cmd, args));
  const readBytes = async (p: string) => (p.startsWith('mem:') ? takeMemFile(p) : undefined) ?? bytesOf('read_file', { path: p });
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  // 书里的图片存到应用数据目录的 assets/（壳的 asset_write），界面经 asset 协议读
  const saveAsset = async (key: string, name: string, data: Uint8Array) => {
    let bin = ''; for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return (await inv<{ uri: string }>('asset_write', { key, name, data: btoa(bin) })).uri;
  };
  const platform: Platform = {
    async fetchUrl(url, opts) {
      const shape = documents.checkUrlShape(url); if (!shape.ok) throw new TibiError('invalid_source', '网址不对');
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), opts?.timeout_ms ?? 20_000);
      opts?.signal?.addEventListener('abort', () => ctrl.abort());
      try {
        const r = await httpFetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Tibi', ...opts?.headers, ...opts?.post?.headers }, ...(opts?.post ? { method: 'POST', body: opts.post.body, maxRedirections: 0 } : {}) });
        const etag = r.headers.get('etag') ?? undefined; const last_modified = r.headers.get('last-modified') ?? undefined;
        return { status: r.status, final_url: r.url || url, content_type: r.headers.get('content-type') ?? '', body: r.status === 304 ? '' : await r.text(), ...(etag || last_modified ? { headers: { ...(etag ? { etag } : {}), ...(last_modified ? { last_modified } : {}) } } : {}) };
      } finally { clearTimeout(t); }
    },
    extractReadable: (html, url) => web.extractReadable(html, url, web.domParser),
    htmlToMarkdown: (html, url) => web.htmlToMarkdown(html, url, web.domParser),
    async getSecret(ref) { return (await inv<{ secret?: string | null }>('keyring_get', { ref })).secret ?? undefined; },
    info: () => ({ app_version: import.meta.env.VITE_APP_VERSION ?? '0.1.0', platform: isIos ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'ios', db_path: path }),
    isOnline: () => navigator.onLine,
    // 手机上的文件都来自系统的文件选择，不另做白名单
    registerPaths() {}, isPathAllowed: () => true,
    // 文件来自系统的文件选择（壳的 read_file 读原始字节）；EPUB / PDF / Word 用和桌面同一份抽取逻辑，图片用浏览器版 tesseract
    readFile: readBytes,
    saveAsset,
    listAssets: () => inv<{ key: string; modified_at: number }[]>('asset_list', {}),
    removeAssets: async key => { await inv('asset_remove', { key }); },
    async extractFile(p) { return web.extractBuffer(p, await readBytes(p), { ...browserExtractDeps, saveAsset }); },
    // 图片和扫描版 PDF 都用浏览器版 tesseract；PDF 先由 pdfjs 一页一页画到画布上
    async ocr(input, opts) {
      if (input.pdf) return ocrPdf(await readBytes(input.pdf), opts?.onProgress, opts?.signal);
      if (!input.images?.length) throw new TibiError('invalid_params', '没有要识别的图片');
      return ocrImages(await Promise.all(input.images.map(readBytes)), opts?.onProgress, opts?.signal);
    },
    // iCloud Drive（iOS：应用的 iCloud 容器）；"文件夹"只在桌面预览里有（手机上没有可选的共享文件夹）
    async syncFolder(o) {
      if (o.kind === 'icloud') {
        const { path: root } = await inv<{ path: string }>('sync_icloud_root', {}).catch(e => { throw new sync.SyncError('other', String(e)); });
        return invokeFolderBackend(inv, root, 'icloud', bytesOf);
      }
      return invokeFolderBackend(inv, o.path.endsWith('Tibi Sync') ? o.path : `${o.path.replace(/\/$/, '')}/Tibi Sync`, 'folder', bytesOf);
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
