import { XMLParser } from 'fast-xml-parser';
import type { FeedKind } from '../../types.js';

/**
 * 订阅源解析（11 §4.3、17 §5.1）：RSS 2.0（含 Podcast 2.0 / iTunes）/ RSS 1.0（RDF）/ Atom / JSON Feed → 统一的条目。
 * 不依赖 DOM（R11）；正文类字段（description、content…）按原样取出再自己解码，CDATA 和转义过的 HTML 都能对上。
 */

export interface ParsedItem {
  /** 去重键：guid → Atom id → 链接 → 音频链接 */
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
  /** 播客单集元数据（17 §4） */
  audio_url?: string;
  audio_mime?: string;
  audio_bytes?: number;
  duration_ms?: number;
  transcript_url?: string;
  transcript_type?: string;
  chapters_url?: string;
  artwork_url?: string;
  season?: number;
  episode?: number;
}
export interface ParsedFeed {
  title: string;
  site_url?: string;
  ttl_minutes?: number;
  kind: FeedKind;
  artwork_url?: string;
  language?: string;
  description?: string;
  items: ParsedItem[];
}

const RAW = ['description', 'content:encoded', 'content', 'summary'];
const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text',
  parseTagValue: false, parseAttributeValue: false, trimValues: true, htmlEntities: true,
  stopNodes: RAW.map(n => `*.${n}`),
  isArray: name => name === 'item' || name === 'entry' || name === 'link' || name === 'enclosure' || name === 'podcast:transcript',
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

/** 解析 itunes:duration：支持 HH:MM:SS、MM:SS、纯秒数 */
export function parseDurationMs(raw: string): number | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const sec = Number(s);
    return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : undefined;
  }
  const parts = s.split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return undefined;
  const sec = parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + parts[1]!;
  return sec > 0 ? Math.round(sec * 1000) : undefined;
}

const TRANSCRIPT_RANK: Record<string, number> = {
  'text/vtt': 4,
  'application/x-subrip': 3,
  'application/srt': 3,
  'text/srt': 3,
  'application/json': 2,
  'text/plain': 1,
};

/** 从多个 <podcast:transcript> 中挑出最合适的一个（VTT > SRT > JSON > TXT，英文优先） */
function pickTranscript(node: Node, base: string): { url: string; type: string } | undefined {
  const list = arr(node) as Record<string, string>[];
  let best: { url: string; type: string; score: number } | undefined;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const url = abs(item['@_url'], base);
    const type = (item['@_type'] ?? '').toLowerCase().split(';')[0]!.trim();
    if (!url || !type) continue;
    const baseScore = TRANSCRIPT_RANK[type] ?? (/vtt/i.test(type) ? 4 : /srt/i.test(type) ? 3 : /json/i.test(type) ? 2 : /text\/plain/i.test(type) ? 1 : 0);
    if (!baseScore) continue;
    const lang = (item['@_language'] ?? '').toLowerCase();
    const langBonus = !lang || lang.startsWith('en') ? 10 : 0;
    const score = baseScore + langBonus;
    if (!best || score > best.score) best = { url, type, score };
  }
  return best ? { url: best.url, type: best.type } : undefined;
}

/** 提取音频 enclosure */
function pickAudioEnclosure(node: Node, base: string): { url: string; mime: string; bytes?: number } | undefined {
  for (const enc of arr(node) as Record<string, string>[]) {
    if (!enc || typeof enc !== 'object') continue;
    const url = abs(enc['@_url'], base);
    const mime = (enc['@_type'] ?? '').toLowerCase().trim();
    if (!url) continue;
    const isAudio = mime.startsWith('audio/') || /\.(mp3|m4a|ogg|opus|wav|aac)(\?|$)/i.test(url);
    if (!isAudio) continue;
    const len = Number(enc['@_length']);
    return { url, mime: mime || 'audio/mpeg', ...(Number.isFinite(len) && len > 0 ? { bytes: Math.round(len) } : {}) };
  }
  return undefined;
}

