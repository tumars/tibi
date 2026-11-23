import type { SectionContent, Sentence, Status } from '@tibi/core';
import { Fragment, memo } from 'react';
import { resolveImageSrc, useImageSrcReady } from '../lib/imageSrc';
import { wordClass } from '../lib/util';
import { MoreHorizontal } from 'lucide-react';
import { tl } from '../lib/i18n';

export type Mode = 'all' | 'new' | 'clean';

/** 按 blocks 渲染一节：代码块原样、图片按地址显示、句子按 token 着色（01 §2 的 tokens 偏移） */
export const SectionView = memo(function SectionView({ content, mode, gloss, overrides, selected, translations, onWord, onSentenceMenu }: {
  content: SectionContent; mode: Mode; gloss: boolean; overrides: Map<string, Status>; selected?: { sentence: string; s: number };
  translations: boolean;
  onWord: (ev: React.MouseEvent<HTMLSpanElement>, word: string, lemma: string, sentence: Sentence, s: number) => void;
  onSentenceMenu?: (sentence: Sentence, element: HTMLElement) => void;
}) {
  useImageSrcReady();   // 导入的书里的插图：应用数据目录取到后再渲染一次
  const byId = new Map(content.sentences.map(s => [s.id, s]));
  // 行内代码：分词时已排除（00 §3.1），这里把 `…` 渲染成 <code>
  const gap = (text: string, key: number) => {
    if (!text.includes('`')) return text;
    return text.split(/(`[^`]+`)/).map((x, i) => /^`[^`]+`$/.test(x) ? <code key={`${key}-${i}`}>{x.slice(1, -1)}</code> : x);
  };
  const renderSentence = (sent: Sentence) => {
    const parts: React.ReactNode[] = []; let pos = 0;
    for (const t of sent.tokens) {
      if (t.s > pos) parts.push(gap(sent.text.slice(pos, t.s), pos));
      const st = overrides.get(t.l) ?? t.status;
      const sel = selected && selected.sentence === sent.id && selected.s === t.s;
      parts.push(<span key={t.s} className={wordClass(st) + (sel ? ' sel' : '')} data-token-start={t.s} tabIndex={onSentenceMenu ? -1 : undefined} data-g={gloss && st !== undefined && st <= 4 ? t.gloss : undefined} onClick={e => { if (e.ctrlKey || window.getSelection()?.isCollapsed === false) return; onWord(e, t.t, t.l, sent, t.s); }}>{sent.text.slice(t.s, t.e)}</span>);
      pos = t.e;
    }
    if (pos < sent.text.length) parts.push(gap(sent.text.slice(pos), pos));
    return <Fragment key={sent.id}><span data-sid={sent.id} className={onSentenceMenu ? 'reader-sentence' : undefined} tabIndex={onSentenceMenu ? -1 : undefined}>{parts}{onSentenceMenu && <button className="sentence-menu" tabIndex={-1} aria-label={tl('句子操作')} title={tl('句子操作')} onMouseDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); onSentenceMenu(sent, e.currentTarget.closest<HTMLElement>('[data-sid]')!); }}><MoreHorizontal size={14} /></button>}</span>{' '}</Fragment>;
  };
  // 相邻的列表项收进同一个 <ul>，项目符号和缩进才对得齐
  const out: React.ReactNode[] = []; let items: React.ReactNode[] = [];
  const flush = (key: number) => { if (items.length) { out.push(<ul key={`ul-${key}`}>{items}</ul>); items = []; } };
  content.blocks.forEach((b, i) => {
    const bt = b.type !== 'sentences' ? b.type : b.block_type ?? byId.get(b.ids[0]!)?.block_type ?? 'prose';
    if (bt !== 'list_item') flush(i);
    if (b.type === 'code') { out.push(<pre key={i} data-lang={b.lang}>{b.code}</pre>); return; }
    if (b.type === 'image') {
      const src = resolveImageSrc(b.src);
      if (src) out.push(<figure key={i} className="fig"><img src={src} alt={b.alt} loading="lazy" onError={e => { (e.currentTarget.parentElement as HTMLElement).hidden = true; }} />{b.alt && <figcaption>{b.alt}</figcaption>}</figure>);
      return;
    }
    const sents = b.ids.map(id => byId.get(id)).filter((s): s is Sentence => !!s);
    const kids = sents.map(renderSentence);
    const tr = translations ? sents.map(s => s.translation).filter(Boolean).join(' ') : '';
    const trEl = tr ? <div className="tr">{tr}</div> : null;
    if (bt === 'list_item') items.push(<li key={i}>{kids}{trEl}</li>);
    else if (bt === 'heading') out.push(<div key={i} className="rdblock heading"><h2>{kids}</h2>{trEl}</div>);
    else if (bt === 'quote') out.push(<div key={i} className="rdblock"><blockquote className="quote">{kids}</blockquote>{trEl}</div>);
    else out.push(<div key={i} className="rdblock"><p data-para={b.paragraph_idx}>{kids}</p>{trEl}</div>);
  });
  flush(content.blocks.length);
  return <div data-reader-body className={`rd${gloss ? ' gloss' : ''}${mode === 'new' ? ' mode-new' : mode === 'clean' ? ' mode-clean' : ''}`} tabIndex={onSentenceMenu ? 0 : undefined} aria-label={onSentenceMenu ? tl('阅读正文') : undefined}
    onKeyDown={onSentenceMenu ? e => {
      if ((e.target as Element).closest('button')) return;
      const sentences = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-sid]'));
      const sentence = (e.target as Element).closest<HTMLElement>('[data-sid]');
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); const i = sentence ? sentences.indexOf(sentence) : -1;
        sentences[e.key === 'Home' ? 0 : e.key === 'End' ? sentences.length - 1 : Math.max(0, Math.min(sentences.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      } else if (sentence && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); const words = Array.from(sentence.querySelectorAll<HTMLElement>('[data-token-start]')); const i = words.indexOf(e.target as HTMLElement);
        if (i === 0 && e.key === 'ArrowLeft') sentence.focus(); else words[Math.max(0, Math.min(words.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))]?.focus();
      } else if (sentence && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault(); const el = e.target as HTMLElement; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left, clientY: r.bottom }));
      }
    } : undefined}>{out}</div>;
});
