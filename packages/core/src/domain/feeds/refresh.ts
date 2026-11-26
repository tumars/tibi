import { now } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import type { Ctx } from '../../rpc/define.js';
import { TibiError, type FeedKind } from '../../types.js';
import { checkUrlShape } from '../documents/methods.js';
import { annotateSentences } from '../text/annotate.js';
import { countWords } from '../text/segment.js';
import { discoverInHtml, parseFeed, type ParsedFeed, type ParsedItem } from './parse.js';
import { KEEP_DAYS, netError, prune, type FeedRow } from './repo.js';

/**
 * 抓订阅与电台（11 §4、17 §5）：到点的源才抓，带 If-None-Match / If-Modified-Since；失败按 2ⁿ 退避。
 * 已有的条目只更新内容，不碰已读 / 保存 / 丢弃的状态。
 */

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5';
const MIN_INTERVAL_MIN = 120;
const MAX_BACKOFF_MIN = 1440;
const CONCURRENCY = 4;
const PER_FETCH = 50;
const MAX_CONTENT = 200_000;

export interface RefreshResult { feeds: number; not_modified: number; new_items: number; failed: number }

let running: Promise<RefreshResult> | undefined;
let runningKey: string | undefined;

function refreshKey(p: { feed_ids?: string[]; kind?: FeedKind; force?: boolean }): string {
  const ids = p.feed_ids?.length ? [...p.feed_ids].sort().join(',') : '';
  return `${p.kind ?? ''}|${ids}|${p.force ? '1' : '0'}`;
}

/** 刷新订阅：相同参数的并发调用复用同一轮；指定了 feed_ids / kind / force 时排在当前轮之后单独跑，不静默吞掉 */
export function refreshFeeds(ctx: Ctx, p: { feed_ids?: string[]; kind?: FeedKind; force?: boolean } = {}): Promise<RefreshResult> {
  const key = refreshKey(p);
  if (running && runningKey === key) return running;
  const prev = running;
  const task: Promise<RefreshResult> = (prev ? prev.catch(() => undefined) : Promise.resolve())
    .then(() => doRefresh(ctx, p))
    .finally(() => {
      if (running === task) { running = undefined; runningKey = undefined; }
    });
  running = task;
  runningKey = key;
  return task;
}
export const isRefreshing = () => !!running;

