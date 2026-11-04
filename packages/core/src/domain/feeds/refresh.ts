import { now } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import type { Ctx } from '../../rpc/define.js';
import { TibiError } from '../../types.js';
import { checkUrlShape } from '../documents/methods.js';
import { annotateSentences } from '../text/annotate.js';
import { countWords } from '../text/segment.js';
import { discoverInHtml, parseFeed, type ParsedFeed, type ParsedItem } from './parse.js';
import { KEEP_DAYS, netError, prune, type FeedRow } from './repo.js';

/**
 * 抓订阅（11 §4）：到点的源才抓，带 If-None-Match / If-Modified-Since；失败按 2ⁿ 退避。
 * 已有的条目只更新内容，不碰已读 / 保存 / 丢弃的状态。
 */

export const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5';
const MIN_INTERVAL_MIN = 120;
const MAX_BACKOFF_MIN = 1440;
const CONCURRENCY = 4;
const PER_FETCH = 50;
const MAX_CONTENT = 200_000;

export interface RefreshResult { feeds: number; not_modified: number; new_items: number; failed: number }

let running: Promise<RefreshResult> | undefined;

/** 刷新订阅；同一时间只跑一轮，重复调用拿到同一轮的结果 */
export function refreshFeeds(ctx: Ctx, p: { feed_ids?: string[]; force?: boolean } = {}): Promise<RefreshResult> {
  if (running) return running;
  running = doRefresh(ctx, p).finally(() => { running = undefined; });
  return running;
}
export const isRefreshing = () => !!running;

async function doRefresh(ctx: Ctx, p: { feed_ids?: string[]; force?: boolean }): Promise<RefreshResult> {
  const out: RefreshResult = { feeds: 0, not_modified: 0, new_items: 0, failed: 0 };
  if (!ctx.platform.isOnline()) return out;
  const t = now();
  const ids = p.feed_ids?.length ? p.feed_ids : undefined;
  const due = await ctx.db.all<FeedRow>(
    `SELECT * FROM feeds WHERE deleted_at IS NULL AND enabled = 1 ${ids ? `AND id IN (${ids.map(() => '?').join(',')})` : ''} ${p.force ? '' : 'AND (next_fetch_at IS NULL OR next_fetch_at <= ?)'} ORDER BY COALESCE(last_fetched_at, 0)`,
    [...(ids ?? []), ...(p.force ? [] : [t])]);
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
    page = await ctx.platform.fetchUrl(f.url, { timeout_ms: 10_000, headers: { accept: FEED_ACCEPT, ...(f.etag ? { 'if-none-match': f.etag } : {}), ...(f.last_modified ? { 'if-modified-since': f.last_modified } : {}) } });
  } catch (e) { return fail(netError(e)); }
  if (page.status === 304) {
    await ctx.db.run('UPDATE feeds SET error = NULL, error_count = 0, last_fetched_at = ?, last_ok_at = ?, next_fetch_at = ? WHERE id = ?', [t, t, t + interval, f.id]);
    return 'not_modified';
  }
  if (page.status >= 400) return fail(`打不开（${page.status}）`);
  const parsed = parseFeed(page.body, page.final_url, page.content_type);
  if (!parsed) return fail('不是 RSS / Atom 订阅了');
  const added = await saveItems(ctx, f.id, parsed.items);
  const next = t + Math.max(MIN_INTERVAL_MIN, parsed.ttl_minutes ?? 0) * 60_000;
  await ctx.db.run(
    `UPDATE feeds SET title = CASE WHEN title_custom = 1 OR ? = '' THEN title ELSE ? END, site_url = COALESCE(?, site_url), etag = ?, last_modified = ?, ttl_minutes = ?,
       error = NULL, error_count = 0, last_fetched_at = ?, last_ok_at = ?, next_fetch_at = ? WHERE id = ?`,
    [parsed.title, parsed.title, parsed.site_url ?? null, page.headers?.etag ?? null, page.headers?.last_modified ?? null, parsed.ttl_minutes ?? null, t, t, next, f.id]);
  return added;
}

