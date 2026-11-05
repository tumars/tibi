import { randomBytes, createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Core } from '@tibi/core';

/**
 * MCP（06 §6，M5）的进程两端：
 * 1. Core 进程里的本地 socket（Unix socket / Windows 命名管道），每行一条 JSON：{ id, token, method: 'tools' | 'call', params }；
 *    令牌是 app.db 旁边的 mcp.token（只有本用户能读，T24）；真正的开关、读写白名单在 Core 的 mcp.* 方法里判。
 * 2. `tibi-core --mcp`：外部 AI 工具以 stdio 启动的 MCP Server，自己不开数据库，只把 tools/list、tools/call 转给运行中的 Tibi。
 */
function mcpSocketPath(dataDir: string): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\tibi-mcp-${createHash('sha1').update(dataDir).digest('hex').slice(0, 12)}`;
  return join(dataDir, 'mcp.sock');
}
const tokenPath = (dataDir: string) => join(dataDir, 'mcp.token');

/** Tauri 的 app_data_dir（identifier = app.tibi） */
export function defaultDataDir(): string {
  if (process.env.TIBI_DATA_DIR) return process.env.TIBI_DATA_DIR;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'app.tibi');
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'app.tibi');
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'app.tibi');
}

function ensureToken(dataDir: string): string {
  const p = tokenPath(dataDir);
  if (existsSync(p)) { const t = readFileSync(p, 'utf8').trim(); if (t.length >= 32) return t; }
  const t = randomBytes(32).toString('hex');
  writeFileSync(p, t, { mode: 0o600 }); try { chmodSync(p, 0o600); } catch { /* Windows */ }
  return t;
}

export function startMcpSocket(core: Core, dataDir: string): Server {
  const token = ensureToken(dataDir);
  const path = mcpSocketPath(dataDir);
  if (process.platform !== 'win32' && existsSync(path)) { try { unlinkSync(path); } catch { /* 被占用 */ } }
  const server = createServer((sock: Socket) => {
    const rl = createInterface({ input: sock });
    rl.on('line', async line => {
      let req: { id?: unknown; token?: string; method?: string; params?: unknown };
      try { req = JSON.parse(line); } catch { return; }
      const reply = (o: object) => { if (!sock.destroyed) sock.write(JSON.stringify({ id: req.id, ...o }) + '\n'); };
      if (req.token !== token) return reply({ error: { code: 'permission_denied', message: '令牌不对' } });
      try {
        const result = req.method === 'tools' ? await core.call('mcp.tools', {}, { origin: 'mcp' })
          : req.method === 'call' ? await core.call('mcp.call', req.params, { origin: 'mcp' })
          : (() => { throw Object.assign(new Error('未知方法'), { code: 'invalid_params' }); })();
        reply({ result });
      } catch (e) { reply({ error: { code: (e as { code?: string }).code ?? 'internal', message: e instanceof Error ? e.message : String(e) } }); }
    });
    sock.on('error', () => undefined);
  });
  server.on('error', e => console.error('[tibi-core] MCP socket 启动失败', e));
  server.listen(path, () => { if (process.platform !== 'win32') { try { chmodSync(path, 0o600); } catch { /* 忽略 */ } } });
  return server;
}

/* ---------- tibi-core --mcp：stdio MCP Server，转发给运行中的 Tibi ---------- */
class SocketClient {
  private sock?: Socket; private seq = 0; private waiting = new Map<number, (r: { result?: unknown; error?: { code: string; message: string } }) => void>();
  constructor(private path: string, private token: string) {}
  private connect(): Promise<Socket> {
    if (this.sock && !this.sock.destroyed) return Promise.resolve(this.sock);
    return new Promise((resolve, reject) => {
      const s = createConnection(this.path, () => { this.sock = s; resolve(s); });
      s.on('error', reject);
      createInterface({ input: s }).on('line', l => { try { const m = JSON.parse(l); this.waiting.get(m.id)?.(m); this.waiting.delete(m.id); } catch { /* 坏行 */ } });
      s.on('close', () => { for (const w of this.waiting.values()) w({ error: { code: 'offline', message: 'Tibi 关掉了' } }); this.waiting.clear(); });
    });
  }
  async request(method: 'tools' | 'call', params?: unknown) {
    const sock = await this.connect().catch(() => { throw new Error('Tibi 没有在运行。先打开 Tibi 桌面应用，并在 设置 → 高级 → 其他 AI 工具 里打开 MCP'); });
    const id = ++this.seq;
    return new Promise<{ result?: unknown; error?: { code: string; message: string } }>(res => { this.waiting.set(id, res); sock.write(JSON.stringify({ id, token: this.token, method, params }) + '\n'); });
  }
}

export async function runMcpStdio(dataDir: string, version: string) {
  const tp = tokenPath(dataDir);
  const token = existsSync(tp) ? readFileSync(tp, 'utf8').trim() : '';
  const client = new SocketClient(mcpSocketPath(dataDir), token);
  let clientName = '外部工具';
  const out = (o: object) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async line => {
    let msg: { id?: string | number; method?: string; params?: Record<string, unknown> };
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id === undefined) return;   // 通知（notifications/initialized 等）不回
    try {
      if (msg.method === 'initialize') {
        clientName = String((msg.params?.clientInfo as { name?: string } | undefined)?.name ?? clientName);
        return out({ id: msg.id, result: { protocolVersion: (msg.params?.protocolVersion as string) ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'tibi', version }, instructions: 'Tibi 是本地的 AI 英语阅读工具。先调 get_context 看用户正在读什么、学习快照；写操作会请用户在 Tibi 里确认。' } });
      }
      if (msg.method === 'ping') return out({ id: msg.id, result: {} });
      if (msg.method === 'tools/list') {
        const r = await client.request('tools');
        if (r.error) throw new Error(r.error.message);
        return out({ id: msg.id, result: { tools: (r.result as { name: string; description: string; inputSchema: unknown }[]).map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } });
      }
      if (msg.method === 'tools/call') {
        const r = await client.request('call', { name: msg.params?.name, args: msg.params?.arguments ?? {}, client: clientName });
        if (r.error) return out({ id: msg.id, result: { isError: true, content: [{ type: 'text', text: r.error.message }] } });
        return out({ id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(r.result ?? null, null, 2) }] } });
      }
      out({ id: msg.id, error: { code: -32601, message: `不支持 ${msg.method}` } });
    } catch (e) {
      out({ id: msg.id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } });
    }
  });
}