async function doRefresh(ctx: Ctx, p: { feed_ids?: string[]; kind?: FeedKind; force?: boolean }): Promise<RefreshResult> {
  const out: RefreshResult = { feeds: 0, not_modified: 0, new_items: 0, failed: 0 };
  if (!ctx.platform.isOnline()) return out;
  const t = now();
  const ids = p.feed_ids?.length ? p.feed_ids : undefined;
  const where = ['deleted_at IS NULL', 'enabled = 1'];
  const args: (string | number)[] = [];
  if (ids) { where.push(`id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
  if (p.kind) { where.push('kind = ?'); args.push(p.kind); }
  if (!p.force) { where.push('(next_fetch_at IS NULL OR next_fetch_at <= ?)'); args.push(t); }
  const due = await ctx.db.all<FeedRow>(`SELECT * FROM feeds WHERE ${where.join(' AND ')} ORDER BY COALESCE(last_fetched_at, 0)`, args);
  const queue = [...due];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      out.feeds++;
      const r = await refreshOne(ctx, f);
      if (r === 'not_modified') out.not_modified++; else if (r === 'failed') out.failed++; else out.new_items += r;
    }
  }));
  if (out.feeds) {
    await prune(ctx.db);
    ctx.events.emit('data.changed', { table: 'feeds' });
    if (out.new_items) ctx.events.emit('data.changed', { table: 'feed_items' });
  }
  return out;
}

async function refreshOne(ctx: Ctx, f: FeedRow): Promise<number | 'not_modified' | 'failed'> {
  const t = now();
  const interval = Math.max(MIN_INTERVAL_MIN, f.ttl_minutes ?? 0) * 60_000;
  const fail = async (msg: string) => {
    const n = f.error_count + 1;
    await ctx.db.run('UPDATE feeds SET error = ?, error_count = ?, last_fetched_at = ?, next_fetch_at = ? WHERE id = ?', [msg, n, t, t + Math.min(MAX_BACKOFF_MIN, 30 * 2 ** (n - 1)) * 60_000, f.id]);
    return 'failed' as const;
  };
  let page;
  try {
    // 播客 RSS XML 常在 0.5–2 MB，给 20 秒超时避免误判
    const timeout_ms = f.kind === 'podcast' ? 20_000 : 12_000;
    page = await ctx.platform.fetchUrl(f.url, { timeout_ms, headers: { accept: FEED_ACCEPT, ...(f.etag ? { 'if-none-match': f.etag } : {}), ...(f.last_modified ? { 'if-modified-since': f.last_modified } : {}) } });
  } catch (e) { return fail(netError(e)); }
  if (page.status === 304) {
    await ctx.db.run('UPDATE feeds SET error = NULL, error_count = 0, last_fetched_at = ?, last_ok_at = ?, next_fetch_at = ? WHERE id = ?', [t, t, t + interval, f.id]);
    return 'not_modified';
  }
  if (page.status >= 400) return fail(`打不开（${page.status}）`);
  const parsed = parseFeed(page.body, page.final_url, page.content_type);
  if (!parsed) return fail('不是 RSS / Atom 订阅了');
  const feedKind: FeedKind = f.kind === 'podcast' || parsed.kind === 'podcast' ? 'podcast' : 'article';
  const added = await saveItems(ctx, f.id, parsed.items, feedKind);
  const next = t + Math.max(MIN_INTERVAL_MIN, parsed.ttl_minutes ?? 0) * 60_000;
  await ctx.db.run(
    `UPDATE feeds SET title = CASE WHEN title_custom = 1 OR ? = '' THEN title ELSE ? END, site_url = COALESCE(?, site_url),
       artwork_url = COALESCE(?, artwork_url), language = COALESCE(?, language), description = COALESCE(?, description),
       etag = ?, last_modified = ?, ttl_minutes = ?,
       error = NULL, error_count = 0, last_fetched_at = ?, last_ok_at = ?, next_fetch_at = ? WHERE id = ?`,
    [parsed.title, parsed.title, parsed.site_url ?? null, parsed.artwork_url ?? null, parsed.language ?? null, parsed.description ?? null,
      page.headers?.etag ?? null, page.headers?.last_modified ?? null, parsed.ttl_minutes ?? null, t, t, next, f.id]);
  return added;
}

/** 写入条目：新的估级别、转全文；已有的只更新内容。返回新增几条 */
async function saveItems(ctx: Ctx, feed_id: string, items: ParsedItem[], kind: FeedKind): Promise<number> {
  const t = now();
  const oldest = t - KEEP_DAYS * 86_400_000;
  let added = 0;
  for (const it of items.slice(0, PER_FETCH)) {
    // 文章按 60 天截断；播客常按周/月更新，保留最近 50 集不按 60 天截空
    if (kind === 'article' && it.published_at && it.published_at < oldest) continue;
    // 只收像全文的（≥ 150 词）：很多源的 content:encoded 只是一段引子，按它算时长会偏短
    const md = it.content_html && ctx.platform.htmlToMarkdown ? safeMd(ctx, it.content_html, it.url) : undefined;
    const content_md = md && countWords(md) >= 150 ? md : undefined;
    const existing = await ctx.db.get<{ id: string }>('SELECT id FROM feed_items WHERE feed_id = ? AND guid = ?', [feed_id, it.guid]);
    if (existing) {
      await ctx.db.run(
        `UPDATE feed_items SET url = ?, title = ?, author = ?, published_at = COALESCE(?, published_at), excerpt = ?,
           content_md = COALESCE(?, content_md), word_count = COALESCE(?, word_count), comments_url = ?,
           audio_url = COALESCE(?, audio_url), audio_mime = COALESCE(?, audio_mime), audio_bytes = COALESCE(?, audio_bytes),
           duration_ms = COALESCE(?, duration_ms), transcript_url = COALESCE(?, transcript_url), transcript_type = COALESCE(?, transcript_type),
           chapters_url = COALESCE(?, chapters_url), artwork_url = COALESCE(?, artwork_url),
           season = COALESCE(?, season), episode = COALESCE(?, episode), updated_at = ?
         WHERE id = ? AND (url != ? OR title != ? OR excerpt != ? OR COALESCE(content_md, '') != COALESCE(?, content_md, '')
           OR COALESCE(audio_url, '') != COALESCE(?, audio_url, '') OR COALESCE(transcript_url, '') != COALESCE(?, transcript_url, ''))`,
        [it.url, it.title, it.author ?? null, it.published_at ?? null, it.excerpt,
          content_md ?? null, content_md ? countWords(content_md) : null, it.comments_url ?? null,
          it.audio_url ?? null, it.audio_mime ?? null, it.audio_bytes ?? null,
          it.duration_ms ?? null, it.transcript_url ?? null, it.transcript_type ?? null,
          it.chapters_url ?? null, it.artwork_url ?? null, it.season ?? null, it.episode ?? null, t,
          existing.id, it.url, it.title, it.excerpt, content_md ?? null, it.audio_url ?? null, it.transcript_url ?? null]);
      continue;
    }
    const level = await estimateLevel(ctx, it.excerpt.split(/\s+/).length >= 12 ? it.excerpt : content_md?.slice(0, 3000));
    const doc = await ctx.db.get<{ id: string; shelved: number }>(
      "SELECT id, shelved FROM documents WHERE ((source_type = 'url' AND source_uri = ?) OR (source_type = 'podcast' AND (source_uri = ? OR media_url = ?))) AND deleted_at IS NULL",
      [it.url, it.url, it.audio_url ?? ''],
    );
    await ctx.db.run(
      `INSERT INTO feed_items(id, feed_id, guid, url, title, author, published_at, excerpt, content_md, word_count, est_level, comments_url,
         audio_url, audio_mime, audio_bytes, duration_ms, transcript_url, transcript_type, chapters_url, artwork_url, season, episode,
         state, document_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uuidv7(), feed_id, it.guid, it.url, it.title, it.author ?? null, it.published_at ?? null, it.excerpt,
        content_md ?? null, content_md ? countWords(content_md) : null, level ?? null, it.comments_url ?? null,
        it.audio_url ?? null, it.audio_mime ?? null, it.audio_bytes ?? null, it.duration_ms ?? null,
        it.transcript_url ?? null, it.transcript_type ?? null, it.chapters_url ?? null, it.artwork_url ?? null,
        it.season ?? null, it.episode ?? null,
        doc ? (Number(doc.shelved) ? 'saved' : 'seen') : 'new', doc?.id ?? null, t, t]);
    added++;
  }
  return added;
}

