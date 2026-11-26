import { now } from '../../db/driver.js';
import type { Ctx } from '../../rpc/define.js';
import { TibiError } from '../../types.js';
import { checkUrlShape } from '../../web/url.js';
import { annotateSentences } from '../text/annotate.js';
import { parseFeed, type ParsedFeed, type ParsedItem } from './parse.js';
import { resolveApplePodcastUrl } from './refresh.js';
import { getFeedByUrl, netError } from './repo.js';

/**
 * 播客单集只读预览与免订阅试听缓存（19 §3.1）：
 * 不写 feeds / feed_items 表；进程内 LRU 缓存最近 20 个源（TTL 10 分钟），供紧接着试听复用。
 */

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5';
const CACHE_MAX = 20;
const CACHE_TTL_MS = 10 * 60_000;

interface CachedPreview {
  at: number;
  final_url: string;
  feed: ParsedFeed;
}

const previewCache = new Map<string, CachedPreview>();

export function clearPreviewCache(): void {
  previewCache.clear();
}

function getCached(url: string): CachedPreview | undefined {
  const hit = previewCache.get(url);
  if (!hit) return undefined;
  if (now() - hit.at > CACHE_TTL_MS) { previewCache.delete(url); return undefined; }
  // 刷新 LRU 顺序
  previewCache.delete(url);
  previewCache.set(url, hit);
  return hit;
}

function setCached(key: string, val: CachedPreview): void {
  previewCache.delete(key);
  previewCache.set(key, val);
  if (previewCache.size > CACHE_MAX) {
    const oldest = previewCache.keys().next().value;
    if (oldest) previewCache.delete(oldest);
  }
}

export interface PodcastPreviewEpisode {
  guid: string;
  title: string;
  url: string;
  author?: string;
  published_at?: number;
  excerpt: string;
  audio_url: string;
  audio_mime?: string;
  duration_ms?: number;
  has_transcript?: boolean;
  artwork_url?: string;
  est_level?: string;
  document_id?: string;
  in_library?: boolean;
}

export interface PodcastPreviewResult {
  feed_url: string;
  title: string;
  site_url?: string;
  artwork_url?: string;
  language?: string;
  description?: string;
  subscribed: boolean;
  feed_id?: string;
  total_episodes: number;
  episodes: PodcastPreviewEpisode[];
}

async function fetchAndParsePodcast(ctx: Ctx, rawUrl: string): Promise<CachedPreview> {
  let u = rawUrl.trim();
  if (!/^https?:\/\//i.test(u) || !checkUrlShape(u).ok) {
    throw new TibiError('invalid_source', '网址不对，或者是本机 / 局域网地址');
  }
  const hit = getCached(u);
  if (hit) return hit;

  if (!ctx.platform.isOnline()) throw new TibiError('offline', '现在没有网络');
  const apple = await resolveApplePodcastUrl(ctx, u);
  if (apple) {
    u = apple;
    const hit2 = getCached(u);
    if (hit2) return hit2;
  }

  const page = await ctx.platform.fetchUrl(u, { timeout_ms: 20_000, headers: { accept: FEED_ACCEPT } })
    .catch(e => { throw e instanceof TibiError ? e : new TibiError('offline', netError(e)); });
  if (page.status >= 400) throw new TibiError('invalid_source', `这个播客源打不开（${page.status}）`);
  const parsed = parseFeed(page.body, page.final_url, page.content_type);
  if (!parsed) throw new TibiError('invalid_source', '不是有效的播客 RSS 源');
  const audioItems = parsed.items.filter(it => it.audio_url && checkUrlShape(it.audio_url).ok);
  if (!audioItems.length) throw new TibiError('invalid_source', '这个源里没有可播放的音频单集');

  const entry: CachedPreview = { at: now(), final_url: page.final_url, feed: { ...parsed, items: audioItems } };
  setCached(u, entry);
  if (page.final_url !== u) setCached(page.final_url, entry);
  return entry;
}

async function estimateExcerptLevel(ctx: Ctx, text: string): Promise<string | undefined> {
  if (!text || text.split(/\s+/).length < 12) return undefined;
  try {
    return (await annotateSentences({ sentences: [text], dict: ctx.dict, statusOf: () => undefined })).level;
  } catch {
    return undefined;
  }
}

/** 预览未订阅（或已订阅）播客的简介与最近单集，不写库 */
export async function previewPodcast(ctx: Ctx, url: string, limit = 8): Promise<PodcastPreviewResult> {
  const { final_url, feed } = await fetchAndParsePodcast(ctx, url);
  const max = Math.min(20, Math.max(1, limit));
  const sub = (await getFeedByUrl(ctx.db, url.trim())) ?? (final_url !== url.trim() ? await getFeedByUrl(ctx.db, final_url) : undefined);

  const slice = feed.items.slice(0, max);
  const episodes: PodcastPreviewEpisode[] = [];
  for (const it of slice) {
    if (!it.audio_url) continue;
    const doc = await ctx.db.get<{ id: string; shelved: number }>(
      "SELECT id, shelved FROM documents WHERE source_type = 'podcast' AND (source_uri = ? OR media_url = ?) AND deleted_at IS NULL",
      [it.url, it.audio_url],
    );
    const est_level = await estimateExcerptLevel(ctx, it.excerpt);
    episodes.push({
      guid: it.guid,
      title: it.title,
      url: it.url,
      ...(it.author ? { author: it.author } : {}),
      ...(it.published_at ? { published_at: it.published_at } : {}),
      excerpt: it.excerpt,
      audio_url: it.audio_url,
      ...(it.audio_mime ? { audio_mime: it.audio_mime } : {}),
      ...(it.duration_ms ? { duration_ms: it.duration_ms } : {}),
      ...(it.transcript_url ? { has_transcript: true } : {}),
      ...(it.artwork_url ? { artwork_url: it.artwork_url } : {}),
      ...(est_level ? { est_level } : {}),
      ...(doc ? { document_id: doc.id, in_library: Number(doc.shelved) === 1 } : {}),
    });
  }

  return {
    feed_url: final_url,
    title: feed.title,
    ...(feed.site_url ? { site_url: feed.site_url } : {}),
    ...(feed.artwork_url ? { artwork_url: feed.artwork_url } : {}),
    ...(feed.language ? { language: feed.language } : {}),
    ...(feed.description ? { description: feed.description } : {}),
    subscribed: !!sub && !!sub.enabled,
    ...(sub ? { feed_id: sub.id } : {}),
    total_episodes: feed.items.length,
    episodes,
  };
}

/** 供 documents.import({ source: { type: 'podcast_episode', feed_url, guid } }) 定位单集 */
export async function resolvePreviewEpisode(ctx: Ctx, feedUrl: string, guid: string): Promise<{ feed: ParsedFeed; item: ParsedItem }> {
  const { feed } = await fetchAndParsePodcast(ctx, feedUrl);
  const item = feed.items.find(it => it.guid === guid || it.audio_url === guid || it.url === guid);
  if (!item || !item.audio_url) throw new TibiError('not_found', '在这个播客源里找不到这期单集');
  if (!checkUrlShape(item.audio_url).ok) throw new TibiError('invalid_source', '音频地址不对，或者是本机 / 局域网地址');
  return { feed, item };
}
