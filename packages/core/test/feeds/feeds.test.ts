import { describe, expect, it } from 'vitest';
import { openAppDb } from '@tibi/core-node';
import { assembleCore, fakePlatform } from '../../src/index.js';
import type { FetchedPage, Platform } from '../../src/platform.js';
import { imported } from '../helpers.js';

const DAY = 86_400_000;
const rss = (items: { guid: string; title: string; link: string; ago?: number; desc?: string }[], title = 'Ex Blog') => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>https://ex.com/</link>
${items.map(i => `<item><guid>${i.guid}</guid><title>${i.title}</title><link>${i.link}</link><pubDate>${new Date(Date.now() - (i.ago ?? 0) * DAY).toUTCString()}</pubDate><description>${i.desc ?? 'Teams are moving services to Rust because memory safety and predictable latency matter more than ever before.'}</description></item>`).join('')}
</channel></rss>`;
const ARTICLE = Array.from({ length: 60 }, (_, i) => `This is sentence ${i} of a long article about compilers.`).join(' ');

type Route = (url: string, headers: Record<string, string>) => Partial<FetchedPage> | undefined;

async function setup(route: Route, extra: Partial<Platform> = {}) {
  const db = await openAppDb(':memory:'); const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  // 内置源先关掉，测试只看自己加的
  await db.run('UPDATE feeds SET enabled = 0');
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const platform = fakePlatform({
    isOnline: () => true,
    fetchUrl: async (url, o) => {
      const headers = o?.headers ?? {}; calls.push({ url, headers });
      const r = route(url, headers);
      return { status: 404, final_url: url, content_type: 'text/html', body: '', ...r };
    },
    extractReadable: async () => ({ title: 'A Tiny Compiler', markdown: ARTICLE, images: [] }),
    htmlToMarkdown: html => html.replace(/<[^>]+>/g, ''),
    ...extra,
  });
  const { core } = await assembleCore({ db, resume: false, platform });
  return { core, db, calls };
}

describe('订阅：加、刷新、条件请求', () => {
  it('加订阅后马上抓一次；第二次带 etag，304 不动条目；新条目去重、已读状态不被冲掉', async () => {
    let body = rss([{ guid: 'a', title: 'First', link: 'https://ex.com/a' }, { guid: 'b', title: 'Second', link: 'https://ex.com/b' }]);
    let etag = 'v1';
    const { core, calls } = await setup((url, h) => url === 'https://ex.com/feed.xml'
      ? (h['if-none-match'] === etag ? { status: 304, final_url: url } : { status: 200, final_url: url, content_type: 'application/rss+xml', body, headers: { etag } })
      : undefined);
    const feed = await core.call<{ id: string; title: string; unread: number }>('feeds.add', { url: 'https://ex.com/feed.xml' });
    expect(feed).toMatchObject({ title: 'Ex Blog', unread: 2 });
    const page = await core.call<{ items: { id: string; title: string; state: string }[] }>('feeds.items', { filter: 'unread' });
    expect(page.items.map(i => i.title).sort()).toEqual(['First', 'Second']);
    await core.call('feeds.mark', { ids: [page.items.find(i => i.title === 'First')!.id], state: 'seen' });

    // 没到点不抓；force 时带 etag，304
    expect(await core.call('feeds.refresh', {})).toMatchObject({ feeds: 0 });
    expect(await core.call('feeds.refresh', { force: true })).toMatchObject({ feeds: 1, not_modified: 1 });
    expect(calls.at(-1)!.headers['if-none-match']).toBe('v1');

    // 源更新：一条新的，一条改了标题
    body = rss([{ guid: 'a', title: 'First (updated)', link: 'https://ex.com/a' }, { guid: 'b', title: 'Second', link: 'https://ex.com/b' }, { guid: 'c', title: 'Third', link: 'https://ex.com/c' }]);
    etag = 'v2';
    expect(await core.call('feeds.refresh', { force: true })).toMatchObject({ new_items: 1 });
    const all = await core.call<{ items: { title: string; state: string }[] }>('feeds.items', { filter: 'all' });
    expect(Object.fromEntries(all.items.map(i => [i.title, i.state]))).toEqual({ 'First (updated)': 'seen', Second: 'new', Third: 'new' });
    expect(await core.call('feeds.status', {})).toMatchObject({ unread: 2, auto_refresh: true });
  });

  it('翻页带总数；带 as_of 时第一页之后才看过的仍按未读算，后面的页不错位', async () => {
    const list = Array.from({ length: 5 }, (_, i) => ({ guid: `g${i}`, title: `Post ${i}`, link: `https://ex.com/${i}`, ago: i }));
    const { core } = await setup(url => url === 'https://ex.com/feed.xml' ? { status: 200, final_url: url, content_type: 'application/rss+xml', body: rss(list) } : undefined);
    await core.call('feeds.add', { url: 'https://ex.com/feed.xml' });
    type P = { items: { id: string; title: string }[]; total: number };
    const asOf = Date.now();
    const p1 = await core.call<P>('feeds.items', { limit: 2 });
    expect(p1).toMatchObject({ total: 5 });
    expect(p1.items.map(i => i.title)).toEqual(['Post 0', 'Post 1']);
    await core.call('feeds.mark', { ids: p1.items.map(i => i.id), state: 'seen' });
    const p2 = await core.call<P>('feeds.items', { limit: 2, cursor: '2', as_of: asOf });
    expect(p2).toMatchObject({ total: 5 });
    expect(p2.items.map(i => i.title)).toEqual(['Post 2', 'Post 3']);
    // 不带 as_of 就是现在的未读
    expect(await core.call<P>('feeds.items', { limit: 2 })).toMatchObject({ total: 3 });
  });

  it('坏掉的源退避，管理页能看到原因；成功后清零', async () => {
    let ok = false;
    const { core, db } = await setup(url => url === 'https://ex.com/feed.xml' ? (ok ? { status: 200, final_url: url, body: rss([{ guid: 'a', title: 'A', link: 'https://ex.com/a' }]) } : { status: 503, final_url: url }) : undefined);
    const t = Date.now();
    await db.run("INSERT INTO feeds(id, url, title, created_at, updated_at) VALUES ('f1', 'https://ex.com/feed.xml', 'Ex', ?, ?)", [t, t]);
    await core.call('feeds.refresh', {});
    await core.call('feeds.refresh', { force: true });
    const row = await db.get<{ error: string; error_count: number; next_fetch_at: number }>("SELECT error, error_count, next_fetch_at FROM feeds WHERE id = 'f1'");
    expect(row).toMatchObject({ error: '打不开（503）', error_count: 2 });
    expect(row!.next_fetch_at - Date.now()).toBeGreaterThan(55 * 60_000);   // 第二次失败退避 60 分钟
    ok = true;
    await core.call('feeds.refresh', { force: true });
    expect((await core.call<{ id: string; error?: string; error_count: number }[]>('feeds.list', {})).find(f => f.id === 'f1')).toMatchObject({ error_count: 0, unread: 1 });
  });

  it('自动发现：网站地址找 <link>，找不到试常见路径；多个候选时不直接加', async () => {
    const page = '<html><head><link rel="alternate" type="application/rss+xml" href="/posts.rss"><link rel="alternate" type="application/atom+xml" href="/notes.atom"></head></html>';
    const { core } = await setup(url => {
      if (url === 'https://multi.com/') return { status: 200, final_url: url, body: page };
      if (url === 'https://multi.com/posts.rss') return { status: 200, final_url: url, body: rss([{ guid: '1', title: 'Post', link: 'https://multi.com/1' }], 'Posts') };
      if (url === 'https://multi.com/notes.atom') return { status: 200, final_url: url, body: rss([{ guid: '2', title: 'Note', link: 'https://multi.com/2' }], 'Notes') };
      if (url === 'https://plain.com/') return { status: 200, final_url: url, body: '<html></html>' };
      if (url === 'https://plain.com/rss') return { status: 200, final_url: url, body: rss([{ guid: '3', title: 'X', link: 'https://plain.com/x' }], 'Plain') };
      return undefined;
    });
    expect((await core.call<{ url: string; title: string }[]>('feeds.discover', { url: 'https://multi.com/' })).map(c => [c.url, c.title])).toEqual([['https://multi.com/posts.rss', 'Posts'], ['https://multi.com/notes.atom', 'Notes']]);
    expect((await core.call<{ url: string }[]>('feeds.discover', { url: 'https://plain.com/' })).map(c => c.url)).toEqual(['https://plain.com/rss']);
    await expect(core.call('feeds.add', { url: 'https://multi.com/' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await core.call('feeds.add', { url: 'https://plain.com/' })).toMatchObject({ url: 'https://plain.com/rss', title: 'Plain' });
    await expect(core.call('feeds.discover', { url: 'https://nothing.org/' })).rejects.toMatchObject({ code: 'invalid_source' });
    await expect(core.call('feeds.discover', { url: 'http://192.168.1.2/feed' })).rejects.toMatchObject({ code: 'invalid_source' });
  });

  it('删订阅可撤销；不感兴趣可撤销；改名后不再被源里的标题覆盖', async () => {
    const { core } = await setup(url => url === 'https://ex.com/feed.xml' ? { status: 200, final_url: url, body: rss([{ guid: 'a', title: 'A', link: 'https://ex.com/a' }]) } : undefined);
    const f = await core.call<{ id: string }>('feeds.add', { url: 'https://ex.com/feed.xml' });
    const [item] = (await core.call<{ items: { id: string }[] }>('feeds.items', {})).items;
    const d = await core.call<{ undo: { undo_id: string } }>('feeds.mark', { ids: [item!.id], state: 'dismissed' });
    expect((await core.call<{ items: unknown[] }>('feeds.items', { filter: 'all' })).items).toEqual([]);
    await core.call('system.undo', { undo_id: d.undo.undo_id });
    expect((await core.call<{ items: { state: string }[] }>('feeds.items', {})).items[0]!.state).toBe('new');

    await core.call('feeds.update', { id: f.id, title: '我的博客', folder: '科技' });
    await core.call('feeds.refresh', { force: true });
    expect((await core.call<{ id: string; title: string; folder?: string }[]>('feeds.list', {})).find(x => x.id === f.id)).toMatchObject({ title: '我的博客', folder: '科技' });

    const r = await core.call<{ undo: { undo_id: string } }>('feeds.remove', { id: f.id });
    expect((await core.call<{ id: string }[]>('feeds.list', {})).some(x => x.id === f.id)).toBe(false);
    await core.call('system.undo', { undo_id: r.undo.undo_id });
    expect((await core.call<{ id: string }[]>('feeds.list', {})).some(x => x.id === f.id)).toBe(true);
  });

  it('保留期：60 天前的不收；源全文转 Markdown 记字数', async () => {
    const body = `<rss><channel><title>T</title><item><guid>old</guid><title>Old</title><link>https://ex.com/old</link><pubDate>${new Date(Date.now() - 90 * DAY).toUTCString()}</pubDate></item>
      <item><guid>full</guid><title>Full</title><link>https://ex.com/full</link><content:encoded><![CDATA[<p>${ARTICLE}</p>]]></content:encoded></item></channel></rss>`;
    const { core, db } = await setup(url => url === 'https://ex.com/feed.xml' ? { status: 200, final_url: url, body } : undefined);
    await core.call('feeds.add', { url: 'https://ex.com/feed.xml' });
    const rows = await db.all<{ guid: string; word_count: number; content_md: string }>('SELECT guid, word_count, content_md FROM feed_items');
    expect(rows.map(r => r.guid)).toEqual(['full']);
    expect(rows[0]!.word_count).toBeGreaterThan(500);   // 和导入时一样用 countWords（数字不算词）
    expect(rows[0]!.content_md.startsWith('This is sentence 0')).toBe(true);
    // 正文够长的按它估时长；只有标题、没有正文的不估（以前一律按 1200 词估成"约 6 分钟"）
    const items = (await core.call<{ items: { title: string; est_minutes?: number }[] }>('feeds.items', { filter: 'all' })).items;
    expect(items.find(i => i.title === 'Full')!.est_minutes).toBeGreaterThan(0);
  });

  it('只有标题的条目不估阅读时长', async () => {
    const { core } = await setup(url => url === 'https://ex.com/feed.xml' ? { status: 200, final_url: url, body: rss([{ guid: 'a', title: 'A', link: 'https://ex.com/a' }]) } : undefined);
    await core.call('feeds.add', { url: 'https://ex.com/feed.xml' });
    const [it] = (await core.call<{ items: { est_minutes?: number }[] }>('feeds.items', { filter: 'all' })).items;
    expect(it).not.toHaveProperty('est_minutes');
  });

  it('抓取异常翻成中文：超时、连不上；库里存着的旧英文原因读出来时也翻', async () => {
    const { netError } = await import('../../src/domain/feeds/repo.js');
    expect(netError(new Error('This operation was aborted'))).toBe('连接超时，稍后会自动再试');
    expect(netError(new Error('getaddrinfo ENOTFOUND ex.com'))).toBe('连不上这个网站，稍后会自动再试');
    expect(netError('打不开（503）')).toBe('打不开（503）');
    const { core, db } = await setup(() => undefined);
    const t = Date.now();
    await db.run("INSERT INTO feeds(id, url, title, error, error_count, created_at, updated_at) VALUES ('f1', 'https://ex.com/feed.xml', 'Ex', 'This operation was aborted', 1, ?, ?)", [t, t]);
    expect((await core.call<{ id: string; error?: string }[]>('feeds.list', {})).find(f => f.id === 'f1')!.error).toBe('连接超时，稍后会自动再试');
  });
});

