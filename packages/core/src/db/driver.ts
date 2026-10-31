/**
 * 数据库驱动接口：Core 只通过它访问 SQLite（05 §11、08 §9）。
 * 桌面用 better-sqlite3（core-node），手机用平台 SQLite，测试用内存库；
 * 全部异步，这样同一份 Core 能跑在不同运行时里。
 */

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlParams = SqlValue[] | Record<string, SqlValue>;
export type Row = Record<string, SqlValue>;

export interface Driver {
  /** 执行不返回行的语句（可多条，用于建表） */
  exec(sql: string): Promise<void>;
  /** 执行一条语句，返回受影响行数 */
  run(sql: string, params?: SqlParams): Promise<{ changes: number }>;
  /** 查询多行 */
  all<T extends Row = Row>(sql: string, params?: SqlParams): Promise<T[]>;
  /** 查询一行 */
  get<T extends Row = Row>(sql: string, params?: SqlParams): Promise<T | undefined>;
  close(): Promise<void>;
}

/**
 * 带事务与互斥的数据库句柄。Core 是唯一写入者（B2），所以用一把锁串行化事务：
 * 事务体可以是 async 函数，期间其他写入排队等候。
 */
export class Database {
  private chain: Promise<unknown> = Promise.resolve();
  private depth = 0;

  constructor(public readonly driver: Driver) {}

  exec(sql: string) { return this.driver.exec(sql); }
  run(sql: string, params?: SqlParams) { return this.driver.run(sql, params); }
  all<T extends Row = Row>(sql: string, params?: SqlParams) { return this.driver.all<T>(sql, params); }
  get<T extends Row = Row>(sql: string, params?: SqlParams) { return this.driver.get<T>(sql, params); }

  /** 串行执行一个事务；嵌套调用时直接复用外层事务 */
  async transaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
    if (this.depth > 0) return fn(this);
    const run = async () => {
      this.depth++;
      await this.driver.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(this);
        await this.driver.exec('COMMIT');
        return out;
      } catch (e) {
        try { await this.driver.exec('ROLLBACK'); } catch { /* 已回滚 */ }
        throw e;
      } finally {
        this.depth--;
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  close() { return this.driver.close(); }
}

export const now = () => Date.now();

/** JSON 字段读写 */
export const j = {
  parse<T>(v: SqlValue | undefined, fallback: T): T {
    if (v == null || v === '') return fallback;
    try { return JSON.parse(String(v)) as T; } catch { return fallback; }
  },
  str(v: unknown): string { return JSON.stringify(v ?? null); },
};
