import { Type } from '@sinclair/typebox';
import { j, now } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import { capability, method, type CapabilityMap, type Ctx, type MethodMap } from '../../rpc/define.js';
import { TibiError, type FeedKind } from '../../types.js';
import { WPM } from '../documents/repo.js';
import { recordUndo, registerUndo } from '../shared/undo.js';
import { discoverFeeds, isRefreshing, refreshFeeds, searchPodcasts } from './refresh.js';
import { getFeed, getFeedByUrl, listFeeds, toView, unreadCount, type FeedRow, type FeedView, type ItemState } from './repo.js';

/**
 * 订阅（11）与电台（17）：界面用的 feeds.* / podcasts.* 方法和 agent 用的能力。
 * 条目不进书架；文章点"读"走网址导入，电台点"听读"走 podcast_item 导入，成功后回填 document_id。
 */

export interface FeedItemView {
  id: string; feed_id: string; feed_title: string; feed_kind: FeedKind; feed_artwork_url?: string;
  url: string; title: string; author?: string; published_at?: number;
  excerpt: string; est_level?: string; /** 不知道正文多长时没有（不再按固定词数瞎估） */ est_minutes?: number; state: ItemState;
  /** 读过（导入过）就有；in_library 表示在书架里，否则是直接读的、不在书架里 */ document_id?: string; in_library?: boolean; comments_url?: string;
  /** 电台单集专属字段 */
  audio_url?: string; audio_mime?: string; audio_bytes?: number; duration_ms?: number;
  has_transcript?: boolean; transcript_url?: string; chapters_url?: string; artwork_url?: string;
  season?: number; episode?: number;
}

type ItemRow = {
  id: string; feed_id: string; feed_title: string; feed_kind: string; feed_artwork_url: string | null;
  url: string; title: string; author: string | null; published_at: number | null; excerpt: string;
  est_level: string | null; word_count: number | null; doc_words: number | null; state: string;
  document_id: string | null; shelved: number | null; comments_url: string | null;
  audio_url: string | null; audio_mime: string | null; audio_bytes: number | null; duration_ms: number | null;
  transcript_url: string | null; chapters_url: string | null; artwork_url: string | null;
  season: number | null; episode: number | null;
};

const ITEM_SELECT = `SELECT i.id, i.feed_id, f.title AS feed_title, f.kind AS feed_kind, f.artwork_url AS feed_artwork_url,
  i.url, i.title, i.author, i.published_at, i.excerpt, i.est_level, i.word_count, d.word_count AS doc_words,
  i.state, d.id AS document_id, d.shelved, i.comments_url,
  i.audio_url, i.audio_mime, i.audio_bytes, i.duration_ms, i.transcript_url, i.chapters_url, i.artwork_url, i.season, i.episode
  FROM feed_items i JOIN feeds f ON f.id = i.feed_id AND f.deleted_at IS NULL LEFT JOIN documents d ON d.id = i.document_id AND d.deleted_at IS NULL`;

/** 读过的按导入后的正文算；源里的正文 ≥ 400 词才按它算，短的多半只是开头几段（如 Ars Technica），就不估了 */
const minutesOf = (r: ItemRow) => {
  if (r.duration_ms && r.duration_ms > 0) return Math.max(1, Math.round(r.duration_ms / 60_000));
  const w = Number(r.doc_words) || (r.word_count && r.word_count >= 400 ? r.word_count : 0);
  return w ? Math.max(1, Math.round(w / WPM)) : undefined;
};

function toItem(r: ItemRow): FeedItemView {
  const minutes = minutesOf(r);
  return {
    id: r.id, feed_id: r.feed_id, feed_title: r.feed_title, feed_kind: (r.feed_kind || 'article') as FeedKind,
    ...(r.feed_artwork_url ? { feed_artwork_url: r.feed_artwork_url } : {}),
    url: r.url, title: r.title, ...(r.author ? { author: r.author } : {}), ...(r.published_at ? { published_at: r.published_at } : {}),
    excerpt: r.excerpt, ...(r.est_level ? { est_level: r.est_level } : {}), ...(minutes ? { est_minutes: minutes } : {}), state: r.state as ItemState,
    ...(r.document_id ? { document_id: r.document_id, in_library: Number(r.shelved) === 1 } : {}),
    ...(r.comments_url ? { comments_url: r.comments_url } : {}),
    ...(r.audio_url ? { audio_url: r.audio_url } : {}),
    ...(r.audio_mime ? { audio_mime: r.audio_mime } : {}),
    ...(r.audio_bytes ? { audio_bytes: Number(r.audio_bytes) } : {}),
    ...(r.duration_ms ? { duration_ms: Number(r.duration_ms) } : {}),
    ...(r.transcript_url ? { has_transcript: true, transcript_url: r.transcript_url } : {}),
    ...(r.chapters_url ? { chapters_url: r.chapters_url } : {}),
    ...(r.artwork_url ? { artwork_url: r.artwork_url } : {}),
    ...(r.season != null ? { season: Number(r.season) } : {}),
    ...(r.episode != null ? { episode: Number(r.episode) } : {}),
  };
}

