import { useEffect, useState } from 'react';
import { Fox } from '../components/Fox';
import { tl } from '../lib/i18n';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';
import { ModelPanel } from './Me';
import { Sheet } from './ui';

const KEY = 'onboarding.done';

/** 手机第一次打开（00 §3.9 的简化版）：打个招呼 → 放一篇示例 → 连接模型。不问英语水平：生词只看用户自己标的。电脑上已经有数据、同步过来的，不再打招呼；还没连模型的，每次打开问一次 */
export function Welcome() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'hello' | 'model'>('hello');
  // 等 Core 连上再判断（手机上 Core 在 WebView 里起，打开词典可能要几秒；只在挂载时查一次会错过，第一次打开就不弹欢迎）
  useEffect(() => {
    let done = false;
    const check = async () => {
      const st = useCore.getState(); if (done || !st.connected) return;
      done = true;
      const s = await rpc.call('settings.get', { keys: [KEY] }).catch(() => ({} as Record<string, unknown>));
      const noModel = !st.status?.models.ok;
      if (s[KEY]) { if (noModel) { setStep('model'); setOpen(true); } return; }
      const docs = await rpc.call('documents.list', { limit: 1 }).catch(() => ({ total: 0 }));
      if (docs.total > 0) { void rpc.call('settings.set', { patch: { [KEY]: true } }); if (noModel) { setStep('model'); setOpen(true); } return; }
      setOpen(true);
    };
    void useCore.getState().refresh().then(check);
    const off = useCore.subscribe(() => void check());
    return () => { done = true; off(); };
  }, []);
  const start = async () => {
    try {
      await rpc.call('settings.set', { patch: { [KEY]: true } });
      const samples = await rpc.call('documents.samples', {}).catch(() => []);
      if (samples[0]) await rpc.call('documents.import', { source: { type: 'sample', id: samples[0].id } });
      if (useCore.getState().status?.models.ok) setOpen(false); else setStep('model');
      void useCore.getState().refresh();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  if (step === 'model') return (
    <Sheet open={open} onClose={() => setOpen(false)} tall>
      <ModelPanel onDone={() => setOpen(false)} />
      <button className="btn full" style={{ marginTop: 8 }} onClick={() => setOpen(false)}>{tl('先不连')}</button>
    </Sheet>
  );
  return (
    <Sheet open={open} onClose={() => undefined} tall>
      <div style={{ display: 'flex', justifyContent: 'center' }}><Fox size={96} state="happy" /></div>
      <h2 style={{ textAlign: 'center' }}>{tl('你好，我是 Tibi。')}</h2>
      <p className="note2" style={{ textAlign: 'center', marginTop: 0 }}>{tl('读的时候点不认识的词，加进生词本，Tibi 会帮你复习。先放一篇示例给你。')}</p>
      <button className="btn pri full" style={{ marginTop: 14 }} onClick={() => void start()}>{tl('开始')}</button>
      <p className="note2" style={{ textAlign: 'center' }}>{tl('电脑上已经在用 Tibi？开始后到 我 › 同步 连上同一个云盘。')}</p>
    </Sheet>
  );
}
