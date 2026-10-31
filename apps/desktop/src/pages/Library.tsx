import type { DocumentSummary, Kind } from '@tibi/core';
import { LayoutGrid, List } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Empty } from '../components/Empty';
import { Samples } from '../components/Samples';
import { Top } from '../components/Shell';
import { fmtAgo, fmtMinutes, fmtPct, GENRE_NAMES } from '../lib/util';
import { rpc } from '../rpc';

export function DocCard({ d, onOpen }: { d: DocumentSummary; onOpen: () => void }) {
  return (
    <div className="doc" onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
      <div className="m"><span>{d.kind === 'book' ? '书 · ' : ''}{GENRE_NAMES[d.genre] ?? d.genre}</span><span>·</span><span>{d.progress >= 1 ? '读完了' : d.progress > 0 ? `读到 ${fmtPct(d.progress)}` : fmtMinutes(d.minutes)}</span></div>
      <div className="t">{d.title}</div>
      {d.excerpt && <div className="ex">{d.excerpt}</div>}
      <div className="f">
        <span className={`lv ${d.difficulty}`}>{d.difficulty === 'hard' ? '偏难' : d.difficulty === 'mid' ? '适中' : '轻松'} · 生词率 {fmtPct(d.unknown_ratio)}</span>
        {d.tags.slice(0, 2).map(t => <span key={t} className="tagc">{t}</span>)}
      </div>
    </div>
  );
}

export function Library() {
  const nav = useNavigate();
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [tag, setTag] = useState<string>();
  const [sort, setSort] = useState<'fit' | 'opened' | 'added' | 'progress' | 'minutes'>('opened');
  const [grid, setGrid] = useState(true);
  const [items, setItems] = useState<DocumentSummary[]>();
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try { const r = await rpc.call('documents.list', { kind: kind === 'all' ? undefined : kind, tags: tag ? [tag] : undefined, sort, q: q || undefined, limit: 200 }); setItems(r.items); } catch { setItems([]); }
  }, [kind, tag, sort, q]);
  useEffect(() => { void load(); return rpc.on('data.changed', d => { if (d.table === 'documents') void load(); }); }, [load]);

  const tags = [...new Set((items ?? []).flatMap(d => d.tags))];
  const counts = { article: (items ?? []).filter(d => d.kind === 'article').length, book: (items ?? []).filter(d => d.kind === 'book').length };

  return (
    <>
      <Top crumbs={[{ label: '书架' }]} right={<>
        <input className="input" placeholder="筛选" value={q} onChange={e => setQ(e.target.value)} style={{ width: 180 }} />
        <select className="input" value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="排序">
          <option value="fit">最适合我</option><option value="opened">最近打开</option><option value="added">最近导入</option><option value="progress">按进度</option><option value="minutes">按时长</option>
        </select>
        <button className="ibtn" title={grid ? '列表' : '网格'} onClick={() => setGrid(!grid)}>{grid ? <List /> : <LayoutGrid />}</button>
      </>} />
      <div className="scroll"><div className="page">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <div className="seg">
            {([['all', '全部'], ['article', `文章 ${counts.article}`], ['book', `书 ${counts.book}`]] as const).map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
          </div>
          {tags.map(t => <button key={t} className={`chip${tag === t ? ' on' : ''}`} style={tag === t ? { background: 'var(--accent-wash)', color: 'var(--accent)', boxShadow: 'none' } : undefined} onClick={() => setTag(tag === t ? undefined : t)}>{t}</button>)}
          {tag && <button className="linkbtn" onClick={() => setTag(undefined)}>清除</button>}
        </div>
        {items === undefined ? null : items.length === 0 ? <Empty title="书架还是空的" text="在首页粘贴网址或一段英文就能导入，也可以先读一篇示例。" action={<Samples />} />
          : grid ? <div className="docs" style={{ marginTop: 16 }}>{items.map(d => <DocCard key={d.id} d={d} onOpen={() => nav(`/read/${d.id}`)} />)}</div>
          : <div className="doclist" style={{ marginTop: 12 }}>
            <div className="row h"><span>标题</span><span>类型 · 标签</span><span>时长</span><span>难度 · 生词率</span><span>最近打开</span></div>
            {items.map(d => <div key={d.id} className="row" onClick={() => nav(`/read/${d.id}`)}>
              <span className="t">{d.title}</span>
              <span className="lbl">{GENRE_NAMES[d.genre] ?? d.genre}{d.tags.length ? ` · ${d.tags.join(' ')}` : ''}</span>
              <span className="lbl">{fmtMinutes(d.minutes)}</span>
              <span className={`lv ${d.difficulty}`} style={{ fontSize: 12.5 }}>{fmtPct(d.unknown_ratio)}</span>
              <span className="lbl">{d.progress >= 1 ? '读完了' : fmtAgo(d.opened_at)}</span>
            </div>)}
          </div>}
      </div></div>
    </>
  );
}
