import type { Approval, MessageReceipt, MessageStep } from '@tibi/core';
import { Brain, Check, ChevronDown, ChevronRight, Hand, Minus, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { tl } from '../lib/i18n';

const MARK = { ok: <Check size={11} strokeWidth={3} />, error: <X size={11} strokeWidth={3} />, denied: <Minus size={11} strokeWidth={3} /> };
const NOTE = { ok: '', error: () => tl('（没成功）'), denied: () => tl('（已拒绝）') };
const noteOf = (s: MessageStep['status']) => (s === 'ok' ? '' : NOTE[s]());
const secs = (ms: number) => (ms < 1000 ? tl('{v0} 秒', { v0: (ms / 1000).toFixed(1) }) : tl('{v0} 秒', { v0: Math.round(ms / 1000) }));
/** 过程卡里的一步：做完的来自库（MessageStep），进行中的来自事件（done=false） */
export type ProcessStep = MessageStep & { done?: boolean; started_at?: number };

/** 进行中时每秒刷新一次，显示已经用了多久 */
function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => set(x => x + 1), 1000); return () => clearInterval(t); }, [on]);
}

/**
 * 过程卡（00 §3.10、05 §10）：参考 assistant-ui 的 Reasoning / ToolCall，思考和工具调用都看得见，但不挤占答案。
 * - 标题一行说现在在干什么（思考中、正在查词、等你确认），进行中文字带流光；做完了说"思考了 N 秒 · 用了几个工具"
 * - 回答进行中自动展开，答完收起；自己点过就按自己的来
 * - 展开是一条时间线：思考过程（模型原话，跟着滚到最新）+ 每一步：做了什么、用时；有参数和结果的再点开看
 * - 能力名这类技术词只放在悬停提示里
 * 只收过程；审批卡、写入回执和答案不收。
 */
