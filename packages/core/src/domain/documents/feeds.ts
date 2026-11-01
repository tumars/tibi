import { Type } from '@sinclair/typebox';
import { j, now } from '../../db/driver.js';
import { capability, method, type CapabilityMap, type Ctx, type MethodMap } from '../../rpc/define.js';
import { TibiError } from '../../types.js';
import { annotateSentences } from '../text/annotate.js';
import { readProfile } from '../terms/repo.js';
import { WPM } from './repo.js';

/**
 * 订阅源（M5，"找文章"技能的候选来源，06 search_feeds）：内置几个英文技术 / 科普源 + 用户自己加的 RSS / Atom。
 * 只取标题、链接、摘要和时间，不抓正文；难度用摘要粗算。解析写在 Core 里（不依赖 DOM，R11），一小时内重复拉取用缓存。
 */
export const BUILTIN_FEEDS = [
  { url: 'https://hnrss.org/best', title: 'Hacker News · Best' },
  { url: 'https://blog.rust-lang.org/feed.xml', title: 'Rust Blog' },
  { url: 'https://go.dev/blog/feed.atom', title: 'The Go Blog' },
  { url: 'https://www.quantamagazine.org/feed/', title: 'Quanta Magazine' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', title: 'Ars Technica' },
];
export interface FeedItem { url: string; title: string; site: string; published_at?: number; excerpt: string; est_minutes: number; est_unknown_ratio?: number }

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const strip = (s: string) => decode(decode(s)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block: string, name: string) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1];

