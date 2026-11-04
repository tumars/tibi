import { useEffect, useState } from 'react';
import * as tts from '../lib/tts';
import { speakWith, useSpeaking, useTtsStatus } from '../components/Speak';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

/**
 * 设置 → 通用 → 语音（00 §3.7）。能读的地方都有系统朗读和 AI 朗读两个按钮，所以两边各占一行：音色、试听（AI 没下载时换成下载）；
 * 另起一行选默认用哪个（快捷键、自动播放、全文朗读开始时），最后是默认语速。AI 朗读是本地 Kokoro，约 92 MB。
 */
const SAMPLE = 'Reading a little every day is the easiest way to build a large vocabulary.';
async function save(patch: Record<string, unknown>) { await rpc.call('settings.set', { patch }).catch(e => toast(errorInfo(e).message, { kind: 'err' })); }

export function VoiceItems() {
  const [engine, setEngine] = useState<tts.Engine>(tts.current().engine);
  const [voice, setVoice] = useState(tts.current().voice);
  const [aiVoice, setAiVoice] = useState(tts.current().aiVoice);
  const [rate, setRate] = useState(tts.current().rate);
  const [sys, setSys] = useState<tts.Voice[]>([]);
  const speaking = useSpeaking(); const ttsStatus = useTtsStatus();
  const sampling = speaking?.key === 'sample:ai' && ttsStatus === 'loading';
  const [dl, setDl] = useState<{ state: 'idle' | 'loading' | 'ready' | 'err'; pct: number }>({ state: tts.kokoroDownloaded() ? 'ready' : 'idle', pct: 0 });
  // 系统语音是异步加载的，刚打开时列表可能还是空的：等一会儿再说"没有"
  const [voicesSettled, setVoicesSettled] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVoicesSettled(true), 1500); return () => clearTimeout(t); }, []);
  useEffect(() => { const f = () => setSys(tts.systemVoices()); f(); try { speechSynthesis.addEventListener('voiceschanged', f); return () => speechSynthesis.removeEventListener('voiceschanged', f); } catch { return undefined; } }, []);

  const download = async () => {
    setDl({ state: 'loading', pct: 0 });
    try { await tts.loadKokoro(pct => setDl({ state: 'loading', pct })); try { localStorage.setItem('tibi.kokoro.ready', '1'); } catch { /* 无存储 */ } setDl({ state: 'ready', pct: 100 }); return true; }
    catch (err) { const m = err instanceof Error ? err.message : String(err); setDl({ state: 'err', pct: 0 }); toast(/no available backend/i.test(m) ? tl('Kokoro 语音引擎启动失败：{v0}', { v0: m }) : tl('Kokoro 下载失败：{v0}', { v0: m }), { kind: 'err' }); return false; }
  };
  const setE = async (e: tts.Engine) => {
    if (e === 'kokoro' && dl.state !== 'ready' && !await download()) return;
    setEngine(e); tts.configure({ engine: e }); await save({ 'tts.engine': e });
  };

  const aiState = dl.state === 'loading' ? tl('正在下载 {pct}%…', { pct: dl.pct }) : dl.state === 'ready' ? tl('模型已下载') : tl('第一次用要下载约 92 MB');
  return <>
    <div className="item">
      <div><div className="t">{tl('系统朗读')}</div><div className="d">{tl('用电脑自带的语音，离线可用，马上出声。')}{sys.length ? '' : voicesSettled ? tl('暂未检测到美音或英音系统语音，可以用 AI 朗读') : tl('正在查找系统语音…')}</div></div>
      <div className="ctl">
        <select className="input" value={voice} onChange={async e => { setVoice(e.target.value); tts.configure({ voice: e.target.value }); await save({ 'tts.voice': e.target.value }); }} aria-label={tl('系统朗读的音色')}>
          <option value="">{tl('系统默认')}</option>
          {sys.map(v => <option key={v.id} value={v.id}>{v.label}{v.accent === 'gb' ? tl('（英音）') : tl('（美音）')}</option>)}
        </select>
        <button className="btn sm" onClick={() => void speakWith(SAMPLE, 'system', 'sample:system')}>{tl('试听')}</button>
      </div>
    </div>
    <div className="item">
      <div><div className="t">{tl('AI 朗读')}</div><div className="d">{tl('本地的 Kokoro，更自然，不联网也能用。{v0}', { v0: aiState })}</div></div>
      <div className="ctl">
        <select className="input" value={aiVoice} onChange={async e => { setAiVoice(e.target.value); tts.configure({ aiVoice: e.target.value }); await save({ 'tts.ai_voice': e.target.value }); }} aria-label={tl('AI 朗读的音色')}>
          {tts.KOKORO_VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
        {dl.state === 'ready'
          ? <button className="btn sm" onClick={() => void speakWith(SAMPLE, 'kokoro', 'sample:ai')}>{sampling ? tl('生成中…') : tl('试听')}</button>
          : <button className="btn sm" disabled={dl.state === 'loading'} onClick={() => void download()}>{dl.state === 'loading' ? tl('下载中 {pct}%', { pct: dl.pct }) : tl('下载')}</button>}
      </div>
    </div>
    <div className="item">
      <div><div className="t">{tl('默认朗读方式')}</div><div className="d">{tl('两种朗读到处都有按钮，随时可以换；复习的快捷键、自动播放和全文朗读刚打开时用这里选的')}</div></div>
      <div className="ctl"><div className="seg">
        <button className={engine === 'system' ? 'on' : ''} onClick={() => void setE('system')}>{tl('系统朗读')}</button>
        <button className={engine === 'kokoro' ? 'on' : ''} disabled={dl.state === 'loading'} onClick={() => void setE('kokoro')}>{tl('AI 朗读')}</button>
      </div></div>
    </div>
    <div className="item">
      <div><div className="t">{tl('默认语速')}</div><div className="d">{tl('阅读器里朗读时还可以单独调')}</div></div>
      <div className="ctl"><select className="input" value={rate} onChange={async e => { const r = Number(e.target.value); setRate(r); tts.configure({ rate: r }); await save({ 'tts.rate': r }); }} aria-label={tl('默认语速')}>
        {[0.75, 0.9, 1, 1.1, 1.25].map(r => <option key={r} value={r}>{r}×</option>)}
      </select></div>
    </div>
  </>;
}
