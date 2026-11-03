import { AudioLines, LoaderCircle, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { tl } from '../lib/i18n';
import { current, type Engine } from '../lib/tts';
import { speakWith, stopSpeaking, useSpeaking, useTtsStatus } from '../components/Speak';

/** 复习卡的朗读：系统朗读和 AI 朗读两个按钮；读的时候再按就停；换题时停下上一题的声音。快捷键用设置里的默认引擎 */
export function usePlayback(text: string) {
  const p = useSpeaking();
  const key = `rv:${text}`;
  const playing = p?.key === key ? p.engine : undefined;
  const toggle = useCallback((engine?: Engine) => { if (text) void speakWith(text, engine ?? current().engine, key); }, [text, key]);
  useEffect(() => () => { stopSpeaking(); }, [text]);
  return { playing, toggle };
}

export function PlayButton({ playing, onToggle, shortcut }: { playing: Engine | undefined; onToggle: (engine?: Engine) => void; shortcut?: string }) {
  const status = useTtsStatus();
  const one = (engine: Engine) => {
    const on = playing === engine;
    const busy = on && engine === 'kokoro' && status === 'loading';
    const label = busy ? tl('生成中…') : on ? tl('停止') : engine === 'system' ? tl('系统朗读') : tl('AI 朗读');
    return (
      <button key={engine} type="button" className={`rvplay${on ? ' on' : ''}`} aria-label={label} title={label} onClick={() => onToggle(engine)}>
        {busy ? <LoaderCircle size={shortcut ? 15 : 18} className="ttsspin" /> : on ? <Square size={12} fill="currentColor" /> : engine === 'system' ? <Volume2 size={shortcut ? 15 : 18} /> : <AudioLines size={shortcut ? 15 : 18} />}
        <span className="t">{label}</span>
        {shortcut && engine === current().engine && <span className="kbd">{shortcut}</span>}
      </button>
    );
  };
  return <>{one('system')}{one('kokoro')}</>;
}
