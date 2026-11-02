import type { Approval, Conversation, Message, MessageBlock } from '@tibi/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tl } from './i18n';
import { errorInfo, rpc, type Params } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';

/**
 * 一段对话的状态（00 §3.10）：桌面 ChatThread 和手机的今天 / 面板共用；界面各自画。
 * 回答流式出现（chat.delta）；工具调用一行"Tibi 正在…"（chat.tool）；写操作按权限模式弹审批（approval.requested）。
 */
export type WidgetStates = Record<string, unknown>;
export type Live = { id: string; text: string; blocks: MessageBlock[]; tools: { tool: string; summary: string; done: boolean }[]; error?: string; done: boolean };
export type ChatContext = NonNullable<Params<'chat.send'>['context']>;

function appendText(blocks: MessageBlock[], delta: string): MessageBlock[] {
  if (!delta) return blocks;
  const last = blocks[blocks.length - 1];
  return last?.type === 'text' ? [...blocks.slice(0, -1), { type: 'text', text: last.text + delta }] : [...blocks, { type: 'text', text: delta }];
}

export function useChat(conversationId: string | undefined, o: { skill?: string; context?: ChatContext; onConv?: (c: Conversation) => void } = {}) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [live, setLive] = useState<Live[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [ready, setReady] = useState(false);
  const [widgetStates, setWidgetStates] = useState<WidgetStates>({});
  const mine = useRef(new Set<string>());
  const msgsRef = useRef(msgs); msgsRef.current = msgs;
  // 回答还没写库时的卡片操作：写库后再存
  const unsaved = useRef(new Map<string, { state: unknown; result?: string }>());
  const opts = useRef(o); opts.current = o;

  const saveWidget = useCallback((widget_id: string, state: unknown, result?: string) => {
    const m = msgsRef.current.find(x => x.blocks?.some(b => b.type === 'widget' && b.id === widget_id));
    if (!m) return false;
    void rpc.call('chat.widget_update', { message_id: m.id, widget_id, state, result }).catch(e => toast(errorInfo(e).message, { kind: 'err' }));
    return true;
  }, []);
  const updateWidget = useCallback((id: string, state: unknown, result?: string) => {
    setWidgetStates(s => ({ ...s, [id]: state }));
    if (!saveWidget(id, state, result)) unsaved.current.set(id, { state, result });
  }, [saveWidget]);

  const reload = useCallback(async () => {
    if (!conversationId) return;
    try { const c = await rpc.call('chat.open', { conversation_id: conversationId }); setMsgs(c.messages); msgsRef.current = c.messages; opts.current.onConv?.(c); setReady(true); for (const [id, w] of [...unsaved.current]) if (saveWidget(id, w.state, w.result)) unsaved.current.delete(id); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, [conversationId, saveWidget]);
  useEffect(() => { setLive([]); setApprovals([]); setWidgetStates({}); unsaved.current.clear(); mine.current.clear(); setReady(false); void reload(); }, [reload]);

  const send = useCallback(async (t: string, ctx?: ChatContext, sk?: string, tier?: 'fast' | 'deep') => {
    const q = t.trim(); if (!q || !conversationId) return;
    setMsgs(m => [...m, { id: `local-${Date.now()}`, role: 'user', text: q, created_at: Date.now() }]);
    try {
      const { submission_id } = await rpc.call('chat.send', { conversation_id: conversationId, text: q, context: ctx ?? opts.current.context, skill: sk ?? opts.current.skill, tier });
      mine.current.add(submission_id);
      setLive(l => [...l, { id: submission_id, text: '', blocks: [], tools: [], done: false }]);
      // 第一句发出去，这段对话就该出现在左栏"最近"，不等回答结束
      void useCore.getState().refreshChats();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, [conversationId]);

  useEffect(() => {
    const patch = (sid: string, f: (l: Live) => Live) => setLive(ls => ls.map(l => (l.id === sid ? f(l) : l)));
    const offs = [
      rpc.on('chat.delta', d => { if (d.conversation_id === conversationId) patch(d.submission_id, l => ({ ...l, text: l.text + d.delta, blocks: appendText(l.blocks, d.delta), done: l.done || !!d.done })); }),
      rpc.on('chat.block', d => { if (d.conversation_id === conversationId) patch(d.submission_id, l => ({ ...l, blocks: [...l.blocks, d.block] })); }),
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

  return { msgs, live, approvals, ready, send, decide, running, cancel, reload, widgetStates, updateWidget };
}
