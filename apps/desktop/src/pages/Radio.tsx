import type { FeedCandidate, FeedItemView, FeedView, PodcastSearchResult } from '@tibi/core';
import { Bookmark, BookmarkCheck, BookmarkPlus, Captions, Check, Clock, ExternalLink, FileAudio, Mic, Plus, RefreshCw, Search, Settings2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router';
import { CoverArt } from '../components/CoverArt';
import { Empty } from '../components/Empty';
import { Modal } from '../components/Modal';
import { ObjectMenuButton, useObjectMenu } from '../components/ObjectMenu';
import { Pager } from '../components/Pager';
import { Top } from '../components/Shell';
import { Badge, InfoTip } from '../components/ui';
import { FeedManageView } from '../feeds/FeedManageView';
import { useFeedBrowser } from '../feeds/useFeedBrowser';
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
  const [filter, setFilter] = useState<RadioFilter>('unread');
  const [adding, setAdding] = useState(false);
  const refreshFailToast = useCallback((n: number) => tl('{n} 个电台没刷新成功，在管理里看原因', { n }), []);
  const {
    feedId, folder, feeds, items, count, loadError, key, page, scroller, refreshing, busy,
    loadFeeds, loadItems, turn, restart, refresh, openOrImport, dismiss, pickFeed,
  } = useFeedBrowser({
    kind: 'podcast',
    filter,
    pageSize: PAGE,
    autoBoot: true,
    dismissToast: tl('不再显示这期'),
    refreshFailToast,
  });

  const hasCloudAsr = useCore(s => !!s.status?.models.asr);
  const localAsr = useLocalAsrConfig();
  useEffect(() => { void hydrateLocalAsrConfig(); }, []);
  const preferLocal = localAsr.enabled && (localAsr.preferred !== 'cloud' || !hasCloudAsr);

  const listen = (it: FeedItemView, open: boolean) =>
    openOrImport(it, open, { type: 'podcast_item', id: it.id }, open ? tl('准备听读…') : tl('正在加入书架…'));

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
              loadError ? (
                <Empty image="error-generic" title={loadError} action={<button className="btn" onClick={() => void loadItems()}>{tl('重试')}</button>} />
              ) : (
                <Empty
                  image="empty-library"
                  title={refreshing ? tl('正在拉取最新单集…') : filter === 'unread' ? tl('当前暂无未听单集。') : filter === 'transcript' ? tl('当前暂无带官方字幕的单集。') : filter === 'saved' ? tl('暂无已保存的电台单集。') : tl('当前电台暂无单集。')}
                  action={filter === 'unread' ? <button className="btn" onClick={() => setFilter('all')}>{tl('查看全部')}</button> : <button className="btn" disabled={refreshing} onClick={() => void refresh()}>{tl('刷新')}</button>}
                />
              )
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
  const searchSeq = useRef(0);
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
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const r = await rpc.call('podcasts.search', { q: query, limit: 15 });
      if (seq === searchSeq.current) setResults(r);
    } catch (e) {
      if (seq === searchSeq.current) toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
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
          <input className="input" autoFocus style={{ width: '100%' }} value={url} onChange={e => { discoverSeq.current++; setBusy(false); setUrl(e.target.value); setFound(undefined); }} onKeyDown={e => { if (e.key === 'Enter' && url.trim() && !busy && !found) void discover(); }} placeholder={tl('RSS 地址、Apple Podcasts 链接或官网地址')} aria-label={tl('播客地址')} />
          {found && (
            <div className="feedcands">
              {found.length === 0 && <p className="lbl">{tl('没有找到')}</p>}
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
  return (
    <FeedManageView
      kind="podcast"
      crumbLabel={tl('电台')}
      crumbTo="/radio"
      addLabel={tl('添加电台')}
      autoTitle={tl('自动刷新订阅与电台')}
      autoTip={tl('应用运行时每 30 分钟检查新单集（同一源至少间隔 2 小时）；仅同步元数据，不自动下载音频或消耗转写额度。')}
      emptyTitle={tl('暂无订阅的播客电台。')}
      deletedToast={title => tl('已删除电台 {title}', { title })}
      renderArt={f => <span className="rf-art lg"><CoverArt src={f.artwork_url} size={16} /></span>}
      renderAddModal={({ feeds, onClose, onAdded }) => (
        <AddRadioModal subscribedUrls={new Set(feeds.map(f => f.url))} onClose={onClose} onAdded={() => onAdded()} />
      )}
    />
  );
}