function safeMd(ctx: Ctx, html: string, url: string): string | undefined {
  try { const md = ctx.platform.htmlToMarkdown!(html, url).trim(); return md ? md.slice(0, MAX_CONTENT) : undefined; } catch { return undefined; }
}

/** 文本级别只看词频（与用户无关），太短不估 */
async function estimateLevel(ctx: Ctx, text: string | undefined): Promise<string | undefined> {
  if (!text || text.split(/\s+/).length < 12) return undefined;
  try { return (await annotateSentences({ sentences: [text], dict: ctx.dict, statusOf: () => undefined })).level; } catch { return undefined; }
}

export interface FeedCandidate {
  url: string; title: string; site_url?: string; kind: FeedKind; artwork_url?: string;
  latest?: { title: string; published_at?: number };
}

export interface PodcastSearchResult {
  title: string; author?: string; feed_url: string; artwork_url?: string; genre?: string; episode_count?: number; site_url?: string;
}

const GUESS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml'];

/** Apple Podcasts 链接（podcasts.apple.com/.../id123456）反查真实 RSS 地址 */
async function resolveApplePodcastUrl(ctx: Ctx, url: string): Promise<string | undefined> {
  const m = url.match(/podcasts\.apple\.com\/.*\/id(\d+)/i);
  if (!m) return undefined;
  try {
    const r = await ctx.platform.fetchUrl(`https://itunes.apple.com/lookup?id=${m[1]}&entity=podcast`, { timeout_ms: 10_000, headers: { accept: 'application/json' } });
    if (r.status >= 400) return undefined;
    const data = JSON.parse(r.body) as { results?: { feedUrl?: string }[] };
    const feedUrl = data.results?.[0]?.feedUrl;
    return feedUrl && checkUrlShape(feedUrl).ok ? feedUrl : undefined;
  } catch { return undefined; }
}

