import type { Status } from '@tibi/core';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCore } from '../store/core';
import { SpeakButtons } from '../components/Speak';
import { STATUS_NAMES } from '../lib/util';
import { errorInfo, rpc, type Result } from '../rpc';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

export interface WordCardProps { word: string; sentenceId?: string; anchor: DOMRect; onClose: () => void; onStatus?: (text: string, status: Status) => void; onAsk?: (word: string, sentenceId?: string) => void; onDict?: (word: string) => void }

/** 词卡浮层（00 §3.2）：词典 + 本地状态 + 语境释义；六档熟练度与忽略 */
export function WordCard({ word, sentenceId, anchor, onClose, onStatus, onAsk, onDict }: WordCardProps) {
  const [data, setData] = useState<Result<'terms.lookup'>>();
  const [err, setErr] = useState<string>();
  const [status, setStatus] = useState<Status | undefined>();
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const modelOk = useCore(s => !!s.status?.models.ok);
  // 语境释义（M1）：缓存里没有、又连了模型时现写一条；没连模型只提示一句，不打断阅读（00 §3.9）
  const [ctxm, setCtxm] = useState<{ state: 'loading' | 'ok' | 'err' | 'nomodel'; text?: string }>();

  useEffect(() => {
    let alive = true;
    setCtxm(undefined);
    rpc.call('terms.lookup', { text: word, sentence_id: sentenceId }).then(r => {
      if (!alive) return; setData(r); setStatus(r.term?.status);
      if (r.context_meaning) { setCtxm({ state: 'ok', text: r.context_meaning }); return; }
      if (!sentenceId || !r.dict && !r.term) return;
      if (!modelOk) { setCtxm({ state: 'nomodel' }); return; }
      setCtxm({ state: 'loading' });
      rpc.call('terms.context_meaning', { text: word, sentence_id: sentenceId }).then(
        m => { if (alive) setCtxm({ state: 'ok', text: m.meaning }); },
        e => { if (!alive) return; const i = errorInfo(e); setCtxm(i.code === 'model_unavailable' && !modelOk ? { state: 'nomodel' } : { state: 'err', text: i.message }); });
    }, e => { if (alive) setErr(errorInfo(e).message); });
    return () => { alive = false; };
  }, [word, sentenceId, modelOk]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (/^[0-5]$/.test(e.key) && !(e.target instanceof HTMLInputElement)) void setS(Number(e.key) as Status); };
    setTimeout(() => addEventListener('mousedown', onDown), 0); addEventListener('keydown', onKey);
    return () => { removeEventListener('mousedown', onDown); removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, data]);

  const setS = async (s: Status) => {
    // 生词只按用户标的来：没有记录的词，第一次标就建一条
    const text = data?.term?.text ?? word;
    // 用返回的原形更新阅读器（running 存成 run，阅读器按原形着色）
    try { const r = await rpc.call('terms.mark', { text, status: s, sentence_id: sentenceId }); setStatus(r.term.status); setData(d => d && { ...d, term: r.term }); onStatus?.(r.term.text, r.term.status); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  // 位置：优先放在词的下方，放不下就放上方；横向贴边
  const W = 340, H = 300;
  const left = Math.min(Math.max(12, anchor.left - 20), innerWidth - W - 12);
  const below = anchor.bottom + 10 + H < innerHeight;
  const top = below ? anchor.bottom + 10 : Math.max(12, anchor.top - 10 - H);
  const head = data?.term?.display ?? data?.dict?.word ?? word;

  return (
    <div className="wc" ref={ref} style={{ left, top }} role="dialog" aria-label={head}>
      <div className="h"><b>{head}</b>{data?.dict?.phonetic && <span className="ipa">/{data.dict.phonetic}/</span>}<SpeakButtons text={head} className="say" /></div>
      {data?.card_created && <div className="added">{tl('已加入复习')} <button className="linkbtn" style={{ fontSize: 12 }} onClick={() => setS(97)}>{tl('其实认识')}</button></div>}
      {err && <div className="dict" style={{ color: 'var(--hard)' }}>{err}</div>}
      {!data && !err && <div className="dict">{tl('查询中…')}</div>}
      {ctxm?.state === 'ok' && <div className="ai"><span className="tag">{tl('✦ 在这句里')}</span>{ctxm.text}</div>}
      {ctxm?.state === 'loading' && <div className="ai muted"><span className="tag">{tl('✦ 在这句里')}</span>{tl('正在看这句话…')}</div>}
      {ctxm?.state === 'err' && <div className="ai muted"><span className="tag">{tl('✦ 在这句里')}</span>{ctxm.text}</div>}
      {ctxm?.state === 'nomodel' && <div className="ai muted"><span className="tag">{tl('✦ 在这句里')}</span>{tl('连接模型后显示 ·')} <button className="linkbtn" onClick={() => nav(`/welcome?step=3&back=${encodeURIComponent(location.hash.slice(1) || '/')}`)}>{tl('去连接')}</button></div>}
      {data && <div className="dict">{data.term?.meaning || data.dict?.translation || (data.dict ? '' : tl('词典里没有这个词'))}</div>}
      {data?.dict?.exam?.length ? <div className="lbl" style={{ marginTop: 6 }}>{data.dict.exam.join(' · ')}{data.dict.collins ? tl(' · 柯林斯 {v0}', { v0: '★'.repeat(data.dict.collins) }) : ''}</div> : null}
      <div className="stages">
        {([0, 1, 2, 3, 4, 5] as Status[]).map(s => <button key={s} data-s={s} className={`${status === s ? 'on' : ''}${status !== undefined && status <= 5 && s <= status ? ' fill' : ''}`} onClick={() => setS(s)} title={tl('{s} 键', { s })}><i />{STATUS_NAMES[s]}</button>)}
      </div>
      <div className="row">
        <button className={`btn${status === 98 ? ' pri' : ''}`} onClick={() => setS(98)}>{tl('忽略')}</button>
        <button className="btn" onClick={() => (onAsk ? onAsk(data?.term?.display ?? word, sentenceId) : toast(tl('在阅读器里可以问 Tibi')))}>{tl('问 Tibi')}</button>
        <button className="btn" onClick={() => { const w = data?.term?.text ?? data?.dict?.word ?? word; if (onDict) onDict(w); else nav(`/dict?w=${encodeURIComponent(w)}`); }}>{tl('查词典')}</button>
      </div>
    </div>
  );
}
