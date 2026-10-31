import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { createCore } from '../src/create.js';
import { startMcpSocket } from '../src/mcp.js';

describe('MCP：stdio 代理 → 本地 socket → Core（M5）', () => {
  it('initialize、tools/list、tools/call；没打开时报错', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibi-mcp-'));
    const core = await createCore({ dbPath: join(dir, 'app.db'), version: 't' });
    const server = startMcpSocket(core, dir);
    await new Promise(r => setTimeout(r, 100));
    const child = spawn(process.execPath, ['--import', 'tsx', join(__dirname, '../src/bin.ts'), '--mcp', '--data-dir', dir], { stdio: ['pipe', 'pipe', 'inherit'] });
    const replies = new Map<number, (v: unknown) => void>();
    createInterface({ input: child.stdout! }).on('line', l => { const m = JSON.parse(l); replies.get(m.id)?.(m); });
    let id = 0;
    const rpc = (method: string, params?: unknown) => new Promise<{ result?: any; error?: any }>(res => { const i = ++id; replies.set(i, res as never); child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
    try {
      const init = await rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'Codex' }, capabilities: {} });
      expect(init.result.serverInfo.name).toBe('tibi');
      const off = await rpc('tools/list');
      expect(off.error?.message).toMatch(/没有打开/);
      await core.call('mcp.configure', { enabled: true });
      const list = await rpc('tools/list');
      expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('get_context');
      const call = await rpc('tools/call', { name: 'get_context', arguments: {} });
      expect(call.result.isError).toBeUndefined();
      expect(JSON.parse(call.result.content[0].text)).toHaveProperty('today');
      const bad = await rpc('tools/call', { name: 'run_skill', arguments: {} });
      expect(bad.result.isError).toBe(true);
    } finally { child.kill(); server.close(); }
  }, 30_000);
});
