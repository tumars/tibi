import type {
  CatalogPodcast, FeedView, PodcastChartCountry, PodcastChartGenre,
  PodcastChartItem, PodcastSearchResult, RadioAccent, RadioCatalogResult, RadioSceneId,
} from '@tibi/core';
import { Captions, Check, Clock, Eye, Plus, RefreshCw, Search, Sparkles, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CoverArt } from '../components/CoverArt';
import { Empty } from '../components/Empty';
import { Badge } from '../components/ui';
import { lang, tl } from '../lib/i18n';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import { PodcastPreviewModal, type PreviewSeed } from './PodcastPreviewModal';

type DiscoverTab = 'curated' | 'charts';
type LevelFilter = 'all' | 'basic' | 'B2' | 'C1';

const SCENE_TABS: { id: 'all' | RadioSceneId; label: () => string }[] = [
  { id: 'all', label: () => tl('全部') },
  { id: 'intensive', label: () => tl('精听') },
  { id: 'spoken', label: () => tl('地道口语') },
  { id: 'tech', label: () => tl('科技与 AI') },
  { id: 'news_biz', label: () => tl('新闻与商业') },
  { id: 'science_story', label: () => tl('科普与故事') },
];

const SCENE_FOLDER: Record<RadioSceneId, () => string> = {
  intensive: () => tl('精听'),
  spoken: () => tl('口语'),
  tech: () => tl('科技'),
  news_biz: () => tl('新闻与商业'),
  science_story: () => tl('科普与故事'),
};

const CHART_TABS: { id: PodcastChartGenre; label: () => string }[] = [
  { id: 'language', label: () => tl('英语学习') },
  { id: 'tech', label: () => tl('科技') },
  { id: 'science', label: () => tl('科学') },
  { id: 'business', label: () => tl('商业') },
  { id: 'news', label: () => tl('新闻') },
  { id: 'history', label: () => tl('历史') },
];

function accentLabel(a: RadioAccent): string {
  switch (a) {
    case 'US': return tl('美音');
    case 'UK': return tl('英音');
    case 'AU': return tl('澳音');
    default: return tl('多口音');
  }
}

/** Onboarding 兴趣 → 优先前置的精选场景（19 §3.2） */
function preferredScenesOf(interests: string[]): Set<RadioSceneId> {
  const s = new Set<RadioSceneId>();
  for (const i of interests) {
    if (i === 'tech') s.add('tech');
    else if (i === 'news') s.add('news_biz');
    else if (i === 'academic') s.add('science_story');
    else if (i === 'lit' || i === 'blog') { s.add('spoken'); s.add('science_story'); }
  }
  return s;
}

function normFeedUrl(u: string): string {
  try {
    const parsed = new URL(u.trim());
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.href.replace(/\/+$/, '');
  } catch {
    return u.trim().replace(/\/+$/, '');
  }
}

/**
 * 发现电台广场（19 §2.3 & §3）：
 * 顶栏全网搜索 + 「英语精选」（内置+COS 静态目录，联动兴趣排序）+ 「热门榜单」（Apple 分类实时榜）+ 单集预览试听。
 */
