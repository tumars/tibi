import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAppDb, PiEngine } from '@tibi/core-node';
import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Api, type ToolCall } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { Core, EventBus, fakePlatform, streamProvider, undoMethods, type CoreEventName, type Platform } from '../../src/index.js';
import { Conversations, createKernel, type Kernel, type ResolvedModel } from '../../src/kernel/index.js';
import type { Database } from '../../src/db/driver.js';

/** 假模型：形状照 pi-ai 目录里的 deepseek-flash */
export const FAKE_MODEL = {
  id: 'fake-flash', name: 'Fake Flash', api: 'openai-completions', provider: 'fake', baseUrl: 'http://fake', input: ['text'],
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 8000,
} as unknown as Model<Api>;

export type Turn = { text?: string; thinking?: string; toolCalls?: { name: string; args: Record<string, unknown> }[]; error?: string };

/**
 * 假的 streamFn：按脚本依次回复。每次调用吐出一条 assistant 消息（文本、工具调用或错误），
 * 用量固定：输入 100、输出 20 token。
 */
export function scriptedStream(turns: Turn[]): StreamFn & { calls: number; reset(): void; contexts: string[]; systems: string[] } {
  let i = 0; let run = 0;
  const fn = ((model: Model<Api>, context: unknown, options?: { signal?: AbortSignal }) => {
    fn.contexts.push(JSON.stringify((context as { messages: unknown }).messages));
    fn.systems.push(JSON.stringify((context as { systemPrompt?: unknown }).systemPrompt ?? ''));
    const stream = createAssistantMessageEventStream();
    const turn = turns[Math.min(i, turns.length - 1)] ?? { text: '' }; i++; (fn as { calls: number }).calls = i;
    const base: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: 0.0001, output: 0.00004, cacheRead: 0, cacheWrite: 0, total: 0.00014 } }, stopReason: 'stop', timestamp: Date.now() };
    queueMicrotask(() => {
      stream.push({ type: 'start', partial: base });
      if (options?.signal?.aborted) { const err = { ...base, stopReason: 'aborted' as const, errorMessage: 'aborted' }; stream.push({ type: 'error', reason: 'aborted', error: err }); stream.end(err); return; }
      if (turn.error) { const err = { ...base, stopReason: 'error' as const, errorMessage: turn.error }; stream.push({ type: 'error', reason: 'error', error: err }); stream.end(err); return; }
      let idx = 0;
      if (turn.thinking) {
        stream.push({ type: 'thinking_start', contentIndex: idx, partial: base });
        stream.push({ type: 'thinking_delta', contentIndex: idx, delta: turn.thinking, partial: base });
        stream.push({ type: 'thinking_end', contentIndex: idx, content: turn.thinking, partial: base });
        base.content.push({ type: 'thinking', thinking: turn.thinking }); idx++;
      }
      if (turn.text) {
        stream.push({ type: 'text_start', contentIndex: idx, partial: base });
        for (const ch of turn.text.match(/.{1,4}/gs) ?? []) stream.push({ type: 'text_delta', contentIndex: idx, delta: ch, partial: base });
        stream.push({ type: 'text_end', contentIndex: idx, content: turn.text, partial: base });
        base.content.push({ type: 'text', text: turn.text }); idx++;
      }
      for (const tc of turn.toolCalls ?? []) {
        const call: ToolCall = { type: 'toolCall', id: `call_${run}_${i}_${idx}`, name: tc.name, arguments: tc.args as never };
        stream.push({ type: 'toolcall_start', contentIndex: idx, partial: base });
        stream.push({ type: 'toolcall_end', contentIndex: idx, toolCall: call, partial: base });
        base.content.push(call); idx++;
      }
      const final: AssistantMessage = { ...base, stopReason: turn.toolCalls?.length ? 'toolUse' : 'stop' };
      stream.push({ type: 'done', reason: final.stopReason as 'stop' | 'toolUse', message: final });
      stream.end(final);
    });
    return stream;
  }) as StreamFn & { calls: number; reset(): void; contexts: string[]; systems: string[] };
  fn.calls = 0; fn.contexts = []; fn.systems = [];
  /** 脚本从头再来，工具调用 id 换一批：相当于崩溃恢复后模型重新回答 */
  fn.reset = () => { i = 0; run++; };
  return fn;
}

export async function makeKernelCore(opts: { turns?: Turn[]; noModel?: boolean; compaction?: { reserveTokens?: number; keepRecentTokens?: number }; platform?: Partial<Platform> } = {}) {
  const db = await openAppDb(':memory:');
  const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  const bus = new EventBus();
  const stream = scriptedStream(opts.turns ?? [{ text: '好的。' }]);
  const provider = streamProvider(FAKE_MODEL, stream);
  const resolved: { tier: string; provider_id?: string }[] = [];
  const resolveModel = opts.noModel ? undefined : async (_ctx: unknown, tier: string, provider_id?: string): Promise<ResolvedModel> => { resolved.push({ tier, provider_id }); return { model: FAKE_MODEL, apiKey: 'k', streamFn: stream, provider }; };
  // 真的 pi 会话，模型是按脚本回复的假服务商；测试里不重试（脚本按调用次数走）
  const engine = new PiEngine({ workDir: mkdtempSync(join(tmpdir(), 'tibi-engine-')), retry: { maxRetries: 0 }, compaction: opts.compaction });
  const kernel = createKernel(db, bus, { resolveModel, engine });
  dbOf.set(kernel, db);
  const core = new Core({ db, platform: fakePlatform({ isOnline: () => true, ...opts.platform }) });
  kernel.bind(caller => core.ctx(caller), core.events);
  core.use(kernel.methods);
  if (!core.dispatcher.has('system.undo')) core.use(undoMethods);
  const events: { event: CoreEventName; data: any }[] = [];
  core.events.on((event, data) => events.push({ event, data }));
  return { db, core, kernel, engine, events, stream, resolved, call: <T = any>(m: string, p: unknown) => core.call<T>(m, p) };
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export async function until(fn: () => boolean | Promise<boolean>, timeout = 5000) {
  const t0 = Date.now();
  while (!(await fn())) { if (Date.now() - t0 > timeout) throw new Error('until 超时'); await sleep(10); }
}

const dbOf = new WeakMap<Kernel, Database>();
/** 等这一轮回答结束，返回记在对话里的结果：done / error / cancel */
export async function finished(kernel: Kernel, turn_id: string, db?: Database): Promise<{ status: string; error?: string }> {
  await kernel.turns.wait(turn_id);
  const t = await new Conversations(db ?? dbOf.get(kernel)!).turn(turn_id);
  return { status: t?.state ?? 'unknown', ...(t?.error ? { error: t.error } : {}) };
}