/** RSS 2.0 / Atom → 条目（只认常见写法） */
export function parseFeed(xml: string, feedUrl: string): Omit<FeedItem, 'est_minutes' | 'est_unknown_ratio'>[] {
  const site = strip(tag(xml.split(/<item|<entry/i)[0] ?? '', 'title') ?? '') || new URL(feedUrl).hostname;
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const out: Omit<FeedItem, 'est_minutes' | 'est_unknown_ratio'>[] = [];
  for (const b of blocks) {
    const title = strip(tag(b, 'title') ?? '');
    let link = strip(tag(b, 'link') ?? '');
    if (!link) link = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i)?.[1] ?? b.match(/<link[^>]*href=["']([^"']+)/i)?.[1] ?? '';
    if (!title || !/^https?:\/\//.test(link)) continue;
    const date = strip(tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date') ?? '');
    const excerpt = strip(tag(b, 'description') ?? tag(b, 'summary') ?? tag(b, 'content') ?? tag(b, 'content:encoded') ?? '').slice(0, 600);
    out.push({ url: decode(link), title, site, published_at: Date.parse(date) || undefined, excerpt });
  }
  return out;
}

const CACHE = new Map<string, { at: number; items: Omit<FeedItem, 'est_minutes' | 'est_unknown_ratio'>[] }>();

export async function userFeeds(ctx: Ctx): Promise<{ url: string; title: string; builtin: boolean; enabled: boolean }[]> {
  const row = await ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'feeds'");
  const cfg = j.parse<{ custom?: { url: string; title: string }[]; disabled?: string[] }>(row?.value, {});
  const disabled = new Set(cfg.disabled ?? []);
  return [...BUILTIN_FEEDS.map(f => ({ ...f, builtin: true })), ...(cfg.custom ?? []).map(f => ({ ...f, builtin: false }))].map(f => ({ ...f, enabled: !disabled.has(f.url) }));
}

export async function searchFeeds(ctx: Ctx, p: { interests?: string[]; max_unknown_ratio?: number; since?: number; limit?: number }): Promise<FeedItem[]> {
  if (!ctx.platform.isOnline()) throw new TibiError('offline', '现在没有网络');
  const feeds = (await userFeeds(ctx)).filter(f => f.enabled);
  const all: Omit<FeedItem, 'est_minutes' | 'est_unknown_ratio'>[] = [];
  await Promise.all(feeds.map(async f => {
    const c = CACHE.get(f.url);
    if (c && now() - c.at < 3600_000) { all.push(...c.items); return; }
    try {
      const page = await ctx.platform.fetchUrl(f.url, { timeout_ms: 10_000 });
      if (page.status >= 400) return;
      const items = parseFeed(page.body, f.url).slice(0, 30);
      CACHE.set(f.url, { at: now(), items }); all.push(...items);
    } catch { /* 某个源坏了不影响别的 */ }
  }));
  const since = p.since ?? now() - 30 * 86_400_000;
  const words = (p.interests ?? []).map(w => w.toLowerCase());
  let items = all.filter(i => !i.published_at || i.published_at >= since);
  // 已经在书架里的不推荐
  const have = new Set((await ctx.db.all<{ source_uri: string }>("SELECT source_uri FROM documents WHERE source_type = 'url' AND deleted_at IS NULL")).map(r => r.source_uri));
  items = items.filter(i => !have.has(i.url));
  const profile = await readProfile(ctx.db);
  const scored: FeedItem[] = [];
  for (const i of items) {
    let ratio: number | undefined;
    if (i.excerpt.split(/\s+/).length >= 12) { const r = await annotateSentences({ sentences: [i.excerpt], dict: ctx.dict, vocab_estimate: profile.vocab_estimate, statusOf: () => undefined }); ratio = r.unknown_ratio; }
    scored.push({ ...i, est_minutes: Math.max(3, Math.round(1200 / WPM)), ...(ratio !== undefined ? { est_unknown_ratio: Number(ratio.toFixed(3)) } : {}) });
  }
  const max = p.max_unknown_ratio ?? 0.08;
  const rank = (i: FeedItem) => (words.some(w => (i.title + ' ' + i.excerpt).toLowerCase().includes(w)) ? 2 : 0) + (i.published_at ? Math.max(0, 1 - (now() - i.published_at) / (14 * 86_400_000)) : 0);
  return scored.filter(i => i.est_unknown_ratio === undefined || i.est_unknown_ratio <= max).sort((a, b) => rank(b) - rank(a)).slice(0, p.limit ?? 20);
}

export const feedsCapabilities: CapabilityMap = {
  search_feeds: capability({
    name: 'search_feeds', description: '从订阅源拉取候选文章（标题、链接、摘要、粗估的生词率）', perm: 'read',
    params: Type.Object({ interests: Type.Optional(Type.Array(Type.String())), max_unknown_ratio: Type.Optional(Type.Number()), since: Type.Optional(Type.Number()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })) }),
    async run(p, ctx) { return searchFeeds(ctx, p); },
  }),
  web_search: capability({
    name: 'web_search', description: '网页搜索（需要在设置里配置搜索服务）', perm: 'read',
    params: Type.Object({ q: Type.String(), limit: Type.Optional(Type.Integer()) }),
    async run() { throw new TibiError('conflict', '没有配置搜索服务，先用订阅源里的文章'); },
  }),
};

export const feedsMethods: MethodMap = {
  'feeds.list': method(Type.Object({}), async (_p, ctx) => userFeeds(ctx), '订阅源：内置 + 自己加的，带开关'),
  'feeds.update': method(Type.Object({ add: Type.Optional(Type.Object({ url: Type.String(), title: Type.Optional(Type.String()) })), remove: Type.Optional(Type.String()), toggle: Type.Optional(Type.Object({ url: Type.String(), enabled: Type.Boolean() })) }), async (p, ctx) => {
    const row = await ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'feeds'");
    const cfg = j.parse<{ custom?: { url: string; title: string }[]; disabled?: string[] }>(row?.value, {});
    cfg.custom ??= []; cfg.disabled ??= [];
    if (p.add) {
      if (!/^https?:\/\//i.test(p.add.url)) throw new TibiError('invalid_params', '订阅地址要以 http(s):// 开头');
      const page = await ctx.platform.fetchUrl(p.add.url, { timeout_ms: 10_000 }).catch(() => { throw new TibiError('invalid_source', '这个地址打不开'); });
      const items = parseFeed(page.body, p.add.url);
      if (!items.length) throw new TibiError('invalid_source', '这个地址不是 RSS / Atom 订阅源');
      if (!cfg.custom.some(f => f.url === p.add!.url)) cfg.custom.push({ url: p.add.url, title: p.add.title || items[0]!.site });
    }
    if (p.remove) cfg.custom = cfg.custom.filter(f => f.url !== p.remove);
    if (p.toggle) cfg.disabled = p.toggle.enabled ? cfg.disabled.filter(u => u !== p.toggle!.url) : [...new Set([...cfg.disabled, p.toggle.url])];
    await ctx.db.run("INSERT INTO settings(key, value, updated_at) VALUES ('feeds', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [j.str(cfg), now()]);
    return userFeeds(ctx);
  }, '加 / 删订阅源（加的时候先抓一次确认是 RSS / Atom）、开关内置源'),
  'feeds.search': method(Type.Object({ interests: Type.Optional(Type.Array(Type.String())), max_unknown_ratio: Type.Optional(Type.Number()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })) }), async (p, ctx) => searchFeeds(ctx, p), '界面直接看候选（不经模型）'),
};
