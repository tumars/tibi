import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
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
    if (typeof frame.id !== 'string' || !frame.id.startsWith('h-') || !this.pending.has(frame.id)) return false;
    const p = this.pending.get(frame.id)!; this.pending.delete(frame.id);
    if (frame.error) p.reject(new Error(typeof frame.error === 'object' && frame.error && 'message' in frame.error ? String((frame.error as { message: unknown }).message) : '壳返回错误'));
    else p.resolve(frame.result);
    return true;
  }
}

export function stdoutWriter() { return (obj: unknown) => { process.stdout.write(JSON.stringify(obj) + '\n'); }; }

export function attachStdio(core: Core, host?: HostBridge, onClose?: () => void) {
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
  rl.on('close', () => { off(); if (onClose) onClose(); else process.exit(0); });
}

const MEDIA_MIME: Record<string, string> = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav' };
const LOCAL_ORIGIN_RE = /^(?:https?:\/\/(?:localhost|127\.0\.0\.1|tauri\.localhost)(?::\d+)?|tauri:\/\/localhost)$/i;

export function startWebSocket(core: Core, port: number, token?: string, mediaDir?: string): WebSocketServer {
  const server = createServer((req, res) => {
    if (mediaDir && req.url?.startsWith('/media/podcasts/')) {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      if (token && parsed.searchParams.get('token') !== token) { res.writeHead(401); res.end(); return; }
      let name: string;
      try { name = decodeURIComponent(parsed.pathname.slice('/media/podcasts/'.length)); } catch { res.writeHead(400); res.end(); return; }
      if (!/^[\w-][\w.-]*$/.test(name)) { res.writeHead(400); res.end(); return; }
      const file = join(mediaDir, 'podcasts', name);
      let st;
      try { st = statSync(file); } catch { res.writeHead(404); res.end(); return; }
      if (!st.isFile()) { res.writeHead(404); res.end(); return; }
      const mime = MEDIA_MIME[extname(name).toLowerCase()] ?? 'application/octet-stream';
      const origin = req.headers.origin;
      if (origin && LOCAL_ORIGIN_RE.test(origin)) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
      }
      res.setHeader('accept-ranges', 'bytes');
      const pipeStream = (opts?: { start: number; end: number }) => {
        const rs = createReadStream(file, opts);
        rs.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
        res.on('close', () => rs.destroy());
        rs.pipe(res);
      };
      const range = req.headers.range;
      if (range) {
        if (st.size === 0) { res.writeHead(416, { 'content-range': 'bytes */0' }); res.end(); return; }
        const m = range.match(/^bytes=(\d*)-(\d*)$/);
        if (!m || (!m[1] && !m[2])) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return; }
        let start: number, end: number;
        if (!m[1] && m[2]) {
          const suffix = Number(m[2]);
          if (!Number.isFinite(suffix) || suffix <= 0) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return; }
          start = Math.max(0, st.size - suffix);
          end = st.size - 1;
        } else {
          start = Number(m[1]);
          end = m[2] ? Math.min(st.size - 1, Number(m[2])) : st.size - 1;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= st.size) {
          res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return;
        }
        res.writeHead(206, { 'content-type': mime, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}` });
        if (req.method === 'HEAD') { res.end(); return; }
        pipeStream({ start, end });
        return;
      }
      res.writeHead(200, { 'content-type': mime, 'content-length': st.size });
      if (req.method === 'HEAD' || st.size === 0) { res.end(); return; }
      pipeStream();
      return;
    }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server });
  server.listen(port, '127.0.0.1');
  const clients = new Set<WebSocket>();
  wss.on('connection', (ws, req) => {
    if (token) {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.searchParams.get('token') !== token) { ws.close(4001, 'token'); return; }
    }
    clients.add(ws);
    ws.on('message', async raw => {
      let msg: Frame;
      try { msg = JSON.parse(String(raw)); } catch {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '不是合法的 JSON' } }));
        return;
      }
      if (!msg.method) return;
      const res = await core.handle(msg);
      if (msg.id !== undefined && ws.readyState === ws.OPEN) ws.send(JSON.stringify(res));
    });
    ws.on('close', () => clients.delete(ws));
  });
  const off = core.events.on((event, data) => {
    const frame = JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { event, data } });
    for (const c of clients) if (c.readyState === c.OPEN) c.send(frame);
  });
  wss.on('close', () => { off(); server.close(); });
  return wss;
}
