import type { EventName, EventTable, MethodName, Params, Result } from './methods';
import { tl } from '../lib/i18n';

/**
 * RPC 客户端（06 §1）：
 * - Tauri 里：invoke('core_call') + listen('core_event')
 * - 浏览器里（pnpm web）：WebSocket 连 `pnpm core:dev`（ws://127.0.0.1:3456），协议与 stdio 一致
 * - ?mock=1：内存假数据，页面不依赖 Core 也能渲染（截图、样式调试）
 */
export class RpcError extends Error {
  constructor(message: string, public readonly code: string, public readonly rpcCode: number, public readonly detail?: unknown) { super(message); this.name = 'RpcError'; }
}

export interface Transport {
  call(method: string, params: unknown): Promise<unknown>;
  onEvent(fn: (event: string, data: unknown) => void): () => void;
  readonly kind: 'tauri' | 'ws' | 'mock';
}

type Frame = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string; data?: { code?: string; detail?: unknown } } };

function toError(e: NonNullable<Frame['error']>) { return new RpcError(e.message, e.data?.code ?? 'internal', e.code, e.data?.detail); }

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Tauri：请求经 Rust 转到 sidecar 的 stdio */
async function tauriTransport(): Promise<Transport> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const listeners = new Set<(event: string, data: unknown) => void>();
  await listen<{ event: string; data: unknown }>('core_event', e => { for (const l of listeners) l(e.payload.event, e.payload.data); });
  return {
    kind: 'tauri',
    async call(method, params) {
      const res = (await invoke('core_call', { method, params: params ?? {} })) as Frame;
      if (res.error) throw toError(res.error);
      return res.result;
    },
    onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/** 浏览器：WebSocket 桥 */
function wsTransport(url: string): Transport {
  let ws: WebSocket | undefined; let seq = 0; let opening: Promise<WebSocket> | undefined;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Set<(event: string, data: unknown) => void>();
  const open = () => {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
    if (opening) return opening;
    opening = new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(url);
      s.onopen = () => { ws = s; opening = undefined; resolve(s); };
      s.onerror = () => { opening = undefined; reject(new RpcError(tl('连不上 Tibi Core。先运行 pnpm core:dev'), 'offline', -32006)); };
      s.onclose = () => { ws = undefined; for (const p of pending.values()) p.reject(new RpcError(tl('Core 断开了'), 'offline', -32006)); pending.clear(); };
      s.onmessage = ev => {
        let f: Frame; try { f = JSON.parse(String(ev.data)); } catch { return; }
        if (f.method === 'event') { const p = f.params as { event: string; data: unknown }; for (const l of listeners) l(p.event, p.data); return; }
        if (typeof f.id === 'number' && pending.has(f.id)) { const p = pending.get(f.id)!; pending.delete(f.id); if (f.error) p.reject(toError(f.error)); else p.resolve(f.result); }
      };
    });
    return opening;
  };
  return {
    kind: 'ws',
    async call(method, params) {
      const s = await open();
      const id = ++seq;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); s.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })); });
    },
    onEvent(fn) { listeners.add(fn); void open().catch(() => undefined); return () => listeners.delete(fn); },
  };
}

class Rpc {
  private transport?: Promise<Transport>;
  private listeners = new Map<string, Set<(data: unknown) => void>>();
  private bound = false;
  kind: Transport['kind'] = 'ws';

  private get t(): Promise<Transport> {
    if (!this.transport) {
      const mock = new URLSearchParams(location.search).get('mock');
      this.transport = mock ? import('../mock').then(m => m.mockTransport()) : isTauri() ? tauriTransport() : Promise.resolve(wsTransport(import.meta.env.VITE_CORE_WS ?? 'ws://127.0.0.1:3456'));
      void this.transport.then(tr => { this.kind = tr.kind; if (!this.bound) { this.bound = true; tr.onEvent((e, d) => this.listeners.get(e)?.forEach(fn => fn(d))); } });
    }
    return this.transport;
  }

  async call<M extends MethodName>(method: M, params: Params<M>): Promise<Result<M>> {
    const tr = await this.t;
    return (await tr.call(method, params)) as Result<M>;
  }

  on<E extends EventName>(event: E, fn: (data: EventTable[E]) => void): () => void {
    void this.t;
    let set = this.listeners.get(event); if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(fn as (d: unknown) => void);
    return () => set!.delete(fn as (d: unknown) => void);
  }
}

export const rpc = new Rpc();

/** 错误归一：界面只认 message 与 code */
export function errorInfo(e: unknown): { message: string; code: string } {
  if (e instanceof RpcError) return { message: e.message, code: e.code };
  if (e instanceof Error) return { message: e.message, code: 'internal' };
  return { message: String(e), code: 'internal' };
}
