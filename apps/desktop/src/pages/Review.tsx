import { isStreakMilestone, Mascot } from '../components/Mascot';
import type { Rating } from '@tibi/core';
import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { PlayButton, usePlayback } from '../review/PlayButton';
import { Practice } from '../review/Practice';
import { useReviewSession } from '../review/useReviewSession';
import { Empty } from '../components/Empty';
import { LevelUp } from '../components/LevelUp';
import { Top } from '../components/Shell';
import { splitAnswer, STATUS_NAMES, isImeKey } from '../lib/util';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast, useUi } from '../store/ui';
import { tl } from '../lib/i18n';

const RATING = { 1: tl('忘了'), 2: tl('模糊'), 3: tl('记得'), 4: tl('轻松') } as const;

/** 复习（00 §3.3，G1–G8）：题目在卡片里，所有操作固定在底部；状态和动作在 useReviewSession（手机复习页共用） */
function ReviewSessionView({ tabs }: { tabs: React.ReactNode }) {
  const nav = useNavigate();
  const streak = useCore(s => s.streak); const less = useUi(s => s.lessMascot);
  const { session, err, phase, setPhase, typed, setTyped, hints, setHints, done, item, load, answer, next, override, undo, pause: pauseSession, drill, story, summary, segClass } = useReviewSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const { playing, toggle: togglePlay } = usePlayback(!item ? '' : item.intro ? item.term.display : item.context.sentence);
  const pause = async () => { await pauseSession(); nav('/'); };

  // 键盘：空格显示答案、Enter 检查 / 继续、1–4 选项或评分、Z 撤销、P 播放
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!item || done || isImeKey(e)) return;
      const inInput = e.target instanceof HTMLInputElement;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (phase.kind === 'answered' || item.intro) void next();
        else if (item.card_type === 'cloze' && phase.kind === 'ask') void answer({ typed });
        else if (item.card_type === 'recognize' && phase.kind === 'ask') setPhase({ kind: 'reveal' });
        return;
      }
      if (inInput) return;
      if (e.key === ' ' && item.card_type === 'recognize' && phase.kind === 'ask') { e.preventDefault(); setPhase({ kind: 'reveal' }); }
      if (/^[1-4]$/.test(e.key)) {
        const n = Number(e.key) as Rating;
        if (item.card_type === 'choice' && phase.kind === 'ask' && item.options?.[n - 1]) void answer({ choice: item.options[n - 1]!.id });
        else if (item.card_type === 'recognize' && phase.kind === 'reveal') void answer({ self_rating: n });
        else if (phase.kind === 'answered' && phase.result.auto) void override(n);
      }
      if (e.key.toLowerCase() === 'z') void undo();
      if (e.key.toLowerCase() === 'p') togglePlay();
    };
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, phase, typed, done, next, answer, togglePlay]);

  useEffect(() => { if (item?.card_type === 'cloze' && phase.kind === 'ask') inputRef.current?.focus(); }, [item, phase]);

  if (err) return <><Top crumbs={[{ label: tl('复习') }]} right={tabs} /><Empty image="error-generic" title={tl('复习还没准备好')} text={err} action={<button className="btn" onClick={() => load()}>{tl('重试')}</button>} /></>;
  if (!session) return <><Top crumbs={[{ label: tl('复习') }]} right={tabs} /><div className="scroll" /></>;
  if (done || !item) {
    const { graded, correctPct, minutes, wrong } = summary();
    const medal = session.kind !== 'drill' && !less && isStreakMilestone(streak);
    return <>
      <Top crumbs={[{ label: tl('复习') }]} right={tabs} />
      <div className="scroll"><div className="rv">
        {session.steps.length === 0 ? <Empty image="empty-review" title={tl('今天没有要复习的')} text={tl('读文章时点开的生词会排进来。')} action={<button className="btn" onClick={() => nav('/library')}>{tl('去读点什么')}</button>} /> : (
          <div className="done">
            <Mascot id={medal ? 'celebrate-streak' : 'celebrate-review'} />
            <h3>{medal ? tl('连续 {n} 天。Tibi 有点意外。', { n: streak }) : session.kind === 'drill' ? tl('练完了') : !less && graded > 0 ? tl('{n} 张，全翻完了。', { n: graded }) : tl('今天的复习完成了')}</h3>
            <div className="k3">
              <div><b>{graded}</b><span>{tl('张卡')}</span></div>
              <div><b>{correctPct}%</b><span>{tl('首次就答对')}</span></div>
              <div><b>{minutes}</b><span>{tl('分钟')}</span></div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              {wrong.length > 0 && <button className="btn" onClick={() => void drill(wrong)}>{tl('再练 {length} 个错词（不计分）', { length: wrong.length })}</button>}
              {session.kind !== 'drill' && session.steps.length > 0 && <button className="btn" onClick={() => void story()}>{tl('读一篇用到这些词的短文')}</button>}
              <button className="btn" onClick={() => nav('/review?tab=practice')}>{tl('去练习')}</button>
              <button className="btn pri" onClick={() => nav('/')}>{tl('回首页')}</button>
            </div>
          </div>
        )}
      </div></div>
    </>;
  }

  const ctx = item.context;
  const sentHtml = () => {
    const { before, mid, after } = splitAnswer(ctx.sentence, ctx.answer, ctx.surface, item.card_type === 'cloze' && phase.kind === 'ask');
    const ans = mid || (ctx.answer[0] ?? item.term.display);
    if (item.card_type === 'cloze' && phase.kind === 'ask') return <>{before}<input ref={inputRef} value={typed} onChange={e => setTyped(e.target.value)} placeholder={hints ? ans.slice(0, hints) : undefined} aria-label={tl('填空')} />{after}</>;
    if (item.card_type === 'cloze' && phase.kind === 'answered') return <>{before}{phase.result.correct ? <span className="fix">{mid || ans}</span> : <><span className="bad">{phase.typed || '—'}</span> <span className="fix">{mid || ans}</span></>}{after}</>;
    return <>{before}<mark>{mid || ans}</mark>{after}</>;
  };
  const r = phase.kind === 'answered' ? phase.result : undefined;
  const stepLeft = session.steps.length - session.cursor;

  return (
    <>
      <Top crumbs={[{ label: tl('复习') }]} right={<>{tabs}<button className="btn sm" onClick={pause}>{tl('稍后继续')}</button></>} />
      <div className="scroll"><div className="rv">
        <div className="rvhead">
          <div className="segs">{session.steps.map(s => <i key={s.step} className={segClass(s)} />)}</div>
          <span className="lbl" style={{ fontVariantNumeric: 'tabular-nums' }}>{tl('第 {v0} / {length} 步 · 还剩约 {v2} 分钟', { v0: session.cursor + 1, length: session.steps.length, v2: Math.max(1, Math.round(stepLeft * 20 / 60)) })}</span>
        </div>
        <div className="rvcard">
          <div className="k">
            <span>{item.intro ? tl('初见') : { choice: tl('选义'), cloze: tl('语境填空'), recognize: tl('识别') }[item.card_type]}</span>
            {item.retry > 0 && <span className="rt">{tl('重练 · 不计分')}</span>}
            <span>{tl('· 熟练度')} <span className={`stage s${item.term.status}`}>{STATUS_NAMES[item.term.status]}</span></span>
            {item.is_new && !item.retry && <span>{tl('· 新词')}</span>}
            <span className="sp" />
            <PlayButton playing={playing} onToggle={togglePlay} shortcut="P" />
          </div>
          {item.intro ? (
            <>
              <div className="ihw">{item.term.display}{item.term.ipa && <small>/{item.term.ipa}/</small>}</div>
              <p style={{ fontSize: 15, marginTop: 8 }}>{item.term.meaning}</p>
              <div className="sent" style={{ fontSize: 17, color: 'var(--ink-2)' }}>{ctx.sentence}</div>
              {ctx.translation && <div className="lbl" style={{ marginTop: 4 }}>{ctx.translation}</div>}
            </>
          ) : (
            <>
              <div className="q">{item.card_type === 'choice' ? tl('它在这句话里是什么意思？') : item.card_type === 'cloze' ? tl('填上这个词{v0}', { v0: item.hint ? tl('：{hint}', { hint: item.hint }) : '' }) : tl('看着这个词，想一想它的意思')}</div>
              <div className="sent">{sentHtml()}</div>
              {(phase.kind !== 'ask' || item.card_type !== 'recognize') && phase.kind !== 'ask' && (
                <div className="ans">
                  {r && <div className={`verdict ${r.correct ? 'ok' : 'bad'}`}>{item.card_type === 'recognize' ? '' : r.correct ? (r.near_miss ? tl('差一点') : tl('答对了')) : item.card_type === 'cloze' ? tl('没填对') : tl('选错了')}</div>}
                  <b>{item.term.display}</b>{item.term.ipa && <span className="ipa">/{item.term.ipa}/</span>}
                  <p>{item.term.meaning}</p>
                  {ctx.translation && <p className="zh">{ctx.translation}</p>}
                  {item.note && <p className="zh">{item.note}</p>}
                  {ctx.document_title && <p className="lbl">{ctx.document_title}{ctx.document_id && <> · <a className="linkbtn" href={`#/read/${ctx.document_id}`}>{tl('回到原文')}</a></>}</p>}
                </div>
              )}
            </>
          )}
        </div>
        <div className="rvfoot">
          {item.intro && <button className="btn pri" style={{ height: 44 }} onClick={next}>{tl('认识了')} <span className="kbd" style={{ marginLeft: 6 }}>Enter</span></button>}
          {!item.intro && item.card_type === 'choice' && phase.kind === 'ask' && <div className="opts">{item.options?.map((o, i) => <button key={o.id} className="ropt" onClick={() => answer({ choice: o.id })}><span className="k">{i + 1}</span>{o.text}</button>)}</div>}
          {!item.intro && item.card_type === 'choice' && phase.kind === 'answered' && <div className="opts">{item.options?.map((o, i) => { const correct = o.id === phase.result.correct_option; const chosen = phase.chosen === o.id; return <button key={o.id} className={`ropt${correct ? ' ok' : chosen ? ' bad' : ' dim'}`} disabled><span className="k">{i + 1}</span>{o.text}{chosen && !correct && o.from && <span className="from">{o.from}</span>}</button>; })}</div>}
          {!item.intro && item.card_type === 'cloze' && phase.kind === 'ask' && <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn pri" style={{ height: 44, flex: 1, justifyContent: 'center' }} onClick={() => answer({ typed })}>{tl('检查')} <span className="kbd" style={{ marginLeft: 6 }}>Enter</span></button>
            <button className="btn" style={{ height: 44 }} onClick={() => setHints(h => h + 1)}>{tl('提示一个字母{v0}', { v0: hints ? ` (${hints})` : '' })}</button>
          </div>}
          {!item.intro && item.card_type === 'recognize' && phase.kind === 'ask' && <button className="btn pri" style={{ height: 44 }} onClick={() => setPhase({ kind: 'reveal' })}>{tl('显示答案')} <span className="kbd" style={{ marginLeft: 6 }}>{tl('空格')}</span></button>}
          {!item.intro && item.card_type === 'recognize' && phase.kind === 'reveal' && <div className="rates">{([1, 2, 3, 4] as Rating[]).map(n => <button key={n} className={`r${n}`} onClick={() => answer({ self_rating: n })}>{RATING[n]}<small>{tl('{n} 键', { n })}</small></button>)}</div>}
          {phase.kind === 'answered' && r && <>
            {r.rating && <div className="gline"><span className={`gtag r${r.rating}`}>{RATING[r.rating]}</span><span>{r.reason}{r.next ? ` · ${r.next.label}` : ''}</span>{r.auto && <span className="sp" />}{r.auto && <span className="lbl">{tl('改评分：按 1–4')}</span>}</div>}
            {r.status_change && <LevelUp from={r.status_change.from} to={r.status_change.to} />}
            <button className="btn pri" style={{ height: 44 }} onClick={next}>{tl('继续')} <span className="kbd" style={{ marginLeft: 6 }}>Enter</span></button>
          </>}
          <div className="lbl" style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 4 }}>
            <span><span className="kbd">Z</span> {tl('撤销上一张')}</span><span><span className="kbd">P</span> {tl('播放')}</span>
          </div>
        </div>
      </div></div>
    </>
  );
}

/** 复习页（00 §3.3）：顶栏"复习 / 练习"切换；练习不计分（G8 / R6） */
export function Review() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'practice' ? 'practice' : 'review';
  const tabs = <div className="seg">{(['review', 'practice'] as const).map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setParams(t === 'practice' ? { tab: 'practice' } : {}, { replace: true })}>{t === 'review' ? tl('复习') : tl('练习')}</button>)}</div>;
  if (tab === 'practice') return <><Top crumbs={[{ label: tl('复习') }]} right={tabs} /><div className="scroll"><div className="rv"><Practice /></div></div></>;
  return <ReviewSessionView tabs={tabs} />;
}
