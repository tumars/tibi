import { now, type Database } from '../../db/driver.js';

/** 订阅与条目的读写（11 §3） */

export type FeedRow = {
  id: string; url: string; site_url: string | null; title: string; title_custom: number; builtin: number; enabled: number; folder: string | null;
  etag: string | null; last_modified: string | null; ttl_minutes: number | null;
  last_fetched_at: number | null; last_ok_at: number | null; error: string | null; error_count: number; next_fetch_at: number | null;
  created_at: number; updated_at: number; deleted_at: number | null;
};
export type ItemState = 'new' | 'seen' | 'saved' | 'dismissed';

/** 界面上的一个订阅 */
export interface FeedView { id: string; url: string; site_url?: string; title: string; builtin: boolean; enabled: boolean; folder?: string; unread: number; last_ok_at?: number; error?: string; error_count: number }

/** 保留期：60 天、每源 300 条；保存过和导入过的不删 */
export const KEEP_DAYS = 60;
export const KEEP_PER_FEED = 300;

export async function listFeeds(db: Database): Promise<FeedView[]> {
  const rows = await db.all<FeedRow & { unread: number }>(
    `SELECT f.*, (SELECT count(*) FROM feed_items i WHERE i.feed_id = f.id AND i.state = 'new' AND i.deleted_at IS NULL) AS unread
     FROM feeds f WHERE f.deleted_at IS NULL ORDER BY COALESCE(f.folder, '') = '', f.folder, f.builtin DESC, f.title COLLATE NOCASE`);
  return rows.map(toView);
}

/** 抓取异常翻成用户看得懂的话（原样是 "This operation was aborted"、"fetch failed" 这类英文） */
export function netError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/abort|timed? ?out/i.test(m)) return '连接超时，稍后会自动再试';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNREFUSED|ECONNRESET|fetch failed|network|certificate|SSL|TLS/i.test(m)) return '连不上这个网站，稍后会自动再试';
  return m;
}

export function toView(r: FeedRow & { unread?: number }): FeedView {
  return {
    id: r.id, url: r.url, ...(r.site_url ? { site_url: r.site_url } : {}), title: r.title, builtin: !!r.builtin, enabled: !!r.enabled,
    ...(r.folder ? { folder: r.folder } : {}), unread: Number(r.unread ?? 0), ...(r.last_ok_at ? { last_ok_at: r.last_ok_at } : {}),
    ...(r.error ? { error: netError(r.error) } : {}), error_count: r.error_count,
  };
}

export const getFeed = (db: Database, id: string) => db.get<FeedRow>('SELECT * FROM feeds WHERE id = ? AND deleted_at IS NULL', [id]);
export const getFeedByUrl = (db: Database, url: string) => db.get<FeedRow>('SELECT * FROM feeds WHERE url = ? AND deleted_at IS NULL', [url]);

export async function unreadCount(db: Database): Promise<number> {
  const r = await db.get<{ n: number }>("SELECT count(*) AS n FROM feed_items i JOIN feeds f ON f.id = i.feed_id WHERE i.state = 'new' AND i.deleted_at IS NULL AND f.deleted_at IS NULL AND f.enabled = 1");
  return Number(r?.n ?? 0);
}

/** 导入成功后回填：链接对得上的条目指向这篇文档；放进书架的记成 saved，直接读的（不进书架）记成已读 */
export async function linkImported(db: Database, urls: (string | null | undefined)[], document_id: string): Promise<number> {
  const list = [...new Set(urls.filter((u): u is string => !!u))];
  if (!list.length) return 0;
  const doc = await db.get<{ shelved: number }>('SELECT shelved FROM documents WHERE id = ?', [document_id]);
  const shelved = Number(doc?.shelved ?? 1) === 1;
  const t = now();
  const state = shelved ? "'saved'" : "CASE WHEN state = 'new' THEN 'seen' ELSE state END";
  const r = await db.run(`UPDATE feed_items SET document_id = ?, state = ${state}, seen_at = COALESCE(seen_at, ?), updated_at = ? WHERE url IN (${list.map(() => '?').join(',')}) AND (document_id IS NULL OR document_id != ? OR state != 'saved') AND deleted_at IS NULL`, [document_id, t, t, ...list, document_id]);
  return r.changes;
}

/** 按保留期硬删旧条目（本机派生数据，P1 不同步） */
export async function prune(db: Database): Promise<number> {
  const keep = "state != 'saved' AND document_id IS NULL";
  const a = await db.run(`DELETE FROM feed_items WHERE ${keep} AND COALESCE(published_at, created_at) < ?`, [now() - KEEP_DAYS * 86_400_000]);
  const b = await db.run(`DELETE FROM feed_items WHERE id IN (
    SELECT id FROM (SELECT id, state, document_id, ROW_NUMBER() OVER (PARTITION BY feed_id ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC) AS rn FROM feed_items)
    WHERE rn > ? AND ${keep})`, [KEEP_PER_FEED]);
  return a.changes + b.changes;
}
