import { j, now } from '../../db/driver.js';
import type { Ctx } from '../../rpc/define.js';
import DEFAULT_CATALOG_RAW from './catalog.default.json' with { type: 'json' };
import {
  parseRadioCatalog,
  type CatalogPodcast,
  type RadioAccent,
  type RadioCatalog,
  type RadioLevel,
  type RadioSceneId,
} from './catalog-schema.js';

export { parseRadioCatalog, type CatalogPodcast, type RadioAccent, type RadioCatalog, type RadioLevel, type RadioSceneId };

/**
 * 电台静态精选目录（19 §2.1）：随包内嵌离线快照，主动进「发现电台」时按需拉取
 * https://dl.ferecord.com/radio-catalog.json（24h 缓存至本机 settings，不同步；失败静默回退）。
 */

export const RADIO_CATALOG_URL = 'https://dl.ferecord.com/radio-catalog.json';
const CACHE_KEY = 'radio.catalog.cache';
const CACHE_TTL_MS = 24 * 3600_000;

export interface RadioCatalogResult extends RadioCatalog {
  source: 'remote' | 'cache' | 'bundled';
}

const BUNDLED: RadioCatalog = parseRadioCatalog(DEFAULT_CATALOG_RAW);

export function getBundledCatalog(): RadioCatalog {
  return BUNDLED;
}

interface CatalogCache {
  fetched_at: number;
  etag?: string;
  catalog: RadioCatalog;
}

async function readCache(ctx: Ctx): Promise<CatalogCache | undefined> {
  const row = await ctx.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [CACHE_KEY]);
  if (!row) return undefined;
  const parsed = j.parse<Partial<CatalogCache> | null>(row.value, null);
  if (!parsed || typeof parsed.fetched_at !== 'number' || !parsed.catalog) return undefined;
  try {
    return {
      fetched_at: parsed.fetched_at,
      ...(typeof parsed.etag === 'string' && parsed.etag ? { etag: parsed.etag } : {}),
      catalog: parseRadioCatalog(parsed.catalog),
    };
  } catch {
    return undefined;
  }
}

async function writeCache(ctx: Ctx, entry: CatalogCache): Promise<void> {
  const t = now();
  await ctx.db.run(
    'INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [CACHE_KEY, j.str(entry), t],
  );
}

/** 按需加载精选目录：优先 24h 本机缓存，过期拉取 dl.ferecord.com，失败静默回退缓存或内置快照 */
export async function loadRadioCatalog(ctx: Ctx, opts?: { force?: boolean }): Promise<RadioCatalogResult> {
  const cached = await readCache(ctx);
  const t = now();
  if (!opts?.force && cached && t - cached.fetched_at < CACHE_TTL_MS) {
    return { source: 'cache', ...cached.catalog };
  }
  if (!ctx.platform.isOnline()) {
    return cached ? { source: 'cache', ...cached.catalog } : { source: 'bundled', ...BUNDLED };
  }
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    const page = await ctx.platform.fetchUrl(RADIO_CATALOG_URL, { timeout_ms: 8_000, headers });
    if (page.status === 304 && cached) {
      await writeCache(ctx, { ...cached, fetched_at: t });
      return { source: 'cache', ...cached.catalog };
    }
    if (page.status >= 200 && page.status < 300) {
      const catalog = parseRadioCatalog(JSON.parse(page.body));
      const etag = page.headers?.etag;
      await writeCache(ctx, { fetched_at: t, ...(etag ? { etag } : {}), catalog });
      return { source: 'remote', ...catalog };
    }
  } catch {
    /* 远端不可用或格式异常时静默回退，不打断用户浏览 */
  }
  return cached ? { source: 'cache', ...cached.catalog } : { source: 'bundled', ...BUNDLED };
}

export interface CatalogFilter {
  scene?: RadioSceneId;
  level?: RadioLevel;
  accent?: RadioAccent;
  max_minutes?: number;
  has_transcript?: boolean;
  q?: string;
  limit?: number;
}

/** 给 scout 技能与筛选查询复用的纯过滤逻辑 */
export function filterRadioCatalog(catalog: RadioCatalog, f: CatalogFilter = {}): CatalogPodcast[] {
  const q = f.q?.trim().toLowerCase();
  const out = catalog.podcasts.filter(p => {
    if (f.scene && p.scene !== f.scene) return false;
    if (f.level && p.level !== f.level) return false;
    if (f.accent && p.accent !== f.accent) return false;
    if (f.max_minutes && p.avg_minutes > f.max_minutes) return false;
    if (f.has_transcript && !p.has_transcript) return false;
    if (q && !`${p.title} ${p.author} ${p.summary_zh} ${p.summary_en}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return f.limit ? out.slice(0, f.limit) : out;
}
