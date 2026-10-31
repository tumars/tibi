import { assembleCore, type KernelOptions } from '@tibi/core';
import { SqliteDict } from './dict.js';
import { nodePlatform } from './platform.js';
import { openAppDb, openDictDb } from './sqlite.js';
import { isBun, openAppDbBun, openDictDbBun } from './sqlite-bun.js';

/** 组装桌面端的 Core：按运行时选 SQLite 驱动，接上词典、平台，再交给 assembleCore 挂内核与各领域模块 */
export async function createCore(opts: { dbPath: string; dictPath?: string; version: string; getSecret?: (ref: string) => Promise<string | undefined>; resolveModel?: KernelOptions['resolveModel'] }) {
  const db = await (isBun() ? openAppDbBun(opts.dbPath) : openAppDb(opts.dbPath));
  const t = Date.now();
  await db.run("INSERT OR IGNORE INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  const dictDb = await (isBun() ? openDictDbBun(opts.dictPath) : openDictDb(opts.dictPath));
  const platform = nodePlatform({
    app_version: opts.version, db_path: opts.dbPath,
    getSecret: opts.getSecret ?? (async ref => process.env[`TIBI_SECRET_${ref.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`]),
  });
  const { core } = await assembleCore({ db, dict: dictDb ? new SqliteDict(dictDb) : undefined, platform, resolveModel: opts.resolveModel, device: 'desktop' });
  return core;
}
