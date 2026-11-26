#!/usr/bin/env node
/**
 * Tibi Core 入口（Tauri sidecar / 开发桥）。
 *   tibi-core --db <app.db> [--dict <dict.db>] [--stdio] [--ws <port> [--token <t>]] [--dev]
 *   tibi-core --mcp [--data-dir <app 数据目录>]   外部 AI 工具用的 MCP Server（stdio），转发给运行中的 Tibi
 * 默认走 stdio（sidecar）；--ws 或 --dev 开 WebSocket 给浏览器里的界面用。环境变量 TIBI_DB、TIBI_DICT 可代替参数。
 * 密钥：stdio 模式经壳取（secret.get 反向请求）；dev 模式读环境变量 TIBI_SECRET_<REF>。
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { devFakeResolver, maybeAutoBackup, sync } from '@tibi/core';
import { createCore } from './create.js';
import { defaultDataDir, runMcpStdio, startMcpSocket } from './mcp.js';
import { attachStdio, HostBridge, startWebSocket, stdoutWriter } from './transport.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  if (flag('mcp')) { await runMcpStdio(resolve(arg('data-dir') ?? defaultDataDir()), process.env.TIBI_VERSION ?? '0.2.0'); return; }
  const dbPath = resolve(arg('db') ?? process.env.TIBI_DB ?? '.tibi/app.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const dictPath = arg('dict') ?? process.env.TIBI_DICT;
  const ws = arg('ws') ?? (flag('dev') ? '3456' : undefined);
  const useStdio = !ws || flag('stdio');
  const host = useStdio ? new HostBridge(stdoutWriter()) : undefined;
  const core = await createCore({
    dbPath, dictPath, version: process.env.TIBI_VERSION ?? '0.2.0-dev',
    getSecret: host ? async ref => (await host.request<{ secret?: string }>('secret.get', { ref }).catch((): { secret?: string } => ({}))).secret : undefined,
    // 开发：--fake-model 用假模型走通 AI 界面（不联网、不花钱）
    resolveModel: flag('fake-model') ? async () => devFakeResolver() : undefined,
  });
  const wss = ws ? startWebSocket(core, Number(ws), arg('token') ?? process.env.TIBI_TOKEN, resolve(dirname(dbPath), 'media')) : undefined;
  if (ws) {
    console.error(`[tibi-core] ws://127.0.0.1:${ws}  db=${dbPath}  dict=${dictPath ?? '（无）'}  方法 ${core.dispatcher.list().length} 个`);
  }
  // MCP：本地 socket 一直开着，真正的开关和白名单在 Core 里判（设置 → 高级 → 其他 AI 工具）
  const mcpServer = !flag('no-mcp') ? startMcpSocket(core, dirname(dbPath)) : undefined;
  // 自动备份：启动后一分钟查一次，之后每小时查一次；最近一份自动备份超过一天就备份（00 §3.7 数据）
  const tick = () => void maybeAutoBackup(core.db, core.platform).catch(e => console.error('[tibi-core] 自动备份失败', e));
  const tBackupInit = setTimeout(tick, 60_000); tBackupInit.unref?.();
  const tBackupLoop = setInterval(tick, 3600_000); tBackupLoop.unref?.();
  // 订阅（11 §4.1）：启动后 2 分钟、之后每 30 分钟；只抓到点的源，自动刷新关了直接返回
  const feeds = () => void core.call('feeds.auto', {}).catch(e => console.error('[tibi-core] 刷新订阅失败', e));
  const tFeedsInit = setTimeout(feeds, 2 * 60_000); tFeedsInit.unref?.();
  const tFeedsLoop = setInterval(feeds, 30 * 60_000); tFeedsLoop.unref?.();
  // 同步（08 §5）：启动后、每 5 分钟、本机有改动后 30 秒（合并连续的改动）；没开同步时 sync.auto 直接返回
  const stopAutoSync = sync.startAutoSync(core, { unref: true });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(tBackupInit); clearInterval(tBackupLoop);
    clearTimeout(tFeedsInit); clearInterval(tFeedsLoop);
    stopAutoSync();
    mcpServer?.close();
    wss?.close();
    await core.dispose();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  if (useStdio) attachStdio(core, host, () => void shutdown());
}

main().catch(e => { console.error('[tibi-core] 启动失败', e); process.exit(1); });
