import { Type } from '@sinclair/typebox';
import { backupNow, listBackups } from '../domain/backup.js';
import { method, type MethodMap } from './define.js';

/** system.*：启动与顶栏徽标（06 §3）。其余 system 方法随各自模块补 */
export const systemMethods: MethodMap = {
  'system.registerPaths': method(Type.Object({ paths: Type.Array(Type.String()) }), async (p, ctx) => { ctx.platform.registerPaths(p.paths); return { ok: true as const }; }, '壳把 pick_file / 拖入的路径登记给 Core；能力层的 path 只认登记过的'),
  'system.status': method(Type.Object({}), async (_p, ctx) => {
    const info = ctx.platform.info();
    const providers = await ctx.db.all<{ tier: string; model: string }>("SELECT tier, model FROM providers WHERE kind = 'llm' AND deleted_at IS NULL AND tier IS NOT NULL");
    const fast = providers.find(p => p.tier === 'fast')?.model;
    const deep = providers.find(p => p.tier === 'deep')?.model;
    return {
      version: info.app_version, db_path: info.db_path, offline: !ctx.platform.isOnline(),
      models: { fast, deep, ok: !!(fast ?? deep) },
    };
  }, '启动与顶栏徽标'),
  'system.backup': method(Type.Object({ reason: Type.Optional(Type.Union([Type.Literal('manual'), Type.Literal('before_reset'), Type.Literal('before_restore'), Type.Literal('before_update')])) }), async (p, ctx) => {
    const f = await backupNow(ctx.db, ctx.platform, p.reason ?? 'manual');
    return { path: f.path, size: f.size, created_at: f.created_at };
  }, '立即备份（VACUUM INTO 到 app.db 旁边的 backups/）；自动备份每天一次、只轮换自动的、保留 7 份'),
  'system.backups': method(Type.Object({}), async (_p, ctx) => {
    const row = await ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'backup.auto'");
    return { auto: row ? JSON.parse(row.value) !== false : true, dir_supported: !!ctx.platform.backups, items: await listBackups(ctx.platform) };
  }, '备份列表（新的在前）；恢复由壳做：停 Core → 先备份当前库 → 换文件 → 重启'),
};
