import { Type } from '@sinclair/typebox';
import { j, now } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import { capability, method, type CapabilityMap, type Ctx, type MethodMap } from '../../rpc/define.js';
import { TibiError } from '../../types.js';
import { WPM } from '../documents/repo.js';
import { recordUndo, registerUndo } from '../shared/undo.js';
import { discoverFeeds, isRefreshing, refreshFeeds } from './refresh.js';
import { getFeed, getFeedByUrl, listFeeds, toView, unreadCount, type FeedRow, type FeedView, type ItemState } from './repo.js';

/**
 * 订阅（11）：界面用的 feeds.* 方法和 agent 用的 search_feeds / list_feeds / manage_feed / discover_feeds。
 * 条目不进书架；"读"走普通的网址导入，导入成功后按链接回填（documents/pipeline.ts）。
 */

export interface FeedItemView {
  id: string; feed_id: string; feed_title: string; url: string; title: string; author?: string; published_at?: number;
  excerpt: string; est_level?: string; est_minutes: number; state: ItemState; document_id?: string; comments_url?: string;
}

type ItemRow = { id: string; feed_id: string; feed_title: string; url: string; title: string; author: string | null; published_at: number | null; excerpt: string; est_level: string | null; word_count: number | null; state: string; document_id: string | null; comments_url: string | null };
const ITEM_SELECT = `SELECT i.id, i.feed_id, f.title AS feed_title, i.url, i.title, i.author, i.published_at, i.excerpt, i.est_level, i.word_count, i.state, d.id AS document_id, i.comments_url
  FROM feed_items i JOIN feeds f ON f.id = i.feed_id AND f.deleted_at IS NULL LEFT JOIN documents d ON d.id = i.document_id AND d.deleted_at IS NULL`;

/** 源里的正文 ≥ 400 词才按它算；短的多半只是开头几段（如 Ars Technica），按 1200 词估 */
const minutesOf = (words: number | null) => Math.max(3, Math.round((words && words >= 400 ? words : 1200) / WPM));
function toItem(r: ItemRow): FeedItemView {
  return {
    id: r.id, feed_id: r.feed_id, feed_title: r.feed_title, url: r.url, title: r.title, ...(r.author ? { author: r.author } : {}), ...(r.published_at ? { published_at: r.published_at } : {}),
    excerpt: r.excerpt, ...(r.est_level ? { est_level: r.est_level } : {}), est_minutes: minutesOf(r.word_count), state: r.state as ItemState,
    ...(r.document_id ? { document_id: r.document_id } : {}), ...(r.comments_url ? { comments_url: r.comments_url } : {}),
  };
}

async function listItems(ctx: Ctx, p: { feed_id?: string; folder?: string; filter?: 'unread' | 'all' | 'saved'; cursor?: string; limit?: number }) {
  const where = ['i.deleted_at IS NULL'];
  const args: (string | number)[] = [];
  if (p.feed_id) { where.push('i.feed_id = ?'); args.push(p.feed_id); }
  else where.push('f.enabled = 1');
  if (p.folder) { where.push('f.folder = ?'); args.push(p.folder); }
  const filter = p.filter ?? 'unread';
  where.push(filter === 'unread' ? "i.state = 'new'" : filter === 'saved' ? "(i.state = 'saved' OR d.id IS NOT NULL)" : "i.state != 'dismissed'");
  const limit = p.limit ?? 30; const offset = Number(p.cursor ?? 0) || 0;
  const rows = await ctx.db.all<ItemRow>(`${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY COALESCE(i.published_at, i.created_at) DESC, i.id DESC LIMIT ? OFFSET ?`, [...args, limit + 1, offset]);
  return { items: rows.slice(0, limit).map(toItem), ...(rows.length > limit ? { next_cursor: String(offset + limit) } : {}) };
}

