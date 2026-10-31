import type { Status } from '@tibi/core';
import { Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { speak, STATUS_NAMES } from '../lib/util';
import { errorInfo, rpc, type Result } from '../rpc';
import { toast } from '../store/ui';

export interface WordCardProps { word: string; sentenceId?: string; anchor: DOMRect; onClose: () => void; onStatus?: (text: string, status: Status) => void }

/** 词卡浮层（00 §3.2）：词典 + 本地状态 + 语境释义；六档熟练度与忽略 */
export function WordCard({ word, sentenceId, anchor, onClose, onStatus }: WordCardProps) {
  const [data, setData] = useState<Result<'terms.lookup'>>();
  const [err, setErr] = useState<string>();
  const [status, setStatus] = useState<Status | undefined>();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    rpc.call('terms.lookup', { text: word, sentence_id: sentenceId }).then(r => { if (!alive) return; setData(r); setStatus(r.term?.status); }, e => { if (alive) setErr(errorInfo(e).message); });
    return () => { alive = false; };
  }, [word, sentenceId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (/^[0-5]$/.test(e.key) && !(e.target instanceof HTMLInputElement)) void setS(Number(e.key) as Status); };
    setTimeout(() => addEventListener('mousedown', onDown), 0); addEventListener('keydown', onKey);
    return () => { removeEventListener('mousedown', onDown); removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, data]);

  const setS = async (s: Status) => {
    const id = data?.term?.id; if (!id) { toast('这个词还没有记录'); return; }
    try { await rpc.call('terms.setStatus', { ids: [id], status: s, source: 'user' }); setStatus(s); onStatus?.(data!.term!.text, s); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  // 位置：优先放在词的下方，放不下就放上方；横向贴边
  const W = 340, H = 300;
  const left = Math.min(Math.max(12, anchor.left - 20), innerWidth - W - 12);
  const below = anchor.bottom + 10 + H < innerHeight;
  const top = below ? anchor.bottom + 10 : Math.max(12, anchor.top - 10 - H);
  const head = data?.term?.display ?? data?.dict?.word ?? word;

  return (
    <div className="wc" ref={ref} style={{ left, top }} role="dialog" aria-label={head}>
      <div className="h"><b>{head}</b>{data?.dict?.phonetic && <span className="ipa">/{data.dict.phonetic}/</span>}<button className="ibtn say" title="发音" onClick={() => speak(head)}><Volume2 /></button></div>
      {data?.card_created && <div className="added">已加入复习 <button className="linkbtn" style={{ fontSize: 12 }} onClick={() => setS(97)}>其实认识</button></div>}
      {err && <div className="dict" style={{ color: 'var(--hard)' }}>{err}</div>}
      {!data && !err && <div className="dict">查询中…</div>}
      {data?.context_meaning && <div className="ai"><span className="tag">✦ 在这句里</span>{data.context_meaning}</div>}
      {data && <div className="dict">{data.term?.meaning || data.dict?.translation || (data.dict ? '' : '词典里没有这个词')}</div>}
      {data?.dict?.exam?.length ? <div className="lbl" style={{ marginTop: 6 }}>{data.dict.exam.join(' · ')}{data.dict.collins ? ` · 柯林斯 ${'★'.repeat(data.dict.collins)}` : ''}</div> : null}
      <div className="stages">
        {([0, 1, 2, 3, 4, 5] as Status[]).map(s => <button key={s} data-s={s} className={`${status === s ? 'on' : ''}${status !== undefined && status <= 5 && s <= status ? ' fill' : ''}`} onClick={() => setS(s)} title={`${s} 键`}><i />{STATUS_NAMES[s]}</button>)}
      </div>
      <div className="row">
        <button className={`btn${status === 98 ? ' pri' : ''}`} onClick={() => setS(98)}>忽略</button>
        <button className="btn" onClick={() => toast('M2 起可以问 Tibi')}>问 Tibi</button>
      </div>
    </div>
  );
}
