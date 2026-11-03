import type { AskState, ImportCardState, MessageBlock, WidgetBlock } from '@tibi/core';
import { deepLink } from '@tibi/core/deeplink';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { openDeepLink } from '../lib/deeplink';
import { tl } from '../lib/i18n';
import { Markdown } from '../lib/md';
import { SpeakButtons } from './Speak';
import type { WidgetStates } from '../lib/useChat';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import './widgets.css';

/**
 * 对话卡片：查词、辨析、练习、反问、导入、跳转入口。数据来自能力结果，桌面和手机共用。
 * 跳到应用里别处的按钮都是 tibi:// 深链（lib/deeplink.ts），和系统打开的链接走同一套。
 * 按钮直接调能力，不经过模型；操作结果经 useChat 保存，重开对话能恢复，下一轮带给模型。
 */
type Update = (id: string, state: unknown, result?: string) => void;
type Fill = (text: string) => void;
type Answer = (widget_id: string, option_ids: string[], text?: string) => Promise<boolean>;
type Of<K extends WidgetBlock['kind']> = Extract<WidgetBlock, { kind: K }>;

const phonetic = (p?: string) => p && (p.startsWith('/') ? p : `/${p}/`);

function WordCard({ b, state, update }: { b: Of<'word'>; state?: { undo_id?: string; added?: boolean }; update: Update }) {
  const d = b.data; const added = state?.added ?? false; const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try { const r = await rpc.call('terms.add', { entries: [{ text: d.word }] }); update(b.id, { added: true, undo_id: r.created.length ? r.undo?.undo_id : undefined }, '已加入生词本'); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
    setBusy(false);
  };
  const undo = async () => {
    setBusy(true);
    try { if (state?.undo_id) await rpc.call('system.undo', { undo_id: state.undo_id }); update(b.id, { added: false }); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
    setBusy(false);
  };
  return <div className="wg">
    <div className="wg-hd"><span className="wg-word">{d.word}</span><span className="wg-k">{[phonetic(d.phonetic), d.pos].filter(Boolean).join(' · ')}</span></div>
    <div className="wg-mean">{d.translation.split('\n').slice(0, 3).join('\n')}</div>
    {d.example && <div className="wg-en">{d.example.en}{d.example.zh && <div className="wg-zh">{d.example.zh}</div>}</div>}
    <div className="wg-acts">
      {d.in_wordbook ? <span className="wg-k">{tl('已在生词本')}</span>
        : added ? <>{<span className="wg-ok">{tl('已加入生词本')}</span>}{state?.undo_id && <button className="btn sm" disabled={busy} onClick={() => void undo()}>{tl('撤销')}</button>}</>
        : <button className="btn sm pri" disabled={busy} onClick={() => void add()}>{tl('加入生词本')}</button>}
      <SpeakButtons text={d.word} id={`wg:${b.id}`} />
    </div>
  </div>;
}

function CompareCard({ b }: { b: Of<'compare'> }) {
  return <div className="wg"><div className="wg-cmp">
    {b.data.words.map(w => <div key={w.word}>
      <div className="wg-hd"><span className="wg-w1">{w.word}</span><span className="wg-k">{phonetic(w.phonetic)}</span></div>
      <div>{w.translation}</div>
      {w.example && <div className="wg-en">{w.example}</div>}
    </div>)}
  </div></div>;
}

const norm = (s: string) => s.trim().toLowerCase();
type QuizState = { picks: string[] };

function QuizCard({ b, state, update, fill }: { b: Of<'quiz'>; state?: QuizState; update: Update; fill?: Fill }) {
  const items = b.data.items; const picks = state?.picks ?? [];
  const [typed, setTyped] = useState('');
  const [showing, setShowing] = useState(picks.length ? Math.min(picks.length, items.length) : 0);
  const right = (i: number) => items[i]!.answer.map(norm).includes(norm(picks[i] ?? ''));
  const score = picks.filter((_, i) => right(i)).length;
  const answer = (v: string) => {
    if (!v.trim()) return;
    const next = [...picks, v]; const wrong = next.flatMap((p, i) => items[i]!.answer.map(norm).includes(norm(p)) ? [] : [items[i]!.term]);
    update(b.id, { picks: next }, `做了 ${next.length}/${items.length} 题，答对 ${next.length - wrong.length} 题${wrong.length ? `，错在 ${wrong.join('、')}` : ''}`);
    setTyped('');
  };
  const redo = () => { update(b.id, { picks: [] }); setShowing(0); setTyped(''); };

  if (showing >= items.length) {
    // 下一步由结果算出来，不调模型；只放进输入框，发不发用户定
    const wrong = items.filter((_, i) => !right(i)).map(q => q.term);
    return <div className="wg">
      <div className="wg-hd"><b>{tl('答对 {n} / {total}', { n: score, total: items.length })}</b><span className="wg-k">{tl('不影响复习排期')}</span></div>
      <div className="wg-acts">
        {fill && wrong.length > 0 && <button className="btn sm" onClick={() => fill(tl('讲讲我做错的：{words}', { words: wrong.join('、') }))}>{tl('讲讲做错的')}</button>}
        {fill && !wrong.length && <button className="btn sm" onClick={() => fill(tl('再出一组难一点的练习'))}>{tl('再来一组难点的')}</button>}
        <button className="btn sm" onClick={redo}>{tl('再做一遍')}</button>
      </div>
    </div>;
  }

  const q = items[showing]!; const pick = picks[showing]; const done = pick !== undefined;
  const correct = done && right(showing);
  return <div className="wg">
    <div className="wg-hd"><b>{q.type === 'choice' ? tl('选出 {word} 的意思', { word: q.term }) : tl('填入合适的词')}</b><span className="wg-k wg-prog">{showing + 1} / {items.length}</span></div>
    {norm(q.prompt) !== norm(q.term) && <div className="wg-en wg-q">{q.prompt}</div>}
    {q.type === 'choice'
      ? <div className="wg-opts">{q.options!.map(o => {
          const isAns = q.answer.map(norm).includes(norm(o));
          return <button key={o} className={`wg-opt${done ? (isAns ? ' right' : o === pick ? ' wrong' : '') : ''}`} disabled={done} onClick={() => answer(o)}>{o}</button>;
        })}</div>
      : !done && <form className="wg-fill" onSubmit={e => { e.preventDefault(); answer(typed); }}>
          <input value={typed} onChange={e => setTyped(e.target.value)} aria-label={tl('你的答案')} placeholder={tl('你的答案')} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <button className="btn sm pri" disabled={!typed.trim()}>{tl('确定')}</button>
        </form>}
    {done && <div className={correct ? 'wg-ok' : 'wg-bad'}>{correct ? tl('答对了') : tl('正确答案：{answer}', { answer: q.answer.join(' / ') })}</div>}
    {done && <div className="wg-acts"><button className="btn sm pri" onClick={() => setShowing(showing + 1)}>{showing === items.length - 1 ? tl('看结果') : tl('下一题')}</button></div>}
  </div>;
}

/** 反问：选项里的文字可能来自网页，只当纯文本显示；"将…"那行由内核生成，用户点之前看得到真正会发生什么 */
function AskCard({ b, state, answer }: { b: Of<'ask'>; state?: AskState; answer?: Answer }) {
  const d = b.data; const done = !!state?.answered; const closed = done || !!state?.expired || !answer;
  const [picks, setPicks] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (ids: string[], t?: string) => { setBusy(true); const ok = await answer!(b.id, ids, t); setBusy(false); if (ok) setText(''); };
  const chosen = state?.answered?.option_ids ?? picks;
  return <div className="wg wg-ask">
    <div className="wg-hd"><b>{d.question}</b>{d.multi && !closed && <span className="wg-k">{tl('可以多选')}</span>}</div>
    <div className="wg-opts">{d.options.map(o => {
      const on = chosen.includes(o.id);
      return <button key={o.id} className={`wg-opt wg-askopt${on ? ' on' : ''}`} disabled={closed || busy} aria-pressed={d.multi ? on : undefined}
        onClick={() => { if (d.multi) setPicks(p => on ? p.filter(x => x !== o.id) : [...p, o.id]); else void submit([o.id]); }}>
        <span className="wg-asklabel">{o.label}</span>
        {o.description && <span className="wg-k">{o.description}</span>}
        {o.url && <span className="wg-k wg-askact">{hostOf(o.url)}</span>}
        {o.action && <span className="wg-k wg-askact">{o.action.preview}</span>}
      </button>;
    })}</div>
    {d.untrusted && !closed && <div className="wg-k">{tl('这些内容来自网页，选之前留意来源')}</div>}
    {state?.answered?.text && <div className="wg-k">{tl('你说：{text}', { text: state.answered.text })}</div>}
    {state?.expired && <div className="wg-k">{tl('已跳过')}</div>}
    {!closed && <>
      {d.multi && <div className="wg-acts"><button className="btn sm pri" disabled={!picks.length || busy} onClick={() => void submit(picks, text.trim() || undefined)}>{tl('确定（{n}）', { n: picks.length })}</button></div>}
      <form className="wg-fill" onSubmit={e => { e.preventDefault(); if (text.trim()) void submit(d.multi ? picks : [], text.trim()); }}>
        <input value={text} onChange={e => setText(e.target.value)} aria-label={tl('或者直接说')} placeholder={tl('或者直接说…')} disabled={busy} />
        {!d.multi && <button className="btn sm" disabled={!text.trim() || busy}>{tl('发送')}</button>}
      </form>
    </>}
  </div>;
}

const hostOf = (url: string) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; } };

