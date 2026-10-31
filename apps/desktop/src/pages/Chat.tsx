import type { Approval, Conversation, Message } from '@tibi/core';
import { ArrowUp, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Top } from '../components/Shell';
import { Markdown } from '../lib/md';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';

/**
 * 和 Tibi 对话（00 §3.10，原型 home.html 发送后的对话页）。首页提问后主区切到这里；左栏"最近"能回来。
 * 回答流式出现（chat.delta）；工具调用显示成一行"Tibi 正在…"（chat.tool）；要写入的操作按权限模式弹审批卡（approval.requested）。
 */
type Live = { id: string; text: string; tools: { tool: string; summary: string; done: boolean }[]; error?: string; done: boolean };

export function Chat() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [conv, setConv] = useState<Conversation>();
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [live, setLive] = useState<Live[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string>();
  const scroll = useRef<HTMLDivElement>(null);
  const sentQ = useRef<string>(undefined);
  const mine = useRef(new Set<string>());

  const reload = useCallback(async () => {
    if (!id) return;
    try { const c = await rpc.call('chat.open', { conversation_id: id }); setConv(c); setMsgs(c.messages); } catch (e) { setErr(errorInfo(e).message); }
  }, [id]);
  useEffect(() => { setLive([]); setApprovals([]); mine.current.clear(); void reload(); }, [reload]);
  const toEnd = () => requestAnimationFrame(() => { const el = scroll.current; if (el) el.scrollTop = el.scrollHeight; });
  useEffect(() => { toEnd(); }, [msgs, live, approvals]);

  const send = useCallback(async (t: string) => {
    const q = t.trim(); if (!q || !id) return;
    setText('');
    setMsgs(m => [...m, { id: `local-${Date.now()}`, role: 'user', text: q, created_at: Date.now() }]);
    try {
      const { submission_id } = await rpc.call('chat.send', { conversation_id: id, text: q, context: { page: 'chat' } });
      mine.current.add(submission_id);
      setLive(l => [...l, { id: submission_id, text: '', tools: [], done: false }]);
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, [id]);

  // 首页带过来的问题（?q=）：只发一次
  useEffect(() => {
    const q = params.get('q');
    if (q && conv && sentQ.current !== `${id}:${q}`) { sentQ.current = `${id}:${q}`; setParams({}, { replace: true }); void send(q); }
  }, [params, conv, id, send, setParams]);

  useEffect(() => {
    const patch = (sid: string, f: (l: Live) => Live) => setLive(ls => ls.map(l => (l.id === sid ? f(l) : l)));
    const offs = [
      rpc.on('chat.delta', d => { if (d.conversation_id !== id) return; patch(d.submission_id, l => ({ ...l, text: l.text + d.delta, done: l.done || !!d.done })); }),
      rpc.on('chat.tool', d => { if (!mine.current.has(d.task_id)) return; patch(d.task_id, l => d.phase === 'start' ? { ...l, tools: [...l.tools, { tool: d.tool, summary: d.summary, done: false }] } : { ...l, tools: l.tools.map(t => (t.tool === d.tool && !t.done ? { ...t, done: true } : t)) }); }),
      rpc.on('task.update', d => { if (mine.current.has(d.task.id) && (d.task.state === 'err' || d.task.state === 'cancel')) patch(d.task.id, l => ({ ...l, done: true, error: d.task.state === 'cancel' ? '已停止' : d.task.error || '出错了' })); }),
      rpc.on('task.done', d => { if (!mine.current.has(d.task.id)) return; patch(d.task.id, l => ({ ...l, done: true })); void reload().then(() => setLive(ls => ls.filter(l => l.id !== d.task.id || !!l.error))); void useCore.getState().refresh(); }),
      rpc.on('approval.requested', d => { if (mine.current.has(d.approval.task_id)) setApprovals(a => [...a.filter(x => x.task_id !== d.approval.task_id), d.approval]); }),
      rpc.on('approval.resolved', d => setApprovals(a => a.filter(x => x.task_id !== d.task_id))),
    ];
    return () => offs.forEach(o => o());
  }, [id, reload]);

  const decide = async (a: Approval, decision: 'allow' | 'deny', always = false) => {
    try { await rpc.call('tasks.approve', { id: a.task_id, decision, always }); setApprovals(x => x.filter(y => y.task_id !== a.task_id)); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const running = live.find(l => !l.done);

  if (err) return <><Top crumbs={[{ label: '首页', to: '/' }, { label: '对话' }]} /><div className="scroll"><div className="chatpage"><p className="lbl">{err}</p></div></div></>;
  return (
    <>
      <Top crumbs={[{ label: '首页', to: '/' }, { label: conv?.title || '对话' }]} />
      <div className="chatwrap">
        <div className="scroll" ref={scroll}>
          <div className="chatpage">
            {msgs.filter(m => m.role !== 'tool' && m.text).map(m => m.role === 'user'
              ? <div key={m.id} className="msg u">{m.text}</div>
              : <div key={m.id} className="msg a"><Markdown text={m.text!} /><div className="prov-line"><span>Tibi</span>{m.task_id && <> · <a href={`#/tasks?t=${m.task_id}`}>查看过程</a></>}</div></div>)}
            {live.map(l => <div key={l.id} className="msg a">
              {l.tools.map((t, i) => <div key={i} className="toolline">{t.done ? '✓' : <span className="spin" />}{t.summary}</div>)}
              {l.text ? <Markdown text={l.text} /> : !l.error && <span className="typing" aria-label="Tibi 正在想"><i /><i /><i /></span>}
              {l.error && <div className="chaterr">{l.error}{/连接模型|API Key|model/i.test(l.error) && <> · <button className="linkbtn" onClick={() => nav(`/welcome?step=3&back=${encodeURIComponent(`/chat/${id}`)}`)}>去连接模型</button></>}</div>}
            </div>)}
            {approvals.map(a => <div key={a.task_id} className="approve">
              <div className="h"><span>{a.title}</span><span className="k">等你确认</span></div>
              <div className="b">{a.body}{a.impact && <><br /><span className="lbl">{a.impact}{a.undoable ? ' · 可撤销' : ''}</span></>}</div>
              <div className="acts"><button className="btn sm pri" onClick={() => decide(a, 'allow')}>允许</button><button className="btn sm" onClick={() => decide(a, 'deny')}>拒绝</button>{!a.untrusted && <button className="btn sm" onClick={() => decide(a, 'allow', true)}>以后都允许</button>}</div>
            </div>)}
            {!msgs.length && !live.length && <div className="lbl" style={{ textAlign: 'center', marginTop: 40 }}>问 Tibi 任何关于英语和你读过的内容的问题</div>}
          </div>
        </div>
        <div className="dfoot"><div className="dcomp">
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="继续问 Tibi…" aria-label="继续提问"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!running) void send(text); } }} />
          {running ? <button className="send" aria-label="停止" title="停止" onClick={() => void rpc.call('chat.cancel', { submission_id: running.id })}><Square size={13} fill="currentColor" /></button>
            : <button className="send" aria-label="发送" disabled={!text.trim()} onClick={() => void send(text)}><ArrowUp size={15} /></button>}
        </div></div>
      </div>
    </>
  );
}
