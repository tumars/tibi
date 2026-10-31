import { openAppDb } from '@tibi/core-node';
import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Api, type ToolCall } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { Core, EventBus, fakePlatform, undoMethods, type CoreEventName } from '../../src/index.js';
import { createKernel, type ResolvedModel } from '../../src/kernel/index.js';

/** 假模型：形状照 pi-ai 目录里的 deepseek-flash */
export const FAKE_MODEL = {
  id: 'fake-flash', name: 'Fake Flash', api: 'openai-completions', provider: 'fake', baseUrl: 'http://fake', input: ['text'],
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 8000,
} as unknown as Model<Api>;

export type Turn = { text?: string; toolCalls?: { name: string; args: Record<string, unknown> }[]; error?: string };

/**
 * 假的 streamFn：按脚本依次回复。每次调用吐出一条 assistant 消息（文本、工具调用或错误），
 * 用量固定：输入 100、输出 20 token。
 */
export function scriptedStream(turns: Turn[]): StreamFn & { calls: number } {
  let i = 0;
  const fn = ((model: Model<Api>) => {
    const stream = createAssistantMessageEventStream();
    const turn = turns[Math.min(i, turns.length - 1)] ?? { text: '' }; i++; (fn as { calls: number }).calls = i;
    const base: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: 0.0001, output: 0.00004, cacheRead: 0, cacheWrite: 0, total: 0.00014 } }, stopReason: 'stop', timestamp: Date.now() };
    queueMicrotask(() => {
      stream.push({ type: 'start', partial: base });
      if (turn.error) { const err = { ...base, stopReason: 'error' as const, errorMessage: turn.error }; stream.push({ type: 'error', reason: 'error', error: err }); stream.end(err); return; }
      let idx = 0;
      if (turn.text) {
        stream.push({ type: 'text_start', contentIndex: idx, partial: base });
        for (const ch of turn.text.match(/.{1,4}/gs) ?? []) stream.push({ type: 'text_delta', contentIndex: idx, delta: ch, partial: base });
        stream.push({ type: 'text_end', contentIndex: idx, content: turn.text, partial: base });
        base.content.push({ type: 'text', text: turn.text }); idx++;
      }
      for (const tc of turn.toolCalls ?? []) {
        const call: ToolCall = { type: 'toolCall', id: `call_${i}_${idx}`, name: tc.name, arguments: tc.args as never };
        stream.push({ type: 'toolcall_start', contentIndex: idx, partial: base });
        stream.push({ type: 'toolcall_end', contentIndex: idx, toolCall: call, partial: base });
        base.content.push(call); idx++;
      }
      const final: AssistantMessage = { ...base, stopReason: turn.toolCalls?.length ? 'toolUse' : 'stop' };
      stream.push({ type: 'done', reason: final.stopReason as 'stop' | 'toolUse', message: final });
      stream.end(final);
    });
    return stream;
  }) as StreamFn & { calls: number };
  fn.calls = 0;
  return fn;
}

export async function makeKernelCore(opts: { turns?: Turn[]; noModel?: boolean } = {}) {
  const db = await openAppDb(':memory:');
  const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  const bus = new EventBus();
  const stream = scriptedStream(opts.turns ?? [{ text: '好的。' }]);
  const resolveModel = opts.noModel ? undefined : async (): Promise<ResolvedModel> => ({ model: FAKE_MODEL, apiKey: 'k', streamFn: stream });
  const kernel = createKernel(db, bus, { resolveModel });
  const core = new Core({ db, platform: fakePlatform({ isOnline: () => true }), jobs: kernel.jobs });
  kernel.bind(caller => core.ctx(caller), core.events);
  core.use(kernel.methods);
  if (!core.dispatcher.has('system.undo')) core.use(undoMethods);
  const events: { event: CoreEventName; data: any }[] = [];
  core.events.on((event, data) => events.push({ event, data }));
  return { db, core, kernel, events, stream, call: <T = any>(m: string, p: unknown) => core.call<T>(m, p) };
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export async function until(fn: () => boolean | Promise<boolean>, timeout = 5000) {
  const t0 = Date.now();
  while (!(await fn())) { if (Date.now() - t0 > timeout) throw new Error('until 超时'); await sleep(10); }
}
