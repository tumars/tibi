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
  const renderSentence = (sent: Sentence) => {
    const parts: React.ReactNode[] = []; let pos = 0;
    for (const t of sent.tokens) {
      if (t.s > pos) parts.push(sent.text.slice(pos, t.s));
      const st = overrides.get(t.l) ?? t.status;
      const sel = selected && selected.sentence === sent.id && selected.s === t.s;
      parts.push(<span key={t.s} className={wordClass(st) + (sel ? ' sel' : '')} data-g={gloss && st !== undefined && st <= 4 ? (t as { gloss?: string }).gloss : undefined} onClick={e => onWord(e, t.t, t.l, sent, t.s)}>{sent.text.slice(t.s, t.e)}</span>);
      pos = t.e;
    }
    if (pos < sent.text.length) parts.push(sent.text.slice(pos));
    return <Fragment key={sent.id}><span data-sid={sent.id}>{parts}</span>{' '}</Fragment>;
  };
  return (
    <div className={`rd${gloss ? ' gloss' : ''}${mode === 'new' ? ' mode-new' : mode === 'clean' ? ' mode-clean' : ''}`}>
      {content.blocks.map((b, i) => {
        if (b.type === 'code') return <pre key={i} data-lang={b.lang}>{b.code}</pre>;
        const sents = b.ids.map(id => byId.get(id)).filter((s): s is Sentence => !!s);
        const kids = sents.map(renderSentence);
        const tr = translations ? sents.map(s => s.translation).filter(Boolean).join(' ') : '';
        const trEl = tr ? <div className="tr">{tr}</div> : null;
        const bt = b.block_type ?? sents[0]?.block_type ?? 'prose';
        if (bt === 'heading') return <Fragment key={i}><h2>{kids}</h2>{trEl}</Fragment>;
        if (bt === 'quote') return <Fragment key={i}><blockquote className="quote">{kids}</blockquote>{trEl}</Fragment>;
        if (bt === 'list_item') return <Fragment key={i}><li>{kids}</li>{trEl}</Fragment>;
        return <Fragment key={i}><p data-para={b.paragraph_idx}>{kids}</p>{trEl}</Fragment>;
      })}
    </div>
  );
});
