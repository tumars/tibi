import { isStreakMilestone, Mascot } from '../components/Mascot';
import type { Rating } from '@tibi/core';
import { RotateCcw, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { tl } from '../lib/i18n';
import { splitAnswer, STATUS_NAMES } from '../lib/util';
import { PlayButton, usePlayback } from '../review/PlayButton';
import { Practice } from '../review/Practice';
import { useReviewSession } from '../review/useReviewSession';
import { useCore } from '../store/core';
import { useUi } from '../store/ui';
import { LevelUp } from '../components/LevelUp';
import { Empty } from './ui';

const RATING = { 1: tl('忘了'), 2: tl('模糊'), 3: tl('记得'), 4: tl('轻松') } as const;
const vibrate = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* 不支持 */ } };

/** 复习（00 §3.13 J6）：入口页显示今天的张数；做题时题目在上半屏、操作都在下半屏；左上角关闭 = 稍后继续 */
export function MReview() {
  const [params, setParams] = useSearchParams();
  const due = useCore(s => s.due);
  if (params.get('run') === '1') return <Session onExit={() => setParams({}, { replace: true })} />;
  if (params.get('practice') === '1') return <div className="screen"><div className="top"><button className="ib" aria-label={tl('返回')} onClick={() => setParams({}, { replace: true })}><X size={20} /></button></div><div className="pad mpractice"><Practice /></div></div>;
  return (
    <div className="screen">
      <div className="topgap" />
      <div className="pad">
        <div className="card rvc" style={{ marginTop: 0 }}>
          <span className="ic"><RotateCcw size={20} /></span>
          <div><b>{due ? tl('复习 {n} 张', { n: due }) : tl('今天没有要复习的')}</b><span>{due ? tl('约 {m} 分钟', { m: Math.max(1, Math.round(due * 20 / 60)) }) : tl('读文章时点开的生词会排进来')}</span></div>
          {due > 0 && <button className="btn sm pri" onClick={() => setParams({ run: '1' })}>{tl('开始')}</button>}
        </div>
        <div className="sec"><h2>{tl('练习（不计分）')}</h2>
          <button className="card rvc" style={{ width: '100%', textAlign: 'left', marginTop: 0 }} onClick={() => setParams({ practice: '1' })}>
            <div><b>{tl('听写、拼写、易混词、造句')}</b><span>{tl('不影响复习排期')}</span></div><span className="btn sm tint">{tl('开始')}</span></button></div>
      </div>
    </div>
  );
}