/** Tibi 不能改的设置：只把人带过去 */
function SettingsLinkCard({ b }: { b: Of<'settings_link'> }) {
  // 手机没有设置页，设置都在"我的"里
  const mobile = !!(window as { __TIBI_LOCAL_CORE__?: boolean }).__TIBI_LOCAL_CORE__;
  return <div className="wg">
    <div>{b.data.reason}</div>
    <div className="wg-acts"><button className="btn sm pri" onClick={() => { location.hash = mobile ? '/me' : `/settings?sec=${encodeURIComponent(b.data.section)}`; }}>{tl('打开设置 · {name}', { name: tl(b.data.label) })}</button></div>
  </div>;
}

/** 跳到应用里某处（Tibi 用 show_link / open_settings 给的） */
function LinkCard({ b }: { b: Of<'link'> }) {
  return <div className="wg">
    <div>{b.data.text}</div>
    <div className="wg-acts">{b.data.links.map((l, i) => <button key={l.href} className={`btn sm${i === 0 ? ' pri' : ''}`} onClick={() => { if (!openDeepLink(l.href)) toast(tl('这个入口打不开'), { kind: 'err' }); }}>{l.label}</button>)}</div>
  </div>;
}

/** 导入的最新进度和结果：卡片是导入开始后才显示的，开头几步的事件比卡片早，先记在这里 */
const importSeen = new Map<string, { label?: string; done?: ImportCardState }>();
const doneOf = (d: { ok: boolean; document_id?: string; title: string; duplicate?: boolean; minutes?: number; level?: string; error?: string }): ImportCardState =>
  d.ok && d.document_id ? { status: 'done', document_id: d.document_id, title: d.title, ...(d.duplicate ? { duplicate: true } : {}), ...(d.minutes ? { minutes: d.minutes } : {}), ...(d.level ? { level: d.level } : {}) } : { status: 'failed', error: d.error || tl('导入失败') };
