import { Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tl } from '../lib/i18n';
import { say, stop } from '../lib/tts';

/** 复习卡的朗读：按一下读，读的时候再按就停；换题时停下上一题的声音 */
export function usePlayback(text: string) {
  const [playing, setPlaying] = useState(false);
  const run = useRef(0);   // 每次开始或停止都加一，旧的 say() 结束时不再改状态
  const active = useRef(false);
  const set = (v: boolean) => { active.current = v; setPlaying(v); };
  const halt = useCallback(() => { run.current++; if (active.current) stop(); set(false); }, []);
  const toggle = useCallback(() => {
    if (active.current) { halt(); return; }
    const my = ++run.current; set(true);
    void say(text).finally(() => { if (my === run.current) set(false); });
  }, [text, halt]);
  useEffect(() => halt, [text, halt]);
  return { playing, toggle };
}

export function PlayButton({ playing, onToggle, shortcut }: { playing: boolean; onToggle: () => void; shortcut?: string }) {
  const label = playing ? tl('停止') : tl('播放');
  return (
    <button type="button" className={`rvplay${playing ? ' on' : ''}`} aria-label={label} title={label} onClick={onToggle}>
      {playing ? <Square size={12} fill="currentColor" /> : <Volume2 size={shortcut ? 15 : 18} />}
      <span className="t">{label}</span>
      {shortcut && <span className="kbd">{shortcut}</span>}
    </button>
  );
}