/** 写入条目：新的估级别、转全文；已有的只更新内容。返回新增几条 */
export async function saveItems(ctx: Ctx, feed_id: string, items: ParsedItem[]): Promise<number> {
  const t = now();
  const oldest = t - KEEP_DAYS * 86_400_000;
  let added = 0;
  for (const it of items.slice(0, PER_FETCH)) {
    if (it.published_at && it.published_at < oldest) continue;
    // 只收像全文的（≥ 150 词）：很多源的 content:encoded 只是一段引子，按它算时长会偏短
    const md = it.content_html && ctx.platform.htmlToMarkdown ? safeMd(ctx, it.content_html, it.url) : undefined;
    const content_md = md && countWords(md) >= 150 ? md : undefined;
    const existing = await ctx.db.get<{ id: string }>('SELECT id FROM feed_items WHERE feed_id = ? AND guid = ?', [feed_id, it.guid]);
    if (existing) {
      await ctx.db.run(`UPDATE feed_items SET url = ?, title = ?, author = ?, published_at = COALESCE(?, published_at), excerpt = ?, content_md = COALESCE(?, content_md), word_count = COALESCE(?, word_count), comments_url = ?, updated_at = ?
        WHERE id = ? AND (url != ? OR title != ? OR excerpt != ? OR COALESCE(content_md, '') != COALESCE(?, content_md, ''))`,
        [it.url, it.title, it.author ?? null, it.published_at ?? null, it.excerpt, content_md ?? null, content_md ? countWords(content_md) : null, it.comments_url ?? null, t, existing.id, it.url, it.title, it.excerpt, content_md ?? null]);
      continue;
    }
    const level = await estimateLevel(ctx, it.excerpt.split(/\s+/).length >= 12 ? it.excerpt : content_md?.slice(0, 3000));
    const doc = await ctx.db.get<{ id: string; shelved: number }>("SELECT id, shelved FROM documents WHERE source_type = 'url' AND source_uri = ? AND deleted_at IS NULL", [it.url]);
    await ctx.db.run(
      `INSERT INTO feed_items(id, feed_id, guid, url, title, author, published_at, excerpt, content_md, word_count, est_level, comments_url, state, document_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uuidv7(), feed_id, it.guid, it.url, it.title, it.author ?? null, it.published_at ?? null, it.excerpt, content_md ?? null, content_md ? countWords(content_md) : null, level ?? null, it.comments_url ?? null, doc ? (Number(doc.shelved) ? 'saved' : 'seen') : 'new', doc?.id ?? null, t, t]);
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

export interface FeedCandidate { url: string; title: string; site_url?: string; latest?: { title: string; published_at?: number } }

const GUESS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml'];

/** 给一个地址（订阅地址或网站地址），找出可以订阅的源 */
export async function discoverFeeds(ctx: Ctx, url: string): Promise<FeedCandidate[]> {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u) || !checkUrlShape(u).ok) throw new TibiError('invalid_source', '网址不对，或者是本机 / 局域网地址');
  if (!ctx.platform.isOnline()) throw new TibiError('offline', '现在没有网络');
  const get = (x: string) => ctx.platform.fetchUrl(x, { timeout_ms: 10_000, headers: { accept: FEED_ACCEPT } });
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
  for (const c of discoverInHtml(page.body, page.final_url).slice(0, 5)) await tryFeed(c.url);
  if (!out.length) {
    const origin = new URL(page.final_url).origin;
    for (const g of GUESS) { await tryFeed(origin + g); if (out.length) break; }
  }
  if (!out.length) throw new TibiError('invalid_source', '这个网站没有找到 RSS / Atom 订阅');
  return out;
}

function candidate(url: string, f: ParsedFeed): FeedCandidate {
  const latest = [...f.items].sort((a, b) => (b.published_at ?? 0) - (a.published_at ?? 0))[0];
  return { url, title: f.title, ...(f.site_url ? { site_url: f.site_url } : {}), ...(latest ? { latest: { title: latest.title, ...(latest.published_at ? { published_at: latest.published_at } : {}) } } : {}) };
}