function Session({ onExit }: { onExit: () => void }) {
  const nav = useNavigate();
  const streak = useCore(s => s.streak); const less = useUi(s => s.lessMascot);
  const r = useReviewSession();
  const { session, err, phase, setPhase, typed, setTyped, hints, setHints, done, item } = r;
  const { playing, toggle: togglePlay } = usePlayback(!item ? '' : item.intro ? item.term.display : item.context.sentence);
  const close = async () => { await r.pause(); onExit(); };
  const answer = async (a: Parameters<typeof r.answer>[0]) => { await r.answer(a); };
  if (err) return <div className="screen" id="s-review"><div className="topgap" /><Empty image="error-generic" title={tl('复习还没准备好')} text={err} action={<button className="btn sm" onClick={() => void r.load()}>{tl('重试')}</button>} /></div>;
  if (!session) return <div className="screen" id="s-review" />;
  if (done || !item) {
    const s = r.summary();
    const medal = session.kind !== 'drill' && !less && isStreakMilestone(streak);
    return <div className="screen" id="s-review"><div className="topgap" /><div className="pad done">
      {session.steps.length === 0 ? <Empty image="empty-review" title={tl('今天没有要复习的')} text={tl('读文章时点开的生词会排进来。')} /> : <>
        <div className="fx"><Mascot id={medal ? 'celebrate-streak' : 'celebrate-review'} /></div>
        <h3>{medal ? tl('连续 {n} 天。Tibi 有点意外。', { n: streak }) : !less && session.kind !== 'drill' && s.graded > 0 ? tl('{n} 张，全翻完了。', { n: s.graded }) : tl('今天的复习完成了')}</h3>
        <div className="k3"><div><b>{s.graded}</b><span>{tl('张卡')}</span></div><div><b>{s.correctPct}%</b><span>{tl('首次就答对')}</span></div><div><b>{s.minutes}</b><span>{tl('分钟')}</span></div></div>
        {s.wrong.length > 0 && <button className="btn full" style={{ marginBottom: 8 }} onClick={() => void r.drill(s.wrong)}>{tl('再练 {length} 个错词（不计分）', { length: s.wrong.length })}</button>}
        <button className="story" style={{ width: '100%' }} onClick={() => void r.story()}><b>{tl('读一篇用到这些词的短文')}</b><span>{tl('Tibi 写好后放进书架')}</span></button>
      </>}
      <button className="btn pri full" onClick={() => { onExit(); nav('/'); }}>{tl('回首页')}</button>
    </div></div>;
  }
  const ctx = item.context; const sp = splitAnswer(ctx.sentence, ctx.answer, ctx.surface, item.card_type === 'cloze' && phase.kind === 'ask'); const ans = sp.mid || (ctx.answer[0] ?? item.term.display);
  const res = phase.kind === 'answered' ? phase.result : undefined;
  const sent = item.card_type === 'cloze' && phase.kind === 'ask' ? <>{sp.before}<input autoFocus value={typed} onChange={e => setTyped(e.target.value)} placeholder={hints ? ans.slice(0, hints) : undefined} aria-label={tl('填空')} autoCapitalize="off" autoCorrect="off" onKeyDown={e => { if (e.key === 'Enter') void answer({ typed }); }} />{sp.after}</>
    : item.card_type === 'cloze' && phase.kind === 'answered' ? <>{sp.before}{res?.correct ? <span className="fix">{sp.mid || ans}</span> : <><span className="bad">{phase.typed || '—'}</span> <span className="fix">{sp.mid || ans}</span></>}{sp.after}</>
    : <>{sp.before}<mark>{sp.mid || ans}</mark>{sp.after}</>;
  const onAnswered = (ok: boolean) => vibrate(ok ? 12 : [12, 60, 12]);
  return (
    <div className="screen" id="s-review">
      <div className="rvhead"><button className="x" aria-label={tl('稍后继续')} onClick={() => void close()}><X size={20} /></button>
        <div className="segs">{session.steps.map(s => <i key={s.step} className={r.segClass(s)} />)}</div>
        <span className="n">{session.cursor + 1}/{session.steps.length}</span></div>
      <div className="rvbody">
        <div className="k"><span>{item.intro ? tl('初见') : { choice: tl('选义'), cloze: tl('语境填空'), recognize: tl('识别') }[item.card_type]}</span>
          {item.retry > 0 && <span className="rt">{tl('重练 · 不计分')}</span>}
          {res?.status_change ? <LevelUp from={res.status_change.from} to={res.status_change.to} /> : <span className={`stage s${item.term.status}`}>{STATUS_NAMES[item.term.status]}</span>}<span className="sp" style={{ flex: 1 }} />
          <PlayButton playing={playing} onToggle={togglePlay} /></div>
        {item.intro ? <>
          <div className="ihw">{item.term.display}{item.term.ipa && <small>/{item.term.ipa}/</small>}</div>
          <p style={{ fontSize: 15 }}>{item.term.meaning}</p>
          <div className="sent" style={{ fontSize: 18, color: 'var(--ink-2)' }}>{ctx.sentence}</div>
        </> : <>
          <div className="q">{item.card_type === 'choice' ? tl('它在这句话里是什么意思？') : item.card_type === 'cloze' ? tl('填上这个词{v0}', { v0: item.hint ? tl('：{hint}', { hint: item.hint }) : '' }) : tl('看着这个词，想一想它的意思')}</div>
          <div className="sent">{sent}</div>
          {phase.kind !== 'ask' && <div className="ans">
            {res && item.card_type !== 'recognize' && <div className={`verdict ${res.correct ? 'ok' : 'bad'}`}>{res.correct ? (res.near_miss ? tl('差一点') : tl('答对了')) : item.card_type === 'cloze' ? tl('没填对') : tl('选错了')}</div>}
            <b>{item.term.display}</b>{item.term.ipa && <span className="ipa">/{item.term.ipa}/</span>}
            <p>{item.term.meaning}</p>{ctx.translation && <p className="zh">{ctx.translation}</p>}
          </div>}
        </>}
      </div>
      <div className="rvfoot">
        {item.intro && <button className="btn pri full" onClick={() => void r.next()}>{tl('认识了')}</button>}
        {!item.intro && item.card_type === 'choice' && <div className="opts">{item.options?.map(o => {
          if (phase.kind !== 'answered') return <button key={o.id} className="ropt" onClick={() => void answer({ choice: o.id }).then(() => undefined)}>{o.text}</button>;
          const correct = o.id === phase.result.correct_option; const chosen = phase.chosen === o.id;
          return <button key={o.id} className={`ropt${correct ? ' ok' : chosen ? ' bad' : ' dim'}`} disabled>{o.text}</button>;
        })}</div>}
        {!item.intro && item.card_type === 'cloze' && phase.kind === 'ask' && <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn pri" style={{ flex: 1 }} onClick={() => void answer({ typed })}>{tl('检查')}</button>
          <button className="btn" onClick={() => setHints(h => h + 1)}>{tl('提示')}</button></div>}
        {!item.intro && item.card_type === 'recognize' && phase.kind === 'ask' && <button className="btn pri full" onClick={() => setPhase({ kind: 'reveal' })}>{tl('显示答案')}</button>}
        {!item.intro && item.card_type === 'recognize' && phase.kind === 'reveal' && <div className="rates">{([1, 2, 3, 4] as Rating[]).map(n => <button key={n} className={`r${n}`} onClick={() => void answer({ self_rating: n })}>{RATING[n]}</button>)}</div>}
        {res && <>
          {res.rating && <div className="gline"><span className={`gtag r${res.rating}`}>{RATING[res.rating]}</span><span>{res.reason}{res.next ? ` · ${res.next.label}` : ''}</span></div>}
          {res.auto && <div className="rates">{([1, 2, 3, 4] as Rating[]).map(n => <button key={n} className={`r${n}${res.rating === n ? ' sug' : ''}`} onClick={() => void r.override(n)}>{RATING[n]}</button>)}</div>}
          <button className="btn pri full" onClick={() => { onAnswered(res.correct); void r.next(); }}>{tl('继续')}</button>
        </>}
      </div>
    </div>
  );
}
