import { createAssistantMessageEventStream, createProvider, type Api, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
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
  // 只看用户说的话，去掉界面附上的附件
  const last = (typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x as { text?: string }).text ?? '').join('') : '').replace(/<attachment>[\s\S]*?<\/attachment>/g, '').trim();
  // 走通对话卡片和写入："卡片 查词 upshot"、"卡片 辨析 a b"、"卡片 练习"、"卡片 加词 a b"（写入回执）、"卡片 记住 一句话"（审批卡）、"卡片 反问"、"卡片 找文章 网址…"（反问卡）、"卡片 设置"、"卡片 改设置 1.2"、"卡片 改预算 30"（每次都问）
  // 主对话里不常用的工具是按需加载的：像真模型一样先 tool_search 搜出来，下一轮再调
  const tail = msgs[msgs.length - 1] as { role: string; toolName?: string } | undefined;
  const searched = tail?.role === 'toolResult' && tail.toolName === 'tool_search';
  // "导入这篇：网址"（对话页的 /导入、⌘ 点链接发来的）也像真模型一样直接导入
  const importAsk = tail?.role === 'user' ? last.match(/^导入这篇：(https?:\/\/\S+)$/) : null;
  const demo = tail?.role === 'user' || searched ? (importAsk ? ['', '导入', importAsk[1]!] : last.match(/^卡片 (查词|辨析|练习|加词|记住|反问|找文章|设置|改设置|跳转)\s*(.*)$/)) : null;
  if (demo) {
    const words = demo[2]!.split(/\s+/).filter(Boolean);
    const call = demo[1] === '导入' ? { name: 'import_document', args: { source: { type: 'url', url: demo[2]! } } }
      : demo[1] === '跳转' ? { name: 'show_link', args: { text: '（假模型）今天有卡片要复习', links: [{ label: '去复习', href: 'tibi://review' }, { label: '看书架', href: 'tibi://library' }] } }
      : demo[1] === '反问' ? { name: 'ask_user', args: { question: '想读哪种题材？', options: [{ label: '科技' }, { label: '小说', description: '轻松一点' }] } }
      : demo[1] === '找文章' ? { name: 'ask_user', args: { question: '想读哪几篇？', multi: true, options: words.map((url, i) => ({ label: `候选文章 ${i + 1}`, description: '（假模型）推荐理由，约 5 分钟', url })) } }
      : demo[1] === '设置' ? { name: 'open_settings', args: { section: 'model', reason: 'API Key 要你自己到设置里填' } }
      : demo[1] === '改设置' ? { name: 'set_config', args: { key: 'tts.rate', value: Number(words[0] ?? 1.2) } }
      : demo[1] === '查词' ? { name: 'lookup_word', args: { word: words[0] ?? 'upshot' } } : demo[1] === '辨析' ? { name: 'compare_words', args: { words } } : demo[1] === '加词' ? { name: 'add_to_wordbook', args: { words: words.map(text => ({ text })) } } : demo[1] === '记住' ? { name: 'remember', args: { type: 'semantic', content: demo[2]! } } : { name: 'create_quiz', args: { count: 3, ...(words.length ? { types: words } : {}) } };
    const always = ['lookup_word', 'add_to_wordbook', 'ask_user', 'import_document', 'show_link', 'get_context', 'get_document', 'search_memory', 'remember', 'run_skill'];
    const real = searched || always.includes(call.name);
    const toolCall = { type: 'toolCall' as const, id: `dev_${Date.now()}`, name: real ? call.name : 'tool_search', arguments: (real ? call.args : { query: call.name }) as never };
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
  // 反问答完：用户选了带链接的文章，就像真模型一样接着导入
  const picked = tail?.role === 'toolResult' && tail.toolName === 'ask_user' ? [...JSON.stringify((tail as { content?: unknown }).content).matchAll(/（(https?:\/\/[^）"\\]+)）/g)].map(m => m[1]!) : [];
  if (picked.length) {
    const base: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 70, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: Date.now() };
    const calls = picked.map((url, i) => ({ type: 'toolCall' as const, id: `dev_${Date.now()}_${i}`, name: 'import_document', arguments: { source: { type: 'url', url } } as never }));
    queueMicrotask(() => {
      s.push({ type: 'start', partial: base });
      const final: AssistantMessage = { ...base, content: calls };
      s.push({ type: 'done', reason: 'toolUse', message: final }); s.end(final);
    });
    return s;
  }
  // 导入的结果（同一批可能有几篇）：照工具结果说成功了还是为什么没成功
  const results = tail?.role === 'toolResult' ? msgs.slice(msgs.map(m => m.role).lastIndexOf('assistant') + 1).filter(m => (m as { toolName?: string }).toolName === 'import_document').map(m => (m.content as { text?: string }[] | undefined)?.[0]?.text ?? '') : [];
  const imported = results.map(t => {
    if (t.startsWith('错误：')) return `没导入成功：${t.slice(3)}`;
    try { return `《${(JSON.parse(t) as { title?: string }).title ?? '这篇'}》放进书架了`; } catch { return '导入了'; }
  });
  const text = imported.length ? `（假模型）${imported.join('；')}。` : msgs[msgs.length - 1]?.role === 'toolResult' ? '（假模型）工具调用完了，结果见上面。' : reply(all, last);
  const base: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 70, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
  // 对话里的回答先"想"一小段，用来走通界面上的思考过程；一次性的提示（总结、释义）不带
  // 系统提示可能在 systemPrompt 里，也可能作为一条消息带进来
  const chat = (JSON.stringify((context as { systemPrompt?: unknown }).systemPrompt ?? '') + all).includes('你是 Tibi');
  const think = chat && msgs[msgs.length - 1]?.role === 'user' ? `（假模型的思考）用户问的是「${last.slice(0, 30)}」。先想想要不要查词，再简单回答。` : '';
  void (async () => {
    s.push({ type: 'start', partial: base });
    const pre: AssistantMessage['content'] = [];
    if (think) {
      s.push({ type: 'thinking_start', contentIndex: 0, partial: base });
      let t = '';
      for (const ch of think.match(/.{1,6}/gs) ?? []) { await new Promise(r => setTimeout(r, 25)); t += ch; s.push({ type: 'thinking_delta', contentIndex: 0, delta: ch, partial: base }); }
      s.push({ type: 'thinking_end', contentIndex: 0, content: think, partial: base });
      pre.push({ type: 'thinking', thinking: think });
    }
    const ti = pre.length;
    s.push({ type: 'text_start', contentIndex: ti, partial: base });
    let said = '';
    for (const ch of text.match(/.{1,6}/gs) ?? []) {
      await new Promise(r => setTimeout(r, 25));
      // 和真实模型一样响应停止：已经说出来的半句留在回答里
      if (options?.signal?.aborted) { const err: AssistantMessage = { ...base, content: [...pre, ...(said ? [{ type: 'text' as const, text: said }] : [])], stopReason: 'aborted', errorMessage: 'aborted' }; s.push({ type: 'error', reason: 'aborted', error: err }); s.end(err); return; }
      said += ch;
      s.push({ type: 'text_delta', contentIndex: ti, delta: ch, partial: { ...base, content: [...pre, { type: 'text', text: said }] } });
    }
    s.push({ type: 'text_end', contentIndex: ti, content: text, partial: base });
    const final: AssistantMessage = { ...base, content: [...pre, { type: 'text', text }] };
    s.push({ type: 'done', reason: 'stop', message: final }); s.end(final);
  })();
  return s;
};

/** 把一个 streamFn 包成 pi-ai 的服务商，交给 agent 引擎注册（测试和开发用） */
export function streamProvider(model: Model<Api>, fn: StreamFn) {
  return createProvider({ id: model.provider, name: model.provider, baseUrl: model.baseUrl, auth: { apiKey: { name: model.provider, resolve: async () => ({ auth: {} }) } } as never, models: [model] as never, api: { stream: fn, streamSimple: fn } as never });
}

export async function devFakeResolver(): Promise<ResolvedModel> { return { model: MODEL, apiKey: 'dev', streamFn: stream, provider: streamProvider(MODEL, stream) }; }
