import { createInterface } from 'node:readline';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Core, CoreEventName, RpcRequest } from '@tibi/core';

/**
 * 传输层（06 §1）：
 * - stdio：Tauri sidecar 用。每行一条 JSON：请求 {jsonrpc,id,method,params}；Core 回 {jsonrpc,id,result|error}；
 *   事件是 {jsonrpc:'2.0', method:'event', params:{event, data}}（没有 id 的通知）。
 * - WebSocket：浏览器里开发界面时用（`pnpm core:dev`），协议与 stdio 完全一致。
 */

export type Frame = RpcRequest & { id?: string | number | null };

export function attachStdio(core: Core) {
  const out = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + '\n');
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async line => {
    line = line.trim(); if (!line) return;
    let req: Frame;
    try { req = JSON.parse(line); } catch { out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '不是合法的 JSON' } }); return; }
    if (req.id === undefined) { await core.handle(req); return; }   // 通知：不回
    out(await core.handle(req));
  });
  const off = core.events.on((event: CoreEventName, data) => out({ jsonrpc: '2.0', method: 'event', params: { event, data } }));
  rl.on('close', () => { off(); process.exit(0); });
  // 日志一律走 stderr，stdout 只给协议
  console.log = (...a: unknown[]) => console.error(...a);
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
