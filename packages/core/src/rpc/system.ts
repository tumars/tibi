import { Type } from '@sinclair/typebox';
import { method, type MethodMap } from './define.js';

/** system.*：启动与顶栏徽标（06 §3）。其余 system 方法随各自模块补 */
export const systemMethods: MethodMap = {
  'system.status': method(Type.Object({}), async (_p, ctx) => {
    const info = ctx.platform.info();
    const pending = await ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM jobs WHERE status = 'waiting_approval'");
    const running = await ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM jobs WHERE status IN ('running', 'queued')");
    const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
    const spent = await ctx.db.get<{ c: number }>('SELECT COALESCE(sum(cost), 0) AS c FROM usage_records WHERE created_at >= ?', [month.getTime()]);
    const budget = await ctx.db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('budget.month', 'budget.task')");
    const b = Object.fromEntries(budget.map(r => [r.key, JSON.parse(r.value) as number]));
    const providers = await ctx.db.all<{ tier: string; model: string }>("SELECT tier, model FROM providers WHERE kind = 'llm' AND deleted_at IS NULL AND tier IS NOT NULL");
    const fast = providers.find(p => p.tier === 'fast')?.model;
    const deep = providers.find(p => p.tier === 'deep')?.model;
    return {
      version: info.app_version, db_path: info.db_path, offline: !ctx.platform.isOnline(),
      models: { fast, deep, ok: !!fast },
      budget: { month_spent: Number(spent?.c ?? 0), limit: b['budget.month'] ?? 20, per_task: b['budget.task'] ?? 1 },
      pending_approvals: Number(pending?.n ?? 0), running_tasks: Number(running?.n ?? 0),
    };
  }, '启动与顶栏徽标'),
};
