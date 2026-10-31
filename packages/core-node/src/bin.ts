#!/usr/bin/env node
/**
 * Tibi Core 入口（Tauri sidecar / 开发桥）。
 *   tibi-core --db <app.db> [--dict <dict.db>] [--stdio] [--ws <port> [--token <t>]] [--dev]
 * 默认走 stdio（sidecar）；--ws 或 --dev 开 WebSocket 给浏览器里的界面用。环境变量 TIBI_DB、TIBI_DICT 可代替参数。
 * 密钥：stdio 模式经壳取（secret.get 反向请求）；dev 模式读环境变量 TIBI_SECRET_<REF>。
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { maybeAutoBackup } from '@tibi/core';
import { createCore } from './create.js';
import { attachStdio, HostBridge, startWebSocket, stdoutWriter } from './transport.js';

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const dbPath = resolve(arg('db') ?? process.env.TIBI_DB ?? '.tibi/app.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const dictPath = arg('dict') ?? process.env.TIBI_DICT;
  const ws = arg('ws') ?? (flag('dev') ? '3456' : undefined);
  const useStdio = !ws || flag('stdio');
  const host = useStdio ? new HostBridge(stdoutWriter()) : undefined;
  const core = await createCore({
    dbPath, dictPath, version: process.env.TIBI_VERSION ?? '0.1.0-dev',
    getSecret: host ? async ref => (await host.request<{ secret?: string }>('secret.get', { ref }).catch((): { secret?: string } => ({}))).secret : undefined,
  });
  if (ws) {
    startWebSocket(core, Number(ws), arg('token') ?? process.env.TIBI_TOKEN);
    console.error(`[tibi-core] ws://127.0.0.1:${ws}  db=${dbPath}  dict=${dictPath ?? '（无）'}  方法 ${core.dispatcher.list().length} 个`);
  }
  if (useStdio) attachStdio(core, host);
  // 自动备份：启动后一分钟查一次，之后每小时查一次；最近一份自动备份超过一天就备份（00 §3.7 数据）
  // 同一个节拍顺便把"稍后补做"的 AI 分析排进任务（之前离线或没连模型的文章）
  const tick = () => {
    void maybeAutoBackup(core.db, core.platform).catch(e => console.error('[tibi-core] 自动备份失败', e));
    void core.call('documents.analyze_deferred', {}).catch(() => undefined);
  };
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, 3600_000).unref?.();
}

main().catch(e => { console.error('[tibi-core] 启动失败', e); process.exit(1); });
