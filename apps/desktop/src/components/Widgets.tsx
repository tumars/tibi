import type { MessageBlock, WidgetBlock } from '@tibi/core';
import { Component, useState, type ReactNode } from 'react';
import { Volume2 } from 'lucide-react';
import { tl } from '../lib/i18n';
import { Markdown } from '../lib/md';
import { say } from '../lib/tts';
import type { WidgetStates } from '../lib/useChat';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import './widgets.css';

/**
 * 对话卡片（第一期）：查词、辨析、练习。数据来自能力结果，桌面和手机共用。
 * 按钮直接调能力，不经过模型；操作结果经 useChat 保存，重开对话能恢复，下一轮带给模型。
 */
type Update = (id: string, state: unknown, result?: string) => void;
type Fill = (text: string) => void;
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
      <button className="btn sm" onClick={() => void say(d.word)} aria-label={tl('朗读 {word}', { word: d.word })}><Volume2 size={14} /> {tl('朗读')}</button>
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

/** 新版本的卡片或坏数据不能拖垮整段对话：退回摘要 */
class Guard extends Component<{ summary: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? <p>{this.props.summary}</p> : this.props.children; }
}

function Widget({ b, state, update, fill }: { b: WidgetBlock; state: unknown; update: Update; fill?: Fill }) {
  const card = b.kind === 'word' ? <WordCard b={b} state={state as never} update={update} />
    : b.kind === 'compare' ? <CompareCard b={b} />
    : b.kind === 'quiz' ? <QuizCard b={b} state={state as never} update={update} fill={fill} />
    : <p>{(b as WidgetBlock).summary}</p>;
  return <Guard summary={b.summary}>{card}</Guard>;
}

/** 一条回答的内容：文字和卡片按出现的顺序排 */
export function Blocks({ blocks, states, update, fill }: { blocks: MessageBlock[]; states: WidgetStates; update: Update; /** 把下一步建议放进输入框 */ fill?: Fill }) {
  return <div className="wg-blocks">{blocks.map((b, i) => b.type === 'text'
    ? <div key={i}><Markdown text={b.text} /></div>
    : <Widget key={b.id} b={b} state={b.id in states ? states[b.id] : b.state} update={update} fill={fill} />)}</div>;
}
