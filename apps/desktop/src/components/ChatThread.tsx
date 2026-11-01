import type { Conversation } from '@tibi/core';
import { ArrowUp, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Markdown } from '../lib/md';
import { useChat, type ChatContext } from '../lib/useChat';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

/**
 * 一段对话（00 §3.10）：对话页和阅读器的 Tibi 面板共用。
 * 回答流式出现（chat.delta）；工具调用显示成一行"Tibi 正在…"（chat.tool）；写操作按权限模式弹审批卡（approval.requested）。
 * pending：外面要发的一句（如首页带来的问题、阅读器里"问 Tibi"），按 key 只发一次。
 */
export type { ChatContext } from '../lib/useChat';
export interface Pending { key: string; text: string; context?: ChatContext; skill?: string; tier?: 'fast' | 'deep' }

export function ChatThread({ conversationId, skill, context, pending, placeholder = tl('继续问 Tibi…'), empty, back, onConv }: {
  conversationId: string; skill?: string; context?: ChatContext; pending?: Pending; placeholder?: string; empty?: React.ReactNode;
  /** 去连接模型后回到哪里 */ back: string; onConv?: (c: Conversation) => void;
}) {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const sent = useRef(new Set<string>());
  const { msgs, live, approvals, ready, send: sendRaw, decide, running, cancel } = useChat(conversationId, { skill, context, onConv });
  const send = useCallback(async (t: string, ctx?: ChatContext, sk?: string, tier?: 'fast' | 'deep') => { setText(''); await sendRaw(t, ctx, sk, tier); }, [sendRaw]);
  useEffect(() => { requestAnimationFrame(() => { const el = scroll.current; if (el) el.scrollTop = el.scrollHeight; }); }, [msgs, live, approvals]);
  useEffect(() => {
    if (!ready || !pending || sent.current.has(pending.key)) return;
    sent.current.add(pending.key); void send(pending.text, pending.context, pending.skill, pending.tier);
  }, [ready, pending, send]);

  return (
    <div className="chatwrap">
      <div className="scroll" ref={scroll}>
        <div className="chatpage" onClick={e => {
          // 回答里的网页链接：点一下导入到书架（找文章的结果直接能读）；按住 ⌘ / Ctrl 点在浏览器里打开
          const a = (e.target as HTMLElement).closest('.msg.a a[href^="http"]') as HTMLAnchorElement | null;
          if (!a || e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          void rpc.call('documents.import', { source: { type: 'url', url: a.href } }).then(() => toast(tl('正在导入这篇，好了会提示')), err => toast(errorInfo(err).message, { kind: 'err' }));
        }}>
          {msgs.filter(m => m.role !== 'tool' && m.text).map(m => m.role === 'user'
            ? <div key={m.id} className="msg u">{m.text}</div>
            : <div key={m.id} className="msg a"><Markdown text={m.text!} /><div className="prov-line"><span>Tibi</span>{m.task_id && <> · <a href={`#/tasks?t=${m.task_id}`}>{tl('查看过程')}</a></>}</div></div>)}
          {live.map(l => <div key={l.id} className="msg a">
            {l.tools.map((t, i) => <div key={i} className="toolline">{t.done ? '✓' : <span className="spin" />}{t.summary}</div>)}
            {l.text ? <Markdown text={l.text} /> : !l.error && <span className="typing" aria-label={tl('Tibi 正在想')}><i /><i /><i /></span>}
            {l.error && <div className="chaterr">{l.error}{/连接模型|API Key|model/i.test(l.error) && <> · <button className="linkbtn" onClick={() => nav(`/welcome?step=3&back=${encodeURIComponent(back)}`)}>{tl('去连接模型')}</button></>}</div>}
          </div>)}
          {approvals.map(a => <div key={a.task_id} className="approve">
            <div className="h"><span>{a.title}</span><span className="k">{tl('等你确认')}</span></div>
            <div className="b">{a.body}{a.impact && <><br /><span className="lbl">{a.impact}{a.undoable ? tl(' · 可撤销') : ''}</span></>}</div>
            <div className="acts"><button className="btn sm pri" onClick={() => decide(a, 'allow')}>{tl('允许')}</button><button className="btn sm" onClick={() => decide(a, 'deny')}>{tl('拒绝')}</button>{!a.untrusted && <button className="btn sm" onClick={() => decide(a, 'allow', true)}>{tl('以后都允许')}</button>}</div>
          </div>)}
          {ready && !msgs.length && !live.length && (empty ?? <div className="lbl" style={{ textAlign: 'center', marginTop: 40 }}>{tl('问 Tibi 任何关于英语和你读过的内容的问题')}</div>)}
        </div>
      </div>
      <div className="dfoot"><div className="dcomp">
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} aria-label={tl('提问')}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!running) void send(text); } }} />
        {running ? <button className="send" aria-label={tl('停止')} title={tl('停止')} onClick={cancel}><Square size={13} fill="currentColor" /></button>
          : <button className="send" aria-label={tl('发送')} disabled={!text.trim()} onClick={() => void send(text)}><ArrowUp size={15} /></button>}
      </div></div>
    </div>
  );
}
