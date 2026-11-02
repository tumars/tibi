import type { Conversation } from '@tibi/core';
import { ArrowDown, ArrowUp, Copy, Pencil, RotateCcw, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Markdown } from '../lib/md';
import { parseSlash, type SlashAction } from '../lib/slash';
import { classifyInput } from '../lib/util';
import { ActionChip, ModelPicker, SlashMenu, useSlashMenu } from './Composer';
import { say } from '../lib/tts';
import { ApprovalCard, ProcessCard, Receipts } from './Process';
import { SelectAsk } from './SelectAsk';
import { Blocks } from './Widgets';
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
export interface Pending { key: string; text: string; context?: ChatContext; skill?: string; model?: string }

interface Queued { id: string; text: string; skill?: string; model?: string }
const queues = new Map<string, Queued[]>();

export function ChatThread({ conversationId, skill, context, pending, placeholder = tl('继续问 Tibi…'), empty, back, onConv }: {
  conversationId: string; skill?: string; context?: ChatContext; pending?: Pending; placeholder?: string; empty?: React.ReactNode;
  /** 去连接模型后回到哪里 */ back: string; onConv?: (c: Conversation) => void;
}) {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const [action, setAction] = useState<SlashAction>();   // / 选中的动作，只对下一句生效
  const [model, setModel] = useState<string>();   // 选定的模型：同一段对话里一直生效，换对话回到自动
  const ta = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const sent = useRef(new Set<string>());
  const { msgs, live, approvals, ready, send: sendRaw, decide, running, cancel, retry, rewind, undoReceipt, cursor, loadOlder, widgetStates, updateWidget } = useChat(conversationId, { skill, context, onConv });
  const [editing, setEditing] = useState<string>();   // 正在改哪句话
  const fill = useCallback((t: string) => { setText(t); ta.current?.focus(); }, []);
  // 回答时按发送先排队：看得见、取得回，答完依次发。换页回来还在（本次运行内）
  const [queue, setQueueState] = useState<Queued[]>(() => queues.get(conversationId) ?? []);
  const setQueue = useCallback((q: Queued[]) => { queues.set(conversationId, q); setQueueState(q); }, [conversationId]);
  useEffect(() => { setQueueState(queues.get(conversationId) ?? []); setEditing(undefined); }, [conversationId]);
  const sendingQueued = useRef(false);
  // 翻出更早的消息后留在原来读的位置：新内容提交到页面时、绘制之前补上高度差
  const heightBefore = useRef<number | undefined>(undefined);
  const older = () => { heightBefore.current = scroll.current?.scrollHeight; void loadOlder(); };
  useLayoutEffect(() => {
    const el = scroll.current; const h = heightBefore.current;
    if (!el || h === undefined || el.scrollHeight === h) return;
    heightBefore.current = undefined; lastTop.current = el.scrollTop += el.scrollHeight - h;
  }, [msgs]);
  // 只有停在底部时才跟随；上翻读的时候不打扰，自己发消息或来了审批再回到底部
  const follow = useRef(true);
  const lastTop = useRef(0);
  const lastHeight = useRef(0);
  const [away, setAway] = useState(false);
  const toBottom = useCallback(() => {
    follow.current = true; setAway(false);
    // 排队这一帧时用户可能刚好上翻（滚动事件先于这个回调），所以再看一次
    requestAnimationFrame(() => { const el = scroll.current; if (el && follow.current) el.scrollTop = el.scrollHeight; });
  }, []);
  const send = useCallback(async (t: string, ctx?: ChatContext, sk?: string, providerId?: string) => {
    setText(''); toBottom();
    const ok = await sendRaw(t, ctx, sk, providerId);
    if (!ok) setText(cur => cur || t);   // 没发出去：把话还给输入框
    return ok;
  }, [sendRaw, toBottom]);
  useEffect(() => { if (follow.current) toBottom(); }, [msgs, live, approvals, toBottom]);
  useEffect(() => { if (approvals.length) toBottom(); }, [approvals.length, toBottom]);
  useEffect(() => { setModel(undefined); setAction(undefined); toBottom(); }, [conversationId, toBottom]);
  useEffect(() => {
    if (!ready || !pending || sent.current.has(pending.key)) return;
    sent.current.add(pending.key); if (pending.model) setModel(pending.model); void send(pending.text, pending.context, pending.skill, pending.model);
  }, [ready, pending, send]);

  const slash = useSlashMenu(text, focus, a => { setAction(a); setText(''); ta.current?.focus(); });
  const enqueue = (t: string, sk?: string) => { setQueue([...queue, { id: `${Date.now()}`, text: t, skill: sk, model }]); setText(''); setAction(undefined); };
  const sendQueued = async (q: Queued) => {
    if (sendingQueued.current) return;
    sendingQueued.current = true;
    setQueue(queue.filter(x => x.id !== q.id));
    await send(q.text, undefined, q.skill, q.model);
    sendingQueued.current = false;
  };
  const submit = async () => {
    const t = text.trim();
    const typed = action ? { action, rest: t } : parseSlash(t, slash.actions);
    if (editing && !running && t) {
      const r = await rewind(editing);
      if (!r) return;
      setEditing(undefined);
      await send(t, undefined, r.skill, model);
      return;
    }
    if (!typed) {
      if (!t) return;
      if (running) { enqueue(t); return; }
      await send(t, undefined, undefined, model);
      return;
    }
    if (typed.action.id === 'importer') {
      if (!typed.rest) return;
      setText(''); setAction(undefined);
      // 导入不是对话：后台跑，这段对话不动
      await rpc.call('documents.import', { source: classifyInput(typed.rest) === 'url' ? { type: 'url', url: typed.rest } : { type: 'text', text: typed.rest } }).then(() => toast(tl('正在导入这篇，好了会提示')), err => toast(errorInfo(err).message, { kind: 'err' }));
      return;
    }
    const q = typed.rest || typed.action.empty;
    if (q) {
      if (running) { enqueue(q, typed.action.id); return; }
      setAction(undefined);
      if (!await send(q, undefined, typed.action.id, model)) { setText(t); setAction(action); }
    }
  };
  const visible = msgs.filter(m => m.role !== 'tool' && (m.text || m.blocks?.length || m.interrupted));
  // 上一句正常答完才接着发；停止或出错时留着，让用户决定
  const stuck = !!visible[visible.length - 1]?.interrupted;
  useEffect(() => { if (ready && queue[0] && !running && !live.length && !stuck) void sendQueued(queue[0]); });
  const regenerate = async (i: number) => {
    const q = visible.slice(0, i).reverse().find(m => m.role === 'user');
    if (!q) return;
    const r = await rewind(q.id);
    if (r) await send(r.text, undefined, r.skill, model);
  };
  const goConnect = () => nav(`/welcome?step=3&back=${encodeURIComponent(back)}`);
  const modelError = (e: string) => /连接模型|API Key|model/i.test(e);
  const canSend = !!text.trim() || !!action?.empty;

  return (
    <div className="chatwrap">
      <div className="scroll" ref={scroll} onScroll={e => {
        const el = e.currentTarget;
        // 往上翻哪怕一点点也不再跟随；内容变短时滚动位置被浏览器压回来不算翻
        const up = el.scrollTop < lastTop.current - 1 && el.scrollHeight >= lastHeight.current;
        lastTop.current = el.scrollTop; lastHeight.current = el.scrollHeight;
        follow.current = !up && el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        setAway(!follow.current);
      }}>
        <div className="chatpage" onClick={e => {
          // 回答里的网页链接：点一下导入到书架（找文章的结果直接能读）；按住 ⌘ / Ctrl 点在浏览器里打开
          const a = (e.target as HTMLElement).closest('.msg.a a[href^="http"]') as HTMLAnchorElement | null;
          if (!a || e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          void rpc.call('documents.import', { source: { type: 'url', url: a.href } }).then(() => toast(tl('正在导入这篇，好了会提示')), err => toast(errorInfo(err).message, { kind: 'err' }));
        }}>
          {cursor && <button className="linkbtn loadolder" onClick={older}>{tl('加载更早的消息')}</button>}
          {visible.map((m, i) => m.role === 'user'
            ? <div key={m.id} className={`msg u${editing === m.id ? ' editing' : ''}`}>{m.text}{!running && !m.id.startsWith('local-') && <button className="msgedit" aria-label={tl('改这句')} title={tl('改这句')} onClick={() => { setEditing(m.id); fill(m.text ?? ''); }}><Pencil size={12} /></button>}</div>
            : <div key={m.id} className="msg a">{m.steps && <ProcessCard steps={m.steps} />}{m.blocks ? <Blocks blocks={m.blocks} states={widgetStates} update={updateWidget} fill={fill} /> : m.text && <Markdown text={m.text} />}{m.receipts && <Receipts items={m.receipts} undo={id => void undoReceipt(m.id, id)} />}{m.interrupted && <div className="chaterr">{m.interrupted.reason === 'cancel' ? tl('已停止') : m.interrupted.message || tl('出错了')}{m.interrupted.message && modelError(m.interrupted.message) && <> · <button className="linkbtn" onClick={goConnect}>{tl('去连接模型')}</button></>}{i === visible.length - 1 && !running && m.task_id && <> · <button className="linkbtn" onClick={() => void retry(m.task_id!)}>{tl('重试')}</button></>}</div>}<div className="prov-line"><span>Tibi</span>{m.skill && <> · <span>{m.skill}</span></>}{m.task_id && <> · <a href={`#/tasks?t=${m.task_id}`}>{tl('查看过程')}</a></>}{m.text && <span className="msgacts">
              <button aria-label={tl('复制')} title={tl('复制')} onClick={() => void navigator.clipboard.writeText(m.text!).then(() => toast(tl('已复制')), () => toast(tl('没能复制'), { kind: 'err' }))}><Copy size={13} /></button>
              <button aria-label={tl('朗读')} title={tl('朗读')} onClick={() => void say(m.text!.replace(/[*_`#>]/g, ''))}><Volume2 size={13} /></button>
              {i === visible.length - 1 && !running && !m.interrupted && <button aria-label={tl('重新回答')} title={tl('重新回答')} onClick={() => void regenerate(i)}><RotateCcw size={13} /></button>}
            </span>}</div></div>)}
          {live.map(l => <div key={l.id} className="msg a">
            {l.resumed && !l.done && <div className="toolline"><span className="spin" />{tl('Tibi 还在回答，说完就显示')}</div>}
            <ProcessCard
              steps={l.tools.filter(t => t.done).map(t => ({ tool: t.tool, summary: t.summary.replace(/^Tibi 正在/, ''), status: t.status ?? 'ok' }))}
              current={l.done ? undefined : l.tools.find(t => !t.done)?.summary} />
            {l.blocks.length > 0 && <Blocks blocks={l.blocks} states={widgetStates} update={updateWidget} />}
            {!l.resumed && !l.error && !l.done && l.blocks[l.blocks.length - 1]?.type !== 'text' && <span className="typing" aria-label={tl('Tibi 正在想')}><i /><i /><i /></span>}
            {l.error && <div className="chaterr">{l.error}{modelError(l.error) && <> · <button className="linkbtn" onClick={goConnect}>{tl('去连接模型')}</button></>}{!running && <> · <button className="linkbtn" onClick={() => void retry(l.id)}>{tl('重试')}</button></>}</div>}
          </div>)}
          {approvals.map(a => <ApprovalCard key={a.task_id} a={a} decide={decide} />)}
          {ready && !msgs.length && !live.length && (empty ?? <div className="lbl" style={{ textAlign: 'center', marginTop: 40 }}>{tl('问 Tibi 任何关于英语和你读过的内容的问题')}</div>)}
        </div>
      </div>
      <SelectAsk root={scroll} ask={fill} />
      <div className="dfoot">{away && <button className="tobottom" aria-label={tl('回到底部')} title={tl('回到底部')} onClick={toBottom}><ArrowDown size={15} /></button>}
        {queue.map(q => <div key={q.id} className="queued">
          <span className="qt">{q.text}</span>
          <span className="lbl">{stuck || !running ? '' : tl('等这句答完')}</span>
          {!running && <button className="linkbtn" onClick={() => void sendQueued(q)}>{tl('现在发')}</button>}
          <button className="linkbtn" onClick={() => { setQueue(queue.filter(x => x.id !== q.id)); setText(cur => cur || q.text); ta.current?.focus(); }}>{tl('取回')}</button>
        </div>)}
        {editing && <div className="queued"><span className="qt lbl">{tl('改完发送后，这句之后的内容会作废；已加入生词本的词不会撤回')}</span><button className="linkbtn" onClick={() => { setEditing(undefined); setText(''); }}>{tl('取消')}</button></div>}
        <div className="dcomp">
        {action && <ActionChip action={action} onClear={() => { setAction(undefined); ta.current?.focus(); }} />}
        <textarea ref={ta} value={text} onChange={e => { setText(e.target.value); slash.textChanged(); }} placeholder={action?.placeholder ?? placeholder} aria-label={tl('提问')}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || slash.handleKey(e)) return;
            if (e.key === 'Backspace' && action && !text) { setAction(undefined); return; }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
          }} />
        <SlashMenu menu={slash.menu} cur={slash.cur} setCur={slash.setMenuCur} pick={slash.pick} />
        <ModelPicker value={model} onChange={setModel} />
        {running ? <button className="send" aria-label={tl('停止')} title={tl('停止')} onClick={cancel}><Square size={13} fill="currentColor" /></button>
          : <button className="send" aria-label={tl('发送')} disabled={!canSend} onClick={() => void submit()}><ArrowUp size={15} /></button>}
      </div></div>
    </div>
  );
}
