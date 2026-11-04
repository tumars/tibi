import type { DocumentSummary, Kind } from '@tibi/core';
import { LayoutGrid, List, Tag, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Empty } from '../components/Empty';
import { Modal } from '../components/Modal';
import { Pager } from '../components/Pager';
import { Samples } from '../components/Samples';
import { Top } from '../components/Shell';
import { useTagEditor } from '../lib/useTagEditor';
import { docSource, fmtAgo, fmtMinutes, fmtPct, GENRE_NAMES } from '../lib/util';
import { rpc } from '../rpc';
import { tl } from '../lib/i18n';

/** 卡片和列表行右上角的按钮：悬停或键盘聚焦时出现，点它不打开文章 */
function TagButton({ onClick }: { onClick: () => void }) {
  return <button className="ibtn doctag" aria-label={tl('编辑标签')} title={tl('编辑标签')} onClick={e => { e.stopPropagation(); onClick(); }} onKeyDown={e => e.stopPropagation()}><Tag /></button>;
}

function TagModal({ d, onClose }: { d: DocumentSummary; onClose: () => void }) {
  const ed = useTagEditor(d, onClose);
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={tl('编辑标签')}
      actions={<><button className="btn" onClick={onClose}>{tl('取消')}</button><button className="btn pri" disabled={ed.busy} onClick={() => void ed.save()}>{tl('保存')}</button></>}>
      <p className="tagdoc">{d.title}</p>
      <div className="tagbox">
        {ed.tags.map(t => <span key={t} className="tagc">{t}<button aria-label={tl('去掉标签 {t}', { t })} onClick={() => ed.remove(t)}><X /></button></span>)}
        <input autoFocus value={ed.input} onChange={e => ed.setInput(e.target.value)} onKeyDown={ed.onKeyDown} placeholder={ed.tags.length ? tl('再加一个') : tl('输入标签，按回车添加')} aria-label={tl('添加标签')} />
      </div>
      {ed.suggestions.length > 0 && <div className="tagsug">{ed.suggestions.map(t => <button key={t} className="tagc sys" onClick={() => ed.add(t)}>{t}</button>)}</div>}
    </Modal>
  );
}

export function DocCard({ d, onOpen, onTags }: { d: DocumentSummary; onOpen: () => void; onTags?: () => void }) {
  return (
    <div className="doc" onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
      {onTags && <TagButton onClick={onTags} />}
      <div className="m"><span>{d.kind === 'book' ? tl('书 · ') : ''}{GENRE_NAMES[d.genre] ?? d.genre}</span><span>·</span><span>{d.progress >= 1 ? tl('读完了') : d.progress > 0 ? tl('读到 {v0}', { v0: fmtPct(d.progress) }) : fmtMinutes(d.minutes)}</span>{docSource(d) && <><span>·</span><span className="src" title={docSource(d)}>{docSource(d)}</span></>}</div>
      <div className="t">{d.title}</div>
      {d.excerpt && <div className="ex">{d.excerpt}</div>}
      <div className="f">
        {d.level && <span className="lv" title={tl('按词频估的文本级别')}>{tl('难度约 {level}', { level: d.level })}</span>}
        {d.tags.slice(0, 2).map(t => <span key={t} className="tagc">{t}</span>)}
        {d.tags.length > 2 && <span className="tagc sys" title={d.tags.slice(2).join(' ')}>+{d.tags.length - 2}</span>}
      </div>
    </div>
  );
}

const PAGE = 48;   // 网格两三四列都能排满

