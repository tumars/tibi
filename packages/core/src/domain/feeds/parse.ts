import { XMLParser } from 'fast-xml-parser';

/**
 * 订阅源解析（11 §4.3）：RSS 2.0 / RSS 1.0（RDF）/ Atom / JSON Feed → 统一的条目。
 * 不依赖 DOM（R11）；正文类字段（description、content…）按原样取出再自己解码，CDATA 和转义过的 HTML 都能对上。
 */

export interface ParsedItem {
  /** 去重键：guid → Atom id → 链接 */
  guid: string;
  url: string;
  title: string;
  author?: string;
  published_at?: number;
  /** 纯文本摘要，≤ 600 字 */
  excerpt: string;
  /** 源里带的全文 HTML（content:encoded / Atom content / 较长的 description） */
  content_html?: string;
  /** 讨论页（HNRSS 这类聚合源） */
  comments_url?: string;
}
export interface ParsedFeed { title: string; site_url?: string; ttl_minutes?: number; items: ParsedItem[] }

const RAW = ['description', 'content:encoded', 'content', 'summary'];
const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text',
  parseTagValue: false, parseAttributeValue: false, trimValues: true, htmlEntities: true,
  stopNodes: RAW.map(n => `*.${n}`),
  isArray: name => name === 'item' || name === 'entry' || name === 'link',
});

const ENT: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&', nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decodeEntities = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
/** 原样取出的 XML 片段 → HTML：CDATA 里的照抄，外面的解一次实体 */
function rawToHtml(raw: string, xhtml = false): string {
  if (xhtml) return raw.trim();
  return raw.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/).map(p => p.startsWith('<![CDATA[') ? p.slice(9, -3) : decodeEntities(p)).join('').trim();
}
const htmlToText = (html: string) => decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

