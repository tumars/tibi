import type { DocumentSummary } from '@tibi/core';
import { Camera, FileText, Images, Link2, Plus, Search, Share, Tag, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { pickFile } from '../lib/files';
import { tl } from '../lib/i18n';
import { useTagEditor } from '../lib/useTagEditor';
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
  const [editing, setEditing] = useState<DocumentSummary>();
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
        {docs && !docs.length ? <Empty image={q ? undefined : 'empty-library'} title={q ? tl('没有找到') : tl('书架是空的')} text={q ? undefined : tl('点右上角的 + 导入一篇，或者在 Safari 里分享给 Tibi。')} />
          : <div className="card">{docs?.map(d => <div key={d.id} className="doc" role="button" tabIndex={0} onClick={() => nav(`/read/${d.id}`)} onKeyDown={e => { if (e.key === 'Enter') nav(`/read/${d.id}`); }}>
            <span className="b"><span className="t">{d.title}</span>
              <span className="m">{d.kind === 'book' ? tl('书') : GENRE_NAMES[d.genre] ?? d.genre}<span>·</span>{fmtMinutes(d.minutes)}<span>·</span><span className={`lv${d.difficulty === 'hard' ? ' hard' : ''}`}>{tl('生词率 {p}', { p: fmtPct(d.unknown_ratio) })}</span></span>
              {d.tags.length > 0 && <span className="tgs">{d.tags.join(' · ')}</span>}
              {d.progress > 0 && <span className="bar"><i style={{ width: fmtPct(d.progress) }} /></span>}</span>
            <button className="doctag" aria-label={tl('编辑标签')} onClick={e => { e.stopPropagation(); setEditing(d); }} onKeyDown={e => e.stopPropagation()}><Tag size={18} /></button>
          </div>)}</div>}
      </div>
      <ImportSheet open={imp} onClose={() => setImp(false)} />
      <Sheet open={!!editing} onClose={() => setEditing(undefined)} className="tagsheet">
        {editing && <TagForm key={editing.id} d={editing} onClose={() => setEditing(undefined)} />}
      </Sheet>
    </div>
  );
}

function TagForm({ d, onClose }: { d: DocumentSummary; onClose: () => void }) {
  const ed = useTagEditor(d, onClose);
  return <>
    <h2>{tl('编辑标签')}</h2>
    <div className="tagdoc">{d.title}</div>
    {ed.tags.length > 0 && <div className="taglist">{ed.tags.map(t => <button key={t} className="chip on" aria-label={tl('去掉标签 {t}', { t })} onClick={() => ed.remove(t)}>{t}<X /></button>)}</div>}
    <input className="field" value={ed.input} onChange={e => ed.setInput(e.target.value)} onKeyDown={ed.onKeyDown} placeholder={tl('输入标签，按回车添加')} aria-label={tl('添加标签')} enterKeyHint="done" />
    {ed.suggestions.length > 0 && <div className="taglist">{ed.suggestions.map(t => <button key={t} className="chip" onClick={() => ed.add(t)}>{t}</button>)}</div>}
    <button className="btn pri full" style={{ marginTop: 14 }} disabled={ed.busy} onClick={() => void ed.save()}>{tl('保存')}</button>
  </>;
}

/** 导入面板（J3）：粘贴网址或文字、从"文件"选、拍书页；下面提示从 Safari 分享 */
export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const go = async (source: Parameters<typeof rpc.call<'documents.import'>>[1]['source']) => {
    try { await rpc.call('documents.import', { source }); toast(tl('正在导入，好了会放进书架')); setText(''); onClose(); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const fromText = () => { const t = text.trim(); if (!t) return; void go(classifyInput(t) === 'url' ? { type: 'url', url: t } : { type: 'text', text: t }); };
  const fromFile = async (kinds: string[]) => { const p = await pickFile(kinds); if (p) void go({ type: 'file', path: p }); };
  // 拍书页（capture：iOS、Android 都直接开相机）/ 从相册选（可以一次选几页，按选的顺序合成一篇）；只在手机上（Core 在 WebView 里）
  const camera = useRef<HTMLInputElement>(null); const photos = useRef<HTMLInputElement>(null);
  const fromPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!(window as { __TIBI_LOCAL_CORE__?: boolean }).__TIBI_LOCAL_CORE__) { toast(tl('浏览器开发模式不能选文件，请在桌面端里操作')); return; }
    const { registerMemFile } = await import('./local/files');
    const paths = await Promise.all([...files].map(registerMemFile));
    for (const r of [camera, photos]) if (r.current) r.current.value = '';
    void go({ type: 'images', paths });
  };
  return (
    <Sheet open={open} onClose={onClose} className="imp">
      <h2>{tl('导入')}</h2>
      <textarea className="field" value={text} onChange={e => setText(e.target.value)} placeholder={tl('粘贴网址或一段英文')} />
      <button className="btn pri full" style={{ marginTop: 10 }} disabled={!text.trim()} onClick={fromText}><Link2 size={18} />{tl('导入')}</button>
      <div style={{ marginTop: 8 }}>
        <button className="opt" onClick={() => void fromFile(['epub', 'pdf', 'docx', 'txt'])}><span className="ic"><FileText size={18} /></span>{tl('从"文件"选（EPUB、PDF、Word）')}</button>
        <button className="opt" onClick={() => camera.current?.click()}><span className="ic"><Camera size={18} /></span>{tl('拍书页（识别文字）')}</button>
        <button className="opt" onClick={() => photos.current?.click()}><span className="ic"><Images size={18} /></span>{tl('从相册选书页照片（可多页）')}</button>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => void fromPhotos(e.target.files)} />
        <input ref={photos} type="file" accept="image/*" multiple hidden onChange={e => void fromPhotos(e.target.files)} />
      </div>
      <div className="tip"><Share size={18} />{tl('在 Safari 里点分享，选 Tibi，也能把网页放进书架。')}</div>
    </Sheet>
  );
}
