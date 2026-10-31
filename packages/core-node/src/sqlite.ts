import BetterSqlite3 from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Database, migrate, PRAGMAS, type Driver, type Migration, type Row, type SqlParams } from '@tibi/core';

/** better-sqlite3 是同步的，这里包成 Core 要的异步接口 */
export class BetterSqliteDriver implements Driver {
  readonly db: BetterSqlite3.Database;
  constructor(path: string) {
    this.db = new BetterSqlite3(path);
  }
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

/** 从 @tibi/core/sql 读全部迁移文件（文件名 NNNN_name.sql） */
export function loadMigrations(): Migration[] {
  const require = createRequire(import.meta.url);
  const corePkg = require.resolve('@tibi/core/package.json');
  const dir = join(dirname(corePkg), 'sql');
  return readdirSync(dir)
    .filter(f => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map(f => ({ version: parseInt(f.slice(0, 4), 10), name: f.slice(5, -4), sql: readFileSync(join(dir, f), 'utf8') }));
}

/** 打开（或新建）app.db：设 PRAGMA、跑迁移 */
export async function openAppDb(path: string): Promise<Database> {
  const db = new Database(new BetterSqliteDriver(path));
  for (const p of PRAGMAS) await db.exec(p);
  await migrate(db, loadMigrations());
  return db;
}

/** 只读打开 dict.db；不存在时返回 undefined（查词降级为"无词典"） */
export function openDictDb(path: string | undefined): Database | undefined {
  if (!path) return undefined;
  try {
    const d = new BetterSqlite3(path, { readonly: true, fileMustExist: true });
    const driver = new BetterSqliteDriver(':memory:');
    driver.db.close();
    (driver as { db: BetterSqlite3.Database }).db = d;
    return new Database(driver);
  } catch {
    return undefined;
  }
}
