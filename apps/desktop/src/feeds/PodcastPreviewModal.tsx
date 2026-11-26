import type { FeedView, PodcastPreviewEpisode, PodcastPreviewResult } from '@tibi/core';
import { BookmarkPlus, Captions, Check, Clock, ExternalLink, Headphones, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { CoverArt } from '../components/CoverArt';
import { Modal } from '../components/Modal';
import { Badge } from '../components/ui';
import { openSource } from '../lib/contextActions';
import { tl } from '../lib/i18n';
import { fmtClock } from '../lib/mediaSrc';
import { fmtAgo } from '../lib/util';
import { errorInfo, rpc, type EventTable } from '../rpc';
import { toast } from '../store/ui';

export interface PreviewSeed {
  title?: string;
  author?: string;
  artwork_url?: string;
  summary?: string;
  folder?: string;
  meta?: string[];
}

/**
 * 播客单集预览弹窗（19 §3.1）：只读拉取最近 8 集，支持免订阅直接「听读」，也支持一键订阅。
 */
export function PodcastPreviewModal({
  url,
  initial,
  subscribed,
  onClose,
  onSubscribed,
}: {
  url: string;
  initial?: PreviewSeed;
  subscribed: boolean;
  onClose: () => void;
  onSubscribed: (f: FeedView) => void;
}) {
  const nav = useNavigate();
  const [data, setData] = useState<PodcastPreviewResult>();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>();
  const [subbing, setSubbing] = useState(false);
  const [isSub, setIsSub] = useState(subscribed);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const pending = useRef(new Map<string, { guid: string; open: boolean }>());
  const earlyDone = useRef(new Map<string, EventTable['import.done']>());
  const starting = useRef(0);

  useEffect(() => { setIsSub(subscribed); }, [subscribed]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(undefined);
    try {
      const r = await rpc.call('podcasts.preview', { url, limit: 8 });
      setData(r);
      if (r.subscribed) setIsSub(true);
    } catch (e) {
      setErr(errorInfo(e).message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { void load(); }, [load]);

  const finishImport = useCallback((p: { guid: string; open: boolean }, d: EventTable['import.done']) => {
    setBusy(b => { const n = { ...b }; delete n[p.guid]; return n; });
    if (!d.ok) return;
    if (d.document_id) {
      setData(cur => cur ? {
        ...cur,
        episodes: cur.episodes.map(e => (e.guid === p.guid ? { ...e, document_id: d.document_id, in_library: !p.open || e.in_library } : e)),
      } : cur);
      if (p.open) { onClose(); nav(`/read/${d.document_id}`); }
    }
  }, [nav, onClose]);

  useEffect(() => {
    const off1 = rpc.on('import.progress', d => {
      const p = pending.current.get(d.import_id);
      if (p) setBusy(b => ({ ...b, [p.guid]: d.label }));
    });
    const off2 = rpc.on('import.done', d => {
      const p = pending.current.get(d.import_id);
      if (p) {
        pending.current.delete(d.import_id);
        finishImport(p, d);
        return;
      }
      if (starting.current > 0) earlyDone.current.set(d.import_id, d);
    });
    return () => { off1(); off2(); };
  }, [finishImport]);

  const subscribe = async () => {
    if (isSub || subbing) return;
    setSubbing(true);
    try {
      const feedUrl = data?.feed_url || url;
      const f = await rpc.call('feeds.add', {
        url: feedUrl,
        title: data?.title || initial?.title,
        folder: initial?.folder || undefined,
        kind: 'podcast',
      });
      setIsSub(true);
      toast(tl('已订阅电台 {title}', { title: f.title }));
      onSubscribed(f);
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      setSubbing(false);
    }
  };

  const listenEpisode = async (ep: PodcastPreviewEpisode, open: boolean) => {
    if (ep.document_id && open) { onClose(); nav(`/read/${ep.document_id}`); return; }
    if (ep.document_id && !open) {
      try {
        await rpc.call('documents.update', { id: ep.document_id, patch: { shelved: true } });
        setData(cur => cur ? { ...cur, episodes: cur.episodes.map(e => (e.guid === ep.guid ? { ...e, in_library: true } : e)) } : cur);
        toast(tl('已放进书架：{title}', { title: ep.title }));
      } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
      return;
    }
    if (busy[ep.guid]) return;
    const feedUrl = data?.feed_url || url;
    starting.current++;
    setBusy(b => ({ ...b, [ep.guid]: open ? tl('准备听读…') : tl('正在加入书架…') }));
    try {
      const { import_id } = await rpc.call('documents.import', {
        source: { type: 'podcast_episode', feed_url: feedUrl, guid: ep.guid, title: ep.title },
        shelve: !open,
      });
      const entry = { guid: ep.guid, open };
      const early = earlyDone.current.get(import_id);
      if (early) {
        earlyDone.current.delete(import_id);
        finishImport(entry, early);
      } else {
        pending.current.set(import_id, entry);
      }
    } catch (e) {
      setBusy(b => { const n = { ...b }; delete n[ep.guid]; return n; });
      toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      starting.current = Math.max(0, starting.current - 1);
    }
  };

  const title = data?.title || initial?.title || tl('电台预览');
  const art = data?.artwork_url || initial?.artwork_url;
  const desc = initial?.summary || data?.description;

  return (
    <Modal
      open
      onOpenChange={o => { if (!o) onClose(); }}
      title={title}
      actions={<>
        {data?.site_url && <button className="btn" onClick={() => void openSource(data.site_url!)}><ExternalLink size={14} />{tl('节目官网')}</button>}
        <span className="sp" />
        <button className="btn" onClick={onClose}>{tl('关闭')}</button>
        <button className={`btn${isSub ? '' : ' pri'}`} disabled={isSub || subbing} onClick={() => void subscribe()}>
          {isSub ? <><Check size={14} />{tl('已订阅')}</> : subbing ? tl('订阅中…') : <><Plus size={14} />{tl('订阅电台')}</>}
        </button>
      </>}
    >
      <div className="pprev">
        <div className="pprev-head">
          <span className="pprev-art"><CoverArt src={art} size={24} /></span>
          <div className="pprev-meta">
            {initial?.author && <span className="lbl">{initial.author}</span>}
            {initial?.meta && initial.meta.length > 0 && (
              <div className="pprev-tags">
                {initial.meta.map(m => <Badge key={m}>{m}</Badge>)}
              </div>
            )}
            {desc && <p className="pprev-desc">{desc}</p>}
          </div>
        </div>

        <div className="pprev-subhead">
          <span>{tl('最近单集')}</span>
          <span className="lbl">{tl('不订阅也可直接点「听读」试听单集')}</span>
        </div>

        {loading && <div className="pprev-state lbl">{tl('正在加载单集预览…')}</div>}
        {err && !loading && (
          <div className="pprev-state">
            <span className="lbl bad">{err}</span>
            <button className="btn sm" onClick={() => void load()}>{tl('重试')}</button>
          </div>
        )}
        {!loading && !err && data && (
          <div className="pprev-list">
            {data.episodes.map(ep => (
              <div key={ep.guid} className="pprev-ep">
                <div className="pprev-ep-main">
                  <div className="pprev-ep-t">{ep.title}</div>
                  {ep.excerpt && <p className="pprev-ep-ex">{ep.excerpt}</p>}
                  <div className="pprev-ep-meta">
                    {ep.published_at && <span>{fmtAgo(ep.published_at)}</span>}
                    {ep.duration_ms && <Badge icon={<Clock size={11} />}>{fmtClock(ep.duration_ms)}</Badge>}
                    {ep.has_transcript && <Badge tone="ok" icon={<Captions size={11} />}>{tl('官方字幕')}</Badge>}
                    {ep.est_level && <Badge>{ep.est_level}</Badge>}
                  </div>
                </div>
                <div className="pprev-ep-acts">
                  {busy[ep.guid] ? (
                    <span className="lbl">{busy[ep.guid]}</span>
                  ) : (
                    <>
                      <button className="btn sm soft" onClick={() => void listenEpisode(ep, true)}>
                        <Headphones size={13} />{ep.document_id ? tl('继续听读') : tl('听读')}
                      </button>
                      {!ep.in_library && (
                        <button className="ibtn" title={tl('加入书架')} onClick={() => void listenEpisode(ep, false)}>
                          <BookmarkPlus size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
