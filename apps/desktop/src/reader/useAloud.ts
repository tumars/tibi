import type { Sentence } from '@tibi/core';
import { useEffect, useRef, useState } from 'react';
import * as tts from '../lib/tts';

/**
 * 一句一句读（00 §3.4）：桌面和手机的朗读共用。暂停停在句子中间，继续接着读；
 * 做不到（句间停顿、Kokoro 合成中、Android）或被查词发音打断过，就从这一句的开头重读。
 * 卸载时停。speed 不传用设置里的默认语速。
 */
export function useAloud(sents: Sentence[], o: { start?: number; speed?: number; gap?: number; loop?: boolean; engine?: tts.Engine; onError?: (e: unknown) => void } = {}) {
  const { speed, gap = 0, loop = false, engine } = o;
  const [idx, setIdx] = useState(o.start ?? 0);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const run = useRef(0);

  const play = async (from: number) => {
    const my = ++run.current; setPlaying(true); setPaused(false);
    for (let i = from; i < sents.length; i++) {
      setIdx(i);
      let done: boolean;
      try {
        const said = tts.say(sents[i]!.text, { ...(speed ? { rate: speed } : {}), ...(engine ? { engine } : {}) });
        // AI 朗读：读这句的时候 Worker 接着合成下一句，句子之间不用干等
        const next = sents[i + 1];
        if (next && !loop && (engine ?? tts.current().engine) === 'kokoro') tts.prefetch(next.text, speed ? { rate: speed } : {});
        done = await said;
      }
      catch (e) { if (my === run.current) { setPlaying(false); o.onError?.(e); } return; }
      if (my !== run.current) return;
      if (!done) { setPlaying(false); setPaused(false); return; }   // 被查词发音之类打断：停在这一句
      if (gap) await new Promise(r => setTimeout(r, gap * 1000));
      if (my !== run.current) return;
      if (loop) i--;   // 单句循环：停在这一句
    }
    setIdx(0); setPlaying(false);
  };
  /** 彻底停下，丢掉暂停的位置（句子序号还在） */
  const halt = () => { run.current++; tts.stop(); setPlaying(false); setPaused(false); };
  const toggle = () => {
    if (playing) {
      if (tts.pause()) { setPlaying(false); setPaused(true); } else halt();
    } else if (paused && tts.resume()) { setPlaying(true); setPaused(false); }
    else void play(idx);
  };
  const jump = (d: number) => {
    const n = Math.max(0, Math.min(sents.length - 1, idx + d));
    if (playing) void play(n); else { if (paused) halt(); setIdx(n); }
  };
  // 调了倍速 / 停顿 / 循环：正在读就从当前句重新开始；暂停着就放弃句中的位置，继续时按新设置读
  useEffect(() => { if (playing) void play(idx); else if (paused) halt(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [speed, gap, loop, engine]);
  useEffect(() => () => { run.current++; tts.stop(); }, []);

  return { idx, setIdx, playing, paused, toggle, jump, halt };
}
