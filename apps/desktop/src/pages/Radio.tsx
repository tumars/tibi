import type { FeedCandidate, FeedItemView, FeedView, PodcastSearchResult } from '@tibi/core';
import { Bookmark, BookmarkCheck, BookmarkPlus, Captions, Check, Clock, ExternalLink, FileAudio, Headphones, Mic, Plus, RefreshCw, Search, Settings2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router';
import { Empty } from '../components/Empty';
import { Modal } from '../components/Modal';
import { ObjectMenuButton, useObjectMenu } from '../components/ObjectMenu';
import { Pager } from '../components/Pager';
import { Top } from '../components/Shell';
import { Switch } from '../components/Switch';
import { Badge, InfoTip, SettingItem } from '../components/ui';
import { copyText, openSource } from '../lib/contextActions';
import { pickFile } from '../lib/files';
import { tl } from '../lib/i18n';
import { hydrateLocalAsrConfig, useLocalAsrConfig } from '../lib/localAsr';
import { fmtClock } from '../lib/mediaSrc';
import { fmtAgo } from '../lib/util';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';

/**
 * 电台（17 §2.2）：左栏是已订阅播客节目，右栏是单集列表。
 * 单集不进书架，点「听读」按官方字幕（流式+静默缓存）或云端 ASR 导入后在听读器打开；
 * 点「加入书架」留存到书架。支持 iTunes 搜播客、粘贴 RSS / Apple Podcasts 链接及导入本地音频。
 */
type RadioFilter = 'unread' | 'all' | 'transcript' | 'saved';
const PAGE = 30;
const QUICK_QUERIES = ['BBC English', 'NPR Planet Money', 'Syntax', 'TED Talks', 'Science'];

export function Radio() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const feedId = params.get('feed') ?? undefined;
  const folder = params.get('folder') ?? undefined;
  const [filter, setFilter] = useState<RadioFilter>('unread');
  const [feeds, setFeeds] = useState<FeedView[]>([]);
  const [items, setItems] = useState<FeedItemView[]>();
  const [count, setCount] = useState(0);
  const key = `${feedId}|${folder}|${filter}`;
  const [pg, setPg] = useState({ key, n: 0 });
  const page = pg.key === key ? pg.n : 0;
  const scroller = useRef<HTMLDivElement>(null);
  const asOf = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const pending = useRef(new Map<string, { item: string; open: boolean }>());
  const hasCloudAsr = useCore(s => !!s.status?.models.asr);
  const localAsr = useLocalAsrConfig();
  useEffect(() => { void hydrateLocalAsrConfig(); }, []);
  const preferLocal = localAsr.enabled && (localAsr.preferred !== 'cloud' || !hasCloudAsr);

  const loadFeeds = useCallback(() => rpc.call('feeds.list', { kind: 'podcast' }).then(setFeeds, () => setFeeds([])), []);
  const loadItems = useCallback(async () => {
    try {
      if (!page) asOf.current = Date.now();
      const r = await rpc.call('feeds.items', {
        kind: 'podcast', feed_id: feedId, folder, filter,
        ...(page ? { cursor: String(page * PAGE), as_of: asOf.current } : {}),
        limit: PAGE,
      });
      if (r.items.length === 0 && page > 0) { setPg({ key, n: Math.max(0, Math.ceil(r.total / PAGE) - 1) }); return; }
      setItems(r.items);
      setCount(r.total ?? page * PAGE + r.items.length + (r.next_cursor ? 1 : 0));
    } catch { setItems([]); setCount(0); }
  }, [feedId, folder, filter, page, key]);

  useEffect(() => { void loadFeeds(); }, [loadFeeds]);
  useEffect(() => { void loadItems(); }, [loadItems]);

  // 首次进电台且单集为空时自动刷一次内置播客源
  const autoBooted = useRef(false);
  useEffect(() => {
    if (autoBooted.current || !feeds.length || items === undefined) return;
    if (feeds.every(f => !f.last_ok_at) && items.length === 0) {
      autoBooted.current = true;
      void refresh();
    }
  }, [feeds, items]);

  const turn = (n: number) => { setPg({ key, n }); scroller.current?.scrollTo({ top: 0 }); };
  const restart = async () => { if (page) turn(0); else await loadItems(); };

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
      if (!d.ok) return;
      setItems(cur => cur?.map(i => (i.id === p.item ? { ...i, state: p.open ? 'seen' : 'saved', document_id: d.document_id, in_library: !p.open || i.in_library } : i)));
      if (p.open && d.document_id) nav(`/read/${d.document_id}`);
    });
    return () => { off1(); off2(); };
  }, [nav]);

  const listen = async (it: FeedItemView, open: boolean) => {
    if (it.document_id && open) { nav(`/read/${it.document_id}`); return; }
    if (it.document_id) { await shelve(it); return; }
    if (busy[it.id]) return;
    try {
      setBusy(b => ({ ...b, [it.id]: open ? tl('准备听读…') : tl('正在加入书架…') }));
      const { import_id } = await rpc.call('documents.import', { source: { type: 'podcast_item', id: it.id }, shelve: !open });
      pending.current.set(import_id, { item: it.id, open });
    } catch (e) {
      setBusy(b => { const n = { ...b }; delete n[it.id]; return n; });
      toast(errorInfo(e).message, { kind: 'err' });
    }
  };

  const shelve = async (it: FeedItemView) => {
    if (!it.document_id) return;
    try {
      await rpc.call('documents.update', { id: it.document_id, patch: { shelved: true } });
      setItems(cur => cur?.map(i => (i.id === it.id ? { ...i, in_library: true } : i)));
      toast(tl('已放进书架：{title}', { title: it.title }));
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const dismiss = async (it: FeedItemView) => {
    try {
      const r = await rpc.call('feeds.mark', { ids: [it.id], state: 'dismissed' });
      setItems(cur => cur?.filter(i => i.id !== it.id));
      if (r.undo) toast(tl('不再显示这期'), { action: { label: tl('撤销'), run: () => void rpc.call('system.undo', { undo_id: r.undo!.undo_id }).then(() => loadItems(), e => toast(errorInfo(e).message, { kind: 'err' })) } });
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const importLocalAudio = async () => {
    const path = await pickFile(['mp3', 'm4a', 'wav', 'ogg', 'aac']);
    if (!path) return;
    try {
      await rpc.call('documents.import', { source: { type: 'audio', path }, shelve: true });
      toast(tl('正在导入本地音频，完成后可立即听读'));
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const menu = useObjectMenu<FeedItemView>(it => [
    { label: tl('开始听读'), enabled: !busy[it.id], run: () => void listen(it, true) },
    { label: it.in_library ? tl('在书架里') : tl('加入书架'), enabled: !it.in_library && !busy[it.id], run: () => void listen(it, false) }, null,
    { label: tl('打开原页'), run: () => void openSource(it.url) },
    ...(it.audio_url ? [{ label: tl('复制音频链接'), run: () => void copyText(it.audio_url!) }] : []),
    ...(!it.document_id && !busy[it.id] ? [null, { label: tl('不感兴趣'), run: () => void dismiss(it) }] : []),
  ], `${key}|${page}`);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await rpc.call('feeds.refresh', { ...(feedId ? { feed_ids: [feedId] } : { kind: 'podcast' }), force: true });
      await loadFeeds();
      await restart();
      if (r.failed) toast(tl('{n} 个电台没刷新成功，在管理里看原因', { n: r.failed }));
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
    setRefreshing(false);
  };

  const markAllRead = async () => {
    try {
      const r = await rpc.call('feeds.mark', { ...(feedId ? { feed_id: feedId } : { kind: 'podcast', all: true }), state: 'seen' });
      if (r.count) { toast(tl('已把 {n} 期标为已读', { n: r.count })); await loadFeeds(); await restart(); }
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const enabledFeeds = feeds.filter(f => f.enabled);
  const totalUnread = enabledFeeds.reduce((s, f) => s + f.unread, 0);
  const folders = [...new Set(enabledFeeds.map(f => f.folder).filter((x): x is string => !!x))];
  const ungrouped = enabledFeeds.filter(f => !f.folder);
  const pickFeed = (id?: string, fld?: string) => {
    const next = new URLSearchParams();
    if (id) next.set('feed', id);
    if (fld) next.set('folder', fld);
    setParams(next);
  };

  return (
    <>
      <Top crumbs={[{ label: tl('电台') }]} right={<div className="feedtop">
        <InfoTip content={tl('带官方字幕的单集可直接听读；无字幕单集可在单集内免费本地离线转写，或在「设置 → 模型」配置云端转写。')} />
        <div className="seg" role="tablist">
          {([['unread', tl('未读')], ['all', tl('全部')], ['transcript', tl('有字幕')], ['saved', tl('已保存')]] as const).map(([v, label]) => (
            <button key={v} role="tab" aria-selected={filter === v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{label}</button>
          ))}
        </div>
        <button className="btn sm" onClick={() => void importLocalAudio()} title={tl('导入本地 MP3 / M4A / WAV 音频')}><FileAudio size={14} />{tl('本地音频')}</button>
        {filter === 'unread' && (items?.length ?? 0) > 0 && <button className="btn sm" onClick={() => void markAllRead()}><Check />{tl('全部已读')}</button>}
        <button className={`ibtn${refreshing ? ' spin' : ''}`} title={refreshing ? tl('正在刷新…') : tl('刷新电台')} disabled={refreshing} onClick={() => void refresh()}><RefreshCw /></button>
      </div>} />

      <div className="feedgrid">
        <aside className="feedside" aria-label={tl('电台列表')}>
          <button className={!feedId && !folder && filter !== 'saved' ? 'cur' : ''} onClick={() => { pickFeed(); if (filter === 'saved') setFilter('unread'); }}>
            <span>{tl('全部电台')}</span>{totalUnread > 0 && <span className="n">{totalUnread > 99 ? '99+' : totalUnread}</span>}
          </button>
          <button className={filter === 'saved' && !feedId && !folder ? 'cur' : ''} onClick={() => { pickFeed(); setFilter('saved'); }}>
            <Bookmark size={14} /><span>{tl('已保存')}</span>
          </button>
          {folders.map(fld => (
            <div key={fld} className="fgroup">
              <button className={`fh${folder === fld && !feedId ? ' cur' : ''}`} onClick={() => pickFeed(undefined, fld)}>{fld}</button>
              {enabledFeeds.filter(f => f.folder === fld).map(f => <RadioFeedLink key={f.id} f={f} cur={feedId === f.id} onClick={() => pickFeed(f.id)} />)}
            </div>
          ))}
          {ungrouped.length > 0 && (
            <div className="fgroup">
              {folders.length > 0 && <span className="fh static">{tl('未分组')}</span>}
              {ungrouped.map(f => <RadioFeedLink key={f.id} f={f} cur={feedId === f.id} onClick={() => pickFeed(f.id)} />)}
            </div>
          )}
          <div className="feedacts">
            <button onClick={() => setAdding(true)}><Plus />{tl('添加电台')}</button>
            <NavLink to="/radio/manage"><Settings2 />{tl('管理电台')}</NavLink>
          </div>
        </aside>

        <div className="scroll" ref={scroller}>
          <div className="feedlist">
            {feeds.length === 0 ? (
              <Empty image="empty-library" title={tl('暂无订阅的播客电台。')} action={<button className="btn pri" onClick={() => setAdding(true)}>{tl('添加电台')}</button>} />
            ) : items === undefined ? null : items.length === 0 ? (
              <Empty
                image="empty-library"
                title={refreshing ? tl('正在拉取最新单集…') : filter === 'unread' ? tl('当前暂无未听单集。') : filter === 'transcript' ? tl('当前暂无带官方字幕的单集。') : filter === 'saved' ? tl('暂无已保存的电台单集。') : tl('当前电台暂无单集。')}
                action={filter === 'unread' ? <button className="btn" onClick={() => setFilter('all')}>{tl('查看全部')}</button> : <button className="btn" disabled={refreshing} onClick={() => void refresh()}>{tl('刷新')}</button>}
              />
            ) : (
              items.map(it => {
                const art = it.artwork_url || it.feed_artwork_url;
                return (
                  <article key={it.id} className={`feeditem epitem${it.state !== 'new' ? ' seen' : ''}`} onContextMenu={e => menu.open(it, e)}>
                    <div className="ep-row">
                      <div className="ep-art" onClick={() => void listen(it, true)}>
                        <CoverArt src={art} size={22} lazy />
                      </div>
                      <div className="ep-body">
                        <div className="fi-h">
                          <a className="fi-t" href={it.url} onClick={e => { e.preventDefault(); void listen(it, true); }}>{it.title}</a>
                          <span className="fi-src">{it.feed_title}{it.published_at ? ` · ${fmtAgo(it.published_at)}` : ''}</span>
                          <ObjectMenuButton onClick={e => menu.open(it, e)} />
                        </div>
                        {it.excerpt && <p className="fi-ex">{it.excerpt}</p>}
                        <div className="fi-f">
                          <span className="fi-meta">
                            {it.duration_ms ? <Badge icon={<Clock size={11} />}>{fmtClock(it.duration_ms)}</Badge> : null}
                            {it.has_transcript
                              ? <Badge tone="ok" icon={<Captions size={11} />} title={tl('提供官方同步逐字稿')}>{tl('官方字幕')}</Badge>
                              : <Badge tone="outline" icon={<Mic size={11} />} title={preferLocal ? tl('支持本地离线转写') : hasCloudAsr ? tl('打开时自动使用云端转写') : tl('支持纯听、离线转写或导入字幕')}>{preferLocal ? tl('本地转写') : hasCloudAsr ? tl('云端转写') : tl('可转写')}</Badge>}
                            {it.est_level && <Badge>{it.est_level}</Badge>}
                          </span>
                          <span className="sp" />
                          {busy[it.id] ? <span className="lbl">{busy[it.id]}</span> : <>
                            <button className="btn sm soft" onClick={() => void listen(it, true)}>
                              {it.document_id ? tl('继续听读') : tl('听读')}
                            </button>
                            {it.in_library ? (
                              <Badge tone="accent" icon={<BookmarkCheck size={11} />}>{tl('已入书架')}</Badge>
                            ) : (
                              <button className="btn sm" onClick={() => void listen(it, false)}>
                                <BookmarkPlus size={14} />{tl('加入书架')}
                              </button>
                            )}
                            <button className="ibtn" title={tl('打开原页')} onClick={() => void openSource(it.url)}><ExternalLink /></button>
                            {!it.document_id && <button className="ibtn" title={tl('不感兴趣')} onClick={() => void dismiss(it)}><X /></button>}
                          </>}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
            <Pager page={page} total={count} size={PAGE} onPage={turn} />
          </div>
        </div>
      </div>

      {adding && (
        <AddRadioModal
          subscribedUrls={new Set(feeds.map(f => f.url))}
          onClose={() => setAdding(false)}
          onAdded={f => { setAdding(false); void loadFeeds(); pickFeed(f.id); }}
        />
      )}
      {menu.menu}
    </>
  );
}

function CoverArt({ src, size, lazy }: { src?: string; size: number; lazy?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) return <Headphones size={size} />;
  return <img src={src} alt="" loading={lazy ? 'lazy' : undefined} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function RadioFeedLink({ f, cur, onClick }: { f: FeedView; cur: boolean; onClick: () => void }) {
  return (
    <button className={cur ? 'cur' : ''} onClick={onClick} title={f.error ? tl('上次没刷新成功：{error}', { error: f.error }) : f.url}>
      <span className="rf-art"><CoverArt src={f.artwork_url} size={12} /></span>
      <span className={`ft${f.error ? ' bad' : ''}`}>{f.title}</span>
      {f.unread > 0 && <span className="n">{f.unread > 99 ? '99+' : f.unread}</span>}
    </button>
  );
}

/** 加电台弹窗：搜播客（iTunes Search API）+ 粘贴链接（RSS / Apple Podcasts） */
function AddRadioModal({ subscribedUrls, onClose, onAdded }: { subscribedUrls: Set<string>; onClose: () => void; onAdded: (f: FeedView) => void }) {
  const [tab, setTab] = useState<'search' | 'url'>('search');
  // 搜播客状态
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PodcastSearchResult[]>();
  const [subbing, setSubbing] = useState<string>();
  // 贴链接状态
  const [url, setUrl] = useState('');
  const [found, setFound] = useState<FeedCandidate[]>();
  const [pick, setPick] = useState<string>();
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);

  const doSearch = async (term?: string) => {
    const query = (term ?? q).trim();
    if (!query) return;
    if (term !== undefined) setQ(term);
    setSearching(true);
    try {
      const r = await rpc.call('podcasts.search', { q: query, limit: 15 });
      setResults(r);
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
    setSearching(false);
  };

  const subscribeResult = async (p: PodcastSearchResult) => {
    setSubbing(p.feed_url);
    try {
      const f = await rpc.call('feeds.add', { url: p.feed_url, title: p.title, folder: p.genre || undefined, kind: 'podcast' });
      toast(tl('已订阅电台 {title}', { title: f.title }));
      onAdded(f);
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
      setSubbing(undefined);
    }
  };

  const discover = async () => {
    setBusy(true);
    try { const c = await rpc.call('feeds.discover', { url: url.trim() }); setFound(c); setPick(c[0]?.url); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
    setBusy(false);
  };

  const addByUrl = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      const f = await rpc.call('feeds.add', { url: pick, folder: folder.trim() || undefined, kind: 'podcast' });
      toast(tl('已订阅电台 {title}', { title: f.title }));
      onAdded(f);
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); setBusy(false); }
  };

  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={tl('添加电台')}
      actions={tab === 'search' ? <button className="btn" onClick={onClose}>{tl('关闭')}</button> : <>
        <button className="btn" onClick={onClose}>{tl('取消')}</button>
        {found
          ? <button className="btn pri" disabled={!pick || busy} onClick={() => void addByUrl()}>{busy ? tl('订阅中…') : tl('订阅')}</button>
          : <button className="btn pri" disabled={!url.trim() || busy} onClick={() => void discover()}>{busy ? tl('检查中…') : tl('查找电台')}</button>}
      </>}>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>{tl('搜索播客')}</button>
        <button className={tab === 'url' ? 'on' : ''} onClick={() => setTab('url')}>{tl('链接导入')}</button>
      </div>

      {tab === 'search' ? (
        <div className="podsearch">
          <div className="podsearch-bar">
            <input className="input" autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && q.trim() && !searching) void doSearch(); }} placeholder={tl('播客名称或关键词，如 BBC、Syntax')} aria-label={tl('搜索播客')} />
            <button className="btn pri sm" disabled={!q.trim() || searching} onClick={() => void doSearch()}><Search size={14} />{searching ? tl('搜索中…') : tl('搜索')}</button>
          </div>
          {!results && (
            <div className="podsearch-chips">
              <span className="lbl">{tl('推荐：')}</span>
              {QUICK_QUERIES.map(kw => <button key={kw} className="tagc" onClick={() => void doSearch(kw)}>{kw}</button>)}
            </div>
          )}
          {results && results.length === 0 && <p className="lbl" style={{ marginTop: 12 }}>{tl('未搜索到匹配播客，请更换关键词或改用链接导入。')}</p>}
          {results && results.length > 0 && (
            <div className="podresults">
              {results.map(r => {
                const already = subscribedUrls.has(r.feed_url);
                return (
                  <div key={r.feed_url} className="podres">
                    <span className="podres-art"><CoverArt src={r.artwork_url} size={18} /></span>
                    <span className="podres-info">
                      <b>{r.title}</b>
                      <span className="lbl">{[r.author, r.genre, r.episode_count ? tl('{n} 集', { n: r.episode_count }) : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                    <button className={`btn sm${already ? '' : ' pri'}`} disabled={already || subbing === r.feed_url} onClick={() => void subscribeResult(r)}>
                      {already ? tl('已订阅') : subbing === r.feed_url ? tl('订阅中…') : tl('订阅')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          <input className="input" autoFocus style={{ width: '100%' }} value={url} onChange={e => { setUrl(e.target.value); setFound(undefined); }} onKeyDown={e => { if (e.key === 'Enter' && url.trim() && !busy && !found) void discover(); }} placeholder={tl('RSS 地址、Apple Podcasts 链接或官网地址')} aria-label={tl('播客地址')} />
          {found && (
            <div className="feedcands">
              {found.length > 1 && <p className="lbl">{tl('检测到 {n} 个订阅源，请选择：', { n: found.length })}</p>}
              {found.map(c => (
                <label key={c.url} className={`cand${pick === c.url ? ' on' : ''}`}>
                  <input type="radio" name="podcand" checked={pick === c.url} onChange={() => setPick(c.url)} />
                  <span><b>{c.title}</b><span className="lbl fu">{c.url}</span>{c.latest && <span className="lbl">{tl('最新一期：{title}', { title: c.latest.title })}{c.latest.published_at ? ` · ${fmtAgo(c.latest.published_at)}` : ''}</span>}</span>
                </label>
              ))}
              <input className="input" style={{ width: '100%' }} value={folder} onChange={e => setFolder(e.target.value)} placeholder={tl('分组（选填），如 精听 / 科技')} aria-label={tl('分组')} />
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/** 电台管理页：开关、改名、分组、删除（可撤销）、查错 */
export function RadioManage() {
  const [feeds, setFeeds] = useState<FeedView[]>();
  const [auto, setAuto] = useState<boolean>();
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => rpc.call('feeds.list', { kind: 'podcast' }).then(setFeeds, () => setFeeds([])), []);
  useEffect(() => {
    void load();
    rpc.call('feeds.status', {}).then(s => setAuto(s.auto_refresh), () => undefined);
    return rpc.on('data.changed', d => { if (d.table === 'feeds') void load(); });
  }, [load]);

  const update = async (p: { id: string; title?: string; folder?: string; enabled?: boolean }) => {
    try { const f = await rpc.call('feeds.update', p); setFeeds(cur => cur?.map(x => (x.id === f.id ? f : x))); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const remove = async (f: FeedView) => {
    try {
      const r = await rpc.call('feeds.remove', { id: f.id }); await load();
      toast(tl('已删除电台 {title}', { title: f.title }), { action: { label: tl('撤销'), run: () => void rpc.call('system.undo', { undo_id: r.undo.undo_id }).then(() => load(), e => toast(errorInfo(e).message, { kind: 'err' })) } });
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const setAutoRefresh = async (v: boolean) => { try { setAuto((await rpc.call('feeds.configure', { auto_refresh: v })).auto_refresh); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };

  return (
    <>
      <Top crumbs={[{ label: tl('电台'), to: '/radio' }, { label: tl('管理') }]} right={<button className="btn sm" onClick={() => setAdding(true)}><Plus />{tl('添加电台')}</button>} />
      <div className="scroll"><div className="page feedmanage">
        {auto !== undefined && (
          <div className="group">
            <SettingItem
              title={tl('自动刷新订阅与电台')}
              tip={tl('应用运行时每 30 分钟检查新单集（同一源至少间隔 2 小时）；仅同步元数据，不自动下载音频或消耗转写额度。')}
              control={<Switch label={tl('自动刷新订阅与电台')} checked={auto} onChange={v => void setAutoRefresh(v)} />}
            />
          </div>
        )}
        {feeds?.length === 0 && <Empty image="empty-library" title={tl('暂无订阅的播客电台。')} action={<button className="btn pri" onClick={() => setAdding(true)}>{tl('添加电台')}</button>} />}
        <div className="feedrows">{feeds?.map(f => (
          <div key={f.id} className={`feedrow${f.enabled ? '' : ' off'}`}>
            <Switch label={f.title} checked={f.enabled} onChange={v => void update({ id: f.id, enabled: v })} />
            <span className="rf-art lg"><CoverArt src={f.artwork_url} size={16} /></span>
            <div className="fmain">
              <input className="input ftitle" defaultValue={f.title} aria-label={tl('名字')} onBlur={e => { const v = e.target.value.trim(); if (v && v !== f.title) void update({ id: f.id, title: v }); }} />
              <span className="lbl fu">{f.url}</span>
              <span className={`lbl${f.error ? ' bad' : ''}`}>{f.error ? tl('上次刷新失败：{error}', { error: f.error }) : f.last_ok_at ? tl('{ago}刷新过', { ago: fmtAgo(f.last_ok_at) }) : tl('尚未刷新')}</span>
            </div>
            <input className="input ffolder" defaultValue={f.folder ?? ''} placeholder={tl('分组')} aria-label={tl('分组')} onBlur={e => { if (e.target.value.trim() !== (f.folder ?? '')) void update({ id: f.id, folder: e.target.value }); }} />
            <button className="linkbtn danger" onClick={() => void remove(f)}>{tl('删除')}</button>
          </div>
        ))}</div>
      </div></div>
      {adding && <AddRadioModal subscribedUrls={new Set((feeds ?? []).map(f => f.url))} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void load(); }} />}
    </>
  );
}
