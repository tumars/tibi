import { describe, expect, it } from 'vitest';
import { openAppDb } from '@tibi/core-node';
import { assembleCore, fakePlatform } from '../../src/index.js';
import { parseFeed } from '../../src/domain/documents/feeds.js';

const RSS = `<?xml version="1.0"?><rss><channel><title>Example Tech</title>
  <item><title>Why Rust Is Eating the Backend</title><link>https://ex.com/rust</link><pubDate>${new Date().toUTCString()}</pubDate><description><![CDATA[<p>Teams are moving services to Rust because memory safety and predictable latency matter more than ever.</p>]]></description></item>
  <item><title>Old post</title><link>https://ex.com/old</link><pubDate>Mon, 01 Jan 2001 00:00:00 GMT</pubDate><description>old</description></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Go Blog</title><entry><title>Go 1.24</title><link rel="alternate" href="https://go.dev/blog/go1.24"/><updated>${new Date().toISOString()}</updated><summary>Generic type aliases &amp; more.</summary></entry></feed>`;

describe('订阅源（M5 找文章）', () => {
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
