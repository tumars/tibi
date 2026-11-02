import { Mascot, type MascotId } from '../components/Mascot';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { tl } from '../lib/i18n';
import { Blocks } from '../components/Widgets';
import { Markdown } from '../lib/md';
import { useChat, type ChatContext } from '../lib/useChat';
import { errorInfo, rpc } from '../rpc';
import { toast, useUi } from '../store/ui';

/** 底部面板（00 §3.13：半屏 / 全屏两档，iOS sheet detents）。上拉横条或点 full 切到全屏 */
export function Sheet({ open, onClose, children, tall, full: fullInit, className = '' }: { open: boolean; onClose: () => void; children: ReactNode; tall?: boolean; full?: boolean; className?: string }) {
  const [full, setFull] = useState(!!fullInit);
  const y0 = useRef<number | undefined>(undefined);
  useEffect(() => { if (!open) setFull(!!fullInit); }, [open, fullInit]);
  return <>
    <div className={`scrim${open ? ' on' : ''}`} onClick={onClose} />
    <div className={`sheet${open ? ' on' : ''}${full ? ' full' : tall ? ' tall' : ''} ${className}`} role="dialog" aria-modal="true" aria-hidden={!open}>
      <div className="grab" onClick={() => setFull(f => !f)}
        onTouchStart={e => { y0.current = e.touches[0]!.clientY; }}
        onTouchEnd={e => { const dy = e.changedTouches[0]!.clientY - (y0.current ?? 0); if (dy < -30) setFull(true); else if (dy > 40) { if (full) setFull(false); else onClose(); } }} />
      <div className="sc">{open && children}</div>
    </div>
  </>;
}

export function MToasts() {
  const toasts = useUi(s => s.toasts); const dismiss = useUi(s => s.dismiss);
  return <div className="toastwrap" aria-live="polite">{toasts.map(t => <div key={t.id} className={`toast${t.kind === 'err' ? ' err' : ''}`}>{t.text}{t.action && <button onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}</div>)}</div>;
}

/** 进度小圆环 */
export function Ring({ value, size = 22, stroke = 3, color = 'var(--warm)' }: { value: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value));
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
  </svg>;
}

export const Empty = ({ title, text, action, image }: { title: string; text?: string; action?: ReactNode; image?: MascotId }) => <div className="empty">{image && <Mascot id={image} />}<b>{title}</b>{text}{action && <div style={{ marginTop: 14 }}>{action}</div>}</div>;

/** 一段对话的气泡（今天页、阅读器和词卡里的 Tibi 面板共用）。回答里的网页链接点一下导入 */
export function Thread({ conversationId, context, pending, onAsk }: { conversationId?: string; context?: ChatContext; pending?: { key: string; text: string }; onAsk?: (send: (t: string) => void) => void }) {
  const { msgs, live, approvals, ready, send, decide, widgetStates, updateWidget } = useChat(conversationId, { context });
  const sent = useRef(new Set<string>());
  useEffect(() => { onAsk?.(t => void send(t)); }, [onAsk, send]);
  useEffect(() => { if (ready && pending && !sent.current.has(pending.key)) { sent.current.add(pending.key); void send(pending.text); } }, [ready, pending, send]);
  return <div className="thread" onClick={e => {
    const a = (e.target as HTMLElement).closest('.a a[href^="http"]') as HTMLAnchorElement | null; if (!a) return;
    e.preventDefault();
    void rpc.call('documents.import', { source: { type: 'url', url: a.href } }).then(() => toast(tl('正在导入这篇，好了会提示')), err => toast(errorInfo(err).message, { kind: 'err' }));
  }}>
    {msgs.filter(m => m.role !== 'tool' && (m.text || m.blocks?.length)).map(m => m.role === 'user' ? <div key={m.id} className="u">{m.text}</div> : <div key={m.id} className="a">{m.blocks ? <Blocks blocks={m.blocks} states={widgetStates} update={updateWidget} /> : <Markdown text={m.text!} />}</div>)}
    {live.map(l => <div key={l.id} className="a">
      {l.tools.map((t, i) => <div key={i} className="tool">{t.done ? '✓' : '…'} {t.summary}</div>)}
      {l.blocks.length > 0 && <Blocks blocks={l.blocks} states={widgetStates} update={updateWidget} />}
      {!l.error && !l.done && l.blocks[l.blocks.length - 1]?.type !== 'text' && <span className="typing" aria-label={tl('Tibi 正在想')}><i /><i /><i /></span>}
      {l.error && <div className="err">{l.error}</div>}
    </div>)}
    {approvals.map(a => <div key={a.task_id} className="approve"><div className="h">{a.title}</div><div className="b">{a.body}</div>
      <div className="acts"><button className="btn sm tint" onClick={() => void decide(a, 'allow')}>{tl('允许')}</button><button className="btn sm" onClick={() => void decide(a, 'deny')}>{tl('拒绝')}</button></div></div>)}
  </div>;
}
