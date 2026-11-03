import { describe, expect, it } from 'vitest';
import { deepLink, parseDeepLink } from '../../src/index.js';
import { backgroundIdle, documentsCapabilities, documentsMethods } from '../../src/domain/documents/index.js';
import { finished, makeKernelCore, until, type Turn } from './helpers.js';

const URL_OK = 'https://example.com/ownership';
const URL_403 = 'https://example.com/blocked';
const PAGE = '<html><body><article><h1>Ownership</h1><p>Ownership is the feature that makes the compiler happy. The upshot is memory safety without overhead, which is nice for everyone who writes programs at compile time. Every value has one owner and the rules are simple to follow once you know them well.</p></article></body></html>';

/** 真的 import_document（取网页是假的：URL_403 打不开） */
async function setup(turns: Turn[]) {
  const k = await makeKernelCore({
    turns,
    platform: {
      async fetchUrl(url) { return url === URL_403 ? { status: 403, final_url: url, content_type: 'text/html', body: '' } : { status: 200, final_url: url, content_type: 'text/html', body: PAGE }; },
      async extractReadable(html) { return { title: 'Ownership', markdown: html.match(/<p>(.*?)<\/p>/)![1]!, images: [] }; },
    },
  });
  k.core.use(documentsMethods);
  k.kernel.registerCapabilities({ import_document: documentsCapabilities['import_document']! });
  const conv = await k.call<{ id: string }>('chat.open', {});
  const say = async (text: string) => { const { submission_id } = await k.call<{ submission_id: string }>('chat.send', { conversation_id: conv.id, text }); await finished(k.kernel, submission_id); };
  const blocks = async () => (await k.call<{ items: { blocks?: any[]; steps?: any[] }[] }>('chat.history', { conversation_id: conv.id })).items.flatMap(m => m.blocks ?? []);
  return { ...k, conv, say, blocks };
}

describe('深链', () => {
  it('只认白名单里的页面，参数不合规的不认', () => {
    expect(parseDeepLink('tibi://read/abc-123')).toEqual({ to: 'read', document_id: 'abc-123' });
    expect(parseDeepLink('tibi://settings?sec=model')).toEqual({ to: 'settings', section: 'model' });
    expect(parseDeepLink('tibi://library')).toEqual({ to: 'library' });
    expect(parseDeepLink('tibi://import?url=https://x.com')).toBeUndefined();   // 导入另有确认流程
    expect(parseDeepLink('tibi://read/a%2Fb')).toBeUndefined();
    expect(parseDeepLink('https://example.com/read/1')).toBeUndefined();
    expect(parseDeepLink('tibi://settings?sec=Model;x')).toBeUndefined();
    for (const l of [{ to: 'read', document_id: 'd1', section_id: 's1' }, { to: 'dict', q: 'upshot' }, { to: 'review' }] as const) expect(parseDeepLink(deepLink(l))).toEqual(l);
  });
});

describe('对话里的导入卡', () => {
  it('用户自己发来的网址：Tibi 导入不再审批，卡片跟着导入走，成功后带「开始阅读」要的文章', async () => {
    const k = await setup([{ toolCalls: [{ name: 'import_document', args: { source: { type: 'url', url: URL_OK } } }] }, { text: '放进书架了' }]);
    await k.say(`导入这篇：${URL_OK}`);
    expect(k.events.some(e => e.event === 'approval.requested')).toBe(false);
    const live = k.events.find(e => e.event === 'chat.block' && e.data.block.kind === 'import')!.data.block;
    expect(live.data.source).toBe('example.com');
    expect(k.events.filter(e => e.event === 'import.done').map(e => e.data.origin)).toEqual(['chat']);   // 界面不弹全局提示
    const card = (await k.blocks()).find(b => b.kind === 'import');
    expect(card.state, JSON.stringify(card.state)).toMatchObject({ status: 'done', title: 'Ownership' });
    expect(await k.db.get('SELECT title FROM documents WHERE id = ?', [card.state.document_id])).toMatchObject({ title: 'Ownership' });
    expect(k.stream.contexts[1]).toContain('imported');
    await backgroundIdle();
  });

  it('打不开的网页：卡片显示原因，原因也交回模型', async () => {
    const k = await setup([{ toolCalls: [{ name: 'import_document', args: { source: { type: 'url', url: URL_403 } } }] }, { text: '没导入成功' }]);
    await k.say(`导入这篇：${URL_403}`);
    const card = (await k.blocks()).find(b => b.kind === 'import');
    expect(card.state.status).toBe('failed');
    expect(card.state.error).toBeTruthy();
    expect(k.stream.contexts[1]).toContain(card.state.error);
  });

  it('网址只在附件里（正在读的文章内容）：不算用户给的，照常审批', async () => {
    const k = await setup([{ toolCalls: [{ name: 'import_document', args: { source: { type: 'url', url: URL_OK } } }] }, { text: '好' }]);
    await k.call('chat.send', { conversation_id: k.conv.id, text: '把文里那个链接导入', context: { page: 'reader', selection: `see ${URL_OK}` } });
    await until(() => k.events.some(e => e.event === 'approval.requested'));
    expect(k.events.some(e => e.event === 'approval.requested')).toBe(true);
  });
});

describe('show_link', () => {
  it('放一张跳转卡；不认识的链接、书架里没有的文章报错，模型能改', async () => {
    const k = await setup([
      { toolCalls: [{ name: 'show_link', args: { text: '去复习', links: [{ label: '复习', href: 'tibi://hack' }] } }] },
      { toolCalls: [{ name: 'show_link', args: { text: '读这篇', links: [{ label: '读', href: 'tibi://read/nope' }] } }] },
      { toolCalls: [{ name: 'show_link', args: { text: '今天有 12 张卡要复习', links: [{ label: '去复习', href: 'tibi://review' }] } }] },
      { text: '去吧' },
    ]);
    await k.say('我该复习了吗');
    expect(k.stream.contexts[1]).toContain('不认识这个链接');
    expect(k.stream.contexts[2]).toContain('书架里没有这篇');
    expect((await k.blocks()).filter(b => b.kind === 'link').map(b => b.data)).toEqual([{ text: '今天有 12 张卡要复习', links: [{ label: '去复习', href: 'tibi://review' }] }]);
  });
});
