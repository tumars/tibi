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
 * 带事务与互斥的数据库句柄。Core 是唯一写入者（B2），所以用一把锁串行化事务（T3）：
 * 事务体可以是 async 函数，期间其他事务排队等候。
 * 嵌套按调用链判断：事务体拿到的 tx 是一个"事务内句柄"，在它上面再开事务直接复用；
 * 在外层句柄上开事务一律排队（并发的两个流程不会被误当成嵌套）。
 * 注意：事务体里要用 tx，不要再用外层的 db.transaction()，否则会等自己而卡住。
 */
export class Database {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(public readonly driver: Driver, private readonly inTx = false) {}

  exec(sql: string) { return this.driver.exec(sql); }
  run(sql: string, params?: SqlParams) { return this.driver.run(sql, params); }
  all<T extends Row = Row>(sql: string, params?: SqlParams) { return this.driver.all<T>(sql, params); }
  get<T extends Row = Row>(sql: string, params?: SqlParams) { return this.driver.get<T>(sql, params); }

  async transaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    const tx = new Database(this.driver, true);
    const run = async () => {
      await this.driver.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(tx);
        await this.driver.exec('COMMIT');
        return out;
      } catch (e) {
        try { await this.driver.exec('ROLLBACK'); } catch { /* 已回滚 */ }
        throw e;
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
