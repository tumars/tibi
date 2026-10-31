import { Database, MIGRATIONS, migrate, PRAGMAS, type Driver, type Row, type SqlParams } from '@tibi/core';

/**
 * 手机上 Core 的 SQLite 驱动（T28）：经 Tauri 命令 db_exec / db_run / db_all 走壳里的 rusqlite（src-tauri/src/local_db.rs）。
 * 每个库一条连接、串行执行，所以 BEGIN … COMMIT 跨多次调用也成立。这里不直接引 Tauri，invoke 由外面传进来（单测里换成 better-sqlite3）。
 */
export type Invoke = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;

export class InvokeDriver implements Driver {
  constructor(private readonly invoke: Invoke, private readonly name: string) {}
  async exec(sql: string) { await this.invoke('db_exec', { name: this.name, sql }); }
  async run(sql: string, params?: SqlParams) { return this.invoke<{ changes: number }>('db_run', { name: this.name, sql, params: norm(params) }); }
  async all<T extends Row = Row>(sql: string, params?: SqlParams) { return this.invoke<T[]>('db_all', { name: this.name, sql, params: norm(params) }); }
  async get<T extends Row = Row>(sql: string, params?: SqlParams): Promise<T | undefined> { return (await this.all<T>(sql, params))[0]; }
  async close() { /* 连接由壳管 */ }
}

/** 参数过 JSON：布尔转 0 / 1，Uint8Array 转数组（壳里转回 BLOB） */
function norm(params?: SqlParams): unknown[] | undefined {
  if (!params) return undefined;
  return (params as unknown[]).map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof Uint8Array ? Array.from(v) : v === undefined ? null : v));
}

/** 打开 app.db（建表、迁移）和随包的 dict.db（没有时返回 undefined） */
export async function openLocalDbs(invoke: Invoke): Promise<{ db: Database; dict?: Database; path: string }> {
  const { path } = await invoke<{ path: string }>('db_open', { name: 'app' });
  const db = new Database(new InvokeDriver(invoke, 'app'));
  for (const p of PRAGMAS) await db.exec(p);
  await migrate(db, MIGRATIONS);
  const t = Date.now();
  await db.run("INSERT OR IGNORE INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  const d = await invoke<{ path: string | null }>('db_open', { name: 'dict' });
  return { db, dict: d.path ? new Database(new InvokeDriver(invoke, 'dict')) : undefined, path };
}
