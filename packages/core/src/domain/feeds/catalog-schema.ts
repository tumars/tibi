/**
 * 电台静态精选目录的类型与严格校验（无相对依赖，可供 Node 发布/探活脚本与 Core 共用）。
 */

export type RadioSceneId = 'intensive' | 'spoken' | 'tech' | 'news_biz' | 'science_story';
export type RadioLevel = 'A2' | 'B1' | 'B2' | 'C1';
export type RadioAccent = 'US' | 'UK' | 'AU' | 'intl';

export interface CatalogPodcast {
  id: string;
  title: string;
  author: string;
  feed_url: string;
  artwork_url: string;
  scene: RadioSceneId;
  level: RadioLevel;
  accent: RadioAccent;
  avg_minutes: number;
  has_transcript: boolean;
  summary_zh: string;
  summary_en: string;
}

export interface RadioCatalog {
  version: 1;
  updated_at: string;
  podcasts: CatalogPodcast[];
}

const SCENES = new Set<string>(['intensive', 'spoken', 'tech', 'news_biz', 'science_story']);
const LEVELS = new Set<string>(['A2', 'B1', 'B2', 'C1']);
const ACCENTS = new Set<string>(['US', 'UK', 'AU', 'intl']);

function isPublicHttpsUrl(raw: string): boolean {
  if (!/^https:\/\//i.test(raw) || raw.length > 1000) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h || h === 'localhost' || /\.(localhost|local|internal|lan|home\.arpa)$/.test(h)) return false;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]); const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (h.includes(':') && !/^[23][0-9a-f]{0,3}:/.test(h)) return false;
  return true;
}

function reqStr(v: unknown, max: number, name: string): string {
  if (typeof v !== 'string') throw new Error(`${name} 须为字符串`);
  const s = v.trim();
  if (!s || s.length > max) throw new Error(`${name} 长度不合法`);
  return s;
}

/** 严格校验目录结构；任何字段异常整份拒收，避免线上坏文件污染界面 */
export function parseRadioCatalog(raw: unknown): RadioCatalog {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('目录格式须为对象');
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) throw new Error('不支持的目录版本');
  const updated_at = reqStr(obj.updated_at, 32, 'updated_at');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updated_at)) throw new Error('updated_at 须为 YYYY-MM-DD');
  if (!Array.isArray(obj.podcasts) || obj.podcasts.length === 0 || obj.podcasts.length > 200) {
    throw new Error('podcasts 须为 1–200 条数组');
  }
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const podcasts: CatalogPodcast[] = [];
  for (let i = 0; i < obj.podcasts.length; i++) {
    const it = obj.podcasts[i];
    if (!it || typeof it !== 'object' || Array.isArray(it)) throw new Error(`podcasts[${i}] 须为对象`);
    const r = it as Record<string, unknown>;
    const id = reqStr(r.id, 64, `podcasts[${i}].id`);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error(`podcasts[${i}].id 非法`);
    if (seenIds.has(id)) throw new Error(`重复的 id：${id}`);
    seenIds.add(id);

    const feed_url = reqStr(r.feed_url, 1000, `podcasts[${i}].feed_url`);
    if (!isPublicHttpsUrl(feed_url)) throw new Error(`podcasts[${i}].feed_url 须为公开 https 网址`);
    if (seenUrls.has(feed_url)) throw new Error(`重复的 feed_url：${feed_url}`);
    seenUrls.add(feed_url);

    const artwork_url = reqStr(r.artwork_url, 1000, `podcasts[${i}].artwork_url`);
    if (!isPublicHttpsUrl(artwork_url)) throw new Error(`podcasts[${i}].artwork_url 须为公开 https 网址`);

    const scene = reqStr(r.scene, 32, `podcasts[${i}].scene`);
    if (!SCENES.has(scene)) throw new Error(`podcasts[${i}].scene 非法`);
    const level = reqStr(r.level, 8, `podcasts[${i}].level`);
    if (!LEVELS.has(level)) throw new Error(`podcasts[${i}].level 非法`);
    const accent = reqStr(r.accent, 8, `podcasts[${i}].accent`);
    if (!ACCENTS.has(accent)) throw new Error(`podcasts[${i}].accent 非法`);

    const avg = Number(r.avg_minutes);
    if (!Number.isFinite(avg) || avg < 1 || avg > 600) throw new Error(`podcasts[${i}].avg_minutes 非法`);
    if (typeof r.has_transcript !== 'boolean') throw new Error(`podcasts[${i}].has_transcript 须为布尔值`);

    podcasts.push({
      id,
      title: reqStr(r.title, 160, `podcasts[${i}].title`),
      author: reqStr(r.author, 160, `podcasts[${i}].author`),
      feed_url,
      artwork_url,
      scene: scene as RadioSceneId,
      level: level as RadioLevel,
      accent: accent as RadioAccent,
      avg_minutes: Math.round(avg),
      has_transcript: r.has_transcript,
      summary_zh: reqStr(r.summary_zh, 200, `podcasts[${i}].summary_zh`),
      summary_en: reqStr(r.summary_en, 240, `podcasts[${i}].summary_en`),
    });
  }
  return { version: 1, updated_at, podcasts };
}
