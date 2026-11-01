import type { DocumentSummary } from '@tibi/core';
import { Camera, FileText, Link2, Plus, Search, Share } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { pickFile } from '../lib/files';
import { tl } from '../lib/i18n';
import { classifyInput, fmtMinutes, fmtPct, GENRE_NAMES } from '../lib/util';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import { Empty, Sheet } from './ui';

/** 书架（00 §3.13）：搜索 + 导入同一行；全部 / 文章 / 书；列表 */
export function Library() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'article' | 'book'>('all');
  const [docs, setDocs] = useState<DocumentSummary[]>();
  const [imp, setImp] = useState(false);
  useEffect(() => {
    const load = () => rpc.call('documents.list', { kind: kind === 'all' ? undefined : kind, q: q || undefined, sort: 'opened', limit: 200 }).then(r => setDocs(r.items), () => setDocs([]));
    void load(); return rpc.on('data.changed', d => { if (d.table === 'documents') void load(); });
  }, [q, kind]);
  return (
    <div className="screen" id="s-lib">
      <div className="top libbar">
        <label className="lsearch"><Search /><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={tl('搜索标题和标签')} /></label>
        <button className="ib" aria-label={tl('导入')} onClick={() => setImp(true)}><Plus size={20} /></button>
      </div>
      <div className="pad">
        <div className="seg" style={{ marginBottom: 12 }}>{([['all', tl('全部')], ['article', tl('文章')], ['book', tl('书')]] as const).map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>
        {docs && !docs.length ? <Empty title={q ? tl('没有找到') : tl('书架是空的')} text={q ? undefined : tl('点右上角的 + 导入一篇，或者在 Safari 里分享给 Tibi。')} />
          : <div className="card">{docs?.map(d => <button key={d.id} className="doc" onClick={() => nav(`/read/${d.id}`)}>
            <span className="b"><span className="t">{d.title}</span>
              <span className="m">{d.kind === 'book' ? tl('书') : GENRE_NAMES[d.genre] ?? d.genre}<span>·</span>{fmtMinutes(d.minutes)}<span>·</span><span className={`lv${d.difficulty === 'hard' ? ' hard' : ''}`}>{tl('生词率 {p}', { p: fmtPct(d.unknown_ratio) })}</span></span>
              {d.progress > 0 && <span className="bar"><i style={{ width: fmtPct(d.progress) }} /></span>}</span>
            <span className="chev">›</span>
          </button>)}</div>}
      </div>
      <ImportSheet open={imp} onClose={() => setImp(false)} />
    </div>
  );
}

/** 导入面板（J3）：粘贴网址或文字、从"文件"选、拍书页；下面提示从 Safari 分享 */
export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const go = async (source: Parameters<typeof rpc.call<'documents.import'>>[1]['source']) => {
    try { await rpc.call('documents.import', { source }); toast(tl('正在导入，好了会放进书架')); setText(''); onClose(); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const fromText = () => { const t = text.trim(); if (!t) return; void go(classifyInput(t) === 'url' ? { type: 'url', url: t } : { type: 'text', text: t }); };
  const fromFile = async (kinds: string[]) => { const p = await pickFile(kinds); if (p) void go(kinds.includes('image') ? { type: 'images', paths: [p] } : { type: 'file', path: p }); };
  return (
    <Sheet open={open} onClose={onClose} className="imp">
      <h2>{tl('导入')}</h2>
      <textarea className="field" value={text} onChange={e => setText(e.target.value)} placeholder={tl('粘贴网址或一段英文')} />
      <button className="btn pri full" style={{ marginTop: 10 }} disabled={!text.trim()} onClick={fromText}><Link2 size={18} />{tl('导入')}</button>
      <div style={{ marginTop: 8 }}>
        <button className="opt" onClick={() => void fromFile(['epub', 'pdf', 'docx', 'txt'])}><span className="ic"><FileText size={18} /></span>{tl('从"文件"选（EPUB、PDF、Word）')}</button>
        <button className="opt" onClick={() => void fromFile(['image'])}><span className="ic"><Camera size={18} /></span>{tl('书页照片（识别文字）')}</button>
      </div>
      <div className="tip"><Share size={18} />{tl('在 Safari 里点分享，选 Tibi，也能把网页放进书架。')}</div>
    </Sheet>
  );
}