/** as_of：翻页时按第一页那一刻的样子算——之后才进来的条目不算，之后才看过的仍算未读，免得往后翻时错位 */
async function listItems(ctx: Ctx, p: { kind?: FeedKind; feed_id?: string; folder?: string; filter?: 'unread' | 'all' | 'saved' | 'transcript'; cursor?: string; limit?: number; as_of?: number }) {
  const where = ['i.deleted_at IS NULL'];
  const args: (string | number)[] = [];
  if (p.feed_id) { where.push('i.feed_id = ?'); args.push(p.feed_id); }
  else {
    where.push('f.enabled = 1');
    if (p.kind) { where.push('f.kind = ?'); args.push(p.kind); }
  }
  if (p.folder) { where.push('f.folder = ?'); args.push(p.folder); }
  const filter = p.filter ?? 'unread';
  if (p.as_of) { where.push('i.created_at <= ?'); args.push(p.as_of); }
  if (filter === 'unread' && p.as_of) { where.push("(i.state = 'new' OR (i.state != 'dismissed' AND i.seen_at >= ?))"); args.push(p.as_of); }
  else if (filter === 'transcript') where.push("i.transcript_url IS NOT NULL AND i.state != 'dismissed'");
  else where.push(filter === 'unread' ? "i.state = 'new'" : filter === 'saved' ? 'd.shelved = 1' : "i.state != 'dismissed'");
  const limit = p.limit ?? 30; const offset = Number(p.cursor ?? 0) || 0;
  const rows = await ctx.db.all<ItemRow>(`${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY COALESCE(i.published_at, i.created_at) DESC, i.id DESC LIMIT ? OFFSET ?`, [...args, limit + 1, offset]);
  // 总数给翻页用
  const count = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM (${ITEM_SELECT} WHERE ${where.join(' AND ')})`, args);
  return { items: rows.slice(0, limit).map(toItem), total: Number(count?.n ?? 0), ...(rows.length > limit ? { next_cursor: String(offset + limit) } : {}) };
}

async function addFeed(ctx: Ctx, p: { url: string; title?: string; folder?: string; kind?: FeedKind }): Promise<FeedView> {
  const found = await discoverFeeds(ctx, p.url);
  const pick = found.find(c => c.url === p.url) ?? (found.length === 1 ? found[0] : undefined);
  if (!pick) throw new TibiError('conflict', `这个网站有 ${found.length} 个订阅，先选一个`, { candidates: found });
  const t = now();
  const kind: FeedKind = p.kind ?? pick.kind ?? 'article';
  let row = await getFeedByUrl(ctx.db, pick.url);
  if (row) {
    if (!row.enabled || (p.kind && row.kind !== p.kind)) {
      await ctx.db.run('UPDATE feeds SET enabled = 1, kind = ?, next_fetch_at = NULL, updated_at = ? WHERE id = ?', [kind, t, row.id]);
    }
  } else {
    const id = uuidv7();
    await ctx.db.run(
      'INSERT INTO feeds(id, url, site_url, title, title_custom, folder, kind, artwork_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, pick.url, pick.site_url ?? null, p.title?.trim() || pick.title, p.title?.trim() ? 1 : 0, p.folder?.trim() || null, kind, pick.artwork_url ?? null, t, t],
    );
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
  try {
    await ctx.db.run('UPDATE feeds SET deleted_at = NULL, next_fetch_at = NULL, updated_at = ? WHERE id = ?', [now(), p.id]);
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) throw new TibiError('conflict', '已经重新订阅了这个源，无法撤销删除');
    throw e;
  }
  ctx.events.emit('data.changed', { table: 'feeds', ids: [p.id] });
  const rootCtx: Ctx = { ...ctx, db: ctx.db.root };
  queueMicrotask(() => { void refreshFeeds(rootCtx, { feed_ids: [p.id], force: true }).catch(() => undefined); });
});

async function markItems(ctx: Ctx, p: { ids?: string[]; feed_id?: string; kind?: FeedKind; all?: boolean; state: 'seen' | 'dismissed' | 'new' }) {
  const t = now();
  let ids = p.ids ?? [];
  if (!ids.length && (p.feed_id || p.all)) {
    if (p.state !== 'seen') throw new TibiError('invalid_params', '整源只能标为已读');
    const conds = ["i.state = 'new'", 'i.deleted_at IS NULL', 'f.deleted_at IS NULL'];
    const args: string[] = [];
    if (p.feed_id) { conds.push('i.feed_id = ?'); args.push(p.feed_id); }
    else if (p.kind) { conds.push('f.kind = ?'); args.push(p.kind); }
    ids = (await ctx.db.all<{ id: string }>(`SELECT i.id FROM feed_items i JOIN feeds f ON f.id = i.feed_id WHERE ${conds.join(' AND ')}`, args)).map(r => r.id);
  }
  if (!ids.length) return { count: 0 };
  const before: { id: string; state: string }[] = [];
  let changedCount = 0;
  // 已读不会把保存过的改回去；改回未读时清 seen_at；按 400 条分批避免超 SQLite 绑定参数上限
  const cond = p.state === 'seen' ? "AND state = 'new'" : p.state === 'dismissed' ? "AND state != 'saved'" : '';
  await ctx.db.transaction(async tx => {
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const ph = chunk.map(() => '?').join(',');
      if (p.state === 'dismissed') {
        before.push(...await tx.all<{ id: string; state: string }>(`SELECT id, state FROM feed_items WHERE id IN (${ph})`, chunk));
      }
      const r = p.state === 'new'
        ? await tx.run(`UPDATE feed_items SET state = ?, seen_at = NULL, updated_at = ? WHERE id IN (${ph})`, [p.state, t, ...chunk])
        : await tx.run(`UPDATE feed_items SET state = ?, seen_at = COALESCE(seen_at, ?), updated_at = ? WHERE id IN (${ph}) ${cond}`, [p.state, t, t, ...chunk]);
      changedCount += r.changes;
    }
  });
  ctx.events.emit('data.changed', { table: 'feed_items', ids });
  if (p.state !== 'dismissed') return { count: changedCount };
  const undo = await recordUndo(ctx.db, ctx, { tool: 'feeds.mark', args: { ids, state: p.state }, undo_payload: { states: before.filter(b => b.state !== 'saved') } });
  return { count: changedCount, undo };
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

const STALE_MS = 2 * 3600_000;
const countFeeds = async (ctx: Ctx, fresh: boolean, kind?: FeedKind) => Number((await ctx.db.get<{ n: number }>(
  `SELECT count(*) AS n FROM feeds WHERE deleted_at IS NULL AND enabled = 1 ${kind ? 'AND kind = ?' : ''} AND ${fresh ? 'last_ok_at >= ?' : '(last_ok_at IS NULL OR last_ok_at < ?)'}`,
  kind ? [kind, now() - STALE_MS] : [now() - STALE_MS]))?.n ?? 0);
async function freshen(ctx: Ctx, kind?: FeedKind): Promise<boolean> {
  if (!(await countFeeds(ctx, false, kind))) return false;
  if (!ctx.platform.isOnline()) return true;
  let timer: ReturnType<typeof setTimeout> | number | undefined;
  const done = await Promise.race([refreshFeeds(ctx, { kind }).then(() => true, () => true), new Promise<false>(res => { timer = setTimeout(() => res(false), 8_000); })]).finally(() => clearTimeout(timer));
  return !done || (await countFeeds(ctx, true, kind)) === 0;
}

/** search_feeds：查文章订阅库。排序：兴趣词命中 + 新近程度 */
export async function searchFeeds(ctx: Ctx, p: { interests?: string[]; since?: number; limit?: number; q?: string; feed_ids?: string[]; unread_only?: boolean }) {
  const stale = await freshen(ctx, 'article');
  const since = p.since ?? now() - 30 * 86_400_000;
  const where = ["i.deleted_at IS NULL", "f.enabled = 1", "f.kind = 'article'", "i.state != 'dismissed'", 'd.id IS NULL', 'COALESCE(i.published_at, i.created_at) >= ?'];
  const args: (string | number)[] = [since];
  if (p.unread_only) where.push("i.state = 'new'");
  if (p.feed_ids?.length) { where.push(`i.feed_id IN (${p.feed_ids.map(() => '?').join(',')})`); args.push(...p.feed_ids); }
  if (p.q?.trim()) { where.push("(i.title LIKE ? ESCAPE '\\' OR i.excerpt LIKE ? ESCAPE '\\')"); const q = `%${p.q.trim().replace(/[\\%_]/g, m => `\\${m}`)}%`; args.push(q, q); }
  const rows = await ctx.db.all<ItemRow>(`${ITEM_SELECT} WHERE ${where.join(' AND ')} AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.source_type = 'url' AND x.source_uri = i.url AND x.deleted_at IS NULL) ORDER BY COALESCE(i.published_at, i.created_at) DESC LIMIT 300`, args);
  const words = (p.interests ?? []).map(w => w.toLowerCase()).filter(Boolean);
  const t = now();
  const rank = (i: ItemRow) => (words.some(w => (i.title + ' ' + i.excerpt).toLowerCase().includes(w)) ? 2 : 0) + (i.published_at ? Math.max(0, 1 - (t - i.published_at) / (14 * 86_400_000)) : 0);
  const items = rows.sort((a, b) => rank(b) - rank(a)).slice(0, p.limit ?? 20).map(r => {
    const v = toItem(r);
    return { item_id: v.id, url: v.url, title: v.title, site: v.feed_title, ...(v.published_at ? { published_at: v.published_at } : {}), excerpt: v.excerpt, ...(v.est_minutes ? { est_minutes: v.est_minutes } : {}), ...(v.est_level ? { est_level: v.est_level } : {}) };
  });
  return { items, ...(stale ? { stale: true } : {}) };
}

const FEED_KIND = Type.Union([Type.Literal('article'), Type.Literal('podcast'), Type.Literal('radio')]);
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
  'feeds.list': method(Type.Object({ kind: Type.Optional(FEED_KIND) }), async (p, ctx) => listFeeds(ctx.db, p.kind), '订阅 / 电台列表：带未读数、出错原因'),
  'feeds.discover': method(Type.Object({ url: Type.String({ minLength: 1 }) }), async (p, ctx) => discoverFeeds(ctx, p.url), '给网站、Apple Podcasts 链接或订阅地址，找出可以订阅的源'),
  'feeds.add': method(Type.Object({ url: Type.String({ minLength: 1 }), title: Type.Optional(Type.String({ maxLength: 200 })), folder: Type.Optional(Type.String({ maxLength: 40 })), kind: Type.Optional(FEED_KIND) }), async (p, ctx) => addFeed(ctx, p), '加订阅或电台：先确认是订阅源，加完马上抓一次'),
  'feeds.update': method(S_UPDATE, async (p, ctx) => updateFeed(ctx, p), '改名、改分组、开关'),
  'feeds.remove': method(Type.Object({ id: Type.String({ minLength: 1 }) }), async (p, ctx) => removeFeed(ctx, p.id), '删订阅（可撤销）'),
  'feeds.refresh': method(Type.Object({ feed_ids: Type.Optional(Type.Array(Type.String())), kind: Type.Optional(FEED_KIND), force: Type.Optional(Type.Boolean()) }), async (p, ctx) => refreshFeeds(ctx, p), '抓到点的源；force：不管到没到点'),
  'feeds.auto': method(Type.Object({}), async (_p, ctx) => (await autoRefreshOn(ctx) ? refreshFeeds(ctx) : { feeds: 0, not_modified: 0, new_items: 0, failed: 0 }), '定时调用：自动刷新开着才抓'),
  'feeds.status': method(Type.Object({}), async (_p, ctx) => ({ unread: await unreadCount(ctx.db, 'article'), radio_unread: await unreadCount(ctx.db, 'podcast'), refreshing: isRefreshing(), auto_refresh: await autoRefreshOn(ctx) }), '未读数（订阅与电台侧栏角标）、是否正在刷新、自动刷新开关'),
  'feeds.configure': method(Type.Object({ auto_refresh: Type.Boolean() }), async (p, ctx) => {
    await ctx.db.run('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [AUTO_KEY, j.str(p.auto_refresh), now()]);
    return { auto_refresh: p.auto_refresh };
  }, '自动刷新订阅（本机设置）'),
  'feeds.items': method(Type.Object({ kind: Type.Optional(FEED_KIND), feed_id: Type.Optional(Type.String()), folder: Type.Optional(Type.String()), filter: Type.Optional(Type.Union([Type.Literal('unread'), Type.Literal('all'), Type.Literal('saved'), Type.Literal('transcript')])), cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), as_of: Type.Optional(Type.Integer()) }), async (p, ctx) => listItems(ctx, p), '条目列表，按发布时间倒序'),
  'feeds.mark': method(Type.Object({ ids: Type.Optional(Type.Array(Type.String())), feed_id: Type.Optional(Type.String()), kind: Type.Optional(FEED_KIND), all: Type.Optional(Type.Boolean()), state: Type.Union([Type.Literal('seen'), Type.Literal('dismissed'), Type.Literal('new')]) }), async (p, ctx) => markItems(ctx, p), '标已读 / 不感兴趣（可撤销）/ 改回未读'),
  'podcasts.search': method(Type.Object({ q: Type.String({ minLength: 1, maxLength: 120 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25 })) }), async (p, ctx) => searchPodcasts(ctx, p.q, p.limit), '用 iTunes Search API 搜全球英文播客'),
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
    name: 'list_feeds', description: '看订阅和电台：每个源的类型、名字、地址、开关、未读数、出错原因', perm: 'read', mcp: false, params: Type.Object({ kind: Type.Optional(FEED_KIND) }),
    async run(p, ctx) { return (await listFeeds(ctx.db, p.kind)).map(f => ({ id: f.id, kind: f.kind, title: f.title, url: f.url, enabled: f.enabled, unread: f.unread, ...(f.folder ? { folder: f.folder } : {}), ...(f.error ? { error: f.error } : {}) })); },
  }),
  discover_feeds: capability({
    name: 'discover_feeds', description: '给网站或 Apple Podcasts 地址，找出它可以订阅的 RSS / Atom / 播客源（不订阅）', perm: 'read', mcp: false,
    params: Type.Object({ url: Type.String({ minLength: 1 }) }),
    async run(p, ctx) { return discoverFeeds(ctx, p.url); },
  }),
  search_podcasts: capability({
    name: 'search_podcasts', description: '按关键词搜索全球播客电台，返回节目名、作者、RSS 地址与集数', perm: 'read', mcp: false,
    params: Type.Object({ q: Type.String({ minLength: 1, maxLength: 120 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 15 })) }),
    async run(p, ctx) { return searchPodcasts(ctx, p.q, p.limit); },
  }),
  manage_feed: capability({
    name: 'manage_feed', description: '管理订阅和电台：add 给网站或订阅地址（网站有多个订阅时返回候选、不加，用 ask_user 问用户选哪个）；remove / toggle 用 list_feeds 里的 id', perm: 'confirm', mcp: false,
    params: Type.Object({ add: Type.Optional(Type.Object({ url: Type.String(), title: Type.Optional(Type.String()), folder: Type.Optional(Type.String()), kind: Type.Optional(FEED_KIND) })), remove: Type.Optional(Type.String()), toggle: Type.Optional(Type.Object({ id: Type.String(), enabled: Type.Boolean() })) }),
    async describe(p, ctx) {
      const name = async (id: string) => (await getFeed(ctx.db, id))?.title ?? id;
      return p.add ? `订阅 ${p.add.url}` : p.remove ? `删订阅 ${await name(p.remove)}` : p.toggle ? `${p.toggle.enabled ? '打开' : '关掉'}订阅 ${await name(p.toggle.id)}` : '没有改动';
    },
    async run(p, ctx) {
      if (p.add) {
        try { const f = await addFeed(ctx, p.add); return { status: 'subscribed' as const, feed: { id: f.id, kind: f.kind, title: f.title, url: f.url, unread: f.unread } }; }
        catch (e) { if (e instanceof TibiError && e.code === 'conflict' && (e.data as { candidates?: unknown })?.candidates) return { status: 'choose' as const, candidates: (e.data as { candidates: unknown }).candidates }; throw e; }
      }
      const byIdOrUrl = async (x: string) => (await getFeed(ctx.db, x)) ?? (await getFeedByUrl(ctx.db, x));
      if (p.remove) { const f = await byIdOrUrl(p.remove); if (!f) throw new TibiError('not_found', '没有这个订阅'); return { status: 'removed' as const, ...(await removeFeed(ctx, f.id)) }; }
      if (p.toggle) { const f: FeedRow | undefined = await byIdOrUrl(p.toggle.id); if (!f) throw new TibiError('not_found', '没有这个订阅'); await updateFeed(ctx, { id: f.id, enabled: p.toggle.enabled }); return { status: 'updated' as const }; }
      return { status: 'noop' as const };
    },
  }),
};
