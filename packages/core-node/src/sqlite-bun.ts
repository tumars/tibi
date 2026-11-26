import { Database as CoreDatabase, initAppDb, type Driver, type Row, type SqlParams } from '@tibi/core';
import { loadMigrations } from './sqlite.js';

/**
 * Bun 运行时的驱动：用内置的 bun:sqlite，不需要原生模块，所以 `bun build --compile` 能打成单文件 sidecar（T11）。
 * 只在 Bun 下动态加载；Node 下不会被 import。
 */
interface BunStmt { run(...p: unknown[]): { changes: number }; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown; finalize?: () => void }
interface BunDb { exec(sql: string): void; prepare(sql: string): BunStmt; close(): void }
type BunSqliteModule = { Database: new (p: string, opts?: { readonly?: boolean }) => BunDb };

async function loadBunSqlite(): Promise<BunSqliteModule> {
  const name = 'bun:sqlite';
  return (await import(/* @vite-ignore */ name)) as BunSqliteModule;
}

class BunSqliteDriver implements Driver {
  constructor(readonly db: BunDb) {}
  async exec(sql: string) { this.db.exec(sql); }
  async run(sql: string, params: SqlParams = []) {
    const stmt = this.db.prepare(sql);
    try {
      const r = stmt.run(...(Array.isArray(params) ? params : [params]));
      return { changes: Number(r.changes) };
    } finally { stmt.finalize?.(); }
  }
  async all<T extends Row = Row>(sql: string, params: SqlParams = []) {
    const stmt = this.db.prepare(sql);
    try { return stmt.all(...(Array.isArray(params) ? params : [params])) as T[]; }
    finally { stmt.finalize?.(); }
  }
  async get<T extends Row = Row>(sql: string, params: SqlParams = []) {
    const stmt = this.db.prepare(sql);
    try { return (stmt.get(...(Array.isArray(params) ? params : [params])) ?? undefined) as T | undefined; }
    finally { stmt.finalize?.(); }
  }
  async close() { this.db.close(); }
}

export async function openAppDbBun(path: string, opts?: { seedProfile?: boolean }): Promise<CoreDatabase> {
  const { Database } = await loadBunSqlite();
  return initAppDb(new BunSqliteDriver(new Database(path)), { migrations: loadMigrations(), seedProfile: opts?.seedProfile });
}

export async function openDictDbBun(path: string | undefined): Promise<CoreDatabase | undefined> {
  if (!path) return undefined;
  let db: CoreDatabase | undefined;
  try {
    const { Database } = await loadBunSqlite();
    db = new CoreDatabase(new BunSqliteDriver(new Database(path, { readonly: true })));
    await db.get('SELECT 1 FROM stardict LIMIT 1');
    return db;
  } catch {
    await db?.close().catch(() => undefined);
    return undefined;
  }
}

export const isBun = () => typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
