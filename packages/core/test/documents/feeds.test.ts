import { describe, expect, it } from 'vitest';
import { openAppDb } from '@tibi/core-node';
import { assembleCore, fakePlatform } from '../../src/index.js';
import { parseFeed, webSearch } from '../../src/domain/documents/feeds.js';
import type { Platform } from '../../src/platform.js';

const RSS = `<?xml version="1.0"?><rss><channel><title>Example Tech</title>
  <item><title>Why Rust Is Eating the Backend</title><link>https://ex.com/rust</link><pubDate>${new Date().toUTCString()}</pubDate><description><![CDATA[<p>Teams are moving services to Rust because memory safety and predictable latency matter more than ever.</p>]]></description></item>
  <item><title>Old post</title><link>https://ex.com/old</link><pubDate>Mon, 01 Jan 2001 00:00:00 GMT</pubDate><description>old</description></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Go Blog</title><entry><title>Go 1.24</title><link rel="alternate" href="https://go.dev/blog/go1.24"/><updated>${new Date().toISOString()}</updated><summary>Generic type aliases &amp; more.</summary></entry></feed>`;

describe('web_search（DeepSeek 搜索）', () => {
  const RESULTS = JSON.stringify({ results: [
    { url: 'https://ex.com/a', title: 'A', snippet: 'short', summary: 'longer', site_name: 'Ex', date: '2026-10-01T00:00:00Z' },
    { url: 'https://ex.com/have', title: 'Have', snippet: 's', summary: '' },
    { url: 'ftp://ex.com/x', title: 'X', snippet: 's' },
  ] });
  async function setup(opts: { base_url?: string; key?: boolean; status?: number; body?: string }) {
    const db = await openAppDb(':memory:'); const t = Date.now();
    await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
    if (opts.key !== false) await db.run("INSERT INTO providers(id, kind, name, protocol, base_url, auth, model, secret_ref, created_at, updated_at) VALUES ('p', 'llm', 'DS', 'openai_compatible', ?, 'api_key', 'deepseek-flash', 'ref', ?, ?)", [opts.base_url ?? 'https://api.deepseek.com', t, t]);
    await db.run("INSERT INTO documents(id, title, kind, source_type, source_uri, content_hash, created_at, updated_at) VALUES ('d', 'Have', 'article', 'url', 'https://ex.com/have', 'h', ?, ?)", [t, t]);
    const calls: { url: string; post?: { headers: Record<string, string>; body: string } }[] = [];
    const search = () => webSearch({ db, platform: fakePlatform({ isOnline: () => true, getSecret: async () => 'sk-test', fetchUrl: async (url, o) => { calls.push({ url, post: o?.post }); return { status: opts.status ?? 200, final_url: url, content_type: 'application/json', body: opts.body ?? RESULTS }; } }), caller: { origin: 'ui' }, events: { emit() {} } } as never, { q: 'rust async', limit: 5 });
    return { db, calls, search };
  }
  it('带 Key POST 到官方接口，优先用 summary', async () => {
    const { calls, search } = await setup({});
    const out = await search();
    expect(calls[0]).toMatchObject({ url: 'https://api.deepseek.com/v1/tools/search', post: { headers: { authorization: 'Bearer sk-test' } } });
    expect(JSON.parse(calls[0]!.post!.body)).toEqual({ query: 'rust async', count: 5 });
    expect(out[0]).toMatchObject({ url: 'https://ex.com/a', snippet: 'longer', site: 'Ex' });
    expect(out.map(r => r.url)).toEqual(['https://ex.com/a']);   // ftp 和书架里已有的都不返回
  });
  it('没连 DeepSeek 或填的是代理地址：不发请求，提示用文章来源', async () => {
    for (const o of [{ key: false }, { base_url: 'https://proxy.example.com/v1' }]) {
      const { calls, search } = await setup(o);
      await expect(search()).rejects.toMatchObject({ code: 'conflict' });
      expect(calls).toEqual([]);
    }
  });
  it('空结果返回空列表；余额不足给出提示', async () => {
    const empty = await setup({ body: '{"results":[]}' });
    expect(await empty.search()).toEqual([]);
    const poor = await setup({ status: 402 });
    await expect(poor.search()).rejects.toThrow('余额不足');
  });
});

