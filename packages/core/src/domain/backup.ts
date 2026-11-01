import type { Database } from '../db/driver.js';
import type { BackupFile, Platform } from '../platform.js';
import { TibiError } from '../types.js';

/**
 * 自动备份（00 §3.7 设置 → 数据）：每天一次，保留最近 7 份；手动备份、重置与恢复之前各备一份。
 * 用 SQLite 的 `VACUUM INTO` 生成一致的快照（WAL 模式下也安全，better-sqlite3 与 bun:sqlite 都支持）。
 * 恢复要替换正在用的 app.db，由壳来做：停 Core → 换文件 → 重启（06 system.backups）。
 */
export const KEEP = 7;
export const DAY = 24 * 3600_000;
export type BackupReason = 'auto' | 'manual' | 'before_reset' | 'before_restore';

function stamp(t: number) {
  const d = new Date(t); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
/** 文件名里的时间（本地时区）；比文件修改时间可靠（拷贝、同步盘会改 mtime） */
function timeOf(name: string): number | undefined {
  const m = name.match(/^tibi-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/); if (!m) return undefined;
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!).getTime();
}
export function reasonOf(name: string): BackupReason { const m = name.match(/-(auto|manual|before_reset|before_restore)\.db$/); return (m?.[1] as BackupReason) ?? 'manual'; }

export async function listBackups(platform: Platform): Promise<(BackupFile & { reason: BackupReason })[]> {
  if (!platform.backups) return [];
  return (await platform.backups.list()).filter(f => /^tibi-\d{8}-\d{6}-[a-z_]+\.db$/.test(f.name)).map(f => ({ ...f, created_at: timeOf(f.name) ?? f.created_at, reason: reasonOf(f.name) })).sort((a, b) => b.created_at - a.created_at);
}

export async function backupNow(db: Database, platform: Platform, reason: BackupReason, at = Date.now()): Promise<BackupFile & { reason: BackupReason }> {
  if (!platform.backups) throw new TibiError('permission_denied', '这里不能备份');
  const name = `tibi-${stamp(at)}-${reason}.db`;
  const path = platform.backups.pathFor(name);
  await db.run('VACUUM INTO ?', [path]);
  const list = await listBackups(platform);
  // 只轮换自动备份：保留最近 7 份；手动和操作前的备份留给用户自己删
  for (const old of list.filter(f => f.reason === 'auto').slice(KEEP)) await platform.backups.remove(old.path);
  const f = (await listBackups(platform)).find(x => x.path === path);
  return f ?? { name, path, size: 0, created_at: at, reason };
}

/** 启动时与每小时检查一次：开着自动备份、且最近一份自动备份超过一天，就备一份 */
export async function maybeAutoBackup(db: Database, platform: Platform, at = Date.now()): Promise<boolean> {
  if (!platform.backups) return false;
  const row = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'backup.auto'");
  if (row && JSON.parse(row.value) === false) return false;
  const last = (await listBackups(platform)).find(f => f.reason === 'auto');
  if (last && at - last.created_at < DAY) return false;
  await backupNow(db, platform, 'auto', at);
  return true;
}
