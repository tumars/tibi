import type { FeedCandidate, FeedItemView, FeedView } from '@tibi/core';
import { ArrowLeft, Check, ExternalLink, Plus, RefreshCw, Settings2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router';
import { Empty } from '../components/Empty';
import { Modal } from '../components/Modal';
import { Top } from '../components/Shell';
import { Switch } from '../components/Switch';
import { tl } from '../lib/i18n';
import { fmtAgo, fmtMinutes } from '../lib/util';
import { errorInfo, isTauri, rpc } from '../rpc';
import { toast } from '../store/ui';

/**
 * 订阅（11 §5.2）：左栏是源，右栏是条目。条目不进书架，点"读"才走网址导入；
 * 滚过去的标为已读（攒一秒发一次），"不感兴趣"可撤销。列表不跟着已读自动刷新，免得滚动时跳。
 */
type Filter = 'unread' | 'all' | 'saved';

export function Feeds() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const feedId = params.get('feed') ?? undefined; const folder = params.get('folder') ?? undefined;
  const [filter, setFilter] = useState<Filter>('unread');
  const [feeds, setFeeds] = useState<FeedView[]>([]);
  const [items, setItems] = useState<FeedItemView[]>();
  const [cursor, setCursor] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<Record<string, string>>({});   // 条目 → 导入进度
  const pending = useRef(new Map<string, { item: string; open: boolean }>());   // import_id → 条目

  const loadFeeds = useCallback(() => rpc.call('feeds.list', {}).then(setFeeds, () => setFeeds([])), []);
  const loadItems = useCallback(async () => {
    try { const r = await rpc.call('feeds.items', { feed_id: feedId, folder, filter, limit: 30 }); setItems(r.items); setCursor(r.next_cursor); } catch { setItems([]); setCursor(undefined); }
  }, [feedId, folder, filter]);
  useEffect(() => { void loadFeeds(); }, [loadFeeds]);
  useEffect(() => { void loadItems(); }, [loadItems]);
  // 源的未读数跟着变；条目列表只在空着的时候自动刷新
  useEffect(() => rpc.on('data.changed', d => {
    if (d.table !== 'feeds' && d.table !== 'feed_items') return;
    void loadFeeds();
    setItems(cur => { if (cur && cur.length === 0) void loadItems(); return cur; });
  }), [loadFeeds, loadItems]);

  useEffect(() => {
    const off1 = rpc.on('import.progress', d => { const p = pending.current.get(d.import_id); if (p) setBusy(b => ({ ...b, [p.item]: d.label })); });
    const off2 = rpc.on('import.done', d => {
      const p = pending.current.get(d.import_id); if (!p) return;
      pending.current.delete(d.import_id);
      setBusy(b => { const n = { ...b }; delete n[p.item]; return n; });
      // 成功和失败的提示由 App 统一给
      if (!d.ok) return;
      setItems(cur => cur?.map(i => (i.id === p.item ? { ...i, state: 'saved', document_id: d.document_id } : i)));
      if (p.open) nav(`/read/${d.document_id}`);
    });
    return () => { off1(); off2(); };
  }, [nav]);

  const read = async (it: FeedItemView, open: boolean) => {
    if (it.document_id) { nav(`/read/${it.document_id}`); return; }
    if (busy[it.id]) return;
    try {
      setBusy(b => ({ ...b, [it.id]: tl('开始') }));
      const { import_id } = await rpc.call('documents.import', { source: { type: 'url', url: it.url } });
      pending.current.set(import_id, { item: it.id, open });
    } catch (e) { setBusy(b => { const n = { ...b }; delete n[it.id]; return n; }); toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const dismiss = async (it: FeedItemView) => {
    try {
      const r = await rpc.call('feeds.mark', { ids: [it.id], state: 'dismissed' });
      setItems(cur => cur?.filter(i => i.id !== it.id));
      if (r.undo) toast(tl('不再显示这篇'), { action: { label: tl('撤销'), run: () => void rpc.call('system.undo', { undo_id: r.undo!.undo_id }).then(() => loadItems(), e => toast(errorInfo(e).message, { kind: 'err' })) } });
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const refresh = async () => {
    setRefreshing(true);
    try { const r = await rpc.call('feeds.refresh', { feed_ids: feedId ? [feedId] : undefined, force: true }); await loadItems(); if (r.failed) toast(tl('{n} 个源没刷新成功，在管理里看原因', { n: r.failed })); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
    setRefreshing(false);
  };
  const markAll = async () => {
    try { await rpc.call('feeds.mark', feedId ? { feed_id: feedId, state: 'seen' } : { all: true, state: 'seen' }); await loadItems(); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const more = async () => {
    if (!cursor) return;
    try { const r = await rpc.call('feeds.items', { feed_id: feedId, folder, filter, cursor, limit: 30 }); setItems(cur => [...(cur ?? []), ...r.items]); setCursor(r.next_cursor); } catch { setCursor(undefined); }
  };

  // 滚过去（整张卡片从列表上边出去）的未读条目标为已读；卡片被移走（换筛选、离开页面）不算
  const seenQueue = useRef(new Set<string>());
  const flush = useRef<ReturnType<typeof setTimeout>>(undefined);
  const observer = useRef<IntersectionObserver>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    observer.current = new IntersectionObserver(entries => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.id;
        if (!id || e.isIntersecting || !e.target.isConnected || !e.rootBounds || e.boundingClientRect.height === 0 || e.boundingClientRect.bottom > e.rootBounds.top) continue;
        seenQueue.current.add(id); observer.current?.unobserve(e.target);
      }
      if (!seenQueue.current.size || flush.current) return;
      flush.current = setTimeout(() => {
        const ids = [...seenQueue.current]; seenQueue.current.clear(); flush.current = undefined;
        setItems(cur => cur?.map(i => (ids.includes(i.id) && i.state === 'new' ? { ...i, state: 'seen' } : i)));
        void rpc.call('feeds.mark', { ids, state: 'seen' }).catch(() => undefined);
      }, 1000);
    }, { root: scroller.current });
    return () => {
      observer.current?.disconnect(); clearTimeout(flush.current); flush.current = undefined;
      // 离开页面时把攒着的已读发出去
      if (seenQueue.current.size) void rpc.call('feeds.mark', { ids: [...seenQueue.current], state: 'seen' }).catch(() => undefined);
      seenQueue.current.clear();
    };
  }, []);
  const watch = (el: HTMLElement | null, it: FeedItemView) => { if (el && it.state === 'new') observer.current?.observe(el); };

  const current = feedId ? feeds.find(f => f.id === feedId) : undefined;
  const folders = [...new Set(feeds.filter(f => f.enabled && f.folder).map(f => f.folder!))];
  const enabled = feeds.filter(f => f.enabled);
  const total = enabled.reduce((a, f) => a + f.unread, 0);
  const go = (p: { feed?: string; folder?: string }) => setParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Record<string, string>);
  const title = current?.title ?? folder ?? tl('全部');

  return (
    <>
      <Top crumbs={[{ label: tl('订阅'), to: feedId || folder ? '/feeds' : undefined }, ...(feedId || folder ? [{ label: title }] : [])]} right={<>
        <div className="seg">{([['unread', tl('未读')], ['all', tl('全部')], ['saved', tl('已保存')]] as const).map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <button className="ibtn" title={tl('全部标为已读')} onClick={() => void markAll()}><Check /></button>
        <button className={`ibtn${refreshing ? ' rot' : ''}`} title={refreshing ? tl('正在刷新') : tl('刷新')} disabled={refreshing} onClick={() => void refresh()}><RefreshCw /></button>
      </>} />
      <div className="feedpage">
        <aside className="feedside">
          <button className={!feedId && !folder ? 'cur' : ''} onClick={() => go({})}><span className="ft">{tl('全部')}</span>{total > 0 && <span className="n">{total}</span>}</button>
          {folders.map(fo => <div key={fo} className="fgroup">
            <button className={`fh${folder === fo && !feedId ? ' cur' : ''}`} onClick={() => go({ folder: fo })}>{fo}</button>
            {enabled.filter(f => f.folder === fo).map(f => <FeedLink key={f.id} f={f} cur={feedId === f.id} onClick={() => go({ feed: f.id })} />)}
          </div>)}
          {enabled.some(f => !f.folder) && <div className="fgroup">
            {folders.length > 0 && <div className="fh static">{tl('未分组')}</div>}
            {enabled.filter(f => !f.folder).map(f => <FeedLink key={f.id} f={f} cur={feedId === f.id} onClick={() => go({ feed: f.id })} />)}
          </div>}
          <div className="feedacts">
            <button className="btn sm" onClick={() => setAdding(true)}><Plus />{tl('加订阅')}</button>
            <NavLink className="btn sm" to="/feeds/manage"><Settings2 />{tl('管理')}</NavLink>
          </div>
        </aside>
        <div className="scroll" ref={scroller}><div className="page feedlist">
          {current?.error && <p className="feederr">{tl('这个源上次没刷新成功：{error}', { error: current.error })}</p>}
          {items === undefined ? null : items.length === 0
            ? (feeds.length === 0 || enabled.length === 0
              ? <Empty image="empty-library" title={tl('还没有订阅')} text={tl('订阅喜欢的英文博客和杂志，新文章会自动出现在这里。')} action={<button className="btn pri" onClick={() => setAdding(true)}>{tl('加订阅')}</button>} />
              : <Empty image="empty-library" title={filter === 'unread' ? tl('都看过了') : filter === 'saved' ? tl('还没有保存的文章') : tl('这里还没有文章')} text={filter === 'unread' ? tl('新文章来了会出现在这里。也可以看看「全部」。') : undefined} action={filter === 'unread' ? <button className="btn" onClick={() => setFilter('all')}>{tl('看全部')}</button> : undefined} />)
            : <>
              {items.map(it => <article key={it.id} data-id={it.id} ref={el => watch(el, it)} className={`fitem${it.state === 'new' ? ' unread' : ''}`}>
                <div className="m">
                  <span className="src">{it.feed_title}</span>
                  {it.published_at && <><span>·</span><span>{fmtAgo(it.published_at)}</span></>}
                  {it.author && <><span>·</span><span className="au">{it.author}</span></>}
                </div>
                <button className="t" onClick={() => void read(it, true)}>{it.title}</button>
                {it.excerpt && <p className="ex">{it.excerpt}</p>}
                <div className="f">
                  {it.est_level && <span className="lv" title={tl('按词频估的文本级别')}>{tl('难度约 {level}', { level: it.est_level })}</span>}
                  <span className="lbl">{fmtMinutes(it.est_minutes)}</span>
                  <span className="sp" />
                  {busy[it.id] ? <span className="lbl busy">{busy[it.id]}</span>
                    : it.document_id ? <button className="btn sm" onClick={() => nav(`/read/${it.document_id}`)}>{tl('在书架里')}</button>
                    : <>
                      <button className="btn sm pri" onClick={() => void read(it, true)}>{tl('读')}</button>
                      <button className="btn sm" onClick={() => void read(it, false)}>{tl('稍后读')}</button>
                      <button className="ibtn" title={tl('不感兴趣')} aria-label={tl('不感兴趣')} onClick={() => void dismiss(it)}><X /></button>
                    </>}
                  <OpenLink url={it.comments_url ?? it.url} title={it.comments_url ? tl('看讨论') : tl('在浏览器里打开')} />
                </div>
              </article>)}
              {cursor && <div className="more"><button className="btn" onClick={() => void more()}>{tl('更多')}</button></div>}
            </>}
        </div></div>
      </div>
      {adding && <AddFeedModal onClose={() => setAdding(false)} onAdded={f => { setAdding(false); void loadFeeds(); go({ feed: f.id }); setFilter('all'); }} />}
    </>
  );
}

function FeedLink({ f, cur, onClick }: { f: FeedView; cur: boolean; onClick: () => void }) {
  return <button className={cur ? 'cur' : ''} onClick={onClick} title={f.error ? tl('上次没刷新成功：{error}', { error: f.error }) : f.url}>
    <span className={`ft${f.error ? ' bad' : ''}`}>{f.title}</span>{f.unread > 0 && <span className="n">{f.unread > 99 ? '99+' : f.unread}</span>}
  </button>;
}

/** 在系统浏览器里打开（桌面走壳；浏览器开发模式开新标签） */
function OpenLink({ url, title }: { url: string; title: string }) {
  const open = async () => {
    if (isTauri()) { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(url).catch(e => toast(errorInfo(e).message, { kind: 'err' })); }
    else window.open(url, '_blank', 'noopener');
  };
  return <button className="ibtn" title={title} aria-label={title} onClick={() => void open()}><ExternalLink /></button>;
}

/** 加订阅：贴网址 → 找订阅地址 → 选一个（可以填分组）→ 订阅 */
export function AddFeedModal({ onClose, onAdded }: { onClose: () => void; onAdded: (f: FeedView) => void }) {
  const [url, setUrl] = useState('');
  const [found, setFound] = useState<FeedCandidate[]>();
  const [pick, setPick] = useState<string>();
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const discover = async () => {
    setBusy(true);
    try { const c = await rpc.call('feeds.discover', { url: url.trim() }); setFound(c); setPick(c[0]?.url); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
    setBusy(false);
  };
  const add = async () => {
    if (!pick) return;
    setBusy(true);
    try { const f = await rpc.call('feeds.add', { url: pick, folder: folder.trim() || undefined }); toast(tl('已订阅 {title}', { title: f.title })); onAdded(f); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); setBusy(false); }
  };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={tl('加订阅')}
      actions={<><button className="btn" onClick={onClose}>{tl('取消')}</button>
        {found ? <button className="btn pri" disabled={!pick || busy} onClick={() => void add()}>{busy ? tl('订阅中…') : tl('订阅')}</button>
          : <button className="btn pri" disabled={!url.trim() || busy} onClick={() => void discover()}>{busy ? tl('检查中…') : tl('下一步')}</button>}</>}>
      <p className="lbl">{tl('贴网站地址或 RSS / Atom 地址，Tibi 会自己找订阅地址。')}</p>
      <input className="input" autoFocus style={{ width: '100%' }} value={url} onChange={e => { setUrl(e.target.value); setFound(undefined); }} onKeyDown={e => { if (e.key === 'Enter' && url.trim() && !busy && !found) void discover(); }} placeholder="https://example.com/blog" aria-label={tl('网址')} />
      {found && <div className="feedcands">
        {found.length > 1 && <p className="lbl">{tl('这个网站有 {n} 个订阅，选一个：', { n: found.length })}</p>}
        {found.map(c => <label key={c.url} className={`cand${pick === c.url ? ' on' : ''}`}>
          <input type="radio" name="feedcand" checked={pick === c.url} onChange={() => setPick(c.url)} />
          <span><b>{c.title}</b><span className="lbl fu">{c.url}</span>{c.latest && <span className="lbl">{tl('最近一篇：{title}', { title: c.latest.title })}{c.latest.published_at ? ` · ${fmtAgo(c.latest.published_at)}` : ''}</span>}</span>
        </label>)}
        <input className="input" style={{ width: '100%' }} value={folder} onChange={e => setFolder(e.target.value)} placeholder={tl('分组（可不填），如 科技')} aria-label={tl('分组')} />
      </div>}
    </Modal>
  );
}

/** 管理订阅：开关、改名、分组、删除（可撤销），看出错原因；自动刷新开关是本机设置 */
export function FeedsManage() {
  const nav = useNavigate();
  const [feeds, setFeeds] = useState<FeedView[]>();
  const [auto, setAuto] = useState<boolean>();
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => rpc.call('feeds.list', {}).then(setFeeds, () => setFeeds([])), []);
  useEffect(() => { void load(); rpc.call('feeds.status', {}).then(s => setAuto(s.auto_refresh), () => undefined); return rpc.on('data.changed', d => { if (d.table === 'feeds') void load(); }); }, [load]);
  const update = async (p: { id: string; title?: string; folder?: string; enabled?: boolean }) => {
    try { const f = await rpc.call('feeds.update', p); setFeeds(cur => cur?.map(x => (x.id === f.id ? f : x))); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const remove = async (f: FeedView) => {
    try {
      const r = await rpc.call('feeds.remove', { id: f.id }); await load();
      toast(tl('已删除订阅 {title}', { title: f.title }), { action: { label: tl('撤销'), run: () => void rpc.call('system.undo', { undo_id: r.undo.undo_id }).then(() => load(), e => toast(errorInfo(e).message, { kind: 'err' })) } });
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const setAutoRefresh = async (v: boolean) => { try { setAuto((await rpc.call('feeds.configure', { auto_refresh: v })).auto_refresh); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };

  return (
    <>
      <Top crumbs={[{ label: tl('订阅'), to: '/feeds' }, { label: tl('管理') }]} right={<button className="btn sm" onClick={() => setAdding(true)}><Plus />{tl('加订阅')}</button>} />
      <div className="scroll"><div className="page feedmanage">
        <button className="linkbtn back" onClick={() => nav('/feeds')}><ArrowLeft size={14} />{tl('回到订阅')}</button>
        {auto !== undefined && <div className="item">
          <div className="d"><b>{tl('自动刷新订阅')}</b><span className="lbl">{tl('Tibi 开着时每 30 分钟看一次有没有新文章（同一个源至少隔 2 小时才抓）。关掉后只在点刷新时抓。只对这台设备生效。')}</span></div>
          <Switch label={tl('自动刷新订阅')} checked={auto} onChange={v => void setAutoRefresh(v)} />
        </div>}
        {feeds?.length === 0 && <Empty image="empty-library" title={tl('还没有订阅')} action={<button className="btn pri" onClick={() => setAdding(true)}>{tl('加订阅')}</button>} />}
        <div className="feedrows">{feeds?.map(f => <div key={f.id} className={`feedrow${f.enabled ? '' : ' off'}`}>
          <Switch label={f.title} checked={f.enabled} onChange={v => void update({ id: f.id, enabled: v })} />
          <div className="fmain">
            <input className="input ftitle" defaultValue={f.title} aria-label={tl('名字')} onBlur={e => { const v = e.target.value.trim(); if (v && v !== f.title) void update({ id: f.id, title: v }); }} />
            <span className="lbl fu">{f.url}</span>
            <span className={`lbl${f.error ? ' bad' : ''}`}>{f.error ? tl('上次没刷新成功：{error}', { error: f.error }) : f.last_ok_at ? tl('{ago}刷新过', { ago: fmtAgo(f.last_ok_at) }) : tl('还没刷新过')}</span>
          </div>
          <input className="input ffolder" defaultValue={f.folder ?? ''} placeholder={tl('分组')} aria-label={tl('分组')} onBlur={e => { if (e.target.value.trim() !== (f.folder ?? '')) void update({ id: f.id, folder: e.target.value }); }} />
          <button className="linkbtn" onClick={() => void remove(f)}>{tl('删除')}</button>
        </div>)}</div>
      </div></div>
      {adding && <AddFeedModal onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void load(); }} />}
    </>
  );
}
