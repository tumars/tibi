import type { Approval, MessageReceipt, MessageStep } from '@tibi/core';
import { useState } from 'react';
import { tl } from '../lib/i18n';

const MARK = { ok: '✓', error: '✕', denied: '–' };
const NOTE = { ok: '', error: () => tl('（没成功）'), denied: () => tl('（已拒绝）') };
const noteOf = (s: MessageStep['status']) => (s === 'ok' ? '' : NOTE[s]());

/**
 * 收起的过程卡（00 §3.10、05 §10）：标题说正在做或做过什么，点开看步骤。
 * 只收过程；审批卡和答案不收。完整记录在"查看过程"。
 */
export function ProcessCard({ steps, current }: { steps: MessageStep[]; /** 正在做的那一步；没有就是做完了 */ current?: string }) {
  if (!steps.length && !current) return null;
  const failed = steps.filter(s => s.status !== 'ok').length;
  const title = current ?? `${tl('Tibi 做了 {n} 步', { n: steps.length })} · ${steps[steps.length - 1]!.summary}${failed ? ` · ${tl('{n} 步没成功', { n: failed })}` : ''}`;
  return <details className={`process${failed ? ' off' : ''}`}>
    <summary>{current && <span className="spin" />}<span className="pt">{title}</span></summary>
    {steps.map((s, i) => <div key={i} className={`toolline${s.status !== 'ok' ? ' off' : ''}`}>{MARK[s.status]} {s.summary}{noteOf(s.status)}</div>)}
  </details>;
}

/** Tibi 写了什么（00 §3.10）：不打断，事后看得见、撤得回 */
export function Receipts({ items, undo }: { items: MessageReceipt[]; undo: (undo_id: string) => void }) {
  return <div className="receipts">{items.map((r, i) => <div key={i} className={r.undone ? 'undone' : ''}>
    <span>{r.summary}</span>
    {r.undone ? <span> · {tl('已撤销')}</span> : r.undo && r.undo.expires_at > Date.now() && <> · <button className="linkbtn" onClick={() => undo(r.undo!.undo_id)}>{tl('撤销')}</button></>}
  </div>)}</div>;
}

/** 审批卡：看清楚要写什么再决定；能改的文字可以改了再允许 */
export function ApprovalCard({ a, decide }: { a: Approval; decide: (a: Approval, decision: 'allow' | 'deny' | 'edit', always?: boolean, edited?: Record<string, unknown>) => void }) {
  const [draft, setDraft] = useState<string>();
  const editing = draft !== undefined && a.editable;
  return <div className="approve">
    <div className="h"><span>{a.title}</span><span className="k">{tl('等你确认')}</span></div>
    <div className="b">
      {editing ? <textarea className="input" rows={3} value={draft} aria-label={tl('修改内容')} onChange={e => setDraft(e.target.value)} /> : a.body}
      <br /><span className="lbl">{tl('将执行')} <code>{a.tool}</code> · {a.impact}{a.undoable ? tl(' · 可撤销') : ''}</span>
    </div>
    <div className="acts">
      {editing
        ? <><button className="btn sm pri" disabled={!draft.trim()} onClick={() => decide(a, 'edit', false, { [a.editable!.field]: draft })}>{tl('改好了，允许')}</button><button className="btn sm" onClick={() => setDraft(undefined)}>{tl('取消')}</button></>
        : <><button className="btn sm pri" onClick={() => decide(a, 'allow')}>{tl('允许')}</button><button className="btn sm" onClick={() => decide(a, 'deny')}>{tl('拒绝')}</button>{a.editable && <button className="btn sm" onClick={() => setDraft(a.editable!.value)}>{tl('修改后允许')}</button>}{!a.untrusted && <button className="btn sm" onClick={() => decide(a, 'allow', true)}>{tl('以后都允许')}</button>}</>}
    </div>
  </div>;
}
