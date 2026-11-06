import { assembleCore, documents, SqliteDict, sync, TibiError, web, type Core, type Platform } from '@tibi/core';
import { RpcError, type Transport } from '../../rpc/client';
import { openLocalDbs, type Invoke } from './driver';
import { browserExtractDeps, ocrImages, ocrPdf, takeMemFile } from './files';
import { invokeFolderBackend } from './syncfs';

/**
 * 跑在页面里的 Core（00 §3.13、R11、T28、12）：同一个 @tibi/core，没有 sidecar。手机和 Web 版各给一个"壳"：
 * - SQLite、插图、密钥：壳的命令（db_* / asset_* / keyring_get），经 InvokeDriver；手机是 rusqlite（local_db.rs），Web 是 Worker 里的 sqlite-wasm
 * - 跨域请求：壳的 fetch；手机是 http 插件，Web 是"直连不行就经中转"（web/net.ts）。全局 fetch 也换成它，模型调用（pi-ai）、WebDAV 都走这里
 * - 网页正文：DOMParser + Readability（web/html.ts，和桌面同一份）
 * 界面的 rpc 直接调这个 Core（localTransport），协议和桌面一样。
 */
export interface LocalShell {
  invoke: Invoke;
  /** 跨域请求；post 时不跟随重定向（密钥不能带去别的地址） */
  httpFetch(input: RequestInfo | URL, init?: RequestInit & { maxRedirections?: number }): Promise<Response>;
  /** 页面里别的跨域请求（模型 API、WebDAV）；不给时同 httpFetch。Web 版是先直连、不行再经中转 */
  apiFetch?: typeof fetch;
  /** 读文件选择拿到的文件 */
  readFile(path: string): Promise<Uint8Array>;
  platform: 'ios' | 'android' | 'web';
  /** 对话怎么分页（电脑一次一页、手机一天一页）：Web 版跟着用的是哪套界面 */
  device: 'desktop' | 'mobile';
  deviceName: string;
  userAgent: string;
  syncFolder?: Platform['syncFolder'];
}

let started: Promise<Transport> | undefined;

/** 手机（Tauri 移动端 / mobile-preview） */
export function localTransport(): Promise<Transport> {
  started ??= tauriShell().then(startLocalCore);
  return started;
}

async function tauriShell(): Promise<LocalShell> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { fetch: httpFetch } = await import('@tauri-apps/plugin-http');
  const inv: Invoke = (cmd, args) => invoke(cmd, args);
  const bytesOf = async (cmd: string, args: Record<string, unknown>) => new Uint8Array(await invoke<ArrayBuffer>(cmd, args));
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return {
    invoke: inv,
    httpFetch: httpFetch as LocalShell['httpFetch'],
    readFile: async p => (p.startsWith('mem:') ? takeMemFile(p) : undefined) ?? bytesOf('read_file', { path: p }),
    platform: isIos ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'ios',
    device: 'mobile',
    deviceName: isIos ? 'iPhone' : 'Android',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Tibi',
    // iCloud Drive（iOS：应用的 iCloud 容器）；"文件夹"只在桌面预览里有（手机上没有可选的共享文件夹）
    async syncFolder(o) {
      if (o.kind === 'icloud') {
        const { path: root } = await inv<{ path: string }>('sync_icloud_root', {}).catch(e => { throw new sync.SyncError('other', String(e)); });
        return invokeFolderBackend(inv, root, 'icloud', bytesOf);
      }
      return invokeFolderBackend(inv, o.path.endsWith('Tibi Sync') ? o.path : `${o.path.replace(/\/$/, '')}/Tibi Sync`, 'folder', bytesOf);
    },
  };
}

export async function startLocalCore(shell: LocalShell): Promise<Transport> {
  const { invoke: inv, httpFetch, readFile: readBytes } = shell;

  // 跨域请求一律走壳（模型 API、网页、WebDAV 大多不给 CORS）
  const pageFetch = globalThis.fetch.bind(globalThis);
  const apiFetch = shell.apiFetch ?? httpFetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return /^https?:/i.test(url) && !url.startsWith(location.origin) ? apiFetch(input, init) : pageFetch(input, init);
  }) as typeof fetch;

  const { db, dict, path } = await openLocalDbs(inv);
  // 书里的图片存到壳的 assets/（asset_write），界面按平台换成能显示的地址（lib/imageSrc.ts）
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
        const r = await httpFetch(url, { signal: ctrl.signal, headers: { 'user-agent': shell.userAgent, ...opts?.headers, ...opts?.post?.headers }, ...(opts?.post ? { method: 'POST', body: opts.post.body, maxRedirections: 0 } : {}) });
        const etag = r.headers.get('etag') ?? undefined; const last_modified = r.headers.get('last-modified') ?? undefined;
        return { status: r.status, final_url: r.url || url, content_type: r.headers.get('content-type') ?? '', body: r.status === 304 ? '' : await r.text(), ...(etag || last_modified ? { headers: { ...(etag ? { etag } : {}), ...(last_modified ? { last_modified } : {}) } } : {}) };
      } finally { clearTimeout(t); }
    },
    extractReadable: (html, url) => web.extractReadable(html, url, web.domParser),
    htmlToMarkdown: (html, url) => web.htmlToMarkdown(html, url, web.domParser),
    async getSecret(ref) { return (await inv<{ secret?: string | null }>('keyring_get', { ref })).secret ?? undefined; },
    info: () => ({ app_version: import.meta.env.VITE_APP_VERSION ?? '0.1.0', platform: shell.platform, db_path: path }),
    isOnline: () => navigator.onLine,
    // 文件都来自系统的文件选择，不另做白名单
    registerPaths() {}, isPathAllowed: () => true,
    // EPUB / PDF / Word 用和桌面同一份抽取逻辑，图片用浏览器版 tesseract
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
    syncFolder: shell.syncFolder,
    deviceName: () => shell.deviceName,
  };
  const { core } = await assembleCore({ db, dict: dict ? new SqliteDict(dict) : undefined, platform, device: shell.device });
  startAutoSync(core);
  return {
    kind: 'tauri',
    async call(method, params) {
      // 参数过一遍 JSON，和桌面经 IPC / WebSocket 时一样：值为 undefined 的键去掉（不然校验时会被转成 [undefined] 之类）
      try { return await core.call(method, JSON.parse(JSON.stringify(params ?? {})), { origin: 'ui' }); }
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
