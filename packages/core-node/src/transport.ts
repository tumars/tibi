import { createInterface } from 'node:readline';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Core, CoreEventName, RpcRequest } from '@tibi/core';

/**
 * 传输层（06 §1）：
 * - stdio：Tauri sidecar 用。每行一条 JSON：
 *   壳 → Core：请求 {jsonrpc,id,method,params}；Core → 壳：响应 {jsonrpc,id,result|error}；
 *   Core → 壳：事件 {jsonrpc:'2.0', method:'event', params:{event, data}}（没有 id）；
 *   Core → 壳：反向请求 {jsonrpc:'2.0', id:'h-…', method:'secret.get', params:{ref}}，壳回 {id, result:{secret}}
 *   （密钥只在壳的密钥存储里，Core 按需取、只留内存，05 §8）。
 * - WebSocket：浏览器里开发界面时用（`pnpm core:dev`），协议与 stdio 一致（反向请求在 dev 下由环境变量代替）。
 */

export type Frame = RpcRequest & { id?: string | number | null; result?: unknown; error?: unknown };

/** Core → 壳 的反向请求（目前只有 secret.get） */
export class HostBridge {
  private seq = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  constructor(private readonly send: (obj: unknown) => void) {}

  request<T = unknown>(method: string, params: unknown, timeout_ms = 10_000): Promise<T> {
    const id = `h-${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`壳没有回应 ${method}`)); }, timeout_ms);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v as T); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** 壳回的响应帧；返回 true 表示已处理 */
  handleResponse(frame: Frame): boolean {
    if (typeof frame.id !== 'string' || !frame.id.startsWith('h-') || !(frame.id in Object.fromEntries(this.pending))) return false;
    const p = this.pending.get(frame.id)!; this.pending.delete(frame.id);
    if (frame.error) p.reject(new Error(typeof frame.error === 'object' && frame.error && 'message' in frame.error ? String((frame.error as { message: unknown }).message) : '壳返回错误'));
    else p.resolve(frame.result);
    return true;
  }
}

export function stdoutWriter() { return (obj: unknown) => { process.stdout.write(JSON.stringify(obj) + '\n'); }; }

export function attachStdio(core: Core, host?: HostBridge) {
  const out = stdoutWriter();
  // 日志一律走 stderr，stdout 只给协议
  console.log = (...a: unknown[]) => console.error(...a);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async line => {
    line = line.trim(); if (!line) return;
    let frame: Frame;
    try { frame = JSON.parse(line); } catch { out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '不是合法的 JSON' } }); return; }
    if (host && !frame.method && host.handleResponse(frame)) return;
    if (!frame.method) return;
    if (frame.id === undefined) { await core.handle(frame); return; }   // 通知：不回
    out(await core.handle(frame));
  });
  const off = core.events.on((event: CoreEventName, data) => out({ jsonrpc: '2.0', method: 'event', params: { event, data } }));
  rl.on('close', () => { off(); process.exit(0); });
}

export function startWebSocket(core: Core, port: number, token?: string): WebSocketServer {
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  const clients = new Set<WebSocket>();
  wss.on('connection', (ws, req) => {
    if (token) {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.searchParams.get('token') !== token) { ws.close(4001, 'token'); return; }
    }
    clients.add(ws);
    ws.on('message', async raw => {
      let msg: Frame;
      try { msg = JSON.parse(String(raw)); } catch { ws.send(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '不是合法的 JSON' } })); return; }
      if (!msg.method) return;
      const res = await core.handle(msg);
      if (msg.id !== undefined) ws.send(JSON.stringify(res));
    });
    ws.on('close', () => clients.delete(ws));
  });
  core.events.on((event, data) => {
    const frame = JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { event, data } });
    for (const c of clients) if (c.readyState === c.OPEN) c.send(frame);
  });
  return wss;
}
