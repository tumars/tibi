import { Agent } from '@earendil-works/pi-agent-core';
import { calculateCost, type AssistantMessage } from '@earendil-works/pi-ai';
import { now } from '../db/driver.js';
import type { Ctx } from '../rpc/define.js';
import { TibiError, type Tier } from '../types.js';
import type { ResolvedModel } from './agent.js';
import { friendlyModelError } from './model-errors.js';
import { checkBudget, monthSpent, recordUsage, USD_CNY } from './usage.js';

/**
 * 一次性模型调用（不走技能、不建任务）：M1 的语境释义和"测试连接"用（06 terms.context_meaning、providers.test）。
 * 照样检查预算、记 usage_records；没有可用模型时抛 model_unavailable。
 */
export interface CompleteOptions { tier?: Tier; provider_id?: string; system: string; prompt: string; skill_id?: string; job_id?: string; max_tokens?: number; signal?: AbortSignal; budget?: boolean }
export interface CompleteResult { text: string; model: string; latency_ms: number; cost: number }
export type Resolver = (ctx: Ctx, tier: Tier, provider_id?: string) => Promise<ResolvedModel>;

export async function completeOnce(ctx: Ctx, resolve: Resolver, o: CompleteOptions): Promise<CompleteResult> {
  if (!ctx.platform.isOnline()) throw new TibiError('offline', '现在没有网络');
  const resolved = await resolve(ctx, o.tier ?? 'fast', o.provider_id);
  if (o.budget !== false) await checkBudget(ctx.db, o.job_id, 0.01);
  const agent = new Agent({ initialState: { systemPrompt: o.system, model: resolved.model, tools: [], messages: [] }, streamFn: resolved.streamFn, getApiKey: () => resolved.apiKey });
  const onAbort = () => agent.abort();
  o.signal?.addEventListener('abort', onAbort, { once: true });
  let msg: AssistantMessage | undefined;
  const unsub = agent.subscribe(ev => { if (ev.type === 'message_end' && ev.message.role === 'assistant') msg = ev.message as AssistantMessage; });
  const t0 = now();
  try { await agent.prompt(o.prompt); } finally { unsub(); o.signal?.removeEventListener('abort', onAbort); }
  const latency_ms = now() - t0;
  if (!msg) throw new TibiError('model_unavailable', '模型没有回复');
  if (msg.stopReason === 'error' || msg.stopReason === 'aborted') throw new TibiError('model_unavailable', friendlyModelError(msg.errorMessage ?? String(msg.stopReason)));
  const u = msg.usage;
  let usd = u?.cost?.total ?? 0;
  if (!usd && u) { try { usd = calculateCost(resolved.model, u).total; } catch { usd = 0; } }
  const cost = usd * USD_CNY;
  if (u) await recordUsage(ctx.db, { job_id: o.job_id, skill_id: o.skill_id, model: msg.model, input_tokens: u.input, cached_tokens: u.cacheRead, output_tokens: u.output, cost_cny: cost });
  ctx.events.emit('usage.updated', { skill_id: o.skill_id, month_cost: cost, total: await monthSpent(ctx.db) });
  const text = msg.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text').map(c => c.text).join('').trim();
  return { text, model: msg.model, latency_ms, cost };
}
