#!/usr/bin/env node
/**
 * Tibi Core 入口（Tauri sidecar / 开发桥）。
 *   tibi-core --db <app.db> [--dict <dict.db>] [--stdio] [--ws <port> [--token <t>]]
 * 默认：有 --ws 就开 WebSocket，否则走 stdio。环境变量 TIBI_DB、TIBI_DICT 可代替参数。
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createCore } from './create.js';
import { attachStdio, startWebSocket } from './transport.js';

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const dbPath = resolve(arg('db') ?? process.env.TIBI_DB ?? '.tibi/app.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const dictPath = arg('dict') ?? process.env.TIBI_DICT;
  const core = await createCore({ dbPath, dictPath, version: process.env.TIBI_VERSION ?? '0.1.0-dev' });
  const ws = arg('ws') ?? (flag('dev') ? '3456' : undefined);
  if (ws) {
    startWebSocket(core, Number(ws), arg('token') ?? process.env.TIBI_TOKEN);
    console.error(`[tibi-core] ws://127.0.0.1:${ws}  db=${dbPath}  dict=${dictPath ?? '（无）'}  方法 ${core.dispatcher.list().length} 个`);
  }
  if (!ws || flag('stdio')) attachStdio(core);
}

main().catch(e => { console.error('[tibi-core] 启动失败', e); process.exit(1); });
