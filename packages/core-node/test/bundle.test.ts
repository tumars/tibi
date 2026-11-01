import { execSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';

/**
 * 打包后的 sidecar（dist/tibi-core.js）真的能调模型：曾经因为 esbuild 把 pi-ai 包成惰性初始化，
 * 打包后 createModels 报 "not a constructor"，开发模式（tsx）下看不出来。这里用本地的 OpenAI 兼容假服务器走一遍。
 */
describe('打包后的 sidecar', () => {
  it('经 OpenAI 兼容接口完成一次模型调用（providers.test）', async () => {
    const cwd = join(__dirname, '..');
    execSync('node build.mjs', { cwd, stdio: 'ignore' });
    const llm = createServer((req, res) => {
      let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
        const stream = JSON.parse(body || '{}').stream;
        if (!stream) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 'x', object: 'chat.completion', model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } })); return; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>(r => llm.listen(0, '127.0.0.1', r));
    const llmPort = (llm.address() as AddressInfo).port;
    const port = 3600 + Math.floor(Math.random() * 300);
    const dir = mkdtempSync(join(tmpdir(), 'tibi-bundle-'));
    const child = spawn(process.execPath, ['dist/tibi-core.js', '--db', join(dir, 'app.db'), '--ws', String(port), '--no-mcp'], { cwd, env: { ...process.env, TIBI_SECRET_PROVIDER_LOCAL_LLM: 'sk-local' }, stdio: 'ignore' });
    try {
      let ws: WebSocket | undefined;
      for (let i = 0; i < 50 && !ws; i++) { await new Promise(r => setTimeout(r, 200)); ws = await new Promise<WebSocket | undefined>(r => { const s = new WebSocket(`ws://127.0.0.1:${port}`); s.on('open', () => r(s)); s.on('error', () => r(undefined)); }); }
      expect(ws).toBeTruthy();
      let id = 0; const wait = new Map<number, (v: { result?: any; error?: any }) => void>();
      ws!.on('message', d => { const m = JSON.parse(String(d)); if (m.id) wait.get(m.id)?.(m); });
      const call = (method: string, params: unknown) => new Promise<{ result?: any; error?: any }>(r => { const i = ++id; wait.set(i, r); ws!.send(JSON.stringify({ jsonrpc: '2.0', id: i, method, params })); });
      const p = await call('providers.upsert', { provider: { kind: 'llm', name: 'Local', protocol: 'openai_compatible', base_url: `http://127.0.0.1:${llmPort}/v1`, auth: 'api_key', tier: 'fast', model: 'test-model', is_default: true }, secret_ref: 'provider.local.llm' });
      const t = await call('providers.test', { id: p.result.id });
      expect(t.result.error ?? '').not.toMatch(/constructor/);
      expect(t.result.ok).toBe(true);
      ws!.close();
    } finally { child.kill(); llm.close(); }
  }, 60_000);
});
