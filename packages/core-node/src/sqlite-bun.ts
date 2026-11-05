import { Database as CoreDatabase, migrate, PRAGMAS, type Driver, type Row, type SqlParams } from '@tibi/core';
import { loadMigrations } from './sqlite.js';

/**
 * Bun 运行时的驱动：用内置的 bun:sqlite，不需要原生模块，所以 `bun build --compile` 能打成单文件 sidecar（T11）。
 * 只在 Bun 下动态加载；Node 下不会被 import。
 */
interface BunStmt { run(...p: unknown[]): { changes: number }; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown }
interface BunDb { exec(sql: string): void; query(sql: string): BunStmt; close(): void }
type BunSqliteModule = { Database: new (p: string, opts?: { readonly?: boolean }) => BunDb };

async function loadBunSqlite(): Promise<BunSqliteModule> {
  const name = 'bun:sqlite';
  return (await import(/* @vite-ignore */ name)) as BunSqliteModule;
}

class BunSqliteDriver implements Driver {
  constructor(readonly db: BunDb) {}
  async exec(sql: string) { this.db.exec(sql); }
  async run(sql: string, params: SqlParams = []) {
    const r = this.db.query(sql).run(...(Array.isArray(params) ? params : [params]));
    return { changes: Number(r.changes) };
  }
  async all<T extends Row = Row>(sql: string, params: SqlParams = []) { return this.db.query(sql).all(...(Array.isArray(params) ? params : [params])) as T[]; }
  async get<T extends Row = Row>(sql: string, params: SqlParams = []) { return (this.db.query(sql).get(...(Array.isArray(params) ? params : [params])) ?? undefined) as T | undefined; }
  async close() { this.db.close(); }
}

export async function openAppDbBun(path: string): Promise<CoreDatabase> {
  const { Database } = await loadBunSqlite();
  const db = new CoreDatabase(new BunSqliteDriver(new Database(path)));
  for (const p of PRAGMAS) await db.exec(p);
  await migrate(db, loadMigrations());
  return db;
}

export async function openDictDbBun(path: string | undefined): Promise<CoreDatabase | undefined> {
  if (!path) return undefined;
  try {
    const { Database } = await loadBunSqlite();
    const db = new CoreDatabase(new BunSqliteDriver(new Database(path, { readonly: true })));
    await db.get('SELECT 1 FROM stardict LIMIT 1');
    return db;
  } catch { return undefined; }
}

export const isBun = () => typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
