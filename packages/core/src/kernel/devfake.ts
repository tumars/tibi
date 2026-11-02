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
  if (all.includes('学生用目标词写了一个英文句子')) return JSON.stringify({ score: 78, ok: true, feedback: '（假模型）用法基本对，冠词漏了一个。', better: 'A lexer turns characters into tokens.' });
  if (all.includes('英语阅读材料作者')) return 'A Small Story About Words\n\n' + 'This is a short story written by the fake model so that the interface can be tested without a real model. '.repeat(5) + '\n\nIt uses the words you reviewed today in a simple way.';
  if (all.includes('英语学习教练')) return JSON.stringify({ text: '（假模型）最近两周阅读时间比上两周少，复习保持得不错。可以每天先读 10 分钟再复习。', actions: ['library', 'review'] });
  if (/Reply with exactly: OK/.test(all)) return 'OK';
  return `（开发用的假模型，没有真的调用 AI）\n\n你问的是：**${last.slice(0, 200)}**\n\n- 连上真实模型后，这里是 Tibi 的回答\n- 回答支持 *Markdown*、\`代码\` 和列表`;
}

const stream: StreamFn = (model, context, options) => {
  const s = createAssistantMessageEventStream();
  const msgs = (context as unknown as { messages: { role: string; content: unknown }[] }).messages;
  const all = JSON.stringify(msgs);
  const lastUser = [...msgs].reverse().find(m => m.role === 'user');
  const c = lastUser?.content;
  // 只看用户说的话，去掉系统附上的 <context> 前缀
  const last = (typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x as { text?: string }).text ?? '').join('') : '').replace(/^<context>[\s\S]*?<\/context>\n\n/, '');
  // 走通对话卡片和写入："卡片 查词 upshot"、"卡片 辨析 a b"、"卡片 练习"、"卡片 加词 a b"（写入回执）、"卡片 记住 一句话"（审批卡）、"卡片 反问"、"卡片 找文章 网址…"（反问卡）、"卡片 设置"、"卡片 改设置 1.2"、"卡片 改预算 30"（每次都问）
  const demo = msgs[msgs.length - 1]?.role === 'user' ? last.match(/^卡片 (查词|辨析|练习|加词|记住|反问|找文章|设置|改设置|改预算)\s*(.*)$/) : null;
  if (demo) {
    const words = demo[2]!.split(/\s+/).filter(Boolean);
    const call = demo[1] === '反问' ? { name: 'ask_user', args: { question: '想读哪种题材？', options: [{ label: '科技' }, { label: '小说', description: '轻松一点' }] } }
      : demo[1] === '找文章' ? { name: 'ask_user', args: { question: '想读哪几篇？', multi: true, options: words.map((url, i) => ({ label: `候选文章 ${i + 1}`, description: '（假模型）推荐理由，约 5 分钟', action: { tool: 'import_document', params: { source: { type: 'url', url } } } })) } }
      : demo[1] === '设置' ? { name: 'open_settings', args: { section: 'model', reason: 'API Key 要你自己到设置里填' } }
      : demo[1] === '改设置' ? { name: 'set_config', args: { key: 'tts.rate', value: Number(words[0] ?? 1.2) } }
      : demo[1] === '改预算' ? { name: 'set_config', args: { key: 'budget.month', value: Number(words[0] ?? 30) } }
      : demo[1] === '查词' ? { name: 'lookup_word', args: { word: words[0] ?? 'upshot' } } : demo[1] === '辨析' ? { name: 'compare_words', args: { words } } : demo[1] === '加词' ? { name: 'add_to_wordbook', args: { words: words.map(text => ({ text })) } } : demo[1] === '记住' ? { name: 'remember', args: { type: 'semantic', content: demo[2]! } } : { name: 'create_quiz', args: { count: 3, ...(words.length ? { types: words } : {}) } };
    const toolCall = { type: 'toolCall' as const, id: `dev_${Date.now()}`, name: call.name, arguments: call.args as never };
    const base: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 70, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: Date.now() };
    queueMicrotask(() => {
      s.push({ type: 'start', partial: base });
      s.push({ type: 'toolcall_start', contentIndex: 0, partial: base });
      s.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: base });
      const final: AssistantMessage = { ...base, content: [toolCall] };
      s.push({ type: 'done', reason: 'toolUse', message: final }); s.end(final);
    });
    return s;
  }
  const text = msgs[msgs.length - 1]?.role === 'toolResult' ? '（假模型）卡片显示在上面。' : reply(all, last);
  const base: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 70, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
  void (async () => {
    s.push({ type: 'start', partial: base });
    s.push({ type: 'text_start', contentIndex: 0, partial: base });
    for (const ch of text.match(/.{1,6}/gs) ?? []) {
      await new Promise(r => setTimeout(r, 25));
      // 和真实模型一样响应停止
      if (options?.signal?.aborted) { const err: AssistantMessage = { ...base, stopReason: 'aborted', errorMessage: 'aborted' }; s.push({ type: 'error', reason: 'aborted', error: err }); s.end(err); return; }
      s.push({ type: 'text_delta', contentIndex: 0, delta: ch, partial: base });
    }
    s.push({ type: 'text_end', contentIndex: 0, content: text, partial: base });
    const final: AssistantMessage = { ...base, content: [{ type: 'text', text }] };
    s.push({ type: 'done', reason: 'stop', message: final }); s.end(final);
  })();
  return s;
};

export async function devFakeResolver(): Promise<ResolvedModel> { return { model: MODEL, apiKey: 'dev', streamFn: stream }; }
