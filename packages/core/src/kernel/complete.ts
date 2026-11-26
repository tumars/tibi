import { Agent, type StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { now } from '../db/driver.js';
import type { Ctx } from '../rpc/define.js';
import { TibiError, type Tier } from '../types.js';
import type { ResolvedModel } from './agent.js';
import { friendlyModelError } from './model-errors.js';

/**
 * 一次性模型调用（不走技能、不在对话里）：语境释义、导入后的总结、"测试连接"用（06 terms.context_meaning、providers.test）。
 * 没有可用模型时抛 model_unavailable。
 */
export interface CompleteOptions { tier?: Tier; provider_id?: string; system: string; prompt: string; max_tokens?: number; signal?: AbortSignal }
export interface CompleteResult { text: string; model: string; latency_ms: number }
export type Resolver = (ctx: Ctx, tier: Tier, provider_id?: string) => Promise<ResolvedModel>;

async function isLocalProvider(ctx: Ctx, tier: Tier, provider_id?: string): Promise<boolean> {
  const row = provider_id
    ? await ctx.db.get<{ protocol: string; base_url: string | null }>('SELECT protocol, base_url FROM providers WHERE id = ? AND deleted_at IS NULL', [provider_id])
    : await ctx.db.get<{ protocol: string; base_url: string | null }>("SELECT protocol, base_url FROM providers WHERE kind = 'llm' AND deleted_at IS NULL AND (tier = ? OR is_default = 1) ORDER BY CASE WHEN tier = ? THEN 0 ELSE 1 END LIMIT 1", [tier, tier]);
  if (!row) return false;
  if (row.protocol === 'ollama') return true;
  if (row.base_url) {
    try { const h = new URL(row.base_url).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '::1'; } catch { /* ignore */ }
  }
  return false;
}

export async function completeOnce(ctx: Ctx, resolve: Resolver, o: CompleteOptions): Promise<CompleteResult> {
  if (o.signal?.aborted) throw new TibiError('busy', '已取消');
  const tier = o.tier ?? 'fast';
  if (!ctx.platform.isOnline() && !(await isLocalProvider(ctx, tier, o.provider_id))) throw new TibiError('offline', '现在没有网络');
  const resolved = await resolve(ctx, tier, o.provider_id);
  if (o.signal?.aborted) throw new TibiError('busy', '已取消');
  const streamFn: StreamFn = o.max_tokens
    ? (model, context, opts) => resolved.streamFn(model, context, { ...opts, maxTokens: o.max_tokens })
    : resolved.streamFn;
  const agent = new Agent({ initialState: { systemPrompt: o.system, model: resolved.model, tools: [], messages: [] }, streamFn, getApiKey: () => resolved.apiKey });
  const onAbort = () => agent.abort();
  o.signal?.addEventListener('abort', onAbort, { once: true });
  let msg: AssistantMessage | undefined;
  const unsub = agent.subscribe(ev => { if (ev.type === 'message_end' && ev.message.role === 'assistant') msg = ev.message as AssistantMessage; });
  const t0 = now();
  try { await agent.prompt(o.prompt); } finally { unsub(); o.signal?.removeEventListener('abort', onAbort); }
  const latency_ms = now() - t0;
  if (!msg) throw new TibiError('model_unavailable', '模型没有回复');
  if (msg.stopReason === 'error' || msg.stopReason === 'aborted') throw new TibiError('model_unavailable', friendlyModelError(msg.errorMessage ?? String(msg.stopReason)));
  const text = msg.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text').map(c => c.text).join('').trim();
  return { text, model: msg.model, latency_ms };
}
