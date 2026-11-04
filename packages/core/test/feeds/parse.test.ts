import { describe, expect, it } from 'vitest';
import { discoverInHtml, parseFeed } from '../../src/domain/feeds/parse.js';

const LONG = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about memory safety.`).join(' ');

// HNRSS：链接是外站，comments 是 HN 讨论页，description 是转义过的 HTML
const HN = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
<title>Hacker News: Best</title><link>https://news.ycombinator.com/best</link><ttl>30</ttl>
<item><title><![CDATA[Show HN: A tiny compiler & friends]]></title><description><![CDATA[<p>Article URL: <a href="https://ex.com/compiler">https://ex.com/compiler</a></p><p>Points: 512</p>]]></description>
<pubDate>Tue, 03 Nov 2026 08:00:00 +0000</pubDate><link>https://ex.com/compiler</link><dc:creator>alice</dc:creator><comments>https://news.ycombinator.com/item?id=1</comments><guid isPermaLink="false">https://news.ycombinator.com/item?id=1</guid></item>
</channel></rss>`;

// WordPress：content:encoded 里是全文，description 是摘要，有 sy:updatePeriod
const WP = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:sy="http://purl.org/rss/1.0/modules/syndication/"><channel>
<title>Quanta Magazine</title><link>https://www.quantamagazine.org</link><sy:updatePeriod>hourly</sy:updatePeriod><sy:updateFrequency>1</sy:updateFrequency>
<item><title>Why the Sky Is Blue &#8212; Again</title><link>https://www.quantamagazine.org/sky/</link><guid isPermaLink="false">https://www.quantamagazine.org/?p=123</guid>
<description><![CDATA[Physicists revisit Rayleigh scattering.]]></description><content:encoded><![CDATA[<p>${LONG}</p><p>R&amp;D matters.</p>]]></content:encoded>
<pubDate>Mon, 02 Nov 2026 10:00:00 +0000</pubDate><author>news@quanta.org (Jane Doe)</author></item>
<item><title>No link here</title><description>skip</description></item>
</channel></rss>`;

// Atom + xml:base，相对链接；content 是转义过的 HTML；有 rel="replies" 的链接
const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://blog.rust-lang.org/">
<title>Rust Blog</title><link rel="self" href="feed.xml"/><link href="https://blog.rust-lang.org/"/>
<entry><title type="html">Announcing Rust 1.90 &amp;amp; more</title><link rel="replies" href="https://x.com/c"/><link rel="alternate" href="2026/11/01/Rust-1.90.html" type="text/html"/>
<id>https://blog.rust-lang.org/2026/11/01/Rust-1.90.html</id><published>2026-11-01T00:00:00+00:00</published><updated>2026-11-02T00:00:00+00:00</updated>
<author><name>The Rust Release Team</name></author><content type="html">&lt;p&gt;The Rust team is happy to announce a new version.&lt;/p&gt;</content></entry>
</feed>`;

