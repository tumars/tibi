import { j, now, type Database } from '../db/driver.js';
import { uuidv7 } from '../ids.js';
import { TibiError } from '../types.js';

/**
 * 用量与预算（05 §8、01 §7 usage_records）。
 * 花费以人民币存；pi-ai 报的价格是美元，按 USD_CNY 换算（汇率是常量，只用于预算提示，不做财务用途）。
 */
export const USD_CNY = 7.2;
export const DEFAULT_BUDGET = { month: 20, task: 1 };

export interface UsageInput { job_id?: string; job_step_id?: string; skill_id?: string; model: string; input_tokens: number; cached_tokens: number; output_tokens: number; cost_cny: number }

export async function recordUsage(db: Database, u: UsageInput): Promise<string> {
  const id = uuidv7();
  await db.run('INSERT INTO usage_records(id, job_id, job_step_id, skill_id, model, input_tokens, cached_tokens, output_tokens, cost, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, u.job_id ?? null, u.job_step_id ?? null, u.skill_id ?? null, u.model, u.input_tokens, u.cached_tokens, u.output_tokens, u.cost_cny, now()]);
  return id;
}

export function monthStart(t: number = now()): number { const d = new Date(t); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }

export async function budgets(db: Database): Promise<{ month: number; task: number }> {
  const rows = await db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('budget.month', 'budget.task')");
  const m = Object.fromEntries(rows.map(r => [r.key, j.parse<number>(r.value, 0)]));
  return { month: m['budget.month'] ?? DEFAULT_BUDGET.month, task: m['budget.task'] ?? DEFAULT_BUDGET.task };
}

export async function monthSpent(db: Database): Promise<number> {
  const r = await db.get<{ c: number | null }>('SELECT sum(cost) AS c FROM usage_records WHERE created_at >= ?', [monthStart()]);
  return Number(r?.c ?? 0);
}

export async function jobSpent(db: Database, job_id: string): Promise<number> {
  const r = await db.get<{ c: number | null }>('SELECT sum(cost) AS c FROM usage_records WHERE job_id = ?', [job_id]);
  return Number(r?.c ?? 0);
}

/** 调用模型前检查（06 §1：超出返回 budget_exceeded）；estimate 为这次预估花费（人民币） */
export async function checkBudget(db: Database, job_id: string | undefined, estimate = 0.02): Promise<void> {
  const b = await budgets(db);
  const spent = await monthSpent(db);
  if (spent + estimate > b.month) throw new TibiError('budget_exceeded', `本月 AI 花费已到上限（¥${b.month}）。可以在设置 → 高级里调整`);
  if (job_id) {
    const js = await jobSpent(db, job_id);
    if (js + estimate > b.task) throw new TibiError('budget_exceeded', `这个任务的花费已到上限（¥${b.task}）`);
  }
}

export async function skillMonthCost(db: Database, skill_id: string): Promise<number> {
  const r = await db.get<{ c: number | null }>('SELECT sum(cost) AS c FROM usage_records WHERE skill_id = ? AND created_at >= ?', [skill_id, monthStart()]);
  return Number(r?.c ?? 0);
}
