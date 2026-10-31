import { useEffect, useState } from 'react';
import * as tts from '../lib/tts';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';

/** 设置 → 通用 → 语音（00 §3.7）：朗读引擎（系统语音 / Kokoro 本地，约 86 MB）、音色（可试听）、默认语速 */
const SAMPLE = 'Reading a little every day is the easiest way to build a large vocabulary.';
async function save(patch: Record<string, unknown>) { await rpc.call('settings.set', { patch }).catch(e => toast(errorInfo(e).message, { kind: 'err' })); }

export function VoiceItems() {
  const [engine, setEngine] = useState<tts.Engine>(tts.current().engine);
  const [voice, setVoice] = useState(tts.current().voice);
  const [rate, setRate] = useState(tts.current().rate);
  const [sys, setSys] = useState<tts.Voice[]>([]);
  const [dl, setDl] = useState<{ state: 'idle' | 'loading' | 'ready' | 'err'; pct: number }>({ state: tts.kokoroDownloaded() ? 'ready' : 'idle', pct: 0 });
  useEffect(() => { const f = () => setSys(tts.systemVoices()); f(); try { speechSynthesis.addEventListener('voiceschanged', f); return () => speechSynthesis.removeEventListener('voiceschanged', f); } catch { return undefined; } }, []);
  const voices = engine === 'kokoro' ? tts.KOKORO_VOICES : sys;

  const setE = async (e: tts.Engine) => {
    if (e === 'kokoro' && dl.state !== 'ready') {
      setDl({ state: 'loading', pct: 0 });
      try { await tts.loadKokoro(pct => setDl({ state: 'loading', pct })); try { localStorage.setItem('tibi.kokoro.ready', '1'); } catch { /* 无存储 */ } setDl({ state: 'ready', pct: 100 }); }
      catch (err) { setDl({ state: 'err', pct: 0 }); toast(`Kokoro 下载失败：${err instanceof Error ? err.message : String(err)}`, { kind: 'err' }); return; }
    }
    const v = e === 'kokoro' ? 'af_heart' : '';
    setEngine(e); setVoice(v); tts.configure({ engine: e, voice: v }); await save({ 'tts.engine': e, 'tts.voice': v });
  };

  return <>
    <div className="item">
      <div><div className="t">朗读引擎</div><div className="d">系统语音不用下载、离线可用；Kokoro 是本地的神经网络语音，更自然，第一次要下载约 86 MB。{dl.state === 'loading' ? ` 正在下载 ${dl.pct}%…` : ''}</div></div>
      <div className="ctl"><div className="seg">
        <button className={engine === 'system' ? 'on' : ''} onClick={() => void setE('system')}>系统语音</button>
        <button className={engine === 'kokoro' ? 'on' : ''} disabled={dl.state === 'loading'} onClick={() => void setE('kokoro')}>Kokoro{dl.state === 'ready' ? '' : ' · 下载'}</button>
      </div></div>
    </div>
    <div className="item">
      <div><div className="t">音色</div><div className="d">{voices.length ? '点"试听"听一句' : '这台电脑没有英文系统语音'}</div></div>
      <div className="ctl">
        <select className="input" value={voice} onChange={async e => { setVoice(e.target.value); tts.configure({ voice: e.target.value }); await save({ 'tts.voice': e.target.value }); }} aria-label="音色">
          {engine === 'system' && <option value="">系统默认</option>}
          {voices.map(v => <option key={v.id} value={v.id}>{v.label}{engine === 'system' ? (v.accent === 'gb' ? '（英音）' : '（美音）') : ''}</option>)}
        </select>
        <button className="btn sm" onClick={() => void tts.say(SAMPLE)}>试听</button>
      </div>
    </div>
    <div className="item">
      <div><div className="t">默认语速</div><div className="d">阅读器里朗读时还可以单独调</div></div>
      <div className="ctl"><select className="input" value={rate} onChange={async e => { const r = Number(e.target.value); setRate(r); tts.configure({ rate: r }); await save({ 'tts.rate': r }); }} aria-label="默认语速">
        {[0.75, 0.9, 1, 1.1, 1.25].map(r => <option key={r} value={r}>{r}×</option>)}
      </select></div>
    </div>
  </>;
}