type Node = unknown;
const arr = (v: Node): Node[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
/** 节点的文字（有属性时在 #text 里） */
function text(v: Node): string {
  const n = arr(v)[0];
  if (n === undefined || n === null) return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (typeof n === 'object') { const t = (n as Record<string, unknown>)['#text']; return t === undefined ? '' : String(t); }
  return '';
}
const attr = (v: Node, name: string): string | undefined => {
  const n = arr(v)[0];
  return n && typeof n === 'object' ? ((n as Record<string, unknown>)[`@_${name}`] as string | undefined) : undefined;
};
const cleanTitle = (s: string) => htmlToText(s);
function abs(link: string | undefined, base: string): string | undefined {
  if (!link) return undefined;
  try { const u = new URL(link.trim(), base); return /^https?:$/.test(u.protocol) ? u.toString() : undefined; } catch { return undefined; }
}
const date = (s: string) => { const t = Date.parse(s.trim()); return Number.isFinite(t) ? t : undefined; };
/** 摘要：去掉聚合源的样板（HNRSS 的 Article URL / Comments URL / Points） */
const excerptOf = (html: string) => htmlToText(html).replace(/\b(Article URL|Comments URL): \S+|\bPoints: \d+|# Comments: \d+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
/** 描述长到像全文（≥ 150 词）才算全文 */
const looksFull = (html: string) => htmlToText(html).split(' ').length >= 150;

const PERIOD: Record<string, number> = { hourly: 60, daily: 1440, weekly: 10080, monthly: 43200, yearly: 525600 };

/** 解析订阅源；不是订阅源（网页、坏 XML）时返回 undefined */
export function parseFeed(body: string, feedUrl: string, contentType = ''): ParsedFeed | undefined {
  const head = body.trimStart();
  if (head.startsWith('{') || /json/i.test(contentType)) return parseJsonFeed(head, feedUrl);
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(head.slice(0, 4096))) return undefined;
  let doc: Record<string, unknown>;
  try { doc = parser.parse(body) as Record<string, unknown>; } catch { return undefined; }
  if (doc.rss || doc['rdf:RDF']) return parseRss(doc, feedUrl);
  if (doc.feed) return parseAtom(doc.feed as Record<string, unknown>, feedUrl);
  return undefined;
}

function parseRss(doc: Record<string, unknown>, feedUrl: string): ParsedFeed {
  const rdf = doc['rdf:RDF'] as Record<string, unknown> | undefined;
  const ch = (rdf ? arr(rdf.channel)[0] : arr((doc.rss as Record<string, unknown>).channel)[0]) as Record<string, unknown> | undefined ?? {};
  const rawItems = arr(rdf ? rdf.item : ch.item) as Record<string, unknown>[];
  const ttl = Number(text(ch.ttl)) || (PERIOD[text(ch['sy:updatePeriod']).trim()] ? PERIOD[text(ch['sy:updatePeriod']).trim()]! / (Number(text(ch['sy:updateFrequency'])) || 1) : undefined);
  const site = abs(text(ch.link), feedUrl);
  const items: ParsedItem[] = [];
  for (const it of rawItems) {
    const url = abs(text(it.link), feedUrl) ?? (attr(it.guid, 'isPermaLink') !== 'false' ? abs(text(it.guid), feedUrl) : undefined) ?? abs(attr(it, 'rdf:about'), feedUrl);
    const title = cleanTitle(text(it.title));
    if (!url || !title) continue;
    const desc = rawToHtml(text(it.description));
    const encoded = rawToHtml(text(it['content:encoded']));
    const content_html = encoded || (looksFull(desc) ? desc : undefined);
    const rssAuthor = text(it.author).replace(/^\S+@\S+\s*\((.*)\)$/, '$1');
    items.push({
      guid: text(it.guid).trim() || url, url, title,
      ...opt('author', htmlToText(text(it['dc:creator']) || rssAuthor)),
      ...opt('published_at', date(text(it.pubDate) || text(it['dc:date']))),
      excerpt: excerptOf(desc || encoded),
      ...opt('content_html', content_html),
      ...opt('comments_url', abs(text(it.comments), feedUrl)),
    });
  }
  return { title: cleanTitle(text(ch.title)) || new URL(feedUrl).hostname, ...opt('site_url', site), ...opt('ttl_minutes', ttl ? Math.round(ttl) : undefined), items };
}

function atomLink(links: Node, base: string): string | undefined {
  const all = arr(links) as Record<string, string>[];
  const pick = all.find(l => !l['@_rel'] || l['@_rel'] === 'alternate') ?? undefined;
  return abs(pick?.['@_href'], base);
}

function parseAtom(feed: Record<string, unknown>, feedUrl: string): ParsedFeed {
  const base = abs(feed['@_xml:base'] as string | undefined, feedUrl) ?? feedUrl;
  const items: ParsedItem[] = [];
  for (const e of arr(feed.entry) as Record<string, unknown>[]) {
    const eb = abs(e['@_xml:base'] as string | undefined, base) ?? base;
    const url = atomLink(e.link, eb);
    const title = cleanTitle(text(e.title));
    if (!url || !title) continue;
    const content = rawToHtml(text(e.content), attr(e.content, 'type') === 'xhtml');
    const summary = rawToHtml(text(e.summary), attr(e.summary, 'type') === 'xhtml');
    const author = arr(e.author).map(a => text((a as Record<string, unknown>)?.name)).filter(Boolean).join(', ');
    items.push({
      guid: text(e.id).trim() || url, url, title,
      ...opt('author', author),
      ...opt('published_at', date(text(e.published) || text(e.updated))),
      excerpt: excerptOf(summary || content),
      ...opt('content_html', content || (looksFull(summary) ? summary : undefined)),
    });
  }
  return { title: cleanTitle(text(feed.title)) || new URL(feedUrl).hostname, ...opt('site_url', atomLink(feed.link, base)), items };
}

function parseJsonFeed(body: string, feedUrl: string): ParsedFeed | undefined {
  let f: { version?: string; title?: string; home_page_url?: string; items?: { id?: string | number; url?: string; external_url?: string; title?: string; content_html?: string; content_text?: string; summary?: string; date_published?: string; date_modified?: string; authors?: { name?: string }[]; author?: { name?: string } }[] };
  try { f = JSON.parse(body); } catch { return undefined; }
  if (!f || typeof f !== 'object' || !String(f.version ?? '').includes('jsonfeed.org')) return undefined;
  const items: ParsedItem[] = [];
  for (const it of f.items ?? []) {
    const url = abs(it.url ?? it.external_url, feedUrl);
    const title = cleanTitle(it.title ?? '');
    if (!url || !title) continue;
    const html = it.content_html ?? (it.content_text ? it.content_text.split(/\n{2,}/).map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('') : '');
    const author = (it.authors ?? (it.author ? [it.author] : [])).map(a => a.name).filter(Boolean).join(', ');
    items.push({
      guid: String(it.id ?? url), url, title,
      ...opt('author', author),
      ...opt('published_at', date(it.date_published ?? it.date_modified ?? '')),
      excerpt: excerptOf(it.summary ?? html),
      ...opt('content_html', html || undefined),
    });
  }
  return { title: cleanTitle(f.title ?? '') || new URL(feedUrl).hostname, ...opt('site_url', abs(f.home_page_url, feedUrl)), items };
}

const opt = <K extends string, V>(k: K, v: V | undefined | '') => (v === undefined || v === '' ? {} : { [k]: v } as { [P in K]: V });

/** 网页里声明的订阅地址（<link rel="alternate" type="application/rss+xml" …>） */
export function discoverInHtml(html: string, pageUrl: string): { url: string; title?: string }[] {
  const out: { url: string; title?: string }[] = [];
  for (const m of html.slice(0, 200_000).matchAll(/<link\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of m[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[a[1]!.toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    if (!/(^|\s)alternate(\s|$)/i.test(attrs.rel ?? '')) continue;
    if (!/application\/(rss|atom|feed|rdf)\+(xml|json)|application\/(rss|atom)$/i.test(attrs.type ?? '')) continue;
    const url = abs(attrs.href, pageUrl);
    if (url && !out.some(o => o.url === url) && !/\/comments\/feed\/?$/.test(url)) out.push({ url, ...opt('title', attrs.title?.trim()) });
  }
  return out;
}