rpc.on('import.progress', d => { if (d.origin === 'chat') importSeen.set(d.import_id, { ...importSeen.get(d.import_id), label: d.label }); });
rpc.on('import.done', d => { if (d.origin === 'chat') importSeen.set(d.import_id, { done: doneOf(d) }); if (importSeen.size > 50) importSeen.delete(importSeen.keys().next().value!); });

/** Tibi 在对话里起的导入：跟着导入事件走进度，结束后给「开始阅读」 */
function ImportCard({ b }: { b: Of<'import'> }) {
  const id = b.data.import_id;
  const [st, setSt] = useState<ImportCardState>((b.state as ImportCardState | undefined)?.status !== 'running' && b.state ? b.state as ImportCardState : importSeen.get(id)?.done ?? { status: 'running' });
  const [label, setLabel] = useState(importSeen.get(id)?.label);
  useEffect(() => { const s = b.state as ImportCardState | undefined; if (s && s.status !== 'running') setSt(s); }, [b.state]);
  useEffect(() => {
    const off1 = rpc.on('import.progress', d => { if (d.import_id === id) setLabel(d.label); });
    const off2 = rpc.on('import.done', d => { if (d.import_id === id) setSt(doneOf(d)); });
    return () => { off1(); off2(); };
  }, [id]);
  if (st.status === 'running') return <div className="wg wg-import">
    <div className="wg-hd"><span className="spin" /><span>{tl('正在导入 {source}', { source: b.data.source })}</span>{label && <span className="wg-k">{label}</span>}</div>
    <div className="wg-acts"><button className="btn sm" onClick={() => openDeepLink(deepLink({ to: 'library' }))}>{tl('去书架看看')}</button></div>
  </div>;
  if (st.status === 'failed') return <div className="wg wg-import">
    <div className="wg-hd"><span className="wg-bad">{tl('没导入成功')}</span><span className="wg-k">{b.data.source}</span></div>
    <div className="wg-k">{st.error}</div>
  </div>;
  const meta = [st.duplicate ? tl('书架里已经有这篇') : tl('已放进书架'), st.minutes ? tl('约 {n} 分钟', { n: st.minutes }) : '', st.level ?? ''].filter(Boolean).join(' · ');
  return <div className="wg wg-import">
    <div className="wg-w1">{st.title}</div>
    <div className="wg-k">{meta}</div>
    <div className="wg-acts"><button className="btn sm pri" onClick={() => openDeepLink(deepLink({ to: 'read', document_id: st.document_id }))}>{tl('开始阅读')}</button></div>
  </div>;
}

