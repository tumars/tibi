import { Core, uuidv7 } from '@tibi/core';
import { SqliteDict } from './dict.js';
import { nodePlatform } from './platform.js';
import { openAppDb, openDictDb } from './sqlite.js';
import { isBun, openAppDbBun, openDictDbBun } from './sqlite-bun.js';
import { makeJobRunner } from './jobs.js';

/** 组装桌面端的 Core：数据库、词典、平台、内核；各领域的方法表在这里挂上 */
export async function createCore(opts: { dbPath: string; dictPath?: string; version: string; getSecret?: (ref: string) => Promise<string | undefined> }) {
  const db = await (isBun() ? openAppDbBun(opts.dbPath) : openAppDb(opts.dbPath));
  const t = Date.now();
  await db.run("INSERT OR IGNORE INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  const dictDb = await (isBun() ? openDictDbBun(opts.dictPath) : openDictDb(opts.dictPath));
  const platform = nodePlatform({
    app_version: opts.version, db_path: opts.dbPath,
    getSecret: opts.getSecret ?? (async ref => process.env[`TIBI_SECRET_${ref.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`]),
  });
  const core = new Core({ db, dict: dictDb ? new SqliteDict(dictDb) : undefined, platform, jobs: makeJobRunner() });
  void uuidv7;
  return core;
}
