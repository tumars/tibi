import type { Approval, Conversation, Message } from '@tibi/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tl } from './i18n';
import { errorInfo, rpc, type Params } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';

/**
 * 一段对话的状态（00 §3.10）：桌面 ChatThread 和手机的今天 / 面板共用；界面各自画。
 * 回答流式出现（chat.delta）；工具调用一行"Tibi 正在…"（chat.tool）；写操作按权限模式弹审批（approval.requested）。
 */
export type Live = { id: string; text: string; tools: { tool: string; summary: string; done: boolean }[]; error?: string; done: boolean };
export type ChatContext = NonNullable<Params<'chat.send'>['context']>;

export function useChat(conversationId: string | undefined, o: { skill?: string; context?: ChatContext; onConv?: (c: Conversation) => void } = {}) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [live, setLive] = useState<Live[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [ready, setReady] = useState(false);
  const mine = useRef(new Set<string>());
  const opts = useRef(o); opts.current = o;

  const reload = useCallback(async () => {
    if (!conversationId) return;
    try { const c = await rpc.call('chat.open', { conversation_id: conversationId }); setMsgs(c.messages); opts.current.onConv?.(c); setReady(true); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, [conversationId]);
  useEffect(() => { setLive([]); setApprovals([]); mine.current.clear(); setReady(false); void reload(); }, [reload]);

  const send = useCallback(async (t: string, ctx?: ChatContext, sk?: string, tier?: 'fast' | 'deep') => {
    const q = t.trim(); if (!q || !conversationId) return;
    setMsgs(m => [...m, { id: `local-${Date.now()}`, role: 'user', text: q, created_at: Date.now() }]);
    try {
      const { submission_id } = await rpc.call('chat.send', { conversation_id: conversationId, text: q, context: ctx ?? opts.current.context, skill: sk ?? opts.current.skill, tier });
      mine.current.add(submission_id);
      setLive(l => [...l, { id: submission_id, text: '', tools: [], done: false }]);
      // 第一句发出去，这段对话就该出现在左栏"最近"，不等回答结束
      void useCore.getState().refreshChats();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, [conversationId]);

  useEffect(() => {
    const patch = (sid: string, f: (l: Live) => Live) => setLive(ls => ls.map(l => (l.id === sid ? f(l) : l)));
    const offs = [
      rpc.on('chat.delta', d => { if (d.conversation_id === conversationId) patch(d.submission_id, l => ({ ...l, text: l.text + d.delta, done: l.done || !!d.done })); }),
      rpc.on('chat.tool', d => { if (!mine.current.has(d.task_id)) return; patch(d.task_id, l => d.phase === 'start' ? { ...l, tools: [...l.tools, { tool: d.tool, summary: d.summary, done: false }] } : { ...l, tools: l.tools.map(t => (t.tool === d.tool && !t.done ? { ...t, done: true } : t)) }); }),
      rpc.on('task.update', d => { if (mine.current.has(d.task.id) && (d.task.state === 'err' || d.task.state === 'cancel')) patch(d.task.id, l => ({ ...l, done: true, error: d.task.state === 'cancel' ? tl('已停止') : d.task.error || tl('出错了') })); }),
      rpc.on('task.done', d => { if (!mine.current.has(d.task.id)) return; patch(d.task.id, l => ({ ...l, done: true })); void reload().then(() => setLive(ls => ls.filter(l => l.id !== d.task.id || !!l.error))); void useCore.getState().refresh(); }),
      rpc.on('approval.requested', d => { if (mine.current.has(d.approval.task_id)) setApprovals(a => [...a.filter(x => x.task_id !== d.approval.task_id), d.approval]); }),
      rpc.on('approval.resolved', d => setApprovals(a => a.filter(x => x.task_id !== d.task_id))),
    ];
    return () => offs.forEach(off => off());
  }, [conversationId, reload]);

  const decide = useCallback(async (a: Approval, decision: 'allow' | 'deny', always = false) => {
    try { await rpc.call('tasks.approve', { id: a.task_id, decision, always }); setApprovals(x => x.filter(y => y.task_id !== a.task_id)); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, []);
  const running = live.find(l => !l.done);
  const cancel = useCallback(() => { if (running) void rpc.call('chat.cancel', { submission_id: running.id }); }, [running]);

  return { msgs, live, approvals, ready, send, decide, running, cancel, reload };
}
