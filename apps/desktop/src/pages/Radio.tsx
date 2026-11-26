import type { FeedCandidate, FeedItemView, FeedView } from '@tibi/core';
import { Bookmark, BookmarkCheck, BookmarkPlus, Captions, Check, Clock, Compass, ExternalLink, FileAudio, Mic, Plus, RefreshCw, Settings2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { NavLink, useSearchParams } from 'react-router';
import { CoverArt } from '../components/CoverArt';
import { Empty } from '../components/Empty';
import { Modal } from '../components/Modal';
import { ObjectMenuButton, useObjectMenu } from '../components/ObjectMenu';
import { Pager } from '../components/Pager';
import { Top } from '../components/Shell';
import { Badge, InfoTip } from '../components/ui';
import { FeedManageView } from '../feeds/FeedManageView';
import { pickOpmlXml, runImportOpml } from '../feeds/opmlActions';
import { RadioDiscoverView } from '../feeds/RadioDiscoverView';
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
 * 电台（17 §2.2、19 §2.3）：左栏为全部电台 / 已保存 / 发现电台及已订阅节目，右栏为单集列表或发现广场。
 * 单集不进书架，点「听读」按官方字幕（流式+静默缓存）、本地离线转写或云端 ASR 打开；
 * 支持精选目录、Apple 分类榜单、全网搜索、单集预览试听、链接导入、OPML 导入与本地音频导入。
 */
type RadioFilter = 'unread' | 'all' | 'transcript' | 'saved';
const PAGE = 30;
const BANNER_DISMISS_KEY = 'tibi.radio.discoverBannerDismissed';

function readBannerDismissed(): boolean {
  try { return localStorage.getItem(BANNER_DISMISS_KEY) === '1'; } catch { return false; }
}

export function Radio() {
  const [params, setParams] = useSearchParams();
  const discovering = params.get('view') === 'discover';
  const [filter, setFilter] = useState<RadioFilter>('unread');
  const [importing, setImporting] = useState(false);
  const [bannerClosed, setBannerClosed] = useState(readBannerDismissed);
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

  const openDiscover = () => {
    const next = new URLSearchParams();
    next.set('view', 'discover');
    setParams(next);
  };

  const dismissBanner = () => {
    setBannerClosed(true);
    try { localStorage.setItem(BANNER_DISMISS_KEY, '1'); } catch { /* */ }
  };

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
  const subscribedUrls = new Set(feeds.filter(f => f.enabled).map(f => f.url));
  const showColdBanner = !discovering && !feedId && !folder && filter !== 'saved' && !bannerClosed && enabledFeeds.length > 0 && enabledFeeds.length <= 2;

  return (
    <>
      <Top
        crumbs={discovering ? [{ label: tl('电台'), to: '/radio' }, { label: tl('发现电台') }] : [{ label: tl('电台') }]}
        right={discovering ? (
          <div className="feedtop">
            <button className="btn sm" onClick={() => void importLocalAudio()} title={tl('导入本地 MP3 / M4A / WAV 音频')}><FileAudio size={14} />{tl('本地音频')}</button>
            <button className="btn sm" onClick={() => setImporting(true)}><Upload size={14} />{tl('链接导入')}</button>
          </div>
        ) : (
          <div className="feedtop">
            <InfoTip content={tl('带官方字幕的单集可直接听读；无字幕单集可在单集内免费本地离线转写，或在「设置 → 模型」配置云端转写。')} />
            <div className="seg" role="tablist">
              {([['unread', tl('未读')], ['all', tl('全部')], ['transcript', tl('有字幕')], ['saved', tl('已保存')]] as const).map(([v, label]) => (
                <button key={v} role="tab" aria-selected={filter === v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{label}</button>
              ))}
            </div>
            <button className="btn sm" onClick={() => void importLocalAudio()} title={tl('导入本地 MP3 / M4A / WAV 音频')}><FileAudio size={14} />{tl('本地音频')}</button>
            {filter === 'unread' && (items?.length ?? 0) > 0 && <button className="btn sm" onClick={() => void markAllRead()}><Check />{tl('全部已读')}</button>}
            <button className={`ibtn${refreshing ? ' spin' : ''}`} title={refreshing ? tl('正在刷新…') : tl('刷新电台')} disabled={refreshing} onClick={() => void refresh()}><RefreshCw /></button>
          </div>
        )}
      />

      <div className="feedgrid">
        <aside className="feedside" aria-label={tl('电台列表')}>
          <button className={!discovering && !feedId && !folder && filter !== 'saved' ? 'cur' : ''} onClick={() => { pickFeed(); if (filter === 'saved') setFilter('unread'); }}>
            <span>{tl('全部电台')}</span>{totalUnread > 0 && <span className="n">{totalUnread > 99 ? '99+' : totalUnread}</span>}
          </button>
          <button className={!discovering && filter === 'saved' && !feedId && !folder ? 'cur' : ''} onClick={() => { pickFeed(); setFilter('saved'); }}>
            <Bookmark size={14} /><span>{tl('已保存')}</span>
          </button>
          <button className={discovering ? 'cur' : ''} onClick={openDiscover}>
            <Compass size={14} /><span>{tl('发现电台')}</span>
          </button>
          {folders.map(fld => (
            <div key={fld} className="fgroup">
              <button className={`fh${!discovering && folder === fld && !feedId ? ' cur' : ''}`} onClick={() => pickFeed(undefined, fld)}>{fld}</button>
              {enabledFeeds.filter(f => f.folder === fld).map(f => <RadioFeedLink key={f.id} f={f} cur={!discovering && feedId === f.id} onClick={() => pickFeed(f.id)} />)}
            </div>
          ))}
          {ungrouped.length > 0 && (
            <div className="fgroup">
              {folders.length > 0 && <span className="fh static">{tl('未分组')}</span>}
              {ungrouped.map(f => <RadioFeedLink key={f.id} f={f} cur={!discovering && feedId === f.id} onClick={() => pickFeed(f.id)} />)}
            </div>
          )}
          <div className="feedacts">
            <button onClick={() => setImporting(true)}><Plus />{tl('链接 / OPML 导入')}</button>
            <NavLink to="/radio/manage"><Settings2 />{tl('管理电台')}</NavLink>
          </div>
        </aside>

        <div className="scroll" ref={scroller}>
          {discovering ? (
            <RadioDiscoverView
              subscribedUrls={subscribedUrls}
              onSubscribed={() => { void loadFeeds(); }}
              onOpenImport={() => setImporting(true)}
            />
          ) : (
            <div className="feedlist">
              {showColdBanner && (
                <div className="rdisc-banner">
                  <Compass size={16} className="rdisc-bi" />
                  <span className="rdisc-bt">{tl('想听更多适合学英语的电台？去「发现电台」按难度、口音和题材直接挑选。')}</span>
                  <button className="btn sm soft" onClick={openDiscover}>{tl('逛发现广场')}</button>
                  <button className="ibtn" title={tl('关闭提示')} onClick={dismissBanner}><X size={14} /></button>
                </div>
              )}

              {feeds.length === 0 ? (
                <Empty
                  image="empty-library"
                  title={tl('暂无订阅的播客电台。')}
                  action={<button className="btn pri" onClick={openDiscover}>{tl('去发现电台')}</button>}
                />
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
          )}
        </div>
      </div>

      {importing && (
        <ImportRadioModal
          onClose={() => setImporting(false)}
          onAdded={f => { setImporting(false); void loadFeeds(); if (f) pickFeed(f.id); }}
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

/** 链接与 OPML 导入弹窗：支持 RSS / Apple Podcasts 链接与 OPML 文件导入 */
function ImportRadioModal({ onClose, onAdded }: { onClose: () => void; onAdded: (f?: FeedView) => void }) {
  const [tab, setTab] = useState<'url' | 'opml'>('url');
  const [url, setUrl] = useState('');
  const [found, setFound] = useState<FeedCandidate[]>();
  const [pick, setPick] = useState<string>();
  const [folder, setFolder] = useState('');
  const [opmlXml, setOpmlXml] = useState('');
  const [busy, setBusy] = useState(false);

  const discover = async () => {
    setBusy(true);
    try {
      const c = await rpc.call('feeds.discover', { url: url.trim() });
      setFound(c); setPick(c[0]?.url);
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      setBusy(false);
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

  const pickAndImportOpml = async () => {
    const xml = await pickOpmlXml();
    if (!xml) return;
    setBusy(true);
    try {
      const ok = await runImportOpml(xml, 'podcast', folder);
      if (ok) onAdded(undefined);
    } finally {
      setBusy(false);
    }
  };

  const importPastedOpml = async () => {
    if (!opmlXml.trim()) return;
    setBusy(true);
    try {
      const ok = await runImportOpml(opmlXml, 'podcast', folder);
      if (ok) onAdded(undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={tl('链接 / OPML 导入')}
      actions={tab === 'url' ? <>
        <button className="btn" onClick={onClose}>{tl('取消')}</button>
        {found
          ? <button className="btn pri" disabled={!pick || busy} onClick={() => void addByUrl()}>{busy ? tl('订阅中…') : tl('订阅')}</button>
          : <button className="btn pri" disabled={!url.trim() || busy} onClick={() => void discover()}>{busy ? tl('检查中…') : tl('查找电台')}</button>}
      </> : <>
        <button className="btn" onClick={onClose}>{tl('关闭')}</button>
        <button className="btn pri" disabled={!opmlXml.trim() || busy} onClick={() => void importPastedOpml()}>
          {busy ? tl('导入中…') : tl('导入粘贴的 OPML')}
        </button>
      </>}>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === 'url' ? 'on' : ''} onClick={() => setTab('url')}>{tl('链接导入')}</button>
        <button className={tab === 'opml' ? 'on' : ''} onClick={() => setTab('opml')}>{tl('导入 OPML')}</button>
      </div>

      {tab === 'url' ? (
        <>
          <input className="input" autoFocus style={{ width: '100%' }} value={url} onChange={e => { setBusy(false); setUrl(e.target.value); setFound(undefined); }} onKeyDown={e => { if (e.key === 'Enter' && url.trim() && !busy && !found) void discover(); }} placeholder={tl('RSS 地址、Apple Podcasts 链接或官网地址')} aria-label={tl('播客地址')} />
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
      ) : (
        <div className="opml-box">
          <p className="lbl">{tl('支持从 Apple Podcasts、Pocket Casts、AntennaPod 等客户端导出的 OPML 文件批量迁移（单次最多 100 个）。')}</p>
          <button className="btn" disabled={busy} onClick={() => void pickAndImportOpml()}>
            <Upload size={14} />{busy ? tl('正在导入…') : tl('选择 .opml / .xml 文件')}
          </button>
          <textarea
            className="input opml-ta"
            rows={5}
            value={opmlXml}
            onChange={e => setOpmlXml(e.target.value)}
            placeholder={tl('或者直接粘贴 OPML XML 内容…')}
            aria-label={tl('OPML 内容')}
          />
        </div>
      )}
    </Modal>
  );
}

/** 电台管理页：开关、改名、分组、删除（可撤销）、查错、OPML 导入导出 */
export function RadioManage() {
  return (
    <FeedManageView
      kind="podcast"
      crumbLabel={tl('电台')}
      crumbTo="/radio"
      addLabel={tl('链接 / OPML 导入')}
      autoTitle={tl('自动刷新订阅与电台')}
      autoTip={tl('应用运行时每 30 分钟检查新单集（同一源至少间隔 2 小时）；仅同步元数据，不自动下载音频或消耗转写额度。')}
      emptyTitle={tl('暂无订阅的播客电台。')}
      deletedToast={title => tl('已删除电台 {title}', { title })}
      renderArt={f => <span className="rf-art lg"><CoverArt src={f.artwork_url} size={16} /></span>}
      renderAddModal={({ onClose, onAdded }) => (
        <ImportRadioModal onClose={onClose} onAdded={() => onAdded()} />
      )}
    />
  );
}
