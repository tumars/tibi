import type { DictEntry } from '@tibi/core';
import { useEffect, useRef, useState } from 'react';
import { tl } from '../lib/i18n';
import { speakWith } from './Speak';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';

const WORD = /^[A-Za-z][A-Za-z'’-]*$/;

/**
 * 选中回答里的英文：一个词能查、能进生词本，一段能朗读、能追问。
 * Tibi 用英文讲解时，人常常卡在讲解本身；查词走本地词典，不调模型。
 * root 是回答所在的滚动区；ask 把问题放进输入框，不直接发。
 */
export function SelectAsk({ root, ask }: { root: React.RefObject<HTMLElement | null>; ask: (text: string) => void }) {
  const [sel, setSel] = useState<{ text: string; x: number; y: number }>();
  const [entry, setEntry] = useState<{ lemma: string; dict?: DictEntry; in_wordbook: boolean }>();
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current; if (!el) return;
    const close = () => { setSel(undefined); setEntry(undefined); };
    const up = (e: MouseEvent) => {
      if (pop.current?.contains(e.target as Node)) return;
      // 点一下取消选区时，选区要到这一轮事件之后才清空
      setTimeout(() => {
        const s = window.getSelection(); const text = s?.toString().trim() ?? '';
        const inAnswer = s?.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode as Element : s.anchorNode.parentElement)?.closest('.msg.a');
        setEntry(undefined);
        if (!s?.rangeCount || !inAnswer || !text || text.length > 400 || !/[A-Za-z]/.test(text)) { setSel(undefined); return; }
        const r = s.getRangeAt(0).getBoundingClientRect();
        setSel({ text, x: Math.min(Math.max(r.left + r.width / 2, 160), window.innerWidth - 160), y: Math.max(r.top, 60) });
      }, 0);
    };
    el.addEventListener('mouseup', up); el.addEventListener('scroll', close, { passive: true });
    return () => { el.removeEventListener('mouseup', up); el.removeEventListener('scroll', close); };
  }, [root]);

  if (!sel) return null;
  const isWord = WORD.test(sel.text);
  const look = async () => {
    try { const r = await rpc.call('dict.entry', { word: sel.text.toLowerCase() }); setEntry({ lemma: r.lemma, dict: r.entry, in_wordbook: r.in_wordbook }); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const add = async (text: string) => {
    try {
      const r = await rpc.call('terms.add', { entries: [{ text }] });
      const undo = r.undo;
      toast(tl('已加入生词本：{w}', { w: text }), undo && r.created.length ? { action: { label: tl('撤销'), run: () => void rpc.call('system.undo', { undo_id: undo.undo_id }) } } : undefined);
      setSel(undefined); setEntry(undefined);
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const question = (q: string) => { ask(q); setSel(undefined); setEntry(undefined); window.getSelection()?.removeAllRanges(); };
  const word = entry?.lemma ?? sel.text;

  return <div className="selpop" ref={pop} style={{ left: sel.x, top: sel.y }} onMouseDown={e => e.preventDefault()}>
    {entry && <div className="selword">
      <b>{word}</b>{entry.dict?.phonetic && <span className="lbl"> /{entry.dict.phonetic.replace(/^\/|\/$/g, '')}/</span>}
      <div>{entry.dict ? entry.dict.translation.split('\n').slice(0, 3).join('\n') : tl('词典里没有这个词')}</div>
    </div>}
    <div className="selacts">
      {isWord && !entry && <button onClick={() => void look()}>{tl('查词')}</button>}
      {isWord && !entry?.in_wordbook && <button onClick={() => void add(word)}>{tl('加入生词本')}</button>}
      {entry?.in_wordbook && <span className="lbl">{tl('已在生词本')}</span>}
      <button onClick={() => void speakWith(sel.text, 'system')}>{tl('系统朗读')}</button>
      <button onClick={() => void speakWith(sel.text, 'kokoro')}>{tl('AI 朗读')}</button>
      <button onClick={() => question(isWord ? tl('「{w}」在这里是什么意思？', { w: sel.text }) : tl('「{w}」这句怎么理解？', { w: sel.text }))}>{tl('问这句')}</button>
    </div>
  </div>;
}