export function ProcessCard({ steps, thinking, thinkMs, thinkStart, live, waiting }: {
  steps: ProcessStep[]; thinking?: string;
  /** 思考用时；进行中没有，用 thinkStart 现算 */ thinkMs?: number; thinkStart?: number;
  /** 这次回答还在进行 */ live?: boolean; /** 停在审批上，等用户决定 */ waiting?: boolean;
}) {
  const running = steps.find(s => s.done === false);
  const thinkingNow = !!live && !!thinking && thinkMs === undefined && !running;
  const busy = !!live && !waiting && (thinkingNow || !!running);
  useTick(!!live && (thinkingNow || !!running));
  const [userOpen, setUserOpen] = useState<boolean>();
  const open = userOpen ?? busy;
  const thinkRef = useRef<HTMLDivElement>(null);
  // 思考还在往外吐：跟着滚到最新一行
  useEffect(() => { const el = thinkRef.current; if (el && thinkingNow) el.scrollTop = el.scrollHeight; }, [thinking, thinkingNow]);
  if (!steps.length && !thinking) return null;
  const done = steps.filter(s => s.done !== false);
  // 用户拒绝的不算出错：不标红，单独说"已拒绝"
  const failed = done.filter(s => s.status === 'error').length;
  const denied = done.filter(s => s.status === 'denied').length;
  const thinkTime = thinkMs ?? (thinkStart ? Date.now() - thinkStart : undefined);
  const names = [...new Set(done.map(s => s.summary.replace(/^Tibi 正在/, '').split('：')[0]!))];
  let title: string;
  if (waiting) title = tl('需要你确认');
  else if (running) title = `${running.summary}${running.started_at ? ` · ${secs(Date.now() - running.started_at)}` : ''}`;
  else if (thinkingNow) title = `${tl('正在思考')}${thinkTime !== undefined ? ` · ${secs(thinkTime)}` : ''}`;
  else {
    const parts: string[] = [];
    if (thinking) parts.push(thinkTime !== undefined ? tl('思考了 {v0}', { v0: secs(thinkTime) }) : tl('思考过程'));
    if (done.length) parts.push(`${tl('用了 {n} 个工具', { n: done.length })}：${names.slice(0, 3).join('、')}${names.length > 3 ? tl(' 等') : ''}`);
    if (failed) parts.push(tl('{n} 步没成功', { n: failed }));
    if (denied) parts.push(tl('{n} 步已拒绝', { n: denied }));
    title = parts.join(' · ');
  }
  const Icon = waiting ? Hand : steps.length && !thinking ? Wrench : Brain;
  return <details className={`process${failed ? ' off' : ''}${busy ? ' busy' : ''}`} open={open}
    onToggle={e => { const o = e.currentTarget.open; if (o !== open) setUserOpen(o); }}>
    <summary>
      <span className="pi">{busy ? <span className="spin" /> : <Icon size={14} />}</span>
      <span className={`pt${busy ? ' shimmer' : ''}`}>{title}</span>
      <ChevronDown className="chev" size={14} />
    </summary>
    <div className="tl">
      {thinking && <div className="ti think">
        <span className="dot" />
        <div className={`thinktext${thinkingNow ? ' live' : ''}`} ref={thinkRef}>{thinking}</div>
      </div>}
      {steps.map((s, i) => {
        const going = s.done === false;
        const more = !!(s.detail || s.result || s.error);
        const line = <>
          <span className="sm">{s.summary.replace(/^Tibi 正在/, '')}{going ? '' : noteOf(s.status)}</span>
          {(s.duration_ms !== undefined || (going && s.started_at)) && <span className="dur">{secs(s.duration_ms ?? Date.now() - s.started_at!)}</span>}
          {more && <ChevronRight className="chev" size={12} />}
        </>;
        return <div key={s.call_id ?? i} className={`ti step${s.status === 'error' ? ' off' : ''}${s.status === 'denied' ? ' denied' : ''}`} title={s.tool}>
          <span className="mk">{going ? <span className="spin" /> : MARK[s.status]}</span>
          {more ? <details className="stepd"><summary className="toolline">{line}</summary>
            <div className="stepmore">
              {s.detail && <div><span className="k">{tl('参数')}</span><span className="v">{s.detail}</span></div>}
              {s.result && <div><span className="k">{tl('结果')}</span><span className="v">{s.result}</span></div>}
              {s.error && <div className="err"><span className="k">{tl('原因')}</span><span className="v">{s.error}</span></div>}
            </div>
          </details> : <div className="toolline">{line}</div>}
        </div>;
      })}
    </div>
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
    <div className="h"><span>{a.title}</span><span className="k">{a.client ? tl('{client} 请求，等你确认', { client: a.client }) : tl('等你确认')}</span></div>
    <div className="b">
      {editing ? <textarea className="input" rows={3} value={draft} aria-label={tl('修改内容')} onChange={e => setDraft(e.target.value)} /> : a.body}
      <br /><span className="lbl" title={a.tool}>{a.impact}{a.undoable ? tl(' · 可撤销') : ''}</span>
    </div>
    <div className="acts">
      {editing
        ? <><button className="btn sm pri" disabled={!draft.trim()} onClick={() => decide(a, 'edit', false, { [a.editable!.field]: draft })}>{tl('改好了，允许')}</button><button className="btn sm" onClick={() => setDraft(undefined)}>{tl('取消')}</button></>
        : <><button className="btn sm pri" onClick={() => decide(a, 'allow')}>{tl('允许')}</button><button className="btn sm" onClick={() => decide(a, 'deny')}>{tl('拒绝')}</button>{a.editable && <button className="btn sm" onClick={() => setDraft(a.editable!.value)}>{tl('修改后允许')}</button>}{!a.untrusted && !a.always_ask && <button className="btn sm" onClick={() => decide(a, 'allow', true)}>{tl('以后都允许')}</button>}</>}
    </div>
  </div>;
}