export function Library() {
  const nav = useNavigate();
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [tag, setTag] = useState<string>();
  const [sort, setSort] = useState<'fit' | 'opened' | 'added' | 'progress' | 'minutes'>('opened');
  const [grid, setGrid] = useState(true);
  const [items, setItems] = useState<DocumentSummary[]>();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<DocumentSummary>();
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<DocumentSummary[]>([]);   // 只按筛选词，给类型计数和标签用，不跟着翻页变
  const scroller = useRef<HTMLDivElement>(null);

  // 换筛选回到第一页
  const filt = <T,>(set: (v: T) => void, v: T) => { set(v); setPage(0); };
  const load = useCallback(async () => {
    try {
      const r = await rpc.call('documents.list', { kind: kind === 'all' ? undefined : kind, tags: tag ? [tag] : undefined, sort, q: q || undefined, cursor: page ? String(page * PAGE) : undefined, limit: PAGE });
      // 最后一页删空了就往前翻
      if (r.items.length === 0 && page > 0) { setPage(Math.max(0, Math.ceil(r.total / PAGE) - 1)); return; }
      setItems(r.items); setTotal(r.total);
    } catch { setItems([]); setTotal(0); }
  }, [kind, tag, sort, q, page]);
  const loadFacets = useCallback(() => rpc.call('documents.list', { q: q || undefined, limit: 500 }).then(r => setFacets(r.items), () => setFacets([])), [q]);
  useEffect(() => { void load(); return rpc.on('data.changed', d => { if (d.table === 'documents') void load(); }); }, [load]);
  useEffect(() => { void loadFacets(); return rpc.on('data.changed', d => { if (d.table === 'documents') void loadFacets(); }); }, [loadFacets]);
  const turn = (p: number) => { setPage(p); scroller.current?.scrollTo({ top: 0 }); };

  const tags = [...new Set(facets.filter(d => kind === 'all' || d.kind === kind).flatMap(d => d.tags))];
  const counts = { article: facets.filter(d => d.kind === 'article').length, book: facets.filter(d => d.kind === 'book').length };

  return (
    <>
      <Top crumbs={[{ label: tl('书架') }]} right={<>
        <input className="input" placeholder={tl('筛选')} value={q} onChange={e => filt(setQ, e.target.value)} style={{ width: 180 }} />
        <select className="input" value={sort} onChange={e => filt(setSort, e.target.value as typeof sort)} aria-label={tl('排序')}>
          <option value="fit">{tl('在读的在前')}</option><option value="opened">{tl('最近打开')}</option><option value="added">{tl('最近导入')}</option><option value="progress">{tl('按进度')}</option><option value="minutes">{tl('按时长')}</option>
        </select>
        <button className="ibtn" title={grid ? tl('列表') : tl('网格')} onClick={() => setGrid(!grid)}>{grid ? <List /> : <LayoutGrid />}</button>
      </>} />
      <div className="scroll" ref={scroller}><div className="page">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <div className="seg">
            {([['all', tl('全部')], ['article', tl('文章 {article}', { article: counts.article })], ['book', tl('书 {book}', { book: counts.book })]] as const).map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => filt(setKind, k)}>{l}</button>)}
          </div>
          {tags.map(t => <button key={t} className={`chip${tag === t ? ' on' : ''}`} style={tag === t ? { background: 'var(--accent-wash)', color: 'var(--accent)', boxShadow: 'none' } : undefined} onClick={() => filt(setTag, tag === t ? undefined : t)}>{t}</button>)}
          {tag && <button className="linkbtn" onClick={() => filt(setTag, undefined)}>{tl('清除')}</button>}
        </div>
        {items === undefined ? null : items.length === 0 ? <Empty image="empty-library" title={tl('书架还是空的')} text={tl('在首页粘贴网址或一段英文就能导入，也可以先读一篇示例。')} action={<Samples />} />
          : grid ? <div className="docs" style={{ marginTop: 16 }}>{items.map(d => <DocCard key={d.id} d={d} onOpen={() => nav(`/read/${d.id}`)} onTags={() => setEditing(d)} />)}</div>
          : <div className="doclist" style={{ marginTop: 12 }}>
            <div className="row h"><span>{tl('标题')}</span><span>{tl('类型 · 标签')}</span><span>{tl('时长')}</span><span>{tl('级别')}</span><span>{tl('最近打开')}</span></div>
            {items.map(d => <div key={d.id} className="row" onClick={() => nav(`/read/${d.id}`)}>
              <span className="t">{d.title}</span>
              <span className="lbl">{GENRE_NAMES[d.genre] ?? d.genre}{d.tags.length ? ` · ${d.tags.join(' ')}` : ''}</span>
              <span className="lbl">{fmtMinutes(d.minutes)}</span>
              <span className="lv" style={{ fontSize: 12.5 }}>{d.level ?? '—'}</span>
              <span className="lbl">{d.progress >= 1 ? tl('读完了') : fmtAgo(d.opened_at)}</span>
              <TagButton onClick={() => setEditing(d)} />
            </div>)}
          </div>}
        {items && <Pager page={page} size={PAGE} total={total} onPage={turn} />}
      </div></div>
      {editing && <TagModal key={editing.id} d={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
