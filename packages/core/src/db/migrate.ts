import type { Database } from './driver.js';

/**
 * 迁移：只向前（01 §9）。版本记在 PRAGMA user_version。
 * SQL 文件由运行时读入后传进来（Core 不读文件系统，R11）。
 */
export interface Migration { version: number; name: string; sql: string }

export async function migrate(db: Database, migrations: Migration[]): Promise<{ from: number; to: number }> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  const from = Number(row?.user_version ?? 0);
  const pending = migrations.filter(m => m.version > from).sort((a, b) => a.version - b.version);
  let to = from;
  for (const m of pending) {
    if (m.version !== to + 1) throw new Error(`迁移不连续：已到 ${to}，下一条是 ${m.version}（${m.name}）`);
    await db.transaction(async tx => {
      await tx.exec(m.sql);
      await tx.exec(`PRAGMA user_version = ${m.version}`);
    });
    to = m.version;
  }
  return { from, to };
}

export const PRAGMAS = ['PRAGMA journal_mode = WAL', 'PRAGMA foreign_keys = ON', 'PRAGMA synchronous = NORMAL'];
