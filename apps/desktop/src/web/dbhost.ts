import type { Database as WasmDb } from '@sqlite.org/sqlite-wasm';

/**
 * Web 版 Worker 里的数据库命令（12 §2）：命令名和参数跟手机壳的 local_db.rs 一样（db_open / db_exec / db_run / db_all），
 * 所以页面这边照用 InvokeDriver。和 Worker、OPFS 分开写，单测里用 Node 版 sqlite-wasm 的内存库跑。
 * 词典是第一次用时下载的（§4）：下载完之前查词的请求等着；没有词典时查不到东西，不报错。
 */
export interface DbSources {
  /** 打开 app.db；path 显示在设置里 */
  app(): { db: WasmDb; path: string };
  /** 打开词典（可能要先下载）；没有时 undefined */
  dict(): Promise<WasmDb | undefined>;
}

type Args = { name?: string; sql?: string; params?: unknown[] | null };

export function createDbHost(src: DbSources) {
  let app: WasmDb | undefined; let appPath = '';
  let dict: Promise<WasmDb | undefined> | undefined;
  const dictDb = () => (dict ??= src.dict().catch(e => { console.warn('[tibi] 词典打不开', e); return undefined; }));
  const dbOf = async (name?: string) => {
    if (name === 'app') { if (!app) ({ db: app, path: appPath } = src.app()); return app; }
    if (name === 'dict') return dictDb();
    throw new Error(`没有这个库：${name}`);
  };

  return async function handle(cmd: string, a: Args): Promise<unknown> {
    if (cmd === 'db_open') {
      if (a.name === 'app') { await dbOf('app'); return { path: appPath }; }
      void dictDb();   // 后台下载，Core 不用等
      return { path: 'dict' };
    }
    const db = await dbOf(a.name);
    if (cmd === 'db_exec') { db?.exec(a.sql!); return null; }
    if (cmd === 'db_run') {
      if (!db) return { changes: 0 };
      const before = db.changes(true);
      db.exec({ sql: a.sql!, bind: bindOf(a.params) });
      return { changes: db.changes(true) - before };
    }
    if (cmd === 'db_all') {
      if (!db) return [];
      const rows = db.exec({ sql: a.sql!, bind: bindOf(a.params), rowMode: 'object', returnValue: 'resultRows' }) as Record<string, unknown>[];
      for (const r of rows) for (const k in r) if (typeof r[k] === 'bigint') r[k] = Number(r[k]);
      return rows;
    }
    throw new Error(`没有这个命令：${cmd}`);
  };
}

/** InvokeDriver 把 Uint8Array 转成了数组（为了过 JSON），这里转回 BLOB */
function bindOf(params?: unknown[] | null) {
  if (!params?.length) return undefined;
  return params.map(v => (Array.isArray(v) ? new Uint8Array(v as number[]) : v)) as (string | number | null | Uint8Array)[];
}