/** 用 Apple iTunes Search API 搜全球播客（免费、免 Key，17 §2.2） */
export async function searchPodcasts(ctx: Ctx, q: string, limit = 15): Promise<PodcastSearchResult[]> {
  const term = q.trim();
  if (!term) return [];
  if (!ctx.platform.isOnline()) throw new TibiError('offline', '现在没有网络');
  const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&term=${encodeURIComponent(term)}&limit=${Math.min(25, Math.max(1, limit))}`;
  const page = await ctx.platform.fetchUrl(url, { timeout_ms: 12_000, headers: { accept: 'application/json' } })
    .catch(e => { throw e instanceof TibiError ? e : new TibiError('offline', netError(e)); });
  if (page.status >= 400) throw new TibiError('invalid_source', `搜索播客失败（${page.status}）`);
  let data: { results?: { collectionName?: string; trackName?: string; artistName?: string; feedUrl?: string; artworkUrl600?: string; artworkUrl100?: string; primaryGenreName?: string; trackCount?: number; collectionViewUrl?: string }[] };
  try { data = JSON.parse(page.body); } catch { return []; }
  const out: PodcastSearchResult[] = [];
  const seen = new Set<string>();
  for (const r of data.results ?? []) {
    if (!r.feedUrl || !checkUrlShape(r.feedUrl).ok || seen.has(r.feedUrl)) continue;
    seen.add(r.feedUrl);
    const title = (r.collectionName || r.trackName || '').trim();
    if (!title) continue;
    out.push({
      title,
      ...(r.artistName ? { author: r.artistName } : {}),
      feed_url: r.feedUrl,
      ...(r.artworkUrl600 || r.artworkUrl100 ? { artwork_url: r.artworkUrl600 || r.artworkUrl100 } : {}),
      ...(r.primaryGenreName ? { genre: r.primaryGenreName } : {}),
      ...(r.trackCount ? { episode_count: r.trackCount } : {}),
      ...(r.collectionViewUrl ? { site_url: r.collectionViewUrl } : {}),
    });
  }
  return out;
}

/** 给一个地址（订阅地址、Apple Podcasts 链接或网站地址），找出可以订阅的源 */
export async function discoverFeeds(ctx: Ctx, url: string): Promise<FeedCandidate[]> {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u) || !checkUrlShape(u).ok) throw new TibiError('invalid_source', '网址不对，或者是本机 / 局域网地址');
  if (!ctx.platform.isOnline()) throw new TibiError('offline', '现在没有网络');
  const appleFeed = await resolveApplePodcastUrl(ctx, u);
  if (appleFeed) u = appleFeed;
  const get = (x: string) => ctx.platform.fetchUrl(x, { timeout_ms: 15_000, headers: { accept: FEED_ACCEPT } });
  const page = await get(u).catch(e => { throw e instanceof TibiError ? e : new TibiError('invalid_source', '这个地址打不开'); });
  if (page.status >= 400) throw new TibiError('invalid_source', `这个地址打不开（${page.status}）`);
  const direct = parseFeed(page.body, page.final_url, page.content_type);
  if (direct) return [candidate(page.final_url, direct)];
  const out: FeedCandidate[] = [];
  const tryFeed = async (x: string) => {
    try {
      const p = await get(x);
      const f = p.status < 400 ? parseFeed(p.body, p.final_url, p.content_type) : undefined;
      if (f && !out.some(o => o.url === p.final_url)) out.push(candidate(p.final_url, f));
    } catch { /* 这个候选坏了，看下一个 */ }
  };
  for (const c of discoverInHtml(page.body, page.final_url).slice(0, 5)) {
    if (checkUrlShape(c.url).ok) await tryFeed(c.url);
  }
  if (!out.length) {
    const origin = new URL(page.final_url).origin;
    for (const g of GUESS) { await tryFeed(origin + g); if (out.length) break; }
  }
  if (!out.length) throw new TibiError('invalid_source', '这个网站没有找到 RSS / Atom 订阅');
  return out;
}

function candidate(url: string, f: ParsedFeed): FeedCandidate {
  const latest = [...f.items].sort((a, b) => (b.published_at ?? 0) - (a.published_at ?? 0))[0];
  return {
    url, title: f.title, kind: f.kind,
    ...(f.site_url ? { site_url: f.site_url } : {}),
    ...(f.artwork_url ? { artwork_url: f.artwork_url } : {}),
    ...(latest ? { latest: { title: latest.title, ...(latest.published_at ? { published_at: latest.published_at } : {}) } } : {}),
  };
}
