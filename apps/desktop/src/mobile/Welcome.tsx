import { useEffect, useState } from 'react';
import { Fox } from '../components/Fox';
import { tl } from '../lib/i18n';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';
import { Sheet } from './ui';

const KEY = 'onboarding.done';
const LEVELS = [['beginner', tl('入门'), tl('能看懂简单句子，长一点就吃力')], ['intermediate', tl('中级'), tl('能读新闻大意，生词不少')], ['upper', tl('中高级'), tl('能读大部分文章，偶尔查词')], ['advanced', tl('高级'), tl('读原版书和论文基本不费劲')]] as const;

/** 手机第一次打开（00 §3.9 的简化版）：选水平 → 放一篇示例。电脑上已经有数据、同步过来的，不再问 */
export function Welcome() {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<string>('intermediate');
  // 等 Core 连上再判断（手机上 Core 在 WebView 里起，打开词典可能要几秒；只在挂载时查一次会错过，第一次打开就不弹欢迎）
  useEffect(() => {
    let done = false;
    const check = async () => {
      const st = useCore.getState(); if (done || !st.connected) return;
      done = true;
      const s = await rpc.call('settings.get', { keys: [KEY] }).catch(() => ({} as Record<string, unknown>));
      if (s[KEY]) return;
      const docs = await rpc.call('documents.list', { limit: 1 }).catch(() => ({ total: 0 }));
      if (docs.total > 0) { void rpc.call('settings.set', { patch: { [KEY]: true } }); return; }
      setOpen(true);
    };
    void useCore.getState().refresh().then(check);
    const off = useCore.subscribe(() => void check());
    return () => { done = true; off(); };
  }, []);
  const start = async () => {
    try {
      await rpc.call('profile.update', { patch: { level_self: level, vocab_source: 'self' } });
      await rpc.call('settings.set', { patch: { [KEY]: true } });
      const samples = await rpc.call('documents.samples', {}).catch(() => []);
      if (samples[0]) await rpc.call('documents.import', { source: { type: 'sample', id: samples[0].id } });
      setOpen(false); void useCore.getState().refresh();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  return (
    <Sheet open={open} onClose={() => undefined} tall>
      <div style={{ display: 'flex', justifyContent: 'center' }}><Fox size={96} state="happy" /></div>
      <h2 style={{ textAlign: 'center' }}>{tl('你好，我是 Tibi。')}</h2>
      <p className="note2" style={{ textAlign: 'center', marginTop: 0 }}>{tl('你现在的英语水平大概是？用来决定一开始标出哪些生词，读得越多越准。')}</p>
      <div className="card" style={{ background: 'var(--sunken)', marginTop: 12 }}>
        {LEVELS.map(([k, t, d]) => <button key={k} className="doc" onClick={() => setLevel(k)}><span className="b"><span className="t">{t}</span><span className="m">{d}</span></span><span style={{ color: 'var(--accent)', fontSize: 18 }}>{level === k ? '✓' : ''}</span></button>)}
      </div>
      <button className="btn pri full" style={{ marginTop: 14 }} onClick={() => void start()}>{tl('开始')}</button>
      <p className="note2" style={{ textAlign: 'center' }}>{tl('电脑上已经在用 Tibi？开始后到 我 › 同步 连上同一个云盘。')}</p>
    </Sheet>
  );
}