async function addFeed(ctx: Ctx, p: { url: string; title?: string; folder?: string }): Promise<FeedView> {
  const found = await discoverFeeds(ctx, p.url);
  const pick = found.find(c => c.url === p.url) ?? (found.length === 1 ? found[0] : undefined);
  if (!pick) throw new TibiError('conflict', `这个网站有 ${found.length} 个订阅，先选一个`, { candidates: found });
  const t = now();
  let row = await getFeedByUrl(ctx.db, pick.url);
  if (row) {
    if (!row.enabled) await ctx.db.run('UPDATE feeds SET enabled = 1, next_fetch_at = NULL, updated_at = ? WHERE id = ?', [t, row.id]);
  } else {
    const id = uuidv7();
    await ctx.db.run('INSERT INTO feeds(id, url, site_url, title, title_custom, folder, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, pick.url, pick.site_url ?? null, p.title?.trim() || pick.title, p.title?.trim() ? 1 : 0, p.folder?.trim() || null, t, t]);
    row = (await getFeed(ctx.db, id))!;
  }
  ctx.events.emit('data.changed', { table: 'feeds', ids: [row.id] });
  await refreshFeeds(ctx, { feed_ids: [row.id], force: true }).catch(() => undefined);
  return (await listFeeds(ctx.db)).find(f => f.id === row!.id) ?? toView(row);
}

async function removeFeed(ctx: Ctx, id: string) {
  const f = await getFeed(ctx.db, id);
  if (!f) throw new TibiError('not_found', '没有这个订阅');
  const t = now();
  await ctx.db.run('UPDATE feeds SET deleted_at = ?, updated_at = ? WHERE id = ?', [t, t, id]);
  // 没保存、没导入的条目一起删（本机派生数据）；撤销后重新抓
  await ctx.db.run("DELETE FROM feed_items WHERE feed_id = ? AND state != 'saved' AND document_id IS NULL", [id]);
  const undo = await recordUndo(ctx.db, ctx, { tool: 'feeds.remove', args: { id }, undo_payload: { id } });
  ctx.events.emit('data.changed', { table: 'feeds', ids: [id] });
  ctx.events.emit('data.changed', { table: 'feed_items' });
  return { ok: true as const, undo };
}
registerUndo<{ id: string }>('feeds.remove', async (p, ctx) => {
  await ctx.db.run('UPDATE feeds SET deleted_at = NULL, next_fetch_at = NULL, updated_at = ? WHERE id = ?', [now(), p.id]);
  ctx.events.emit('data.changed', { table: 'feeds', ids: [p.id] });
  void refreshFeeds({ ...ctx, db: ctx.db }, { feed_ids: [p.id], force: true }).catch(() => undefined);
});

async function markItems(ctx: Ctx, p: { ids?: string[]; feed_id?: string; all?: boolean; state: 'seen' | 'dismissed' | 'new' }) {
  const t = now();
  let ids = p.ids ?? [];
  if (!ids.length && (p.feed_id || p.all)) {
    if (p.state !== 'seen') throw new TibiError('invalid_params', '整源只能标为已读');
    ids = (await ctx.db.all<{ id: string }>(`SELECT i.id FROM feed_items i JOIN feeds f ON f.id = i.feed_id WHERE i.state = 'new' AND i.deleted_at IS NULL AND f.deleted_at IS NULL ${p.feed_id ? 'AND i.feed_id = ?' : ''}`, p.feed_id ? [p.feed_id] : [])).map(r => r.id);
  }
  if (!ids.length) return { count: 0 };
  const ph = ids.map(() => '?').join(',');
  const before = await ctx.db.all<{ id: string; state: string }>(`SELECT id, state FROM feed_items WHERE id IN (${ph})`, ids);
  // 已读不会把保存过的改回去；不感兴趣可以撤销
  const cond = p.state === 'seen' ? "AND state = 'new'" : p.state === 'dismissed' ? "AND state != 'saved'" : '';
  const r = await ctx.db.run(`UPDATE feed_items SET state = ?, seen_at = COALESCE(seen_at, ?), updated_at = ? WHERE id IN (${ph}) ${cond}`, [p.state, t, t, ...ids]);
  ctx.events.emit('data.changed', { table: 'feed_items', ids });
  if (p.state !== 'dismissed') return { count: r.changes };
  const undo = await recordUndo(ctx.db, ctx, { tool: 'feeds.mark', args: { ids, state: p.state }, undo_payload: { states: before.filter(b => b.state !== 'saved') } });
  return { count: r.changes, undo };
}
registerUndo<{ states: { id: string; state: string }[] }>('feeds.mark', async (p, ctx) => {
  for (const s of p.states) await ctx.db.run('UPDATE feed_items SET state = ?, updated_at = ? WHERE id = ?', [s.state, now(), s.id]);
  ctx.events.emit('data.changed', { table: 'feed_items', ids: p.states.map(s => s.id) });
});

const AUTO_KEY = 'feeds.auto_refresh';
async function autoRefreshOn(ctx: Ctx) {
  const r = await ctx.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [AUTO_KEY]);
  return j.parse<boolean>(r?.value, true) !== false;
}