function channelArtwork(ch: Record<string, unknown>, base: string): string | undefined {
  const itunes = attr(ch['itunes:image'], 'href');
  if (itunes) return abs(itunes, base);
  const img = ch.image as Record<string, unknown> | undefined;
  if (img && typeof img === 'object') return abs(text(img.url), base);
  return undefined;
}

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
  const artwork = channelArtwork(ch, feedUrl);
  const lang = text(ch.language).trim() || undefined;
  const chDesc = excerptOf(rawToHtml(text(ch.description) || text(ch['itunes:summary'])));
  const items: ParsedItem[] = [];
  let audioCount = 0;
  for (const it of rawItems) {
    const enc = pickAudioEnclosure(it.enclosure, feedUrl);
    if (enc) audioCount++;
    const url = abs(text(it.link), feedUrl)
      ?? (attr(it.guid, 'isPermaLink') !== 'false' ? abs(text(it.guid), feedUrl) : undefined)
      ?? abs(attr(it, 'rdf:about'), feedUrl)
      ?? enc?.url;
    const title = cleanTitle(text(it.title));
    if (!url || !title) continue;
    const desc = rawToHtml(text(it.description) || text(it['itunes:summary']));
    const encoded = rawToHtml(text(it['content:encoded']));
    const content_html = encoded || (looksFull(desc) ? desc : undefined);
    const rssAuthor = text(it.author).replace(/^\S+@\S+\s*\((.*)\)$/, '$1');
    const author = htmlToText(text(it['dc:creator']) || text(it['itunes:author']) || rssAuthor);
    const transcript = pickTranscript(it['podcast:transcript'], feedUrl);
    const chaptersUrl = abs(attr(it['podcast:chapters'], 'url'), feedUrl);
    const itemArt = abs(attr(it['itunes:image'], 'href'), feedUrl);
    const duration_ms = parseDurationMs(text(it['itunes:duration']));
    const seasonNum = Number(text(it['itunes:season']));
    const episodeNum = Number(text(it['itunes:episode']));
    items.push({
      guid: text(it.guid).trim() || url, url, title,
      ...opt('author', author),
      ...opt('published_at', date(text(it.pubDate) || text(it['dc:date']))),
      excerpt: excerptOf(desc || encoded),
      ...opt('content_html', content_html),
      ...opt('comments_url', abs(text(it.comments), feedUrl)),
      ...opt('audio_url', enc?.url),
      ...opt('audio_mime', enc?.mime),
      ...opt('audio_bytes', enc?.bytes),
      ...opt('duration_ms', duration_ms),
      ...opt('transcript_url', transcript?.url),
      ...opt('transcript_type', transcript?.type),
      ...opt('chapters_url', chaptersUrl),
      ...opt('artwork_url', itemArt),
      ...opt('season', Number.isInteger(seasonNum) && seasonNum > 0 ? seasonNum : undefined),
      ...opt('episode', Number.isInteger(episodeNum) && episodeNum > 0 ? episodeNum : undefined),
    });
  }
  const hasItunes = !!(ch['itunes:category'] || ch['itunes:explicit'] || ch['itunes:type'] || ch['itunes:author']);
  const kind: FeedKind = audioCount > 0 && (audioCount >= Math.ceil(items.length * 0.3) || hasItunes) ? 'podcast' : 'article';
  return {
    title: cleanTitle(text(ch.title)) || new URL(feedUrl).hostname,
    ...opt('site_url', site),
    ...opt('ttl_minutes', ttl ? Math.round(ttl) : undefined),
    kind,
    ...opt('artwork_url', artwork),
    ...opt('language', lang),
    ...opt('description', chDesc),
    items,
  };
}

function atomLink(links: Node, base: string): string | undefined {
  const all = arr(links) as Record<string, string>[];
  const pick = all.find(l => !l['@_rel'] || l['@_rel'] === 'alternate') ?? undefined;
  return abs(pick?.['@_href'], base);
}