export function RadioDiscoverView({
  subscribedUrls,
  onSubscribed,
  onOpenImport,
}: {
  subscribedUrls: Set<string>;
  onSubscribed: (f: FeedView) => void;
  onOpenImport: () => void;
}) {
  const [justSubbed, setJustSubbed] = useState<Set<string>>(() => new Set());
  const normSubs = useMemo(() => {
    const s = new Set<string>();
    for (const u of subscribedUrls) s.add(normFeedUrl(u));
    for (const u of justSubbed) s.add(normFeedUrl(u));
    return s;
  }, [subscribedUrls, justSubbed]);
  const isSubscribed = useCallback((url: string) => normSubs.has(normFeedUrl(url)), [normSubs]);
  const [tab, setTab] = useState<DiscoverTab>('curated');
  // 全网搜索
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PodcastSearchResult[]>();
  const searchSeq = useRef(0);
  // 精选目录
  const [catalog, setCatalog] = useState<RadioCatalogResult>();
  const [catLoading, setCatLoading] = useState(true);
  const [scene, setScene] = useState<'all' | RadioSceneId>('all');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [onlyTranscript, setOnlyTranscript] = useState(false);
  const [interests, setInterests] = useState<string[]>([]);
  // Apple 热门榜单
  const [chartGenre, setChartGenre] = useState<PodcastChartGenre>('language');
  const [chartCountry, setChartCountry] = useState<PodcastChartCountry>('us');
  const [charts, setCharts] = useState<PodcastChartItem[]>();
  const [chartLoading, setChartLoading] = useState(false);
  const [chartErr, setChartErr] = useState<string>();
  const chartSeq = useRef(0);
  // 订阅与预览状态
  const [subbing, setSubbing] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ url: string; seed?: PreviewSeed }>();

  const loadCatalog = useCallback(async (force = false) => {
    setCatLoading(true);
    try {
      const r = await rpc.call('podcasts.catalog', force ? { force: true } : {});
      setCatalog(r);
      if (force) toast(r.source === 'remote' ? tl('已刷新精选目录') : tl('精选目录已是最新'));
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      setCatLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog(false);
    rpc.call('profile.get', {}).then(p => setInterests(p.interests ?? []), () => undefined);
  }, [loadCatalog]);

  const loadCharts = useCallback(async (genre: PodcastChartGenre, country: PodcastChartCountry, force = false) => {
    const seq = ++chartSeq.current;
    setChartLoading(true);
    setChartErr(undefined);
    try {
      const r = await rpc.call('podcasts.charts', { genre, country, limit: 20, ...(force ? { force: true } : {}) });
      if (seq === chartSeq.current) setCharts(r);
    } catch (e) {
      if (seq === chartSeq.current) setChartErr(errorInfo(e).message);
    } finally {
      if (seq === chartSeq.current) setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'charts') void loadCharts(chartGenre, chartCountry, false);
  }, [tab, chartGenre, chartCountry, loadCharts]);

  const doSearch = async (term?: string) => {
    const query = (term ?? q).trim();
    if (!query) { setSearchResults(undefined); return; }
    if (term !== undefined) setQ(term);
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const r = await rpc.call('podcasts.search', { q: query, limit: 20 });
      if (seq === searchSeq.current) setSearchResults(r);
    } catch (e) {
      if (seq === searchSeq.current) toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const clearSearch = () => {
    searchSeq.current++;
    setQ('');
    setSearchResults(undefined);
    setSearching(false);
  };

  const subscribe = async (p: { feed_url: string; title: string; folder?: string }) => {
    if (isSubscribed(p.feed_url) || subbing[p.feed_url]) return;
    setSubbing(s => ({ ...s, [p.feed_url]: true }));
    try {
      const f = await rpc.call('feeds.add', { url: p.feed_url, title: p.title, folder: p.folder || undefined, kind: 'podcast' });
      setJustSubbed(s => new Set(s).add(p.feed_url).add(f.url));
      toast(tl('已订阅电台 {title}', { title: f.title }));
      onSubscribed(f);
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      setSubbing(s => { const n = { ...s }; delete n[p.feed_url]; return n; });
    }
  };

  const preferredScenes = useMemo(() => preferredScenesOf(interests), [interests]);

  const filteredCatalog = useMemo(() => {
    const list = catalog?.podcasts ?? [];
    const matched = list.filter(p => {
      if (scene !== 'all' && p.scene !== scene) return false;
      if (level === 'basic' && p.level !== 'A2' && p.level !== 'B1') return false;
      if (level === 'B2' && p.level !== 'B2') return false;
      if (level === 'C1' && p.level !== 'C1') return false;
      if (onlyTranscript && !p.has_transcript) return false;
      return true;
    });
    if (scene !== 'all' || preferredScenes.size === 0) return matched;
    // 默认「全部」视图按 Onboarding 兴趣将匹配场景排在前面，不隐藏其余节目
    return [...matched].sort((a, b) => {
      const pa = preferredScenes.has(a.scene) ? 0 : 1;
      const pb = preferredScenes.has(b.scene) ? 0 : 1;
      return pa - pb;
    });
  }, [catalog, scene, level, onlyTranscript, preferredScenes]);

  const openCatalogPreview = (p: CatalogPodcast) => setPreview({
    url: p.feed_url,
    seed: {
      title: p.title,
      author: p.author,
      artwork_url: p.artwork_url,
      summary: lang === 'en' ? p.summary_en : p.summary_zh,
      folder: SCENE_FOLDER[p.scene](),
      meta: [p.level, accentLabel(p.accent), tl('约 {n} 分钟', { n: p.avg_minutes }), ...(p.has_transcript ? [tl('官方字幕')] : [])],
    },
  });

  const openSearchPreview = (p: PodcastSearchResult & { summary?: string }) => setPreview({
    url: p.feed_url,
    seed: {
      title: p.title,
      author: p.author,
      artwork_url: p.artwork_url,
      summary: p.summary,
      folder: p.genre,
      meta: [p.genre, p.episode_count ? tl('{n} 集', { n: p.episode_count }) : ''].filter((x): x is string => !!x),
    },
  });

  return (
    <div className="rdisc">
      <div className="rdisc-top">
        <div className="rdisc-search">
          <Search size={15} className="rdisc-si" />
          <input
            className="input"
            value={q}
            onChange={e => { setQ(e.target.value); if (!e.target.value.trim()) setSearchResults(undefined); }}
            onKeyDown={e => { if (e.key === 'Enter' && q.trim() && !searching) void doSearch(); }}
            placeholder={tl('搜索全球播客名称或关键词，如 BBC、AI、History')}
            aria-label={tl('搜索全球播客')}
          />
          {q && <button className="ibtn rdisc-clr" title={tl('清除搜索')} onClick={clearSearch}><X size={14} /></button>}
          <button className="btn pri sm" disabled={!q.trim() || searching} onClick={() => void doSearch()}>
            {searching ? tl('搜索中…') : tl('搜索')}
          </button>
        </div>
        <button className="btn sm" onClick={onOpenImport}>
          <Upload size={14} />{tl('链接 / OPML')}
        </button>
      </div>

      {searchResults !== undefined ? (
        <div className="rdisc-section">
          <div className="rdisc-bar">
            <span className="lbl">{tl('「{q}」的搜索结果（{n}）', { q: q.trim(), n: searchResults.length })}</span>
            <button className="linkbtn" onClick={clearSearch}>{tl('返回发现广场')}</button>
          </div>
          {searchResults.length === 0 ? (
            <Empty
              image="empty-library"
              title={tl('未搜索到匹配播客，请更换关键词或改用链接导入。')}
              action={<button className="btn" onClick={onOpenImport}>{tl('链接导入')}</button>}
            />
          ) : (
            <div className="rdisc-grid">
              {searchResults.map(r => {
                const already = isSubscribed(r.feed_url);
                const busy = !!subbing[r.feed_url];
                return (
                  <article key={r.feed_url} className="rdisc-card" onClick={() => openSearchPreview(r)}>
                    <div className="rdisc-ch">
                      <span className="rdisc-art"><CoverArt src={r.artwork_url} size={22} lazy /></span>
                      <div className="rdisc-info">
                        <b className="rdisc-t">{r.title}</b>
                        <span className="lbl rdisc-au">{[r.author, r.genre, r.episode_count ? tl('{n} 集', { n: r.episode_count }) : ''].filter(Boolean).join(' · ')}</span>
                      </div>
                    </div>
                    <div className="rdisc-cf" onClick={e => e.stopPropagation()}>
                      <button className="btn sm" onClick={() => openSearchPreview(r)}><Eye size={13} />{tl('预览')}</button>
                      <button className={`btn sm${already ? '' : ' pri'}`} disabled={already || busy} onClick={() => void subscribe({ feed_url: r.feed_url, title: r.title, folder: r.genre })}>
                        {already ? <><Check size={13} />{tl('已订阅')}</> : busy ? tl('订阅中…') : <><Plus size={13} />{tl('订阅')}</>}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="rdisc-tabs">
            <div className="seg" role="tablist">
              <button role="tab" aria-selected={tab === 'curated'} className={tab === 'curated' ? 'on' : ''} onClick={() => setTab('curated')}>
                {tl('英语精选')}
              </button>
              <button role="tab" aria-selected={tab === 'charts'} className={tab === 'charts' ? 'on' : ''} onClick={() => setTab('charts')}>
                {tl('热门榜单')}
              </button>
            </div>
            <span className="sp" />
            {tab === 'curated' ? (
              <div className="rdisc-meta">
                {preferredScenes.size > 0 && scene === 'all' && (
                  <span className="lbl rdisc-hint"><Sparkles size={12} />{tl('已按你的兴趣优先排序')}</span>
                )}
                <button className={`ibtn${catLoading ? ' spin' : ''}`} title={tl('刷新精选目录')} disabled={catLoading} onClick={() => void loadCatalog(true)}>
                  <RefreshCw size={14} />
                </button>
              </div>
            ) : (
              <div className="rdisc-meta">
                <div className="seg" role="tablist" aria-label={tl('榜单地区')}>
                  <button role="tab" aria-selected={chartCountry === 'us'} className={chartCountry === 'us' ? 'on' : ''} onClick={() => setChartCountry('us')}>{tl('美区')}</button>
                  <button role="tab" aria-selected={chartCountry === 'gb'} className={chartCountry === 'gb' ? 'on' : ''} onClick={() => setChartCountry('gb')}>{tl('英区')}</button>
                </div>
                <button className={`ibtn${chartLoading ? ' spin' : ''}`} title={tl('刷新榜单')} disabled={chartLoading} onClick={() => void loadCharts(chartGenre, chartCountry, true)}>
                  <RefreshCw size={14} />
                </button>
              </div>
            )}
          </div>

          {tab === 'curated' ? (
            <div className="rdisc-section">
              <div className="rdisc-filters">
                <div className="rdisc-pills">
                  {SCENE_TABS.map(s => (
                    <button key={s.id} className={`tagc${scene === s.id ? ' on' : ''}`} onClick={() => setScene(s.id)}>
                      {s.label()}
                    </button>
                  ))}
                </div>
                <div className="rdisc-subfilters">
                  {([
                    ['all', tl('全部难度')],
                    ['basic', tl('入门 A2–B1')],
                    ['B2', tl('进阶 B2')],
                    ['C1', tl('挑战 C1')],
                  ] as const).map(([v, label]) => (
                    <button key={v} className={`rdisc-chip${level === v ? ' on' : ''}`} onClick={() => setLevel(v)}>
                      {label}
                    </button>
                  ))}
                  <button className={`rdisc-chip${onlyTranscript ? ' on' : ''}`} onClick={() => setOnlyTranscript(v => !v)}>
                    <Captions size={12} />{tl('官方字幕')}
                  </button>
                </div>
              </div>

              {filteredCatalog.length === 0 && !catLoading ? (
                <Empty
                  image="empty-library"
                  title={tl('当前筛选条件下没有匹配的电台。')}
                  action={<button className="btn" onClick={() => { setScene('all'); setLevel('all'); setOnlyTranscript(false); }}>{tl('重置筛选')}</button>}
                />
              ) : (
                <div className="rdisc-grid">
                  {filteredCatalog.map(p => {
                    const already = isSubscribed(p.feed_url);
                    const busy = !!subbing[p.feed_url];
                    return (
                      <article key={p.id} className="rdisc-card" onClick={() => openCatalogPreview(p)}>
                        <div className="rdisc-ch">
                          <span className="rdisc-art"><CoverArt src={p.artwork_url} size={22} lazy /></span>
                          <div className="rdisc-info">
                            <b className="rdisc-t">{p.title}</b>
                            <span className="lbl rdisc-au">{p.author}</span>
                            <div className="rdisc-badges">
                              <Badge>{p.level}</Badge>
                              <Badge>{accentLabel(p.accent)}</Badge>
                              <Badge icon={<Clock size={10} />}>{tl('{n} 分钟', { n: p.avg_minutes })}</Badge>
                              {p.has_transcript && <Badge tone="ok" icon={<Captions size={10} />}>{tl('官方字幕')}</Badge>}
                            </div>
                          </div>
                        </div>
                        <p className="rdisc-desc">{lang === 'en' ? p.summary_en : p.summary_zh}</p>
                        <div className="rdisc-cf" onClick={e => e.stopPropagation()}>
                          <button className="btn sm" onClick={() => openCatalogPreview(p)}><Eye size={13} />{tl('预览单集')}</button>
                          <button
                            className={`btn sm${already ? '' : ' pri'}`}
                            disabled={already || busy}
                            onClick={() => void subscribe({ feed_url: p.feed_url, title: p.title, folder: SCENE_FOLDER[p.scene]() })}
                          >
                            {already ? <><Check size={13} />{tl('已订阅')}</> : busy ? tl('订阅中…') : <><Plus size={13} />{tl('订阅')}</>}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="rdisc-section">
              <div className="rdisc-pills">
                {CHART_TABS.map(c => (
                  <button key={c.id} className={`tagc${chartGenre === c.id ? ' on' : ''}`} onClick={() => setChartGenre(c.id)}>
                    {c.label()}
                  </button>
                ))}
              </div>
              {chartLoading && !charts ? (
                <div className="rdisc-loading lbl">{tl('正在加载热门榜单…')}</div>
              ) : chartErr ? (
                <Empty
                  image="error-generic"
                  title={chartErr}
                  action={<button className="btn" onClick={() => void loadCharts(chartGenre, chartCountry, true)}>{tl('重试')}</button>}
                />
              ) : charts && charts.length === 0 ? (
                <Empty image="empty-library" title={tl('当前分类暂无榜单数据。')} />
              ) : (
                <div className="rdisc-grid">
                  {(charts ?? []).map((item: PodcastChartItem) => {
                    const already = isSubscribed(item.feed_url);
                    const busy = !!subbing[item.feed_url];
                    return (
                      <article key={item.feed_url} className="rdisc-card" onClick={() => openSearchPreview(item)}>
                        <div className="rdisc-ch">
                          <span className="rdisc-rank">{item.rank}</span>
                          <span className="rdisc-art"><CoverArt src={item.artwork_url} size={22} lazy /></span>
                          <div className="rdisc-info">
                            <b className="rdisc-t">{item.title}</b>
                            <span className="lbl rdisc-au">{[item.author, item.episode_count ? tl('{n} 集', { n: item.episode_count }) : ''].filter(Boolean).join(' · ')}</span>
                          </div>
                        </div>
                        {item.summary && <p className="rdisc-desc">{item.summary}</p>}
                        <div className="rdisc-cf" onClick={e => e.stopPropagation()}>
                          <button className="btn sm" onClick={() => openSearchPreview(item)}><Eye size={13} />{tl('预览单集')}</button>
                          <button
                            className={`btn sm${already ? '' : ' pri'}`}
                            disabled={already || busy}
                            onClick={() => void subscribe({ feed_url: item.feed_url, title: item.title, folder: item.genre })}
                          >
                            {already ? <><Check size={13} />{tl('已订阅')}</> : busy ? tl('订阅中…') : <><Plus size={13} />{tl('订阅')}</>}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {preview && (
        <PodcastPreviewModal
          url={preview.url}
          initial={preview.seed}
          subscribed={isSubscribed(preview.url)}
          onClose={() => setPreview(undefined)}
          onSubscribed={f => {
            setJustSubbed(s => new Set(s).add(preview.url).add(f.url));
            onSubscribed(f);
          }}
        />
      )}
    </div>
  );
}