/** 数据旧于 2 小时就先刷一下（最多等 8 秒）；没网或超时用库里的 */
const STALE_MS = 2 * 3600_000;
async function freshen(ctx: Ctx): Promise<boolean> {
  const stale = await ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM feeds WHERE deleted_at IS NULL AND enabled = 1 AND (last_ok_at IS NULL OR last_ok_at < ?)', [now() - STALE_MS]);
  if (!Number(stale?.n ?? 0)) return false;
  if (!ctx.platform.isOnline()) return true;
  let timer: ReturnType<typeof setTimeout> | number | undefined;
  const done = await Promise.race([refreshFeeds(ctx).then(() => true, () => true), new Promise<false>(res => { timer = setTimeout(() => res(false), 8_000); })]).finally(() => clearTimeout(timer));
  return !done;
}

/** search_feeds：查订阅库。排序：兴趣词命中 + 新近程度（P2 换成 fitScore） */
export async function searchFeeds(ctx: Ctx, p: { interests?: string[]; since?: number; limit?: number; q?: string; feed_ids?: string[]; unread_only?: boolean }) {
  const stale = await freshen(ctx);
  const since = p.since ?? now() - 30 * 86_400_000;
  const where = ["i.deleted_at IS NULL", "f.enabled = 1", "i.state != 'dismissed'", 'd.id IS NULL', 'COALESCE(i.published_at, i.created_at) >= ?'];
  const args: (string | number)[] = [since];
  if (p.unread_only) where.push("i.state = 'new'");
  if (p.feed_ids?.length) { where.push(`i.feed_id IN (${p.feed_ids.map(() => '?').join(',')})`); args.push(...p.feed_ids); }
  if (p.q?.trim()) { where.push("(i.title LIKE ? OR i.excerpt LIKE ?)"); const q = `%${p.q.trim()}%`; args.push(q, q); }
  const rows = await ctx.db.all<ItemRow>(`${ITEM_SELECT} WHERE ${where.join(' AND ')} AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.source_type = 'url' AND x.source_uri = i.url AND x.deleted_at IS NULL) ORDER BY COALESCE(i.published_at, i.created_at) DESC LIMIT 300`, args);
  const words = (p.interests ?? []).map(w => w.toLowerCase()).filter(Boolean);
  const t = now();
  const rank = (i: ItemRow) => (words.some(w => (i.title + ' ' + i.excerpt).toLowerCase().includes(w)) ? 2 : 0) + (i.published_at ? Math.max(0, 1 - (t - i.published_at) / (14 * 86_400_000)) : 0);
  const items = rows.sort((a, b) => rank(b) - rank(a)).slice(0, p.limit ?? 20).map(r => {
    const v = toItem(r);
    return { item_id: v.id, url: v.url, title: v.title, site: v.feed_title, ...(v.published_at ? { published_at: v.published_at } : {}), excerpt: v.excerpt, est_minutes: v.est_minutes, ...(v.est_level ? { est_level: v.est_level } : {}) };
  });
  return { items, ...(stale ? { stale: true } : {}) };
}

const S_UPDATE = Type.Object({ id: Type.String({ minLength: 1 }), title: Type.Optional(Type.String({ maxLength: 200 })), folder: Type.Optional(Type.String({ maxLength: 40 })), enabled: Type.Optional(Type.Boolean()) });

