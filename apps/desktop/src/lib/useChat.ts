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
/** resumed：离开再回来时已经在跑的回答，前面的文字没收到，等说完从库里读 */
export type Live = { id: string; text: string; blocks: MessageBlock[]; tools: { tool: string; summary: string; done: boolean; status?: 'ok' | 'error' | 'denied' }[]; error?: string; done: boolean; resumed?: boolean };
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

  const current = useRef(conversationId); current.current = conversationId;
  const [cursor, setCursor] = useState<string>();   // 更早的消息从这里接着翻；没有就是到头了
  const cursorSet = useRef(false);
  const reload = useCallback(async () => {
    if (!conversationId) return;
    try {
      const c = await rpc.call('chat.open', { conversation_id: conversationId });
      if (current.current !== conversationId) return;   // 等待时换了对话
      // 只给最新一页；已经翻出来的更早消息留着
      const first = c.messages[0]?.created_at ?? Infinity;
      const merged = [...msgsRef.current.filter(m => m.created_at < first && !m.id.startsWith('local-')), ...c.messages];
      setMsgs(merged); msgsRef.current = merged; opts.current.onConv?.(c); setReady(true);
      if (!cursorSet.current) { cursorSet.current = true; setCursor(c.cursor); }
      for (const [id, w] of [...unsaved.current]) if (saveWidget(id, w.state, w.result)) unsaved.current.delete(id);
      // 接上还在跑的回答和等确认的审批
      const active = c.active ?? [];
      active.forEach(id => mine.current.add(id));
      setLive(ls => [
        ...ls.filter(l => !c.messages.some(m => m.role === 'assistant' && m.task_id === l.id)),
        ...active.filter(id => !ls.some(l => l.id === id) && !c.messages.some(m => m.role === 'assistant' && m.task_id === id)).map(id => ({ id, text: '', blocks: [], tools: [], done: false, resumed: true })),
      ]);
      setApprovals(c.approvals ?? []);
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, [conversationId, saveWidget]);
  useEffect(() => { setMsgs([]); msgsRef.current = []; setCursor(undefined); cursorSet.current = false; setLive([]); setApprovals([]); setWidgetStates({}); unsaved.current.clear(); mine.current.clear(); setReady(false); void reload(); }, [reload]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || !cursor) return;
    try {
      const r = await rpc.call('chat.history', { conversation_id: conversationId, cursor });
      if (current.current !== conversationId) return;
      setMsgs(m => [...r.items, ...m]); setCursor(r.cursor);
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, [conversationId, cursor]);

  /** 回到这句话之前：这条和之后的都作废，返回原话和当时用的技能 */
  const rewind = useCallback(async (message_id: string) => {
    if (!conversationId) return undefined;
    try {
      const r = await rpc.call('chat.rewind', { conversation_id: conversationId, message_id });
      const i = msgsRef.current.findIndex(m => m.id === message_id);
      const kept = i >= 0 ? msgsRef.current.slice(0, i) : msgsRef.current;
      setMsgs(kept); msgsRef.current = kept;
      setLive(l => l.filter(x => !x.error));
      return r;
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); return undefined; }
  }, [conversationId]);

  const undoReceipt = useCallback(async (message_id: string, undo_id: string) => {
    try {
      await rpc.call('system.undo', { undo_id });
      await rpc.call('chat.receipt_undone', { message_id, undo_id });
      setMsgs(ms => ms.map(m => m.id !== message_id ? m : { ...m, receipts: m.receipts?.map(r => (r.undo?.undo_id === undo_id ? { ...r, undone: true } : r)) }));
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, []);

  const retry = useCallback(async (task_id: string) => {
    try {
      mine.current.add(task_id);
      await rpc.call('tasks.retry', { id: task_id });
      setMsgs(m => m.filter(x => !(x.role === 'assistant' && x.task_id === task_id)));
      setLive(l => [...l.filter(x => x.id !== task_id), { id: task_id, text: '', blocks: [], tools: [], done: false }]);
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, []);

  const send = useCallback(async (t: string, ctx?: ChatContext, sk?: string, provider_id?: string) => {
    const q = t.trim(); if (!q || !conversationId) return false;
    const localId = `local-${Date.now()}`;
    setLive(l => l.filter(x => !x.error));   // 上一句停止后留下的提示，不要压在新消息下面
    setMsgs(m => [...m, { id: localId, role: 'user', text: q, created_at: Date.now() }]);
    try {
      const { submission_id } = await rpc.call('chat.send', { conversation_id: conversationId, text: q, context: ctx ?? opts.current.context, skill: sk ?? opts.current.skill, provider_id });
      mine.current.add(submission_id);
      setLive(l => l.some(x => x.id === submission_id) ? l : [...l, { id: submission_id, text: '', blocks: [], tools: [], done: false }]);
      // 第一句发出去，这段对话就该出现在左栏"最近"，不等回答结束
      void useCore.getState().refreshChats();
      return true;
    } catch (e) {
      setMsgs(m => m.filter(x => x.id !== localId));
      toast(errorInfo(e).message, { kind: 'err' });
      return false;
    }
  }, [conversationId]);

  useEffect(() => {
    const patch = (sid: string, f: (l: Live) => Live) => setLive(ls => ls.map(l => (l.id === sid ? f(l) : l)));
    const offs = [
      rpc.on('chat.delta', d => { if (d.conversation_id === conversationId) patch(d.submission_id, l => l.resumed ? { ...l, done: l.done || !!d.done } : ({ ...l, text: l.text + d.delta, blocks: appendText(l.blocks, d.delta), done: l.done || !!d.done })); }),
      rpc.on('chat.block', d => { if (d.conversation_id === conversationId) patch(d.submission_id, l => l.resumed ? l : ({ ...l, blocks: [...l.blocks, d.block] })); }),
      rpc.on('chat.tool', d => { if (!mine.current.has(d.task_id)) return; patch(d.task_id, l => {
        if (d.phase === 'start') return { ...l, tools: [...l.tools, { tool: d.tool, summary: d.summary, done: false }] };
        const i = l.tools.findIndex(t => t.tool === d.tool && !t.done);
        return { ...l, tools: l.tools.map((t, k) => (k === i ? { ...t, done: true, status: d.status } : t)) };
      }); }),
      rpc.on('task.update', d => {
        if (!mine.current.has(d.task.id) || (d.task.state !== 'err' && d.task.state !== 'cancel')) return;
        patch(d.task.id, l => ({ ...l, done: true, error: d.task.state === 'cancel' ? tl('已停止') : d.task.error || tl('出错了') }));
        // 说了一半的回答已经写库：换成库里那条；什么都没说时留着错误提示
        void reload();
      }),
      rpc.on('task.done', d => { if (!mine.current.has(d.task.id)) return; patch(d.task.id, l => ({ ...l, done: true })); void reload().then(() => setLive(ls => ls.filter(l => l.id !== d.task.id || !!l.error))); void useCore.getState().refresh(); }),
      rpc.on('approval.requested', d => { if (d.approval.conversation_id === conversationId || mine.current.has(d.approval.task_id)) setApprovals(a => [...a.filter(x => x.task_id !== d.approval.task_id), d.approval]); }),
      rpc.on('approval.resolved', d => setApprovals(a => a.filter(x => x.task_id !== d.task_id))),
    ];
    return () => offs.forEach(off => off());
  }, [conversationId, reload]);

  const decide = useCallback(async (a: Approval, decision: 'allow' | 'deny' | 'edit', always = false, edited?: Record<string, unknown>) => {
    try { await rpc.call('tasks.approve', { id: a.task_id, decision, always, edited }); setApprovals(x => x.filter(y => y.task_id !== a.task_id)); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, []);
  const running = live.find(l => !l.done);
  const cancel = useCallback(() => { if (running) void rpc.call('chat.cancel', { submission_id: running.id }); }, [running]);

  return { msgs, live, approvals, ready, send, decide, running, cancel, retry, rewind, undoReceipt, reload, cursor, loadOlder, widgetStates, updateWidget };
}
