import { now } from '../../db/driver.js';
import type { Ctx } from '../../rpc/define.js';
import { TibiError } from '../../types.js';
import { checkUrlShape } from '../../web/url.js';
import type { PodcastSearchResult } from './refresh.js';
import { netError } from './repo.js';

/**
 * Apple iTunes 实时分类榜单（19 §2.2）：免 Key，2 次请求（toppodcasts + 批量 lookup 换 feedUrl），
 * 进程内存缓存 6 小时；语言学习分类（1498）自动剔除非英语目标语节目。
 */

export type PodcastChartGenre = 'language' | 'tech' | 'science' | 'business' | 'news' | 'history';
export type PodcastChartCountry = 'us' | 'gb';

export interface PodcastChartItem extends PodcastSearchResult {
  rank: number;
  apple_id: string;
  summary?: string;
}

export const CHART_GENRE_IDS: Record<PodcastChartGenre, number> = {
  language: 1498,
  tech: 1318,
  science: 1533,
  business: 1321,
  news: 1489,
  history: 1487,
};

const CHARTS_TTL_MS = 6 * 3600_000;
const cache = new Map<string, { at: number; items: PodcastChartItem[] }>();

export function clearChartsCache(): void {
  cache.clear();
}

/** 过滤语言学习榜里的非英语目标语课程（如 Coffee Break Spanish / French / Easy German） */
const NON_ENGLISH_TARGET_RE = /\b(spanish|espanol|español|french|français|francais|german|deutsch|japanese|nihongo|korean|italian|italiano|portuguese|português|mandarin|chinese|cantonese|arabic|russian|dutch|swedish|hindi|hebrew|polish|turkish|vietnamese|thai|indonesian|greek|norwegian|danish|finnish|czech|latin|esperanto|irish|welsh|ukrainian)\b/i;
const ENGLISH_MENTION_RE = /\b(english|esl|efl|ielts|toefl)\b/i;

export function isNonEnglishLanguageCourse(title: string, author = '', summary = ''): boolean {
  const head = `${title} ${author}`;
  if (ENGLISH_MENTION_RE.test(head)) return false;
  if (NON_ENGLISH_TARGET_RE.test(head)) return true;
  if (!ENGLISH_MENTION_RE.test(summary) && NON_ENGLISH_TARGET_RE.test(summary.slice(0, 240))) return true;
  return false;
}

interface AppleRssEntry {
  id?: { attributes?: { 'im:id'?: string } };
  'im:name'?: { label?: string };
  'im:artist'?: { label?: string };
  'im:image'?: { label?: string }[];
  summary?: { label?: string };
}

interface AppleLookupItem {
  collectionId?: number;
  trackId?: number;
  collectionName?: string;
  trackName?: string;
  artistName?: string;
  feedUrl?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
  trackCount?: number;
  collectionViewUrl?: string;
}