describe('网页搜索的设置', () => {
  async function setup(fetchUrl: Platform['fetchUrl'], secrets: Record<string, string> = {}) {
    const db = await openAppDb(':memory:'); const t = Date.now();
    await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
    const platform = fakePlatform({ isOnline: () => true, getSecret: async r => secrets[r], fetchUrl });
    const { core } = await assembleCore({ db, resume: false, platform });
    return { core, db, search: () => webSearch({ db, platform, caller: { origin: 'ui' }, events: { emit() {} } } as never, { q: 'rust', limit: 30 }) };
  }
  const never: Platform['fetchUrl'] = async () => { throw new Error('不该发请求'); };
  it('默认 DeepSeek；Tavily 用自己的 Key，结果字段对齐', async () => {
    const calls: { url: string; body: string; auth?: string }[] = [];
    const { core, search } = await setup(async (url, o) => { calls.push({ url, body: o!.post!.body, auth: o!.post!.headers.authorization }); return { status: 200, final_url: url, content_type: 'application/json', body: JSON.stringify({ results: [{ url: 'https://ex.com/t', title: 'T', content: 'body', published_date: '2026-10-01' }] }) }; }, { 'search.tavily': 'tvly-x' });
    expect(await core.call('websearch.config', {})).toEqual({ provider: 'deepseek', deepseek_ready: false, tavily_ready: true });
    await core.call('websearch.configure', { provider: 'tavily' });
    expect((await search())[0]).toMatchObject({ url: 'https://ex.com/t', snippet: 'body' });
    expect(calls[0]).toMatchObject({ url: 'https://api.tavily.com/search', auth: 'Bearer tvly-x' });
    expect(JSON.parse(calls[0]!.body)).toEqual({ query: 'rust', max_results: 20 });
  });
  it('关闭或没填 Tavily Key：不发请求', async () => {
    const { core, search } = await setup(never);
    await core.call('websearch.configure', { provider: 'off' });
    await expect(search()).rejects.toThrow('关掉');
    await core.call('websearch.configure', { provider: 'tavily' });
    await expect(search()).rejects.toThrow('Tavily 的 API Key');
  });
  it('Tavily 额度用完：报可读的错', async () => {
    const { core, search } = await setup(async url => ({ status: 432, final_url: url, content_type: '', body: '' }), { 'search.tavily': 'k' });
    await core.call('websearch.configure', { provider: 'tavily' });
    await expect(search()).rejects.toThrow('额度');
  });
});

describe('文章来源（M5 找文章）', () => {
  it('解析 RSS 与 Atom', () => {
    expect(parseFeed(RSS, 'https://ex.com/feed')[0]).toMatchObject({ title: 'Why Rust Is Eating the Backend', url: 'https://ex.com/rust', site: 'Example Tech' });
    expect(parseFeed(ATOM, 'https://go.dev/blog/feed.atom')[0]).toMatchObject({ title: 'Go 1.24', url: 'https://go.dev/blog/go1.24', excerpt: 'Generic type aliases & more.' });
  });
  it('search_feeds：只拉开着的源，过滤太旧的，兴趣词排前面；加源时校验格式', async () => {
    const db = await openAppDb(':memory:'); const t = Date.now();
    await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
    const fetched: string[] = [];
    const { core } = await assembleCore({ db, resume: false, platform: fakePlatform({ isOnline: () => true, fetchUrl: async url => { fetched.push(url); return { status: 200, final_url: url, content_type: 'application/xml', body: url.includes('go.dev') ? ATOM : url.includes('ex.com') ? RSS : '<html>no</html>' }; } }) });
    for (const u of ['https://hnrss.org/best', 'https://blog.rust-lang.org/feed.xml', 'https://www.quantamagazine.org/feed/', 'https://feeds.arstechnica.com/arstechnica/index'])
      await core.call('feeds.update', { toggle: { url: u, enabled: false } });
    await core.call('feeds.update', { add: { url: 'https://ex.com/feed' } });
    await expect(core.call('feeds.update', { add: { url: 'https://nofeed.org/' } })).rejects.toMatchObject({ code: 'invalid_source' });
    const list = await core.call<{ title: string }[]>('feeds.search', { interests: ['rust'], max_unknown_ratio: 1 });
    expect(list.map(i => i.title)).toEqual(['Why Rust Is Eating the Backend', 'Go 1.24']);
    expect(fetched).not.toContain('https://hnrss.org/best');
  });
});