describe('订阅和书架、找文章', () => {
  it('导入一篇后条目记成"在书架里"，search_feeds 不再返回；按关键词找、离线时用库里的', async () => {
    let online = true, down = false;
    const { core } = await setup(url => {
      if (down) throw new Error('getaddrinfo ENOTFOUND ex.com');
      if (url === 'https://ex.com/feed.xml') return { status: 200, final_url: url, body: rss([{ guid: 'a', title: 'A Tiny Compiler', link: 'https://ex.com/a' }, { guid: 'b', title: 'Garden notes', link: 'https://ex.com/b', desc: 'Tomatoes and basil grow well together in a sunny spot near the kitchen window.' }]) };
      if (url === 'https://ex.com/a') return { status: 200, final_url: 'https://ex.com/a?ref=rss', content_type: 'text/html', body: '<html></html>' };
      return undefined;
    }, { isOnline: () => online });
    await core.call('feeds.add', { url: 'https://ex.com/feed.xml' });
    const r = await imported(await core.call<{ import_id: string }>('documents.import', { source: { type: 'url', url: 'https://ex.com/a' } }));
    expect(r.ok).toBe(true);
    const items = (await core.call<{ items: { title: string; state: string; document_id?: string }[] }>('feeds.items', { filter: 'all' })).items;
    expect(items.find(i => i.title === 'A Tiny Compiler')).toMatchObject({ state: 'saved', document_id: (r as { document_id: string }).document_id });
    expect((await core.call<{ items: unknown[] }>('feeds.items', { filter: 'saved' })).items).toHaveLength(1);

    // 书架只列放进书架的
    expect((await core.call<{ items: { title: string; shelved: boolean }[] }>('documents.list', {})).items).toMatchObject([{ title: 'A Tiny Compiler', shelved: true }]);

    const { searchFeeds } = await import('../../src/domain/feeds/methods.js');
    const ctx = core.ctx({ origin: 'skill' });
    expect((await searchFeeds(ctx, {})).items.map(i => i.title)).toEqual(['Garden notes']);
    expect((await searchFeeds(ctx, { q: 'compiler' })).items).toEqual([]);
    expect((await searchFeeds(ctx, { q: 'tomato' })).items[0]).toMatchObject({ title: 'Garden notes', site: 'Ex Blog' });
    online = false;
    await core.ctx({ origin: 'ui' }).db.run('UPDATE feeds SET last_ok_at = 0');
    expect(await searchFeeds(ctx, {})).toMatchObject({ stale: true, items: [{ title: 'Garden notes' }] });
    // 系统说在线、但源很快就连不上（断网时多半是域名解析失败）：刷完一个新的源都没有，也要标 stale
    online = true; down = true;
    expect(await searchFeeds(ctx, {})).toMatchObject({ stale: true, items: [{ title: 'Garden notes' }] });
    // 只是个别源坏了、别的源是新的：不标
    await core.ctx({ origin: 'ui' }).db.run("INSERT INTO feeds(id, url, title, last_ok_at, created_at, updated_at) VALUES ('ok', 'https://ok.com/feed', 'OK', ?, 0, 0)", [Date.now()]);
    expect((await searchFeeds(ctx, {})).stale).toBeUndefined();
  });

  it('从订阅里直接读：同一个阅读器能打开，但不进书架；之后加入书架或再导入一次才进', async () => {
    const { core } = await setup(url => {
      if (url === 'https://ex.com/feed.xml') return { status: 200, final_url: url, body: rss([{ guid: 'a', title: 'A Tiny Compiler', link: 'https://ex.com/a' }]) };
      if (url === 'https://ex.com/a') return { status: 200, final_url: url, content_type: 'text/html', body: '<html></html>' };
      return undefined;
    });
    await core.call('feeds.add', { url: 'https://ex.com/feed.xml' });
    const read = await imported(await core.call<{ import_id: string }>('documents.import', { source: { type: 'url', url: 'https://ex.com/a' }, shelve: false }));
    expect(read).toMatchObject({ ok: true, summary: '可以读了：A Tiny Compiler' });
    const id = (read as { document_id: string }).document_id;
    // 阅读器要的东西都在：文档、章节
    expect(await core.call('documents.get', { id })).toMatchObject({ id, shelved: false, sections: [{ idx: 0 }] });
    // 书架里没有，计数也不算
    expect(await core.call('documents.list', {})).toMatchObject({ items: [], total: 0 });
    // 订阅里：读过了（不是未读），但不在书架里，"已保存"里也没有
    const [item] = (await core.call<{ items: { state: string; document_id?: string; in_library?: boolean }[] }>('feeds.items', { filter: 'all' })).items;
    expect(item).toMatchObject({ state: 'seen', document_id: id, in_library: false });
    expect((await core.call<{ items: unknown[] }>('feeds.items', { filter: 'saved' })).items).toEqual([]);
    expect((await core.call<{ unread: number }>('feeds.status', {})).unread).toBe(0);

    // 在阅读器里点「加入书架」，可以撤销
    const u = await core.call<{ undo: { undo_id: string } }>('documents.update', { id, patch: { shelved: true } });
    expect((await core.call<{ total: number }>('documents.list', {})).total).toBe(1);
    expect((await core.call<{ items: { in_library?: boolean }[] }>('feeds.items', { filter: 'saved' })).items[0]).toMatchObject({ in_library: true });
    await core.call('system.undo', { undo_id: u.undo.undo_id });
    expect((await core.call<{ total: number }>('documents.list', {})).total).toBe(0);

    // 用别的方式（首页贴网址）再导入同一篇：放进书架，不重复建文档
    const again = await imported(await core.call<{ import_id: string }>('documents.import', { source: { type: 'url', url: 'https://ex.com/a' } }));
    expect(again).toMatchObject({ ok: true, document_id: id, duplicate: true, summary: '已放进书架：A Tiny Compiler' });
    expect(await core.call('documents.list', {})).toMatchObject({ total: 1, items: [{ id, shelved: true }] });
    expect((await core.call<{ items: { state: string }[] }>('feeds.items', { filter: 'saved' })).items[0]!.state).toBe('saved');
  });
});
