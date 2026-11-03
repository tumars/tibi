import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bars } from '../components/Charts';
import { Mascot } from '../components/Mascot';
import { locale, tl } from '../lib/i18n';
import { isImeKey } from '../lib/util';
import { errorInfo, rpc, type Result } from '../rpc';
import { useCore } from '../store/core';
import { toast, useUi } from '../store/ui';
import { MODES } from './Practice';

type Data = Result<'review.overview'>;

/** 一步约 20 秒；新词先初见再回忆，按 1.5 步算 */
const estMinutes = (due: number, fresh: number) => Math.max(1, Math.round((due + fresh * 1.5) * 20 / 60));

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return tl('{m} 分钟前', { m: Math.max(1, m) });
  const h = Math.round(m / 60);
  return h < 24 ? tl('{h} 小时前', { h }) : tl('{d} 天前', { d: Math.round(h / 24) });
}

/**
 * 复习页面板（00 §3.3"复习页入口"）：进来先看今天要做什么、做到哪了，再决定开始；不建会话。
 * 今天 → 今天做了多少 → 接下来 7 天 / 这周忘过的词 → 练习 → 复习设置。
 */
export function ReviewOverview() {
  const nav = useNavigate();
  const streak = useCore(s => s.streak); const less = useUi(s => s.lessMascot);
  const recognizeLabel = useRecognize();
  const [d, setD] = useState<Data>();
  const [err, setErr] = useState<string>();
  const load = () => { setErr(undefined); rpc.call('review.overview', {}).then(setD, e => setErr(errorInfo(e).message)); };
  useEffect(load, []);

  const restart = async () => {
    try { await rpc.call('review.start', { resume: false }); nav('/review?run=1'); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  // Enter：开始 / 接着复习
  const canStart = !!d && (!!d.open || d.due + d.fresh > 0);
  useEffect(() => {
    if (!canStart) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !isImeKey(e) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); nav('/review?run=1'); } };
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
  }, [canStart, nav]);

  if (err) return <div className="page rvhome"><div className="rvhero"><div className="m"><span className="k">{tl('复习')}</span><b className="big">{tl('面板没加载出来')}</b><span className="d">{err}</span></div><div className="acts"><button className="btn" onClick={load}>{tl('重试')}</button></div></div></div>;
  if (!d) return <div className="page rvhome" />;

  const total = d.due + d.fresh;
  const todayPct = d.today.reviews ? Math.round(d.today.correct / d.today.reviews * 100) : 0;
  const days = d.forecast.map((_, i) => i === 0 ? tl('今天') : i === 1 ? tl('明天') : new Date(Date.now() + i * 86_400_000).toLocaleDateString(locale, { weekday: 'short' }));
  const week = d.forecast.slice(1).reduce((a, b) => a + b, 0);

  return (
    <div className="page rvhome">
      {d.open ? (
        <div className="rvhero">
          <div className="m">
            <span className="k">{tl('复习做到一半')}</span>
            <b className="big">{tl('还剩 {n} 张', { n: d.open.left })}</b>
            <span className="d">{tl('这一轮共 {total} 张 · 约 {m} 分钟 · {ago}停下的', { total: d.open.total, m: estMinutes(d.open.left, 0), ago: ago(d.open.updated_at) })}</span>
          </div>
          <div className="acts">
            <button className="btn" onClick={() => void restart()}>{tl('从头开始')}</button>
            <button className="btn pri" onClick={() => nav('/review?run=1')}>{tl('接着复习')} <span className="kbd" style={{ marginLeft: 6 }}>Enter</span></button>
          </div>
        </div>
      ) : total > 0 ? (
        <div className="rvhero">
          <div className="m">
            <span className="k">{tl('今天要复习')}</span>
            <b className="big">{total}<small>{tl('张')}</small></b>
            <span className="chips">
              {d.due > 0 && <span>{tl('到期 {n}', { n: d.due })}{d.late > 0 && <em>{tl('（逾期 {n}）', { n: d.late })}</em>}</span>}
              {d.fresh > 0 && <span>{tl('新词 {n}', { n: d.fresh })}</span>}
              <span>{tl('约 {m} 分钟', { m: estMinutes(d.due, d.fresh) })}</span>
            </span>
          </div>
          <div className="acts"><button className="btn pri" onClick={() => nav('/review?run=1')}>{tl('开始复习')} <span className="kbd" style={{ marginLeft: 6 }}>Enter</span></button></div>
        </div>
      ) : (
        <div className="rvhero calm">
          {!less && d.today.reviews > 0 && <Mascot id="celebrate-review" />}
          <div className="m">
            <span className="k">{tl('今天')}</span>
            <b className="big">{d.today.reviews > 0 ? tl('今天的复习做完了') : tl('今天没有要复习的')}</b>
            <span className="d">{d.forecast[1] ? tl('明天有 {n} 张。', { n: d.forecast[1] }) : tl('明天也没有到期的。')}{d.new_waiting > 0 && d.fresh === 0 ? tl('今天的新词额度用完了，还有 {n} 个排在后面。', { n: d.new_waiting }) : d.new_waiting === 0 && d.today.reviews === 0 ? tl('读文章时点开的生词会排进来。') : ''}</span>
          </div>
          <div className="acts">
            {d.later_today > 0 && <button className="btn" onClick={() => nav('/review?run=1&ahead=1')}>{tl('提前复习 {n} 张', { n: d.later_today })}</button>}
            {d.new_waiting === 0 && d.today.reviews === 0 ? <button className="btn pri" onClick={() => nav('/library')}>{tl('去读点什么')}</button> : <button className="btn pri" onClick={() => nav('/review?tab=practice')}>{tl('练一会儿（不计分）')}</button>}
          </div>
        </div>
      )}

      <div className="tiles four">
        <div className="tile"><span className="k">{tl('今天已复习')}</span><span className="v">{d.today.reviews}<small>{tl('次')}</small></span><span className="d">{d.today.reviews ? tl('答对 {p}% · {m} 分钟', { p: todayPct, m: Math.max(1, d.today.minutes) }) : tl('还没开始')}</span></div>
        <div className="tile"><span className="k">{tl('今天新学')}</span><span className="v">{d.today.new_learned}<small>/ {d.daily_new}</small></span><span className="d">{d.new_waiting ? tl('还有 {n} 个新词排队', { n: d.new_waiting }) : tl('没有排队的新词')}</span></div>
        <div className="tile"><span className="k">{tl('连续学习')}</span><span className="v">{streak}<small>{tl('天')}</small></span><span className="d">{tl('读或复习都算')}</span></div>
        <button className="tile" onClick={() => nav('/words?view=leech')}><span className="k">{tl('难词')}</span><span className="v">{d.leeches}<small>{tl('词')}</small></span><span className="d">{d.leeches ? tl('忘了 3 次以上 · 去看看 →') : tl('还没有总忘的词')}</span></button>
      </div>

      <div className="two">
        <section>
          <div className="sech"><h2>{tl('接下来 7 天')}</h2><span className="lbl">{tl('之后 6 天共 {n} 张', { n: week })}</span></div>
          <Bars values={d.forecast} hi={(_, i) => i === 0} height={96} labels={days} title={(v, i) => tl('{day} · {v} 张', { day: days[i], v })} />
        </section>
        <section>
          <div className="sech"><h2>{tl('这周忘过的词')}</h2>{d.mistakes.length > 0 && <button className="linkbtn" onClick={() => nav('/review?tab=practice&source=mistakes')}>{tl('练这些（不计分）')}</button>}</div>
          {d.mistakes.length ? <ul className="rvmiss">{d.mistakes.map(m => (
            <li key={m.term_id}><a href={`#/words?term=${m.term_id}`}><b>{m.display}</b><span>{m.meaning}</span>{m.lapses >= 3 && <i className="hard">{tl('难')}</i>}</a></li>
          ))}</ul> : <p className="lbl">{tl('这周没有忘过的词。')}</p>}
        </section>
      </div>

      <section>
        <div className="sech"><h2>{tl('练习')}</h2><span className="lbl">{tl('不计分，不影响复习排期')}</span></div>
        <div className="pmodes four">{MODES.map(m => <button key={m.key} onClick={() => nav(`/review?tab=practice&mode=${m.key}`)}><b>{m.label}</b><span>{m.desc}</span></button>)}</div>
      </section>

      <div className="rvset lbl">
        <span>{tl('每天最多新学 {n} 个', { n: d.daily_new })}</span><span>·</span><span>{recognizeLabel}</span><span>·</span>
        <a href="#/settings?sec=learning">{tl('复习设置 →')}</a><span className="sp" /><a href="#/words?view=due">{tl('在生词本里看今天到期的 →')}</a>
      </div>
    </div>
  );
}

function useRecognize(): string {
  const [on, setOn] = useState(false);
  useEffect(() => { rpc.call('settings.get', { keys: ['review.recognize'] }).then(r => setOn(!!r['review.recognize']), () => undefined); }, []);
  return on ? tl('出识别题') : tl('不出识别题');
}
