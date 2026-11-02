import { useEffect, useState } from 'react';
import * as tts from '../lib/tts';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

/** 设置 → 通用 → 语音（00 §3.7）：朗读引擎（系统语音 / Kokoro 本地，约 92 MB）、音色（可试听）、默认语速 */
const SAMPLE = 'Reading a little every day is the easiest way to build a large vocabulary.';
async function save(patch: Record<string, unknown>) { await rpc.call('settings.set', { patch }).catch(e => toast(errorInfo(e).message, { kind: 'err' })); }

export function VoiceItems() {
  const [engine, setEngine] = useState<tts.Engine>(tts.current().engine);
  const [voice, setVoice] = useState(tts.current().voice);
  const [rate, setRate] = useState(tts.current().rate);
  const [sys, setSys] = useState<tts.Voice[]>([]);
  const [dl, setDl] = useState<{ state: 'idle' | 'loading' | 'ready' | 'err'; pct: number }>({ state: tts.kokoroDownloaded() ? 'ready' : 'idle', pct: 0 });
  // 系统语音是异步加载的，刚打开时列表可能还是空的：等一会儿再说"没有"
  const [voicesSettled, setVoicesSettled] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVoicesSettled(true), 1500); return () => clearTimeout(t); }, []);
  useEffect(() => { const f = () => setSys(tts.systemVoices()); f(); try { speechSynthesis.addEventListener('voiceschanged', f); return () => speechSynthesis.removeEventListener('voiceschanged', f); } catch { return undefined; } }, []);
  const voices = engine === 'kokoro' ? tts.KOKORO_VOICES : sys;

  const setE = async (e: tts.Engine) => {
    if (e === 'kokoro' && dl.state !== 'ready') {
      setDl({ state: 'loading', pct: 0 });
      try { await tts.loadKokoro(pct => setDl({ state: 'loading', pct })); try { localStorage.setItem('tibi.kokoro.ready', '1'); } catch { /* 无存储 */ } setDl({ state: 'ready', pct: 100 }); }
      catch (err) { const m = err instanceof Error ? err.message : String(err); setDl({ state: 'err', pct: 0 }); toast(/no available backend/i.test(m) ? tl('Kokoro 语音引擎启动失败：{v0}', { v0: m }) : tl('Kokoro 下载失败：{v0}', { v0: m }), { kind: 'err' }); return; }
    }
    const v = e === 'kokoro' ? 'af_heart' : '';
    setEngine(e); setVoice(v); tts.configure({ engine: e, voice: v }); await save({ 'tts.engine': e, 'tts.voice': v });
  };

  return <>
    <div className="item">
      <div><div className="t">{tl('朗读引擎')}</div><div className="d">{tl('系统语音不用下载、离线可用；Kokoro 是本地的神经网络语音，更自然，第一次要下载约 92 MB。{v0}', { v0: dl.state === 'loading' ? tl(' 正在下载 {pct}%…', { pct: dl.pct }) : '' })}</div></div>
      <div className="ctl"><div className="seg">
        <button className={engine === 'system' ? 'on' : ''} onClick={() => void setE('system')}>{tl('系统语音')}</button>
        <button className={engine === 'kokoro' ? 'on' : ''} disabled={dl.state === 'loading'} onClick={() => void setE('kokoro')}>Kokoro{dl.state === 'ready' ? '' : tl(' · 下载')}</button>
      </div></div>
    </div>
    <div className="item">
      <div><div className="t">{tl('音色')}</div><div className="d">{voices.length ? tl('点"试听"听一句') : voicesSettled ? tl('暂未检测到美音或英音系统语音，可以换用 Kokoro') : tl('正在查找系统语音…')}</div></div>
      <div className="ctl">
        {!voices.length && voicesSettled && <button className="btn sm" disabled={dl.state === 'loading'} onClick={() => void setE('kokoro')}>{dl.state === 'ready' ? tl('使用 Kokoro') : tl('下载 Kokoro（约 92 MB）')}</button>}
        <select className="input" value={voice} onChange={async e => { setVoice(e.target.value); tts.configure({ voice: e.target.value }); await save({ 'tts.voice': e.target.value }); }} aria-label={tl('音色')}>
          {engine === 'system' && <option value="">{tl('系统默认')}</option>}
          {voices.map(v => <option key={v.id} value={v.id}>{v.label}{engine === 'system' ? (v.accent === 'gb' ? tl('（英音）') : tl('（美音）')) : ''}</option>)}
        </select>
        <button className="btn sm" onClick={() => void tts.say(SAMPLE)}>{tl('试听')}</button>
      </div>
    </div>
    <div className="item">
      <div><div className="t">{tl('默认语速')}</div><div className="d">{tl('阅读器里朗读时还可以单独调')}</div></div>
      <div className="ctl"><select className="input" value={rate} onChange={async e => { const r = Number(e.target.value); setRate(r); tts.configure({ rate: r }); await save({ 'tts.rate': r }); }} aria-label={tl('默认语速')}>
        {[0.75, 0.9, 1, 1.1, 1.25].map(r => <option key={r} value={r}>{r}×</option>)}
      </select></div>
    </div>
  </>;
}
