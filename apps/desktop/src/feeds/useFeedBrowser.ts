import type { FeedItemView, FeedKind, FeedView } from '@tibi/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { tl } from '../lib/i18n';
import { errorInfo, rpc, type EventTable, type Params } from '../rpc';
import { toast } from '../store/ui';

export type FeedFilter = 'unread' | 'all' | 'saved' | 'transcript';

export interface UseFeedBrowserOptions<F extends FeedFilter> {
  kind: FeedKind;
  filter: F;
  pageSize?: number;
  autoBoot?: boolean;
  dismissToast: string;
  refreshFailToast: (n: number) => string;
}

/**
 * 订阅与电台共用的列表状态（分页、源切换、刷新、条目导入追踪、收进书架、忽略/撤销）。
 * 修复了 import.done 早于 documents.import 返回的竞态，以及在 setState updater 内触发副作用的问题。
 */
export function useFeedBrowser<F extends FeedFilter>({
  kind,
  filter,
  pageSize = 30,
  autoBoot = false,
  dismissToast,
  refreshFailToast,
}: UseFeedBrowserOptions<F>) {
  const nav = useNavigate();
  const navRef = useRef(nav);
  navRef.current = nav;
  const [params, setParams] = useSearchParams();
  const feedId = params.get('feed') ?? undefined;
  const folder = params.get('folder') ?? undefined;
  const [feeds, setFeeds] = useState<FeedView[]>([]);
  const [items, setItems] = useState<FeedItemView[]>();
  const [count, setCount] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const key = `${feedId}|${folder}|${filter}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  const [pg, setPg] = useState({ key, n: 0 });
  const page = pg.key === key ? pg.n : 0;
  const pageRef = useRef(page);
  pageRef.current = page;
  const scroller = useRef<HTMLDivElement>(null);
  const asOf = useRef(0);
  const feedsSeq = useRef(0);
  const itemsSeq = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const pending = useRef(new Map<string, { item: string; open: boolean }>());
  const earlyDone = useRef(new Map<string, EventTable['import.done']>());
  const starting = useRef(0);
  const itemsLenRef = useRef(-1);
  itemsLenRef.current = items ? items.length : -1;

  const loadFeeds = useCallback(() => {
    const seq = ++feedsSeq.current;
    return rpc.call('feeds.list', { kind }).then(
      list => { if (seq === feedsSeq.current) setFeeds(list); },
      () => { if (seq === feedsSeq.current) setFeeds([]); },
    );
  }, [kind]);
  const loadItems = useCallback(async () => {
    const seq = ++itemsSeq.current;
    setLoadError(undefined);
    try {
      if (!page) asOf.current = Date.now();
      const r = await rpc.call('feeds.items', {
        kind,
        feed_id: feedId,
        folder,
        filter,
        ...(page ? { cursor: String(page * pageSize), as_of: asOf.current } : {}),
        limit: pageSize,
      });
      if (seq !== itemsSeq.current) return;
      if (r.items.length === 0 && page > 0) {
        setPg({ key, n: Math.max(0, Math.ceil(r.total / pageSize) - 1) });
        return;
      }
      setItems(r.items);
      setCount(r.total ?? page * pageSize + r.items.length + (r.next_cursor ? 1 : 0));
    } catch (e) {
      if (seq !== itemsSeq.current) return;
      setLoadError(errorInfo(e).message);
      setItems([]);
      setCount(0);
    }
  }, [kind, feedId, folder, filter, page, pageSize, key]);

  useEffect(() => { void loadFeeds(); }, [loadFeeds]);
  useEffect(() => { void loadItems(); }, [loadItems]);

  const turn = useCallback((n: number) => {
    setPg({ key, n });
    scroller.current?.scrollTo({ top: 0 });
  }, [key]);

  const restart = useCallback(async () => {
    if (page) turn(0);
    else await loadItems();
  }, [page, turn, loadItems]);

  const refresh = useCallback(async () => {
    const startedKey = keyRef.current;
    const startedPage = pageRef.current;
    setRefreshing(true);
    try {
      const r = await rpc.call('feeds.refresh', { ...(feedId ? { feed_ids: [feedId] } : { kind }), force: true });
      await loadFeeds();
      if (keyRef.current === startedKey && pageRef.current === startedPage) await restart();
      if (r.failed) toast(refreshFailToast(r.failed));
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      setRefreshing(false);
    }
  }, [feedId, kind, loadFeeds, restart, refreshFailToast]);

  const autoBooted = useRef(false);
  useEffect(() => {
    if (!autoBoot || autoBooted.current || !feeds.length || items === undefined) return;
    if (feeds.every(f => !f.last_ok_at) && items.length === 0) {
      autoBooted.current = true;
      void refresh();
    }
  }, [autoBoot, feeds, items, refresh]);

  useEffect(() => rpc.on('data.changed', d => {
    if (d.table !== 'feeds' && d.table !== 'feed_items') return;
    void loadFeeds();
    if (itemsLenRef.current === 0) void loadItems();
  }), [loadFeeds, loadItems]);

  const finishImport = useCallback((p: { item: string; open: boolean }, d: EventTable['import.done']) => {
    setBusy(b => { const n = { ...b }; delete n[p.item]; return n; });
    if (!d.ok) return;
    setItems(cur => cur?.map(i => (i.id === p.item ? { ...i, state: p.open ? 'seen' : 'saved', document_id: d.document_id, in_library: !p.open || i.in_library } : i)));
    if (p.open && d.document_id) navRef.current(`/read/${d.document_id}`);
  }, []);

  useEffect(() => {
    const off1 = rpc.on('import.progress', d => {
      const p = pending.current.get(d.import_id);
      if (p) setBusy(b => ({ ...b, [p.item]: d.label }));
    });
    const off2 = rpc.on('import.done', d => {
      const p = pending.current.get(d.import_id);
      if (p) {
        pending.current.delete(d.import_id);
        finishImport(p, d);
        return;
      }
      if (starting.current > 0) {
        earlyDone.current.set(d.import_id, d);
        if (earlyDone.current.size > 20) earlyDone.current.delete(earlyDone.current.keys().next().value!);
      }
    });
    return () => { off1(); off2(); };
  }, [finishImport]);

  const shelve = useCallback(async (it: FeedItemView) => {
    if (!it.document_id) return;
    try {
      await rpc.call('documents.update', { id: it.document_id, patch: { shelved: true } });
      setItems(cur => cur?.map(i => (i.id === it.id ? { ...i, in_library: true } : i)));
      toast(tl('已放进书架：{title}', { title: it.title }));
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    }
  }, []);

  const openOrImport = useCallback(async (
    it: FeedItemView,
    open: boolean,
    source: Params<'documents.import'>['source'],
    initialLabel: string,
  ) => {
    if (it.document_id && open) { navRef.current(`/read/${it.document_id}`); return; }
    if (it.document_id) { await shelve(it); return; }
    if (busy[it.id]) return;
    starting.current++;
    setBusy(b => ({ ...b, [it.id]: initialLabel }));
    try {
      const { import_id } = await rpc.call('documents.import', { source, shelve: !open });
      const entry = { item: it.id, open };
      const early = earlyDone.current.get(import_id);
      if (early) {
        earlyDone.current.delete(import_id);
        finishImport(entry, early);
      } else {
        pending.current.set(import_id, entry);
      }
    } catch (e) {
      setBusy(b => { const n = { ...b }; delete n[it.id]; return n; });
      toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      starting.current = Math.max(0, starting.current - 1);
    }
  }, [busy, shelve, finishImport]);

  const dismiss = useCallback(async (it: FeedItemView) => {
    const startedKey = keyRef.current;
    try {
      const r = await rpc.call('feeds.mark', { ids: [it.id], state: 'dismissed' });
      setItems(cur => cur?.filter(i => i.id !== it.id));
      if (r.undo) {
        toast(dismissToast, {
          action: {
            label: tl('撤销'),
            run: () => void rpc.call('system.undo', { undo_id: r.undo!.undo_id }).then(
              () => { if (keyRef.current === startedKey) void loadItems(); },
              e => toast(errorInfo(e).message, { kind: 'err' }),
            ),
          },
        });
      }
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    }
  }, [dismissToast, loadItems]);

  const pickFeed = useCallback((id?: string, fld?: string) => {
    const next = new URLSearchParams();
    if (id) next.set('feed', id);
    if (fld) next.set('folder', fld);
    setParams(next);
  }, [setParams]);

  return {
    feedId,
    folder,
    feeds,
    items,
    setItems,
    count,
    loadError,
    key,
    page,
    scroller,
    refreshing,
    busy,
    loadFeeds,
    loadItems,
    turn,
    restart,
    refresh,
    openOrImport,
    dismiss,
    pickFeed,
  };
}