export async function fetchPodcastCharts(
  ctx: Ctx,
  opts: { genre: PodcastChartGenre; country?: PodcastChartCountry; limit?: number; force?: boolean },
): Promise<PodcastChartItem[]> {
  const country: PodcastChartCountry = opts.country ?? 'us';
  const limit = Math.min(30, Math.max(1, opts.limit ?? 20));
  const key = `${country}:${opts.genre}:${limit}`;
  const hit = cache.get(key);
  if (!opts.force && hit && now() - hit.at < CHARTS_TTL_MS) return hit.items;
  if (!ctx.platform.isOnline()) throw new TibiError('offline', '现在没有网络');

  const genreId = CHART_GENRE_IDS[opts.genre];
  // 语言学习榜过滤非英语节目后会减员，多拉一倍候选
  const fetchLimit = opts.genre === 'language' ? Math.min(50, Math.max(limit * 2, 30)) : Math.min(50, limit + 5);
  const rssUrl = `https://itunes.apple.com/${country}/rss/toppodcasts/limit=${fetchLimit}/genre=${genreId}/json`;
  const rssPage = await ctx.platform.fetchUrl(rssUrl, { timeout_ms: 12_000, headers: { accept: 'application/json' } })
    .catch(e => { throw e instanceof TibiError ? e : new TibiError('offline', netError(e)); });
  if (rssPage.status >= 400) throw new TibiError('invalid_source', `拉取播客榜单失败（${rssPage.status}）`);

  let rawEntries: AppleRssEntry[] = [];
  try {
    const parsed = JSON.parse(rssPage.body) as { feed?: { entry?: AppleRssEntry | AppleRssEntry[] } };
    const e = parsed.feed?.entry;
    rawEntries = Array.isArray(e) ? e : e ? [e] : [];
  } catch {
    return [];
  }

  const candidates: { id: string; title: string; author: string; summary: string; fallbackArt?: string }[] = [];
  const seenIds = new Set<string>();
  for (const e of rawEntries) {
    const id = e.id?.attributes?.['im:id']?.trim();
    const title = e['im:name']?.label?.trim() ?? '';
    const author = e['im:artist']?.label?.trim() ?? '';
    const summary = (e.summary?.label ?? '').replace(/\s+/g, ' ').trim();
    if (!id || !/^\d+$/.test(id) || !title || seenIds.has(id)) continue;
    if (opts.genre === 'language' && isNonEnglishLanguageCourse(title, author, summary)) continue;
    seenIds.add(id);
    const imgs = e['im:image'] ?? [];
    const fallbackArt = imgs[imgs.length - 1]?.label?.trim();
    candidates.push({ id, title, author, summary, fallbackArt });
  }
  if (!candidates.length) {
    cache.set(key, { at: now(), items: [] });
    return [];
  }

  // 单次批量 lookup 换取 feedUrl 与高清封面
  const lookupUrl = `https://itunes.apple.com/lookup?id=${candidates.map(c => c.id).join(',')}&entity=podcast`;
  const lookupPage = await ctx.platform.fetchUrl(lookupUrl, { timeout_ms: 12_000, headers: { accept: 'application/json' } })
    .catch(e => { throw e instanceof TibiError ? e : new TibiError('offline', netError(e)); });
  if (lookupPage.status >= 400) throw new TibiError('invalid_source', `解析榜单播客地址失败（${lookupPage.status}）`);

  const byId = new Map<string, AppleLookupItem>();
  try {
    const data = JSON.parse(lookupPage.body) as { results?: AppleLookupItem[] };
    for (const r of data.results ?? []) {
      const id = String(r.collectionId ?? r.trackId ?? '');
      if (id) byId.set(id, r);
    }
  } catch {
    return [];
  }

  const out: PodcastChartItem[] = [];
  const seenFeedUrls = new Set<string>();
  for (const c of candidates) {
    if (out.length >= limit) break;
    const detail = byId.get(c.id);
    const feedUrl = detail?.feedUrl?.trim();
    if (!feedUrl || !checkUrlShape(feedUrl).ok || seenFeedUrls.has(feedUrl)) continue;
    seenFeedUrls.add(feedUrl);
    const art = detail?.artworkUrl600 || detail?.artworkUrl100 || c.fallbackArt;
    out.push({
      rank: out.length + 1,
      apple_id: c.id,
      title: (detail?.collectionName || detail?.trackName || c.title).trim(),
      ...(detail?.artistName || c.author ? { author: (detail?.artistName || c.author).trim() } : {}),
      feed_url: feedUrl,
      ...(art ? { artwork_url: art } : {}),
      ...(detail?.primaryGenreName ? { genre: detail.primaryGenreName } : {}),
      ...(detail?.trackCount ? { episode_count: detail.trackCount } : {}),
      ...(detail?.collectionViewUrl ? { site_url: detail.collectionViewUrl } : {}),
      ...(c.summary ? { summary: c.summary.slice(0, 260) } : {}),
    });
  }

  cache.set(key, { at: now(), items: out });
  return out;
}