/** 新版本的卡片或坏数据不能拖垮整段对话：退回摘要 */
class Guard extends Component<{ summary: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? <p>{this.props.summary}</p> : this.props.children; }
}

function Widget({ b, state, update, fill, answer }: { b: WidgetBlock; state: unknown; update: Update; fill?: Fill; answer?: Answer }) {
  const card = b.kind === 'word' ? <WordCard b={b} state={state as never} update={update} />
    : b.kind === 'compare' ? <CompareCard b={b} />
    : b.kind === 'quiz' ? <QuizCard b={b} state={state as never} update={update} fill={fill} />
    : b.kind === 'ask' ? <AskCard b={b} state={state as never} answer={answer} />
    : b.kind === 'settings_link' ? <SettingsLinkCard b={b} />
    : b.kind === 'link' ? <LinkCard b={b} />
    : b.kind === 'import' ? <ImportCard b={b} />
    : <p>{(b as WidgetBlock).summary}</p>;
  return <Guard summary={b.summary}>{card}</Guard>;
}

/** 一条回答的内容：文字和卡片按出现的顺序排 */
export function Blocks({ blocks, states, update, fill, answer }: { blocks: MessageBlock[]; states: WidgetStates; update: Update; /** 把下一步建议放进输入框 */ fill?: Fill; /** 回答反问卡；不给就只读 */ answer?: Answer }) {
  return <div className="wg-blocks">{blocks.map((b, i) => b.type === 'text'
    ? <div key={i}><Markdown text={b.text} /></div>
    : <Widget key={b.id} b={b} state={b.id in states ? states[b.id] : b.state} update={update} fill={fill} answer={answer} />)}</div>;
}
