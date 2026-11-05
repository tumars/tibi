import { now, type Database } from '../../db/driver.js';
import type { Platform } from '../../platform.js';
import { UNDO_TTL_MS } from '../shared/undo.js';

/** 刚写下、还没入库的图片（导入做到一半）不删 */
const FRESH_MS = 60 * 60 * 1000;

/**
 * 清掉没有文档再用的书内图片（Platform.saveAsset 存的 assets/<key>/）：文档只软删（可撤销、要同步），
 * 所以删文档时不动图片，启动时再收：没被任何没删的文档、或还在撤销期内的文档引用的目录才删。
 */
export async function pruneAssets(db: Database, platform: Platform): Promise<number> {
  if (!platform.listAssets || !platform.removeAssets) return 0;
  const dirs = await platform.listAssets(); if (!dirs.length) return 0;
  const t = now();
  const rows = await db.all<{ content_md: string }>("SELECT s.content_md FROM sections s JOIN documents d ON d.id = s.document_id WHERE (d.deleted_at IS NULL OR d.deleted_at > ?) AND s.content_md LIKE '%](asset:%'", [t - UNDO_TTL_MS]);
  const used = new Set<string>();
  for (const r of rows) for (const m of r.content_md.matchAll(/\]\(asset:([\w-]+)\//g)) used.add(m[1]!);
  let removed = 0;
  for (const d of dirs) {
    if (used.has(d.key) || d.modified_at > t - FRESH_MS) continue;
    await platform.removeAssets(d.key).then(() => { removed++; }, () => undefined);
  }
  return removed;
}