const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://ex.org/"><title>RDF Site</title><link>https://ex.org/</link></channel>
<item rdf:about="https://ex.org/a"><title>First</title><link>https://ex.org/a</link><description>Hello &lt;b&gt;world&lt;/b&gt;</description><dc:date>2026-10-30T12:00:00Z</dc:date></item>
</rdf:RDF>`;

const JSONF = JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'JSON Blog', home_page_url: 'https://json.ex/', items: [
  { id: 'j1', url: 'https://json.ex/1', title: 'Plain text post', content_text: 'Para one.\n\nPara <two>.', date_published: '2026-11-01T00:00:00Z', authors: [{ name: 'Bob' }] },
  { id: 'j2', title: 'No url' },
] });

describe('订阅源解析', () => {
  it('HNRSS：外站链接、讨论页、CDATA 标题、guid 不是链接', () => {
    const f = parseFeed(HN, 'https://hnrss.org/best')!;
    expect(f).toMatchObject({ title: 'Hacker News: Best', site_url: 'https://news.ycombinator.com/best', ttl_minutes: 30 });
    expect(f.items).toHaveLength(1);
    expect(f.items[0]).toMatchObject({ title: 'Show HN: A tiny compiler & friends', url: 'https://ex.com/compiler', guid: 'https://news.ycombinator.com/item?id=1', comments_url: 'https://news.ycombinator.com/item?id=1', author: 'alice', published_at: Date.parse('2026-11-03T08:00:00Z') });
    expect(f.items[0]!.excerpt).toBe('');   // 只有样板，没有摘要
    expect(f.items[0]!.content_html).toBeUndefined();   // 短描述不算全文
  });
  it('WordPress：content:encoded 是全文，数字实体，作者邮箱格式，没链接的跳过', () => {
    const f = parseFeed(WP, 'https://www.quantamagazine.org/feed/')!;
    expect(f.ttl_minutes).toBe(60);
    expect(f.items).toHaveLength(1);
    const it0 = f.items[0]!;
    expect(it0).toMatchObject({ title: 'Why the Sky Is Blue — Again', guid: 'https://www.quantamagazine.org/?p=123', author: 'Jane Doe', excerpt: 'Physicists revisit Rayleigh scattering.' });
    expect(it0.content_html).toContain('<p>Sentence number 0');
    expect(it0.content_html).toContain('R&amp;D');   // CDATA 里的原样保留
  });
  it('Atom：xml:base 补全相对链接，选 alternate，转义的 HTML 内容', () => {
    const f = parseFeed(ATOM, 'https://blog.rust-lang.org/feed.xml')!;
    expect(f).toMatchObject({ title: 'Rust Blog', site_url: 'https://blog.rust-lang.org/' });
    expect(f.items[0]).toMatchObject({ title: 'Announcing Rust 1.90 & more', url: 'https://blog.rust-lang.org/2026/11/01/Rust-1.90.html', guid: 'https://blog.rust-lang.org/2026/11/01/Rust-1.90.html', author: 'The Rust Release Team', published_at: Date.parse('2026-11-01T00:00:00Z') });
    expect(f.items[0]!.content_html).toBe('<p>The Rust team is happy to announce a new version.</p>');
    expect(f.items[0]!.excerpt).toBe('The Rust team is happy to announce a new version.');
  });
  it('RSS 1.0（RDF）和 JSON Feed', () => {
    const r = parseFeed(RDF, 'https://ex.org/rss')!;
    expect(r.items[0]).toMatchObject({ title: 'First', url: 'https://ex.org/a', excerpt: 'Hello world', published_at: Date.parse('2026-10-30T12:00:00Z') });
    const j = parseFeed(JSONF, 'https://json.ex/feed.json', 'application/feed+json')!;
    expect(j).toMatchObject({ title: 'JSON Blog', site_url: 'https://json.ex/' });
    expect(j.items).toHaveLength(1);
    expect(j.items[0]).toMatchObject({ guid: 'j1', author: 'Bob', excerpt: 'Para one. Para <two>.' });
  });
  it('不是订阅源：网页、坏 XML、普通 JSON', () => {
    expect(parseFeed('<!doctype html><html><head><title>x</title></head></html>', 'https://ex.com/')).toBeUndefined();
    expect(parseFeed('<rss><channel><item><title>a', 'https://ex.com/')?.items ?? []).toEqual([]);
    expect(parseFeed('{"a":1}', 'https://ex.com/x.json')).toBeUndefined();
  });
  it('网页里声明的订阅地址', () => {
    const html = `<html><head><link rel="stylesheet" href="/a.css"><link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml">
      <link rel='alternate' type='application/atom+xml' href='https://ex.com/atom.xml'><link rel="alternate" type="application/rss+xml" href="/comments/feed/">
      <link rel="alternate" hreflang="fr" href="/fr/"></head></html>`;
    expect(discoverInHtml(html, 'https://ex.com/blog/')).toEqual([{ url: 'https://ex.com/feed.xml', title: 'Posts' }, { url: 'https://ex.com/atom.xml' }]);
  });
});
