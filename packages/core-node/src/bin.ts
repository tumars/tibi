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
import { devFakeResolver, maybeAutoBackup } from '@tibi/core';
import { createCore } from './create.js';
import { defaultDataDir, runMcpStdio, startMcpSocket } from './mcp.js';
import { attachStdio, HostBridge, startWebSocket, stdoutWriter } from './transport.js';

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  if (flag('mcp')) { await runMcpStdio(resolve(arg('data-dir') ?? defaultDataDir()), process.env.TIBI_VERSION ?? '0.1.0'); return; }
  const dbPath = resolve(arg('db') ?? process.env.TIBI_DB ?? '.tibi/app.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const dictPath = arg('dict') ?? process.env.TIBI_DICT;
  const ws = arg('ws') ?? (flag('dev') ? '3456' : undefined);
  const useStdio = !ws || flag('stdio');
  const host = useStdio ? new HostBridge(stdoutWriter()) : undefined;
  const core = await createCore({
    dbPath, dictPath, version: process.env.TIBI_VERSION ?? '0.1.0-dev',
    getSecret: host ? async ref => (await host.request<{ secret?: string }>('secret.get', { ref }).catch((): { secret?: string } => ({}))).secret : undefined,
    // 开发：--fake-model 用假模型走通 AI 界面（不联网、不花钱）
    resolveModel: flag('fake-model') ? async () => devFakeResolver() : undefined,
  });
  if (ws) {
    startWebSocket(core, Number(ws), arg('token') ?? process.env.TIBI_TOKEN);
    console.error(`[tibi-core] ws://127.0.0.1:${ws}  db=${dbPath}  dict=${dictPath ?? '（无）'}  方法 ${core.dispatcher.list().length} 个`);
  }
  if (useStdio) attachStdio(core, host);
  // MCP：本地 socket 一直开着，真正的开关和白名单在 Core 里判（设置 → 高级 → 其他 AI 工具）
  if (!flag('no-mcp')) startMcpSocket(core, dirname(dbPath));
  // 自动备份：启动后一分钟查一次，之后每小时查一次；最近一份自动备份超过一天就备份（00 §3.7 数据）
  // 同一个节拍顺便把"稍后补做"的 AI 分析排进任务（之前离线或没连模型的文章）
  const tick = () => {
    void maybeAutoBackup(core.db, core.platform).catch(e => console.error('[tibi-core] 自动备份失败', e));
    void core.call('documents.analyze_deferred', {}).catch(() => undefined);
  };
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, 3600_000).unref?.();
  // 同步（08 §5）：启动后、每 5 分钟、本机有改动后 30 秒（合并连续的改动）；没开同步时 sync.auto 直接返回
  const autoSync = () => void core.call('sync.auto', {}).catch(() => undefined);
  setTimeout(autoSync, 10_000).unref?.();
  setInterval(autoSync, 5 * 60_000).unref?.();
  let pending: ReturnType<typeof setTimeout> | undefined;
  core.events.on((event, data) => {
    if (event !== 'data.changed' || (data as { source?: string }).source === 'sync') return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(autoSync, 30_000); pending.unref?.();
  });
}

main().catch(e => { console.error('[tibi-core] 启动失败', e); process.exit(1); });
