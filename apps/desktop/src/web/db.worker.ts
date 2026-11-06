/// <reference lib="webworker" />
import sqlite3InitModule, { type Database as WasmDb } from '@sqlite.org/sqlite-wasm';
import { createDbHost } from './dbhost';
import { getSecret } from './secrets';

/**
 * Web 版的"壳"（12 §2）：跑在 Worker 里，提供和手机壳同名的命令。
 * - db_*：sqlite-wasm + OPFS 的 SAH 池（只有 Worker 能用，不需要 COOP / COEP）；浏览器不支持时退回内存库
 * - 词典：dict/manifest.json 指的精简词典，本地没有这一版就下载、导入池里，删掉旧版（§4）
 * - asset_*：书里的插图写在 OPFS 的 assets/<key>/<name>，页面经 Service Worker（public/web-sw.js）读
 * - keyring_get：IndexedDB（secrets.ts）
 */
type Pool = Awaited<ReturnType<Awaited<ReturnType<typeof sqlite3InitModule>>['installOpfsSAHPoolVfs']>>;
const BASE = import.meta.env.BASE_URL;

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  let pool: Pool | undefined;
  try {
    // 一个库要两个位置（库 + 日志），词典换版时新旧两份同时在
    pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'tibi', initialCapacity: 10 });
    await pool.reserveMinimumCapacity(10);
  } catch (e) { console.warn('[tibi] 用不了 OPFS，数据只在内存里', e); }
  return createDbHost({
    app: () => (pool ? { db: new pool.OpfsSAHPoolDb('/app.db'), path: 'OPFS · app.db' } : { db: new sqlite3.oo1.DB(':memory:', 'c'), path: ':memory:' }),
    dict: async () => (pool ? loadDict(pool) : undefined),
  });
})();

async function loadDict(pool: Pool): Promise<WasmDb | undefined> {
  const have = pool.getFileNames().filter(n => /^\/dict-[\w-]+\.db$/.test(n));
  let want: string | undefined;
  try {
    const m = await (await fetch(`${BASE}dict/manifest.json`, { cache: 'no-cache' })).json() as { file: string };
    want = `/${m.file.replace(/\.gz$/, '')}`;
    if (!have.includes(want)) {
      const r = await fetch(`${BASE}dict/${m.file}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      let buf = new Uint8Array(await r.arrayBuffer());
      // 服务器可能已经按 Content-Encoding 解压过了，看文件头再决定
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      await pool.importDb(want, buf);
    }
  } catch (e) { console.warn('[tibi] 词典下载失败，先用本地已有的', e); want = undefined; }
  const names = pool.getFileNames();
  const use = want && names.includes(want) ? want : have.filter(n => names.includes(n)).at(-1);
  if (!use) return undefined;
  for (const n of have) if (n !== use) pool.unlink(n);
  return new pool.OpfsSAHPoolDb(use);
}

// ---- 插图 ----
const KEY = /^[\w-]+$/; const NAME = /^[\w-][\w.-]*$/;
type SyncHandle = { truncate(n: number): void; write(b: Uint8Array, o?: { at: number }): number; flush(): void; close(): void };
const assetsDir = async (create: boolean) => (await navigator.storage.getDirectory()).getDirectoryHandle('assets', { create });

async function assetWrite(a: { key: string; name: string; data: string }) {
  if (!KEY.test(a.key) || !NAME.test(a.name)) throw new Error('插图名字不对');
  const dir = await (await assetsDir(true)).getDirectoryHandle(a.key, { create: true });
  const fh = await dir.getFileHandle(a.name, { create: true });
  const h = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();
  try { const bin = atob(a.data); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); h.truncate(0); h.write(bytes, { at: 0 }); h.flush(); }
  finally { h.close(); }
  return { uri: `asset:${a.key}/${a.name}` };
}

async function assetList() {
  const out: { key: string; modified_at: number }[] = [];
  const root = await assetsDir(true);
  for await (const [key, h] of root as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (h.kind !== 'directory') continue;
    let t = 0;
    for await (const [, f] of h as unknown as AsyncIterable<[string, FileSystemHandle]>) if (f.kind === 'file') t = Math.max(t, (await (f as FileSystemFileHandle).getFile()).lastModified);
    out.push({ key, modified_at: t });
  }
  return out;
}

async function assetRemove(a: { key: string }) {
  if (!KEY.test(a.key)) return null;
  await (await assetsDir(true)).removeEntry(a.key, { recursive: true }).catch(() => undefined);
  return null;
}

self.onmessage = async (e: MessageEvent<{ id: number; cmd: string; args: Record<string, unknown> }>) => {
  const { id, cmd, args } = e.data;
  try {
    let value: unknown;
    if (cmd.startsWith('db_')) value = await (await ready)(cmd, args);
    else if (cmd === 'asset_write') value = await assetWrite(args as never);
    else if (cmd === 'asset_list') value = await assetList();
    else if (cmd === 'asset_remove') value = await assetRemove(args as never);
    else if (cmd === 'keyring_get') value = { secret: (await getSecret(String(args.ref))) ?? null };
    else throw new Error(`没有这个命令：${cmd}`);
    self.postMessage({ id, ok: true, value });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
