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
/** 进行中的一步：call_id 把开始和结束配对；started_at 用来显示正在进行的耗时 */
export type LiveStep = { call_id?: string; tool: string; summary: string; done: boolean; status?: 'ok' | 'error' | 'denied'; detail?: string; result?: string; error?: string; duration_ms?: number; started_at?: number };
/** thinking：模型的思考过程；think_ms：思考用了多久（开始出正文或调工具时算结束） */
export type Live = { id: string; text: string; blocks: MessageBlock[]; tools: LiveStep[]; thinking?: string; think_start?: number; think_ms?: number; error?: string; done: boolean; resumed?: boolean };
/** 思考段落结束：第一次出正文、调工具或说完时 */
const endThinking = (l: Live): Live => (l.think_start && l.think_ms === undefined ? { ...l, think_ms: Date.now() - l.think_start } : l);
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
      // 刚发出、库里还没有的句子（打开对话的请求先回来了）留着，不然气泡会消失到下次刷新
      const pending = msgsRef.current.filter(m => m.id.startsWith('local-') && !c.messages.some(s => s.role === 'user' && s.text === m.text && s.created_at >= m.created_at - 5000));
      const merged = [...msgsRef.current.filter(m => m.created_at < first && !m.id.startsWith('local-')), ...c.messages, ...pending];
      setMsgs(merged); msgsRef.current = merged; opts.current.onConv?.(c); setReady(true);
      if (!cursorSet.current) { cursorSet.current = true; setCursor(c.cursor); }
      for (const [id, w] of [...unsaved.current]) if (saveWidget(id, w.state, w.result)) unsaved.current.delete(id);
      // 接上还在跑的回答和等确认的审批
      const active = c.active ?? [];
      active.forEach(id => mine.current.add(id));
      setLive(ls => [
        ...ls.filter(l => !c.messages.some(m => m.role === 'assistant' && m.turn_id === l.id)),
        ...active.filter(id => !ls.some(l => l.id === id) && !c.messages.some(m => m.role === 'assistant' && m.turn_id === id)).map(id => {
          // 接上已经说出来的部分，后面的增量接着往上加；进程重启过就没有，只能等说完
          const seen = c.live?.find(x => x.id === id);
          return seen
            ? { id, text: '', blocks: seen.blocks, tools: seen.steps.map(s => ({ ...s, done: true })), ...(seen.thinking ? { thinking: seen.thinking } : {}), done: false }
            : { id, text: '', blocks: [], tools: [], done: false, resumed: true };
        }),
      ]);
      setApprovals(c.approvals ?? []);
      // 反问卡以库里为准：可能在别处答了，或者发了新消息后过期了
      const asks = c.messages.flatMap(m => m.blocks ?? []).filter(b => b.type === 'widget' && b.kind === 'ask');
      if (asks.length) setWidgetStates(s => { const n = { ...s }; for (const b of asks) if (b.type === 'widget') delete n[b.id]; return n; });
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

  /** 回答反问卡：Tibi 在这一轮里原地等着，回答交给它接着做 */
  const answer = useCallback(async (widget_id: string, option_ids: string[], text?: string) => {
    try {
      const r = await rpc.call('chat.answer', { widget_id, option_ids, text });
      setWidgetStates(s => ({ ...s, [widget_id]: r.state }));
      return true;
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); void reload(); return false; }
  }, [reload]);

  const undoReceipt = useCallback(async (message_id: string, undo_id: string) => {
    try {
      await rpc.call('system.undo', { undo_id });
      await rpc.call('chat.receipt_undone', { message_id, undo_id });
      setMsgs(ms => ms.map(m => m.id !== message_id ? m : { ...m, receipts: m.receipts?.map(r => (r.undo?.undo_id === undo_id ? { ...r, undone: true } : r)) }));
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, []);

  /** 停止或出错的那一轮重新回答 */
  const retry = useCallback(async (turn_id: string) => {
    if (!conversationId) return;
    try {
      mine.current.add(turn_id);
      await rpc.call('chat.retry', { conversation_id: conversationId, turn_id });
      setMsgs(m => m.filter(x => !(x.role === 'assistant' && x.turn_id === turn_id)));
      setLive(l => [...l.filter(x => x.id !== turn_id), { id: turn_id, text: '', blocks: [], tools: [], done: false }]);
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, [conversationId]);

  /** quiet：回答中插话失败时不提示（调用方改为排队等这句答完） */
  const send = useCallback(async (t: string, ctx?: ChatContext, sk?: string, provider_id?: string, quiet = false) => {
    const q = t.trim(); if (!q || !conversationId) return false;
    const localId = `local-${Date.now()}`;
    setLive(l => l.filter(x => !x.error));   // 上一句停止后留下的提示，不要压在新消息下面
    setMsgs(m => [...m, { id: localId, role: 'user', text: q, created_at: Date.now() }]);
    try {
      // 正在回答时再发：Core 把这句插进当前回答（steered），submission_id 还是那次回答
      const { submission_id, answered } = await rpc.call('chat.send', { conversation_id: conversationId, text: q, context: ctx ?? opts.current.context, skill: sk ?? opts.current.skill, provider_id });
      // Tibi 在等反问的回答：这句写在卡片上（"你说：…"），不另起气泡
      if (answered) { setMsgs(m => m.filter(x => x.id !== localId)); void reload(); }
      mine.current.add(submission_id);
      setLive(l => l.some(x => x.id === submission_id) ? l : [...l, { id: submission_id, text: '', blocks: [], tools: [], done: false }]);
      // 第一句发出去，这段对话就该出现在左栏"最近"，不等回答结束
      void useCore.getState().refreshChats();
      return true;
    } catch (e) {
      setMsgs(m => m.filter(x => x.id !== localId));
      if (!quiet) toast(errorInfo(e).message, { kind: 'err' });
      return false;
    }
  }, [conversationId, reload]);

  useEffect(() => {
    const patch = (sid: string, f: (l: Live) => Live) => setLive(ls => ls.map(l => (l.id === sid ? f(l) : l)));
    const offs = [
      rpc.on('chat.delta', d => { if (d.conversation_id === conversationId) patch(d.submission_id, l => l.resumed ? { ...l, done: l.done || !!d.done } : endThinking({ ...l, text: l.text + d.delta, blocks: appendText(l.blocks, d.delta), done: l.done || !!d.done })); }),
      rpc.on('chat.thinking', d => { if (d.conversation_id === conversationId) patch(d.submission_id, l => l.resumed ? l : ({ ...l, thinking: (l.thinking ?? '') + d.delta, think_start: l.think_start ?? Date.now(), think_ms: undefined })); }),
      rpc.on('chat.block', d => { if (d.conversation_id === conversationId) patch(d.submission_id, l => l.resumed ? l : ({ ...l, blocks: [...l.blocks, d.block] })); }),
      rpc.on('chat.tool', d => { if (!mine.current.has(d.turn_id)) return; patch(d.turn_id, l0 => {
        const l = endThinking(l0);
        if (d.phase === 'start') {
          // 同一个调用又开始（模型连续重试：每次重试都发开始，只在最后发一次结束）：更新那一步，不另起一行
          const same = d.call_id ? l.tools.findIndex(t => t.call_id === d.call_id && !t.done) : -1;
          if (same >= 0) return { ...l, tools: l.tools.map((t, k) => (k === same ? { ...t, summary: d.summary } : t)) };
          return { ...l, tools: [...l.tools, { call_id: d.call_id, tool: d.tool, summary: d.summary, detail: d.detail, done: false, started_at: Date.now() }] };
        }
        // 按调用 ID 配对；旧事件没有 ID 时退回按工具名找第一个没做完的
        const i = d.call_id ? l.tools.findIndex(t => t.call_id === d.call_id && !t.done) : l.tools.findIndex(t => t.tool === d.tool && !t.done);
        return { ...l, tools: l.tools.map((t, k) => (k === i ? { ...t, done: true, status: d.status, result: d.result, error: d.error, duration_ms: d.duration_ms ?? (t.started_at ? Date.now() - t.started_at : undefined) } : t)) };
      }); }),
      rpc.on('chat.end', d => {
        if (d.conversation_id !== conversationId || !mine.current.has(d.submission_id)) return;
        const id = d.submission_id;
        if (d.state === 'done') {
          patch(id, l => ({ ...l, done: true }));
          void reload().then(() => setLive(ls => ls.filter(l => l.id !== id || !!l.error)));
          void useCore.getState().refresh();
          return;
        }
        patch(id, l => ({ ...l, done: true, error: d.state === 'cancel' ? tl('已停止') : d.error || tl('出错了') }));
        // 说了一半的回答已经写库：换成库里那条；什么都没说时留着错误提示
        void reload();
      }),
      rpc.on('approval.requested', d => { if (d.approval.conversation_id === conversationId) setApprovals(a => [...a.filter(x => x.id !== d.approval.id), d.approval]); }),
      rpc.on('approval.resolved', d => setApprovals(a => a.filter(x => x.id !== d.id))),
    ];
    return () => offs.forEach(off => off());
  }, [conversationId, reload]);

  const decide = useCallback(async (a: Approval, decision: 'allow' | 'deny' | 'edit', always = false, edited?: Record<string, unknown>) => {
    try { await rpc.call('approvals.decide', { id: a.id, decision, always, edited }); setApprovals(x => x.filter(y => y.id !== a.id)); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, []);
  const running = live.find(l => !l.done);
  const cancel = useCallback(() => { if (running) void rpc.call('chat.cancel', { submission_id: running.id }); }, [running]);

  return { msgs, live, approvals, ready, send, decide, running, cancel, retry, rewind, undoReceipt, reload, cursor, loadOlder, widgetStates, updateWidget, answer };
}
