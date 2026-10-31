import type { SectionContent } from '@tibi/core';
import { Pause, Play, Repeat, SkipBack, SkipForward, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as tts from '../lib/tts';

/**
 * 全文朗读（00 §3.4，M4）：从当前看到的那句开始，一句一句读，当前句高亮并滚到视野里。
 * 倍速 0.5–2.0、单句循环、句间停顿（便于跟读）。离开阅读器或关掉就停。
 */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const GAPS = [0, 1, 2, 3];

export function ReadAloud({ content, scroller, onClose }: { content: SectionContent; scroller: HTMLElement | null; onClose: () => void }) {
  const [idx, setIdx] = useState(() => firstVisible(content, scroller));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(tts.current().rate || 1);
  const [loop, setLoop] = useState(false);
  const [gap, setGap] = useState(0);
  const run = useRef(0);
  const sents = content.sentences;

  // 高亮当前句
  useEffect(() => {
    const el = scroller?.querySelector<HTMLElement>(`[data-sid="${sents[idx]?.id}"]`);
    scroller?.querySelectorAll('.speaking').forEach(e => e.classList.remove('speaking'));
    if (el) { el.classList.add('speaking'); if (playing) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }, [idx, playing, scroller, sents]);
  useEffect(() => () => { run.current++; tts.stop(); scroller?.querySelectorAll('.speaking').forEach(e => e.classList.remove('speaking')); }, [scroller]);

  const play = async (from: number) => {
    const my = ++run.current; setPlaying(true);
    for (let i = from; i < sents.length; i++) {
      setIdx(i);
      await tts.say(sents[i]!.text, { rate: speed });
      if (my !== run.current) return;
      if (gap) await new Promise(r => setTimeout(r, gap * 1000));
      if (my !== run.current) return;
      if (loop) i--;   // 单句循环：停在这一句
    }
    setPlaying(false);
  };
  const pause = () => { run.current++; tts.stop(); setPlaying(false); };
  const jump = (d: number) => { const n = Math.max(0, Math.min(sents.length - 1, idx + d)); if (playing) void play(n); else setIdx(n); };
  // 调了倍速 / 停顿 / 循环：正在读就从当前句重新开始
  useEffect(() => { if (playing) void play(idx); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [speed, gap, loop]);

  return (
    <div className="aloud" role="toolbar" aria-label="朗读">
      <button className="ibtn" title="上一句" onClick={() => jump(-1)}><SkipBack size={16} /></button>
      <button className="play" title={playing ? '暂停' : '播放'} onClick={() => (playing ? pause() : void play(idx))}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
      <button className="ibtn" title="下一句" onClick={() => jump(1)}><SkipForward size={16} /></button>
      <span className="lbl">{idx + 1} / {sents.length}</span>
      <span className="vsep" />
      <select className="input" value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label="倍速">{SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}</select>
      <button className={`ibtn${loop ? ' on' : ''}`} title="单句循环" onClick={() => setLoop(!loop)}><Repeat size={15} /></button>
      <select className="input" value={gap} onChange={e => setGap(Number(e.target.value))} aria-label="句间停顿">{GAPS.map(g => <option key={g} value={g}>{g ? `停 ${g} 秒` : '不停顿'}</option>)}</select>
      <button className="ibtn" title="关闭朗读" onClick={() => { pause(); onClose(); }}><X size={15} /></button>
    </div>
  );
}

/** 视野里第一句（从这里开始读） */
function firstVisible(content: SectionContent, scroller: HTMLElement | null): number {
  if (!scroller) return 0;
  const top = scroller.getBoundingClientRect().top + 40;
  const spans = [...scroller.querySelectorAll<HTMLElement>('[data-sid]')];
  const el = spans.find(s => s.getBoundingClientRect().bottom >= top);
  const i = el ? content.sentences.findIndex(s => s.id === el.dataset.sid) : 0;
  return Math.max(0, i);
}
