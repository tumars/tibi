import { AudioLines, LoaderCircle, Square, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { tl } from '../lib/i18n';
import { getStatus, kokoroDownloaded, loadKokoro, onStatus, say, stop, type Engine, type Status } from '../lib/tts';
import { errorInfo } from '../rpc';
import { toast } from '../store/ui';

/**
 * 朗读按钮（00 §3.4）：凡是能读出来的地方都给两个——系统朗读（离线、马上出声）和 AI 朗读（Kokoro，更自然，第一次要下载约 92 MB）。
 * 全局同时只读一处：点另一处就换过去；正在读的那个按钮变成停止。
 */
type Playing = { key: string; engine: Engine } | undefined;
let playing: Playing;
let run = 0;
const subs = new Set<(p: Playing) => void>();
const set = (p: Playing) => { playing = p; subs.forEach(f => f(p)); };

export function useSpeaking() {
  const [p, setP] = useState<Playing>(playing);
  useEffect(() => { subs.add(setP); return () => { subs.delete(setP); }; }, []);
  return p;
}

/** 朗读状态：AI 朗读点下去要先加载模型、合成，这段时间是 loading，按钮上转圈 */
export function useTtsStatus(): Status {
  const [s, setS] = useState(getStatus);
  useEffect(() => onStatus(setS), []);
  return s;
}

/** 停下按钮发起的朗读（换页、换题时用） */
export function stopSpeaking() { if (playing) { run++; stop(); set(undefined); } }

export async function speakWith(text: string, engine: Engine, key = text, onProgress?: (pct: number) => void) {
  if (playing?.key === key && playing.engine === engine) { stopSpeaking(); return; }
  // 先停下正在读的，再去下载、合成：下载 AI 模型那几十秒里旧声音不该接着响
  stop();
  const my = ++run; set({ key, engine });
  try {
    if (engine === 'kokoro' && !kokoroDownloaded()) await loadKokoro(onProgress);
    if (my !== run) return;
    await say(text, { engine });
  } catch (e) {
    if (my === run) toast(tl('AI 朗读用不了：{v0}。可以先用系统朗读', { v0: errorInfo(e).message || tl('模型没下载好') }), { kind: 'err' });
  } finally {
    if (my === run) set(undefined);
  }
}

export function SpeakButtons({ text, id, size = 14, className = '' }: { text: string; /** 同一段文字出现在多处时区分 */ id?: string; size?: number; className?: string }) {
  const p = useSpeaking();
  const status = useTtsStatus();
  const [pct, setPct] = useState<number>();
  const key = id ?? text;
  const clean = text.replace(/[*_`#>]/g, '');
  const btn = (engine: Engine) => {
    const on = p?.key === key && p.engine === engine;
    const loading = engine === 'kokoro' && on && pct !== undefined && pct < 100;
    const busy = engine === 'kokoro' && on && !loading && status === 'loading';
    const label = busy ? tl('正在生成语音，点一下停止') : on ? tl('停止') : engine === 'system' ? tl('系统朗读') : kokoroDownloaded() ? tl('AI 朗读') : tl('AI 朗读（第一次要下载约 92 MB）');
    return <button type="button" key={engine} className={`ibtn spk${on ? ' on' : ''}`} aria-label={label} title={label}
      onClick={e => { e.stopPropagation(); void speakWith(clean, engine, key, v => setPct(v)).finally(() => setPct(undefined)); }}>
      {loading ? <span className="spk-pct">{pct}%</span> : busy ? <LoaderCircle size={size} className="ttsspin" /> : on ? <Square size={size - 3} fill="currentColor" /> : engine === 'system' ? <Volume2 size={size} /> : <AudioLines size={size} />}
    </button>;
  };
  return <span className={`spkbtns ${className}`}>{btn('system')}{btn('kokoro')}</span>;
}
