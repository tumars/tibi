import { openAppDb } from '@tibi/core-node';
import { Core, fakePlatform, NullDict, type Ctx, type Dict, type Platform } from '../src/index.js';
import { idle, importDone, type ImportOutcome } from '../src/domain/documents/imports.js';

/** 测试辅助：内存库 + 假平台。导入、总结在后台跑，settle() 等它们做完 */
export async function makeCore(opts: { dict?: Dict; platform?: Partial<Platform> } = {}) {
  const db = await openAppDb(':memory:');
  const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  const core = new Core({ db, dict: opts.dict ?? new NullDict(), platform: fakePlatform(opts.platform) });
  return { core, db, settle: idle, ctx: core.ctx({ origin: 'ui' }) as Ctx };
}

/** documents.import 的结果：等这次导入做完（成功或失败） */
export async function imported(r: { import_id: string }): Promise<ImportOutcome> {
  const p = importDone(r.import_id);
  if (!p) throw new Error(`没有这次导入：${r.import_id}`);
  return p;
}
