import type { SectionContent, Sentence, Status } from '@tibi/core';
import { Fragment, memo } from 'react';
import { wordClass } from '../lib/util';

export type Mode = 'all' | 'new' | 'clean';

/** 按 blocks 渲染一节：代码块原样、句子按 token 着色（01 §2 的 tokens 偏移） */
export const SectionView = memo(function SectionView({ content, mode, gloss, overrides, selected, translations, onWord }: {
  content: SectionContent; mode: Mode; gloss: boolean; overrides: Map<string, Status>; selected?: { sentence: string; s: number };
  translations: boolean;
  onWord: (ev: React.MouseEvent<HTMLSpanElement>, word: string, lemma: string, sentence: Sentence, s: number) => void;
}) {
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
      parts.push(<span key={t.s} className={wordClass(st) + (sel ? ' sel' : '')} data-g={gloss && st !== undefined && st <= 4 ? t.gloss : undefined} onClick={e => onWord(e, t.t, t.l, sent, t.s)}>{sent.text.slice(t.s, t.e)}</span>);
      pos = t.e;
    }
    if (pos < sent.text.length) parts.push(gap(sent.text.slice(pos), pos));
    return <Fragment key={sent.id}><span data-sid={sent.id}>{parts}</span>{' '}</Fragment>;
  };
  // 相邻的列表项收进同一个 <ul>，项目符号和缩进才对得齐
  const out: React.ReactNode[] = []; let items: React.ReactNode[] = [];
  const flush = (key: number) => { if (items.length) { out.push(<ul key={`ul-${key}`}>{items}</ul>); items = []; } };
  content.blocks.forEach((b, i) => {
    const bt = b.type === 'code' ? 'code' : b.block_type ?? byId.get(b.ids[0]!)?.block_type ?? 'prose';
    if (bt !== 'list_item') flush(i);
    if (b.type === 'code') { out.push(<pre key={i} data-lang={b.lang}>{b.code}</pre>); return; }
    const sents = b.ids.map(id => byId.get(id)).filter((s): s is Sentence => !!s);
    const kids = sents.map(renderSentence);
    const tr = translations ? sents.map(s => s.translation).filter(Boolean).join(' ') : '';
    const trEl = tr ? <div className="tr">{tr}</div> : null;
    if (bt === 'list_item') items.push(<li key={i}>{kids}{trEl}</li>);
    else if (bt === 'heading') out.push(<Fragment key={i}><h2>{kids}</h2>{trEl}</Fragment>);
    else if (bt === 'quote') out.push(<Fragment key={i}><blockquote className="quote">{kids}</blockquote>{trEl}</Fragment>);
    else out.push(<Fragment key={i}><p data-para={b.paragraph_idx}>{kids}</p>{trEl}</Fragment>);
  });
  flush(content.blocks.length);
  return <div className={`rd${gloss ? ' gloss' : ''}${mode === 'new' ? ' mode-new' : mode === 'clean' ? ' mode-clean' : ''}`}>{out}</div>;
});
