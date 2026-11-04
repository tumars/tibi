import type { SectionContent } from '@tibi/core';
import { AudioLines, LoaderCircle, Pause, Play, Repeat, SkipBack, SkipForward, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as tts from '../lib/tts';
import { tl } from '../lib/i18n';
import { errorInfo } from '../rpc';
import { toast } from '../store/ui';
import { useAloud } from './useAloud';
import { useTtsStatus } from '../components/Speak';

/**
 * 全文朗读（00 §3.4，M4）：从当前看到的那句开始，一句一句读，当前句高亮并滚到视野里。
 * 倍速 0.5–2.0、单句循环、句间停顿（便于跟读）。离开阅读器或关掉就停。
 */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const GAPS = [0, 1, 2, 3];

export function ReadAloud({ content, scroller, onClose }: { content: SectionContent; scroller: HTMLElement | null; onClose: () => void }) {
  const [start] = useState(() => firstVisible(content, scroller));
  const [speed, setSpeed] = useState(tts.current().rate || 1);
  const [loop, setLoop] = useState(false);
  const [gap, setGap] = useState(0);
  const [engine, setEngine] = useState<tts.Engine>(tts.current().engine);
  const [pct, setPct] = useState<number>();
  const sents = content.sentences;
  const status = useTtsStatus();
  const { idx, playing, paused, toggle, jump, goto, halt } = useAloud(sents, { start, speed, gap, loop, engine, onError: e => toast(tl('AI 朗读用不了：{v0}。可以先用系统朗读', { v0: errorInfo(e).message || tl('模型没下载好') }), { kind: 'err' }) });
  // 换成 AI 朗读：没下载过先下载（约 92 MB），按钮上显示进度
  const pick = async (e: tts.Engine) => {
    if (e === 'kokoro' && !tts.kokoroDownloaded()) {
      setPct(0);
      try { await tts.loadKokoro(setPct); } catch (err) { setPct(undefined); toast(tl('AI 朗读用不了：{v0}。可以先用系统朗读', { v0: errorInfo(err).message || tl('模型没下载好') }), { kind: 'err' }); return; }
      setPct(undefined);
    }
    setEngine(e);
  };

  // 高亮当前句
  useEffect(() => {
    const el = scroller?.querySelector<HTMLElement>(`[data-sid="${sents[idx]?.id}"]`);
    scroller?.querySelectorAll('.speaking').forEach(e => e.classList.remove('speaking'));
    if (el) { el.classList.add('speaking'); if (playing) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }, [idx, playing, scroller, sents]);
  useEffect(() => () => { scroller?.querySelectorAll('.speaking').forEach(e => e.classList.remove('speaking')); }, [scroller]);
  // 朗读时单击选的是句子：从点的那句开始读，不弹词卡（捕获阶段拦下，词上的 onClick 收不到）；拖选文字照旧
  const gotoRef = useRef(goto); gotoRef.current = goto;
  useEffect(() => {
    if (!scroller) return;
    const on = (e: MouseEvent) => {
      if (window.getSelection()?.isCollapsed === false) return;
      const sid = (e.target as Element).closest<HTMLElement>('[data-sid]')?.dataset.sid;
      const i = sid ? sents.findIndex(s => s.id === sid) : -1;
      if (i < 0) return;
      e.stopPropagation(); gotoRef.current(i);
    };
    scroller.classList.add('aloud-on'); scroller.addEventListener('click', on, true);
    return () => { scroller.classList.remove('aloud-on'); scroller.removeEventListener('click', on, true); };
  }, [scroller, sents]);

  return (
    <div className="aloud" role="toolbar" aria-label={tl('朗读')}>
      <button className="ibtn" title={tl('上一句')} onClick={() => jump(-1)}><SkipBack size={16} /></button>
      <button className="play" title={playing && status === 'loading' ? tl('正在生成语音…') : playing ? tl('暂停') : paused ? tl('继续') : tl('播放')} onClick={toggle}>{playing && status === 'loading' ? <LoaderCircle size={16} className="ttsspin" /> : playing ? <Pause size={16} /> : <Play size={16} />}</button>
      <button className="ibtn" title={tl('下一句')} onClick={() => jump(1)}><SkipForward size={16} /></button>
      <span className="lbl">{idx + 1} / {sents.length}</span>
      <span className="vsep" />
      <button className={`ibtn${engine === 'system' ? ' on' : ''}`} title={tl('系统朗读')} aria-pressed={engine === 'system'} onClick={() => void pick('system')}><Volume2 size={15} /></button>
      <button className={`ibtn${engine === 'kokoro' ? ' on' : ''}`} title={tts.kokoroDownloaded() ? tl('AI 朗读') : tl('AI 朗读（第一次要下载约 92 MB）')} aria-pressed={engine === 'kokoro'} onClick={() => void pick('kokoro')}>{pct !== undefined ? <span className="spk-pct">{pct}%</span> : <AudioLines size={15} />}</button>
      <span className="vsep" />
      <select className="input" value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label={tl('倍速')}>{SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}</select>
      <button className={`ibtn${loop ? ' on' : ''}`} title={tl('单句循环')} onClick={() => setLoop(!loop)}><Repeat size={15} /></button>
      <select className="input" value={gap} onChange={e => setGap(Number(e.target.value))} aria-label={tl('句间停顿')}>{GAPS.map(g => <option key={g} value={g}>{g ? tl('停 {g} 秒', { g }) : tl('不停顿')}</option>)}</select>
      <button className="ibtn" title={tl('关闭朗读')} onClick={() => { halt(); onClose(); }}><X size={15} /></button>
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
