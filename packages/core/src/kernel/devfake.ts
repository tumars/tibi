import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { ResolvedModel } from './agent.js';

/**
 * 开发用的假模型（core-node `--fake-model`）：不联网、不花钱，按提示的类型给出形状正确的回答，
 * 用来在浏览器里走通对话、总结、译文、语境释义的界面。不进正式构建的默认路径。
 */
const MODEL = { id: 'dev-fake', name: 'Dev Fake', api: 'openai-completions', provider: 'dev', baseUrl: 'http://dev', input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 4000 } as unknown as Model<Api>;

function reply(all: string, last: string): string {
  if (all.includes('"summary"')) return JSON.stringify({ summary: '（假模型）这篇文章讲了一件事，这里是三句中文总结的占位。', keywords: ['example'], advice: '（假模型）生词不多，可以直接读。' });
  if (all.includes('"phrases"')) return JSON.stringify({ phrases: [] });
  if (all.includes('"hard_sentences"')) return JSON.stringify({ hard_sentences: [] });
  if (all.includes('JSON 字符串数组')) { try { const arr = JSON.parse(last.slice(last.indexOf('['), last.lastIndexOf(']') + 1)) as string[]; return JSON.stringify(arr.map((_, i) => `（假译文 ${i + 1}）`)); } catch { return '[]'; } }
  if (all.includes('只输出这个词在这句话里的中文意思')) return '（假释义）';
  if (all.includes('英语学习教练')) return JSON.stringify({ text: '（假模型）最近两周阅读时间比上两周少，复习保持得不错。可以每天先读 10 分钟再复习。', actions: ['library', 'review'] });
  if (/Reply with exactly: OK/.test(all)) return 'OK';
  return `（开发用的假模型，没有真的调用 AI）\n\n你问的是：**${last.slice(0, 200)}**\n\n- 连上真实模型后，这里是 Tibi 的回答\n- 回答支持 *Markdown*、\`代码\` 和列表`;
}

const stream: StreamFn = (model, context) => {
  const s = createAssistantMessageEventStream();
  const msgs = (context as unknown as { messages: { role: string; content: unknown }[] }).messages;
  const all = JSON.stringify(msgs);
  const lastUser = [...msgs].reverse().find(m => m.role === 'user');
  const c = lastUser?.content;
  const last = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x as { text?: string }).text ?? '').join('') : '';
  const text = reply(all, last);
  const base: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 70, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
  void (async () => {
    s.push({ type: 'start', partial: base });
    s.push({ type: 'text_start', contentIndex: 0, partial: base });
    for (const ch of text.match(/.{1,6}/gs) ?? []) { await new Promise(r => setTimeout(r, 25)); s.push({ type: 'text_delta', contentIndex: 0, delta: ch, partial: base }); }
    s.push({ type: 'text_end', contentIndex: 0, content: text, partial: base });
    const final: AssistantMessage = { ...base, content: [{ type: 'text', text }] };
    s.push({ type: 'done', reason: 'stop', message: final }); s.end(final);
  })();
  return s;
};

export async function devFakeResolver(): Promise<ResolvedModel> { return { model: MODEL, apiKey: 'dev', streamFn: stream }; }