async function updateFeed(ctx: Ctx, p: { id: string; title?: string; folder?: string; enabled?: boolean }) {
  const f = await getFeed(ctx.db, p.id);
  if (!f) throw new TibiError('not_found', '没有这个订阅');
  const t = now();
  if (p.title !== undefined) await ctx.db.run('UPDATE feeds SET title = ?, title_custom = 1, updated_at = ? WHERE id = ?', [p.title.trim() || f.title, t, f.id]);
  if (p.folder !== undefined) await ctx.db.run('UPDATE feeds SET folder = ?, updated_at = ? WHERE id = ?', [p.folder.trim() || null, t, f.id]);
  if (p.enabled !== undefined) await ctx.db.run('UPDATE feeds SET enabled = ?, next_fetch_at = CASE WHEN ? = 1 THEN NULL ELSE next_fetch_at END, updated_at = ? WHERE id = ?', [p.enabled ? 1 : 0, p.enabled ? 1 : 0, t, f.id]);
  ctx.events.emit('data.changed', { table: 'feeds', ids: [f.id] });
  if (p.enabled && !f.enabled) void refreshFeeds(ctx, { feed_ids: [f.id] }).catch(() => undefined);
  return (await listFeeds(ctx.db)).find(x => x.id === f.id)!;
}

