import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { tl } from '../lib/i18n';
import { isImeKey } from '../lib/util';

/**
 * 阅读页内查找（⌘F / Ctrl+F）：在这一章的正文里找词句，↵ 下一个、⇧↵ 上一个、Esc 关闭。
 * 高亮走 CSS Custom Highlight API，不改正文 DOM；不支持的 WebView 只滚到所在句子。
 * 一个单词被拆成多个 token span，所以把整章文本拼起来再找，命中再映射回各个文本节点。
 */
const supported = typeof CSS !== 'undefined' && 'highlights' in CSS;

function findRanges(root: HTMLElement, q: string): Range[] {
  const nodes: { n: Text; at: number }[] = []; let text = ''; let block: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    // 只找正文：句子、代码块、译文；标题栏、工具栏、读完卡片里的字不算
    if (!n.parentElement?.closest('[data-sid], pre, .tr')) continue;
    // 段落之间垫一个换行，免得上一段结尾和下一段开头连成一个命中
    const b = n.parentElement?.closest('p, li, h2, blockquote, pre, .tr') ?? null;
    if (b !== block) { text += '\n'; block = b; }
    nodes.push({ n, at: text.length }); text += n.data;
  }
  const hay = text.toLowerCase(); const needle = q.toLowerCase(); const out: Range[] = [];
  let i = 0, k = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) {
    const end = i + needle.length;
    while (k < nodes.length - 1 && nodes[k + 1]!.at <= i) k++;
    let j = k; while (j < nodes.length - 1 && nodes[j + 1]!.at < end) j++;
    const r = document.createRange();
    r.setStart(nodes[k]!.n, i - nodes[k]!.at); r.setEnd(nodes[j]!.n, end - nodes[j]!.at);
    out.push(r); i = end;
  }
  return out;
}

export function FindBar({ root, deps, onClose }: { root: HTMLElement | null; deps: unknown[]; onClose: () => void }) {
  const [q, setQ] = useState(() => { const s = window.getSelection()?.toString().trim() ?? ''; return s.length <= 80 && !s.includes('\n') ? s : ''; });
  const [ranges, setRanges] = useState<Range[]>([]);
  const [cur, setCur] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.select(); }, []);
  // 再按一次 ⌘F：回到输入框并全选，和浏览器一样
  useEffect(() => { const on = () => input.current?.select(); window.addEventListener('tibi:find', on); return () => window.removeEventListener('tibi:find', on); }, []);

  // 词变了、章节或译文变了（正文重渲染）就重新找
  useEffect(() => {
    const t = q.trim();
    setRanges(root && t ? findRanges(root, t) : []); setCur(0);
  }, [q, root, ...deps]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const r = ranges[cur];
    if (supported) {
      CSS.highlights.set('reader-find', new Highlight(...ranges));
      if (r) CSS.highlights.set('reader-find-cur', new Highlight(r)); else CSS.highlights.delete('reader-find-cur');
    }
    if (!r) return;
    const el = r.startContainer.parentElement;
    const box = r.getBoundingClientRect(); const sc = el?.closest('.scroll'); const view = sc?.getBoundingClientRect();
    // 已经在视野里就不动，免得一边打字一边跳
    if (view && box.top > view.top + 60 && box.bottom < view.bottom - 80) return;
    el?.scrollIntoView({ block: 'center' });
    if (!supported) { const s = el?.closest('[data-sid]'); s?.classList.add('flash'); setTimeout(() => s?.classList.remove('flash'), 1600); }
  }, [ranges, cur]);
  useEffect(() => () => { if (supported) { CSS.highlights.delete('reader-find'); CSS.highlights.delete('reader-find-cur'); } }, []);

  const step = (d: 1 | -1) => { if (ranges.length) setCur(c => (c + d + ranges.length) % ranges.length); };

  return (
    <div className="rdfind" role="search">
      <Search size={14} />
      <input ref={input} value={q} placeholder={tl('在这一章里查找')} aria-label={tl('在这一章里查找')} onChange={e => setQ(e.target.value)} onKeyDown={e => {
        if (isImeKey(e.nativeEvent)) return;
        if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g')) { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      }} />
      <span className="n">{q.trim() ? ranges.length ? `${cur + 1}/${ranges.length}` : tl('无结果') : ''}</span>
      <button className="ibtn" title={tl('上一个')} disabled={!ranges.length} onClick={() => step(-1)}><ChevronUp /></button>
      <button className="ibtn" title={tl('下一个')} disabled={!ranges.length} onClick={() => step(1)}><ChevronDown /></button>
      <button className="ibtn" title={tl('关闭')} onClick={onClose}><X /></button>
    </div>
  );
}