function atomAudioEnclosure(links: Node, base: string): { url: string; mime: string; bytes?: number } | undefined {
  for (const l of arr(links) as Record<string, string>[]) {
    if (l['@_rel'] !== 'enclosure') continue;
    const url = abs(l['@_href'], base);
    const mime = (l['@_type'] ?? '').toLowerCase().trim();
    if (!url || !(mime.startsWith('audio/') || /\.(mp3|m4a|ogg|opus|wav)(\?|$)/i.test(url))) continue;
    const len = Number(l['@_length']);
    return { url, mime: mime || 'audio/mpeg', ...(Number.isFinite(len) && len > 0 ? { bytes: Math.round(len) } : {}) };
  }
  return undefined;
}

function parseAtom(feed: Record<string, unknown>, feedUrl: string): ParsedFeed {
  const base = abs(feed['@_xml:base'] as string | undefined, feedUrl) ?? feedUrl;
  const items: ParsedItem[] = [];
  let audioCount = 0;
  for (const e of arr(feed.entry) as Record<string, unknown>[]) {
    const eb = abs(e['@_xml:base'] as string | undefined, base) ?? base;
    const enc = atomAudioEnclosure(e.link, eb);
    if (enc) audioCount++;
    const url = atomLink(e.link, eb) ?? enc?.url;
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
      ...opt('audio_url', enc?.url),
      ...opt('audio_mime', enc?.mime),
      ...opt('audio_bytes', enc?.bytes),
    });
  }
  const kind: FeedKind = audioCount > 0 && audioCount >= Math.ceil(items.length * 0.5) ? 'podcast' : 'article';
  return { title: cleanTitle(text(feed.title)) || new URL(feedUrl).hostname, ...opt('site_url', atomLink(feed.link, base)), kind, items };
}

function parseJsonFeed(body: string, feedUrl: string): ParsedFeed | undefined {
  let f: { version?: string; title?: string; home_page_url?: string; icon?: string; description?: string; language?: string; items?: { id?: string | number; url?: string; external_url?: string; title?: string; content_html?: string; content_text?: string; summary?: string; date_published?: string; date_modified?: string; authors?: { name?: string }[]; author?: { name?: string }; attachments?: { url?: string; mime_type?: string; size_in_bytes?: number; duration_in_seconds?: number }[] }[] };
  try { f = JSON.parse(body); } catch { return undefined; }
  if (!f || typeof f !== 'object' || !String(f.version ?? '').includes('jsonfeed.org')) return undefined;
  const items: ParsedItem[] = [];
  let audioCount = 0;
  for (const it of f.items ?? []) {
    const audioAtt = (it.attachments ?? []).find(a => a.url && (a.mime_type?.startsWith('audio/') || /\.(mp3|m4a|ogg)(\?|$)/i.test(a.url)));
    const audio_url = abs(audioAtt?.url, feedUrl);
    if (audio_url) audioCount++;
    const url = abs(it.url ?? it.external_url, feedUrl) ?? audio_url;
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
      ...opt('audio_url', audio_url),
      ...opt('audio_mime', audioAtt?.mime_type),
      ...opt('audio_bytes', audioAtt?.size_in_bytes),
      ...opt('duration_ms', audioAtt?.duration_in_seconds ? Math.round(audioAtt.duration_in_seconds * 1000) : undefined),
    });
  }
  const kind: FeedKind = audioCount > 0 && audioCount >= Math.ceil(items.length * 0.5) ? 'podcast' : 'article';
  return {
    title: cleanTitle(f.title ?? '') || new URL(feedUrl).hostname,
    ...opt('site_url', abs(f.home_page_url, feedUrl)),
    kind,
    ...opt('artwork_url', abs(f.icon, feedUrl)),
    ...opt('language', f.language),
    ...opt('description', f.description?.slice(0, 600)),
    items,
  };
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
