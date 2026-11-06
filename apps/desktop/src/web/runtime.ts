import type { Transport } from '../rpc/client';
import { isMobileUi } from '../rpc/client';
import { startLocalCore } from '../mobile/local/runtime';
import { takeMemFile } from '../mobile/local/files';
import type { Invoke } from '../mobile/local/driver';
import { throughProxy, webFetch } from './net';

/**
 * Web 版的 Core（12）：和手机走同一个 startLocalCore，壳换成浏览器的——
 * 数据库、插图、密钥在 Worker 里（db.worker.ts），跨域请求经 net.ts，文件来自 <input type=file>（mem:）。
 */
let started: Promise<Transport> | undefined;

export function webTransport(): Promise<Transport> {
  started ??= start();
  return started;
}

async function start(): Promise<Transport> {
  const worker = new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' });
  const pageFetch = globalThis.fetch.bind(globalThis);
  return startLocalCore({
    invoke: workerInvoke(worker),
    httpFetch: (input, init) => throughProxy(pageFetch, input, init),
    apiFetch: webFetch(pageFetch),
    async readFile(p) { const b = takeMemFile(p); if (!b) throw new Error('这个文件已经不在了，请重新选一次'); return b; },
    platform: 'web',
    device: isMobileUi() ? 'mobile' : 'desktop',
    deviceName: browserName(navigator.userAgent),
    userAgent: navigator.userAgent,
  });
}

function workerInvoke(w: Worker): Invoke {
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id); if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.value); else p.reject(new Error(e.data.error));
  };
  w.onerror = e => { for (const p of pending.values()) p.reject(new Error(e.message || '数据库没能启动')); pending.clear(); };
  return <T>(cmd: string, args: Record<string, unknown>) => new Promise<T>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, cmd, args });
  });
}

/** 同步的设备列表里显示的名字 */
export function browserName(ua: string): string {
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '浏览器';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b}（${os}）` : b;
}
