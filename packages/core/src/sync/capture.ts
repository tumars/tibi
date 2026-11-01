import type { Database } from '../db/driver.js';
import { TABLES, type TableSpec } from './spec.js';

/**
 * 变更捕获（08 §5）：开启同步后给每张同步表建触发器，把改动写进 sync_outbox。
 * 用触发器而不是在每个领域方法里记：所有写入都会被记下，以后加的写操作也不会漏。
 * 触发器按当前表结构生成（迁移加了列，下次启动重建），只在 sync_state.capture = '1' 时记录；
 * 应用别的设备的改动时临时设成 '0'，免得又被当成本机改动推回去。
 */
const META = new Set(['updated_at']);
const NOW_MS = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const ACTIVE = "(SELECT value FROM sync_state WHERE key = 'capture') = '1'";

export async function syncedColumns(db: Database, spec: TableSpec): Promise<string[]> {
  const cols = await db.all<{ name: string }>(`PRAGMA table_info(${spec.t})`);
  return cols.map(c => c.name).filter(c => !META.has(c) && !spec.exclude?.includes(c));
}
export const idExpr = (spec: TableSpec, alias: 'NEW' | 'OLD' | '') => spec.pk.map(k => (alias ? `${alias}.${k}` : k)).join(" || '|' || ");

function q(s: string) { return `'${s.replace(/'/g, "''")}'`; }

export async function triggerSql(db: Database, spec: TableSpec): Promise<string[]> {
  const cols = await syncedColumns(db, spec);
  const obj = (a: string) => `json_object(${cols.map(c => `${q(c)}, ${a}.${c}`).join(', ')})`;
  const local = (a: string) => (spec.localGlobs ?? []).map(g => ` AND ${a}.key NOT GLOB ${q(g)}`).join('');
  const out: string[] = [];
  if (spec.kind === 'add') {
    out.push(`CREATE TRIGGER sync_${spec.t}_ins AFTER INSERT ON ${spec.t} WHEN ${ACTIVE} BEGIN
  INSERT INTO sync_outbox(t, id, op, f, chg, ms) VALUES (${q(spec.t)}, ${idExpr(spec, 'NEW')}, 'add', ${obj('NEW')}, NULL, ${NOW_MS});
END`);
    return out;
  }
  out.push(`CREATE TRIGGER sync_${spec.t}_ins AFTER INSERT ON ${spec.t} WHEN ${ACTIVE}${local('NEW')} BEGIN
  INSERT INTO sync_outbox(t, id, op, f, chg, ms) VALUES (${q(spec.t)}, ${idExpr(spec, 'NEW')}, 'put', ${obj('NEW')}, NULL, ${NOW_MS});
END`);
  const changed = cols.map(c => `OLD.${c} IS NOT NEW.${c}`).join(' OR ');
  const pkChanged = spec.pk.map(k => `OLD.${k} IS NOT NEW.${k}`).join(' OR ');
  // 主键变了（合并重复时改指向）：旧 ID 记一条删除，新 ID 记整行
  out.push(`CREATE TRIGGER sync_${spec.t}_rekey AFTER UPDATE ON ${spec.t} WHEN ${ACTIVE}${local('OLD')} AND (${pkChanged}) BEGIN
  INSERT INTO sync_outbox(t, id, op, f, chg, ms) VALUES (${q(spec.t)}, ${idExpr(spec, 'OLD')}, 'del', NULL, NULL, ${NOW_MS});
  INSERT INTO sync_outbox(t, id, op, f, chg, ms) VALUES (${q(spec.t)}, ${idExpr(spec, 'NEW')}, 'put', ${obj('NEW')}, NULL, ${NOW_MS});
END`);
  out.push(`CREATE TRIGGER sync_${spec.t}_upd AFTER UPDATE ON ${spec.t} WHEN ${ACTIVE}${local('NEW')} AND NOT (${pkChanged}) AND (${changed}) BEGIN
  INSERT INTO sync_outbox(t, id, op, f, chg, ms) VALUES (${q(spec.t)}, ${idExpr(spec, 'NEW')}, 'put', ${obj('NEW')}, json_array(${cols.map(c => `CASE WHEN OLD.${c} IS NOT NEW.${c} THEN ${q(c)} END`).join(', ')}), ${NOW_MS});
END`);
  out.push(`CREATE TRIGGER sync_${spec.t}_del AFTER DELETE ON ${spec.t} WHEN ${ACTIVE}${local('OLD')} BEGIN
  INSERT INTO sync_outbox(t, id, op, f, chg, ms) VALUES (${q(spec.t)}, ${idExpr(spec, 'OLD')}, 'del', NULL, NULL, ${NOW_MS});
END`);
  return out;
}

export async function dropTriggers(db: Database) {
  const rows = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync\\_%' ESCAPE '\\'");
  for (const r of rows) await db.exec(`DROP TRIGGER IF EXISTS ${r.name}`);
}

/** 按当前表结构重建全部同步触发器 */
export async function ensureTriggers(db: Database) {
  await dropTriggers(db);
  for (const spec of TABLES) for (const sql of await triggerSql(db, spec)) await db.exec(sql);
}
