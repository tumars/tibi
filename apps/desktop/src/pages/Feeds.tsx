import type { FeedCandidate, FeedItemView, FeedView } from '@tibi/core';
import { BookmarkCheck, BookmarkPlus, Check, ExternalLink, Plus, RefreshCw, Settings2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router';
import { Empty } from '../components/Empty';
import { Modal } from '../components/Modal';
import { Pager } from '../components/Pager';
import { Top } from '../components/Shell';
import { ObjectMenuButton, useObjectMenu } from '../components/ObjectMenu';
import { Alert } from '../components/ui';
import { FeedManageView } from '../feeds/FeedManageView';
import { useFeedBrowser } from '../feeds/useFeedBrowser';
import { copyText, openSource } from '../lib/contextActions';
import { tl } from '../lib/i18n';
import { fmtAgo, fmtMinutes } from '../lib/util';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';

/**
 * 订阅（11 §5.2）：左栏是源，右栏是条目。条目不进书架，点"读"才走网址导入；
 * 滚过去的标为已读（攒一秒发一次），"不感兴趣"可撤销。列表不跟着已读自动刷新，免得滚动时跳。
 */
type Filter = 'unread' | 'all' | 'saved';
const PAGE = 30;

export function Feeds() {
  const [filter, setFilter] = useState<Filter>('unread');
  const [adding, setAdding] = useState(false);
  const refreshFailToast = useCallback((n: number) => tl('{n} 个源没刷新成功，在管理里看原因', { n }), []);
  const {
    feedId, folder, feeds, items, setItems, count, loadError, key, page, scroller, refreshing, busy,
    loadFeeds, loadItems, turn, restart, refresh, openOrImport, dismiss, pickFeed,
  } = useFeedBrowser({
    kind: 'article',
    filter,
    pageSize: PAGE,
    dismissToast: tl('不再显示这篇'),
    refreshFailToast,
  });

  // 读：同一个阅读器打开，但不进书架（11 §5.2）；加入书架：放进书架，不跳转
  const read = (it: FeedItemView, open: boolean) =>
    openOrImport(it, open, { type: 'url', url: it.url, title: it.title }, open ? tl('正在打开…') : tl('正在加入书架…'));

  const menu = useObjectMenu<FeedItemView>(it => [
    { label: tl('阅读'), enabled: !busy[it.id], run: () => void read(it, true) },
    { label: it.in_library ? tl('在书架里') : tl('加入书架'), enabled: !it.in_library && !busy[it.id], run: () => void read(it, false) }, null,
    { label: tl('打开原文'), run: () => void openSource(it.url) },
    { label: tl('复制原文链接'), run: () => void copyText(it.url) },
    ...(it.comments_url ? [{ label: tl('看讨论'), run: () => void openSource(it.comments_url!) }] : []),
    ...(!it.document_id && !busy[it.id] ? [null, { label: tl('不感兴趣'), run: () => void dismiss(it) }] : []),
  ], `${key}|${page}`);
  const markAll = async () => {
    try { await rpc.call('feeds.mark', feedId ? { feed_id: feedId, state: 'seen' } : { kind: 'article', all: true, state: 'seen' }); await restart(); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  // 滚过去（整张卡片从列表上边出去）的未读条目标为已读；卡片被移走（换筛选、离开页面）不算
  const seenQueue = useRef(new Set<string>());
  const flush = useRef<ReturnType<typeof setTimeout>>(undefined);
  const observer = useRef<IntersectionObserver>(undefined);
  useEffect(() => {
    observer.current = new IntersectionObserver(entries => {
      for (const e of entries) {
        const ids = (e.target as HTMLElement).dataset.id?.split(' ').filter(Boolean);
        if (!ids?.length || e.isIntersecting || !e.target.isConnected || !e.rootBounds || e.boundingClientRect.height === 0 || e.boundingClientRect.bottom > e.rootBounds.top) continue;
        for (const id of ids) seenQueue.current.add(id);
        observer.current?.unobserve(e.target);
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
  }, [scroller, setItems]);
  const watch = (el: HTMLElement | null, g: FeedItemView[]) => { if (el && g.some(i => i.state === 'new')) observer.current?.observe(el); };
  const [variant, setVariant] = useState<Record<string, string>>({});   // 分级稿：卡片 → 选中的那一版
  useEffect(() => { menu.close(); }, [items, variant, menu.close]);

  const current = feedId ? feeds.find(f => f.id === feedId) : undefined;
  const folders = [...new Set(feeds.filter(f => f.enabled && f.folder).map(f => f.folder!))];
  const enabled = feeds.filter(f => f.enabled);
  const total = enabled.reduce((a, f) => a + f.unread, 0);
  const go = (p: { feed?: string; folder?: string }) => pickFeed(p.feed, p.folder);
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
            <button onClick={() => setAdding(true)}><Plus />{tl('加订阅')}</button>
            <NavLink to="/feeds/manage"><Settings2 />{tl('管理订阅')}</NavLink>
          </div>
        </aside>
        <div className="scroll" ref={scroller}><div className="page feedlist">
          {current?.error && (
            <Alert tone="danger" compact action={<button className="linkbtn" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? tl('正在刷新') : tl('重试')}</button>}>
              {tl('上次刷新失败：{error}', { error: current.error })}
            </Alert>
          )}
          {items === undefined ? null : items.length === 0
            ? (loadError
              ? <Empty image="error-generic" title={loadError} action={<button className="btn" onClick={() => void loadItems()}>{tl('重试')}</button>} />
              : feeds.length === 0 || enabled.length === 0
              ? <Empty image="empty-library" title={tl('暂无文章订阅源。')} action={<button className="btn pri" onClick={() => setAdding(true)}>{tl('添加订阅')}</button>} />
              : current?.error && !current.last_ok_at
              ? <Empty image="error-generic" title={tl('尚未获取到该订阅源的文章。')} action={<button className="btn" disabled={refreshing} onClick={() => void refresh()}>{tl('重试')}</button>} />
              : <Empty
                  image={filter === 'unread' ? 'empty-review' : 'empty-library'}
                  title={filter === 'unread' ? tl('当前暂无未读文章。') : filter === 'saved' ? tl('暂无已保存的文章。') : tl('当前订阅源暂无文章。')}
                  action={filter === 'all'
                    ? <button className="btn" disabled={refreshing} onClick={() => void refresh()}>{tl('刷新')}</button>
                    : <button className="btn" onClick={() => setFilter('all')}>{tl('查看全部')}</button>}
                />)
            : <>
              {/* 整张卡片点开就读；收进书架、不感兴趣、原网页放在右下角，悬停才亮 */}
              {groupLevels(items).map(g => { const it = g.find(i => i.id === variant[g[0]!.id]) ?? g[g.length - 1]!; return <article key={g[0]!.id} data-id={g.map(i => i.id).join(' ')} ref={el => watch(el, g)} className={`fitem${g.some(i => i.state === 'new') ? ' unread' : ''}${busy[it.id] ? ' busy' : ''}`}
                tabIndex={0} aria-label={it.title} onClick={e => { if (!e.ctrlKey) void read(it, true); }} onContextMenu={e => menu.open(it, e)} onKeyDown={e => {
                  menu.onKeyDown(it, e);
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); void read(it, true); }
                }}>
                <div className="m">
                  <span className="src">{it.feed_title}</span>
                  {it.published_at && <><span>·</span><span>{fmtAgo(it.published_at)}</span></>}
                  {it.author && <><span>·</span><span className="au">{it.author}</span></>}
                </div>
                <button className="t" onClick={e => { e.stopPropagation(); if (!e.ctrlKey) void read(it, true); }}>{g.length > 1 ? levelBase(it.title) : it.title}</button>
                {it.excerpt && <p className="ex">{it.excerpt.replace(LEADING_STAMP, '')}</p>}
                <div className="f" onClick={e => e.stopPropagation()}>
                  {g.length > 1
                    ? <span className="lvs" role="group" aria-label={tl('难度版本')}>{g.map(v => <button key={v.id} className={v.id === it.id ? 'on' : ''} title={tl('按词频估的文本级别')} onClick={() => setVariant(m => ({ ...m, [g[0]!.id]: v.id }))}>{v.est_level ?? levelNo(v.title)}</button>)}</span>
                    : it.est_level && <span className="lv" title={tl('按词频估的文本级别')}>{it.est_level}</span>}
                  {it.est_minutes && <span>{fmtMinutes(it.est_minutes)}</span>}
                  {it.in_library && <span className="tag"><BookmarkCheck />{tl('在书架里')}</span>}
                  <span className="sp" />
                  <ObjectMenuButton onClick={e => menu.open(it, e)} />
                  {busy[it.id] ? <span className="busy" role="status"><span className="spin" />{busy[it.id]}</span> : <span className="acts">
                    {!it.in_library && <button className="ibtn" title={tl('加入书架')} aria-label={tl('加入书架')} onClick={() => void read(it, false)}><BookmarkPlus /></button>}
                    {!it.document_id && <button className="ibtn" title={tl('不感兴趣')} aria-label={tl('不感兴趣')} onClick={() => void dismiss(it)}><X /></button>}
                    <OpenLink url={it.comments_url ?? it.url} title={it.comments_url ? tl('看讨论') : tl('在浏览器里打开')} />
                  </span>}
                </div>
              </article>; })}
              <Pager page={page} size={PAGE} total={count} onPage={turn} />
            </>}
        </div></div>
      </div>
      {menu.menu}
      {adding && <AddFeedModal onClose={() => setAdding(false)} onAdded={f => { setAdding(false); void loadFeeds(); go({ feed: f.id }); setFilter('all'); }} />}
    </>
  );
}

/** News in Levels 这类同一篇按难度出几版（标题以 "– level N" 结尾）：同一个源里合成一张卡，按 level 从低到高 */
/** 有的源把发布时间写在摘要开头（04-11-2026 15:00），列表上已经有时间了 */
const LEADING_STAMP = /^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(\s+\d{1,2}:\d{2})?\s*/;
const LEVEL_RE = /\s*[–—-]\s*level\s*(\d)\s*$/i;
const levelBase = (t: string) => t.replace(LEVEL_RE, '');
const levelNo = (t: string) => `L${t.match(LEVEL_RE)?.[1] ?? '?'}`;
function groupLevels(items: FeedItemView[]): FeedItemView[][] {
  const out: FeedItemView[][] = []; const at = new Map<string, FeedItemView[]>();
  for (const it of items) {
    if (!LEVEL_RE.test(it.title)) { out.push([it]); continue; }
    const key = `${it.feed_id}|${levelBase(it.title).toLowerCase()}`;
    const g = at.get(key); if (g) { g.push(it); continue; }
    const ng = [it]; at.set(key, ng); out.push(ng);
  }
  for (const g of out) if (g.length > 1) g.sort((a, b) => levelNo(a.title).localeCompare(levelNo(b.title), undefined, { numeric: true }));
  return out;
}

function FeedLink({ f, cur, onClick }: { f: FeedView; cur: boolean; onClick: () => void }) {
  return <button className={cur ? 'cur' : ''} onClick={onClick} title={f.error ? tl('上次没刷新成功：{error}', { error: f.error }) : f.url}>
    <span className={`ft${f.error ? ' bad' : ''}`}>{f.title}</span>{f.unread > 0 && <span className="n">{f.unread > 99 ? '99+' : f.unread}</span>}
  </button>;
}

/** 在系统浏览器里打开（桌面走壳；浏览器开发模式开新标签） */
function OpenLink({ url, title }: { url: string; title: string }) {
  return <button className="ibtn" title={title} aria-label={title} onClick={() => void openSource(url)}><ExternalLink /></button>;
}

/** 加订阅：贴网址 → 找订阅地址 → 选一个（可以填分组）→ 订阅 */
function AddFeedModal({ onClose, onAdded }: { onClose: () => void; onAdded: (f: FeedView) => void }) {
  const [url, setUrl] = useState('');
  const [found, setFound] = useState<FeedCandidate[]>();
  const [pick, setPick] = useState<string>();
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const discoverSeq = useRef(0);
  const discover = async () => {
    const seq = ++discoverSeq.current;
    setBusy(true);
    try {
      const c = await rpc.call('feeds.discover', { url: url.trim() });
      if (seq !== discoverSeq.current) return;
      setFound(c); setPick(c[0]?.url);
    } catch (e) {
      if (seq === discoverSeq.current) toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      if (seq === discoverSeq.current) setBusy(false);
    }
  };
  const add = async () => {
    if (!pick) return;
    setBusy(true);
    try { const f = await rpc.call('feeds.add', { url: pick, folder: folder.trim() || undefined }); toast(tl('已订阅 {title}', { title: f.title })); onAdded(f); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); setBusy(false); }
  };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={tl('添加订阅')}
      actions={<><button className="btn" onClick={onClose}>{tl('取消')}</button>
        {found ? <button className="btn pri" disabled={!pick || busy} onClick={() => void add()}>{busy ? tl('订阅中…') : tl('订阅')}</button>
          : <button className="btn pri" disabled={!url.trim() || busy} onClick={() => void discover()}>{busy ? tl('检查中…') : tl('查找订阅源')}</button>}</>}>
      <input className="input" autoFocus style={{ width: '100%' }} value={url} onChange={e => { discoverSeq.current++; setBusy(false); setUrl(e.target.value); setFound(undefined); }} onKeyDown={e => { if (e.key === 'Enter' && url.trim() && !busy && !found) void discover(); }} placeholder={tl('网站地址或 RSS / Atom 链接')} aria-label={tl('网址')} />
      {found && <div className="feedcands">
        {found.length === 0 && <p className="lbl">{tl('没有找到')}</p>}
        {found.length > 1 && <p className="lbl">{tl('检测到 {n} 个订阅源，请选择：', { n: found.length })}</p>}
        {found.map(c => <label key={c.url} className={`cand${pick === c.url ? ' on' : ''}`}>
          <input type="radio" name="feedcand" checked={pick === c.url} onChange={() => setPick(c.url)} />
          <span><b>{c.title}</b><span className="lbl fu">{c.url}</span>{c.latest && <span className="lbl">{tl('最近一篇：{title}', { title: c.latest.title })}{c.latest.published_at ? ` · ${fmtAgo(c.latest.published_at)}` : ''}</span>}</span>
        </label>)}
        <input className="input" style={{ width: '100%' }} value={folder} onChange={e => setFolder(e.target.value)} placeholder={tl('分组（选填），如 科技')} aria-label={tl('分组')} />
      </div>}
    </Modal>
  );
}

/** 管理订阅：开关、改名、分组、删除（可撤销），看出错原因；自动刷新开关是本机设置 */
export function FeedsManage() {
  return (
    <FeedManageView
      kind="article"
      crumbLabel={tl('订阅')}
      crumbTo="/feeds"
      addLabel={tl('添加订阅')}
      autoTitle={tl('自动刷新订阅')}
      autoTip={tl('应用运行时每 30 分钟检查更新，同一订阅源至少间隔 2 小时；关闭后仅手动刷新。仅对本机生效。')}
      emptyTitle={tl('暂无文章订阅源。')}
      deletedToast={title => tl('已删除订阅 {title}', { title })}
      renderAddModal={({ onClose, onAdded }) => <AddFeedModal onClose={onClose} onAdded={() => onAdded()} />}
    />
  );
}
