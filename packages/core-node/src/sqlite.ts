import type BetterSqlite3 from 'better-sqlite3';
import { Database, migrate, MIGRATIONS, PRAGMAS, type Driver, type Migration, type Row, type SqlParams } from '@tibi/core';

/**
 * Node 运行时的驱动：better-sqlite3（同步 API 包成 Core 要的异步接口）。
 * 模块按需加载，这样同一份代码在 Bun 下走 bun:sqlite（sqlite-bun.ts），打单文件 sidecar 时不需要原生模块。
 */
type BS3 = typeof BetterSqlite3;
let bs3: BS3 | undefined;
async function loadBs3(): Promise<BS3> {
  if (!bs3) bs3 = (await import('better-sqlite3')).default as unknown as BS3;
  return bs3;
}

export class BetterSqliteDriver implements Driver {
  constructor(readonly db: BetterSqlite3.Database) {}
  static async open(path: string, opts?: BetterSqlite3.Options) { const B = await loadBs3(); return new BetterSqliteDriver(new B(path, opts)); }
  async exec(sql: string) { this.db.exec(sql); }
  async run(sql: string, params: SqlParams = []) {
    const info = this.db.prepare(sql).run(params as never);
    return { changes: Number(info.changes) };
  }
  async all<T extends Row = Row>(sql: string, params: SqlParams = []) {
    return this.db.prepare(sql).all(params as never) as T[];
  }
  async get<T extends Row = Row>(sql: string, params: SqlParams = []) {
    return this.db.prepare(sql).get(params as never) as T | undefined;
  }
  async close() { this.db.close(); }
}

/** 迁移内嵌在 @tibi/core（scripts/build-sql.mjs 生成），这里只是转一手 */
export function loadMigrations(): Migration[] { return MIGRATIONS; }

/** 打开（或新建）app.db：设 PRAGMA、跑迁移 */
export async function openAppDb(path: string): Promise<Database> {
  const db = new Database(await BetterSqliteDriver.open(path));
  for (const p of PRAGMAS) await db.exec(p);
  await migrate(db, loadMigrations());
  return db;
}

/** 只读打开 dict.db；不存在或是空文件（没有 stardict 表）时返回 undefined（查词降级为"无词典"） */
export async function openDictDb(path: string | undefined): Promise<Database | undefined> {
  if (!path) return undefined;
  try {
    const db = new Database(await BetterSqliteDriver.open(path, { readonly: true, fileMustExist: true }));
    await db.get('SELECT 1 FROM stardict LIMIT 1');
    return db;
  } catch {
    return undefined;
  }
}
