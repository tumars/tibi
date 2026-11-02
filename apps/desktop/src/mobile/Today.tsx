import type { DocumentSummary } from '@tibi/core';
import { ArrowUp, Clipboard, Plus, RotateCcw, Search, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { tl } from '../lib/i18n';
import { classifyInput, fmtMinutes, fmtPct, GENRE_NAMES, isImeKey } from '../lib/util';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';
import { ImportSheet } from './Library';
import { Ring, Thread } from './ui';

/** 今天（00 §3.13 J2、J9）：一行进度、继续读、复习卡、两条建议；下面接今天的对话，输入条常驻在标签栏上方 */
export function Today() {
  const nav = useNavigate();
  const { todayMinutes, goal, streak, due } = useCore();
  const [lead, setLead] = useState<DocumentSummary>();
  const [conv, setConv] = useState<string>();
  const [text, setText] = useState('');
  const [imp, setImp] = useState(false);
  const askRef = useRef<((t: string) => Promise<boolean>) | undefined>(undefined);

  useEffect(() => {
    rpc.call('documents.list', { sort: 'opened', limit: 12 }).then(r => setLead(r.items.find(d => d.progress > 0 && d.progress < 1) ?? r.items.find(d => d.progress === 0)), () => undefined);
    rpc.call('chat.open', { today: true }).then(c => setConv(c.id), () => undefined);
  }, []);
  const onAsk = useCallback((send: (t: string) => Promise<boolean>) => { askRef.current = send; }, []);

  const submit = async (raw = text) => {
    const t = raw.trim(); if (!t) { setImp(true); return; }
    setText('');
    const k = classifyInput(t);
    if (k === 'ask') {
      requestAnimationFrame(() => document.querySelector('#s-home')?.scrollTo({ top: 1e6, behavior: 'smooth' }));
      if (await askRef.current?.(t) === false) setText(cur => cur || t);   // 没发出去：把话还给输入框
      return;
    }
    try { await rpc.call('documents.import', { source: k === 'url' ? { type: 'url', url: t } : { type: 'text', text: t } }); toast(tl('正在导入，好了会放进书架'), { action: { label: tl('去书架'), run: () => nav('/library') } }); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const paste = async () => { try { const t = await navigator.clipboard.readText(); if (t) setText(t); } catch { toast(tl('没能读取剪贴板')); } };

  return (
    <div className="screen" id="s-home">
      <div className="todayline"><Ring value={goal ? todayMinutes / goal : 0} /><span>{tl('今日')} <b>{todayMinutes}</b> / {goal} {tl('分钟')}</span><i className="dot" /><span>{tl('连续')} <b>{streak}</b> {tl('天')}</span></div>
      <div className="pad">
        {lead && <button className="card cont" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav(`/read/${lead.id}`)}>
          <span className="k">{lead.progress > 0 ? tl('继续读') : tl('开始读')} · {GENRE_NAMES[lead.genre] ?? lead.genre}</span>
          <span className="t">{lead.title}</span>
          <span className="bar"><i style={{ width: fmtPct(lead.progress) }} /></span>
          <span className="row"><span className="lbl">{tl('读到 {p} · 还剩{m}', { p: fmtPct(lead.progress), m: fmtMinutes(lead.minutes * (1 - lead.progress)) })}</span><span className="btn sm pri">{lead.progress > 0 ? tl('继续') : tl('开始读')}</span></span>
        </button>}
        <div className="card rvc">
          <span className="ic"><RotateCcw size={20} /></span>
          <div><b>{due ? tl('复习 {n} 张', { n: due }) : tl('今天没有要复习的')}</b><span>{due ? tl('约 {m} 分钟', { m: Math.max(1, Math.round(due * 20 / 60)) }) : tl('读文章时点开的生词会排进来')}</span></div>
          {due > 0 && <button className="btn sm tint" onClick={() => nav('/review?run=1')}>{tl('开始')}</button>}
        </div>
        <div className="chips" style={{ marginTop: 16 }}>
          <button className="chip" onClick={() => void submit(tl('推荐一篇 10 分钟的科技新闻'))}><Search />{tl('推荐一篇 10 分钟的科技新闻')}</button>
          <button className="chip" onClick={() => void submit(tl('用这周的生词写个小故事'))}><Sparkles />{tl('用这周的生词写个小故事')}</button>
        </div>
        <div style={{ marginTop: 18 }}>{conv && <Thread conversationId={conv} onAsk={onAsk} />}</div>
      </div>
      <div className={`dock ask${text.trim() ? ' has' : ''}`}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={tl('粘贴网址，或问 Tibi')} aria-label={tl('粘贴网址，或问 Tibi')} enterKeyHint="send"
          onKeyDown={e => { if (e.key === 'Enter' && !isImeKey(e.nativeEvent)) { e.preventDefault(); void submit(); } }} />
        {!text && <button className="paste" onClick={() => void paste()}><Clipboard size={13} />{tl('粘贴')}</button>}
        <button className="send" aria-label={text.trim() ? tl('发送') : tl('导入')} onClick={() => void submit()}><Plus className="p" /><ArrowUp className="go" /></button>
      </div>
      <ImportSheet open={imp} onClose={() => setImp(false)} />
    </div>
  );
}