export const feedsMethods: MethodMap = {
  'feeds.list': method(Type.Object({}), async (_p, ctx) => listFeeds(ctx.db), '订阅列表：带未读数、出错原因'),
  'feeds.discover': method(Type.Object({ url: Type.String({ minLength: 1 }) }), async (p, ctx) => discoverFeeds(ctx, p.url), '给网站或订阅地址，找出可以订阅的源'),
  'feeds.add': method(Type.Object({ url: Type.String({ minLength: 1 }), title: Type.Optional(Type.String({ maxLength: 200 })), folder: Type.Optional(Type.String({ maxLength: 40 })) }), async (p, ctx) => addFeed(ctx, p), '加订阅：先确认是订阅源，加完马上抓一次'),
  'feeds.update': method(S_UPDATE, async (p, ctx) => updateFeed(ctx, p), '改名、改分组、开关'),
  'feeds.remove': method(Type.Object({ id: Type.String({ minLength: 1 }) }), async (p, ctx) => removeFeed(ctx, p.id), '删订阅（可撤销）'),
  'feeds.refresh': method(Type.Object({ feed_ids: Type.Optional(Type.Array(Type.String())), force: Type.Optional(Type.Boolean()) }), async (p, ctx) => refreshFeeds(ctx, p), '抓到点的源；force：不管到没到点'),
  'feeds.auto': method(Type.Object({}), async (_p, ctx) => (await autoRefreshOn(ctx) ? refreshFeeds(ctx) : { feeds: 0, not_modified: 0, new_items: 0, failed: 0 }), '定时调用：自动刷新开着才抓'),
  'feeds.status': method(Type.Object({}), async (_p, ctx) => ({ unread: await unreadCount(ctx.db), refreshing: isRefreshing(), auto_refresh: await autoRefreshOn(ctx) }), '未读数（侧栏角标）、是否正在刷新、自动刷新开关'),
  'feeds.configure': method(Type.Object({ auto_refresh: Type.Boolean() }), async (p, ctx) => {
    await ctx.db.run('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [AUTO_KEY, j.str(p.auto_refresh), now()]);
    return { auto_refresh: p.auto_refresh };
  }, '自动刷新订阅（本机设置）'),
  'feeds.items': method(Type.Object({ feed_id: Type.Optional(Type.String()), folder: Type.Optional(Type.String()), filter: Type.Optional(Type.Union([Type.Literal('unread'), Type.Literal('all'), Type.Literal('saved')])), cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }), async (p, ctx) => listItems(ctx, p), '条目列表，按发布时间倒序'),
  'feeds.mark': method(Type.Object({ ids: Type.Optional(Type.Array(Type.String())), feed_id: Type.Optional(Type.String()), all: Type.Optional(Type.Boolean()), state: Type.Union([Type.Literal('seen'), Type.Literal('dismissed'), Type.Literal('new')]) }), async (p, ctx) => markItems(ctx, p), '标已读 / 不感兴趣（可撤销）/ 改回未读'),
};

export const feedsCapabilities: CapabilityMap = {
  search_feeds: capability({
    name: 'search_feeds', description: '从订阅里找候选文章（标题、链接、摘要、按词频粗估的文本级别）；书架里已有的和用户丢弃的不返回；stale 表示这次没能刷新，用的是库里的', perm: 'read',
    params: Type.Object({
      interests: Type.Optional(Type.Array(Type.String())), since: Type.Optional(Type.Number()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      q: Type.Optional(Type.String({ maxLength: 128 })), feed_ids: Type.Optional(Type.Array(Type.String())), unread_only: Type.Optional(Type.Boolean()),
    }),
    async run(p, ctx) { return searchFeeds(ctx, p); },
  }),
  list_feeds: capability({
    name: 'list_feeds', description: '看订阅：每个源的名字、地址、开关、未读数、出错原因', perm: 'read', mcp: false, params: Type.Object({}),
    async run(_p, ctx) { return (await listFeeds(ctx.db)).map(f => ({ id: f.id, title: f.title, url: f.url, enabled: f.enabled, unread: f.unread, ...(f.folder ? { folder: f.folder } : {}), ...(f.error ? { error: f.error } : {}) })); },
  }),
  discover_feeds: capability({
    name: 'discover_feeds', description: '给网站地址，找出它可以订阅的 RSS / Atom 源（不订阅）', perm: 'read', mcp: false,
    params: Type.Object({ url: Type.String({ minLength: 1 }) }),
    async run(p, ctx) { return discoverFeeds(ctx, p.url); },
  }),
  manage_feed: capability({
    name: 'manage_feed', description: '管理订阅：add 给网站或订阅地址（网站有多个订阅时返回候选、不加，用 ask_user 问用户选哪个）；remove / toggle 用 list_feeds 里的 id', perm: 'confirm', mcp: false,
    params: Type.Object({ add: Type.Optional(Type.Object({ url: Type.String(), title: Type.Optional(Type.String()), folder: Type.Optional(Type.String()) })), remove: Type.Optional(Type.String()), toggle: Type.Optional(Type.Object({ id: Type.String(), enabled: Type.Boolean() })) }),
    async describe(p, ctx) {
      const name = async (id: string) => (await getFeed(ctx.db, id))?.title ?? id;
      return p.add ? `订阅 ${p.add.url}` : p.remove ? `删订阅 ${await name(p.remove)}` : p.toggle ? `${p.toggle.enabled ? '打开' : '关掉'}订阅 ${await name(p.toggle.id)}` : '没有改动';
    },
    async run(p, ctx) {
      if (p.add) {
        try { const f = await addFeed(ctx, p.add); return { status: 'subscribed' as const, feed: { id: f.id, title: f.title, url: f.url, unread: f.unread } }; }
        catch (e) { if (e instanceof TibiError && e.code === 'conflict' && (e.data as { candidates?: unknown })?.candidates) return { status: 'choose' as const, candidates: (e.data as { candidates: unknown }).candidates }; throw e; }
      }
      const byIdOrUrl = async (x: string) => (await getFeed(ctx.db, x)) ?? (await getFeedByUrl(ctx.db, x));
      if (p.remove) { const f = await byIdOrUrl(p.remove); if (!f) throw new TibiError('not_found', '没有这个订阅'); return { status: 'removed' as const, ...(await removeFeed(ctx, f.id)) }; }
      if (p.toggle) { const f: FeedRow | undefined = await byIdOrUrl(p.toggle.id); if (!f) throw new TibiError('not_found', '没有这个订阅'); await updateFeed(ctx, { id: f.id, enabled: p.toggle.enabled }); return { status: 'updated' as const }; }
      return { status: 'noop' as const };
    },
  }),
};
