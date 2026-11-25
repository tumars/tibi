import { Fragment, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AreaChart, Bars, Heatmap, StackBars } from '../components/Charts';
import { Empty } from '../components/Empty';
import { Top } from '../components/Shell';
import { MetricDueIcon, MetricMasteredIcon, MetricReadIcon, MetricStreakIcon, TibiAvatar } from '../components/TibiIcons';
import { PageFooter, SectionHeader } from '../components/ui';
import { GENRE_NAMES, STATUS_NAMES } from '../lib/util';
import { errorInfo, rpc, type Result } from '../rpc';
import { useCore } from '../store/core';
import { locale, tl } from '../lib/i18n';

/**
 * 学习统计（00 §3.6）：四项指标 → Tibi 洞察 → 已掌握的词 → 每日阅读 →
 * 接下来要复习 → 复习表现 → 学习日历 → 生词本熟练度 → 按类型阅读量 → 页脚（免责声明与更新时间仅出现一次）。
 */
type Range = 30 | 90 | 180;
const RANGE_LABEL: Record<Range, string> = { 30: tl('30 天'), 90: tl('90 天'), 180: tl('半年') };

export function Stats() {
  const nav = useNavigate();
  const [range, setRange] = useState<Range>(30);
  const [sum, setSum] = useState<Result<'stats.summary'>>();
  const [mastered, setMastered] = useState<Result<'stats.series'>>();
  const [daily, setDaily] = useState<Result<'stats.series'>>();
  const [cal, setCal] = useState<Result<'stats.series'>>();
  const [ret, setRet] = useState<Result<'stats.retention'>>();
  const [fc, setFc] = useState<Result<'stats.forecast'>>();
  const [stages, setStages] = useState<number[]>([]);
  const [genres, setGenres] = useState<Result<'stats.genres'>>([]);
  const [updatedAt, setUpdatedAt] = useState<Date>(() => new Date());
  const [ins, setIns] = useState<{ state: 'idle' | 'loading' | 'ok' | 'err' | 'nomodel'; data?: NonNullable<Result<'stats.insight'>['insight']>; err?: string }>({ state: 'idle' });
  const goal = useCore(s => s.goal); const modelOk = useCore(s => !!s.status?.models.ok);

  useEffect(() => {
    void rpc.call('stats.summary', { range }).then(r => { setSum(r); setUpdatedAt(new Date()); }, () => undefined);
    void rpc.call('stats.series', { metrics: ['mastered'], days: range }).then(setMastered, () => undefined);
    void rpc.call('stats.genres', { range }).then(setGenres, () => undefined);
  }, [range]);
  useEffect(() => {
    void rpc.call('stats.series', { metrics: ['minutes', 'words'], days: 30 }).then(setDaily, () => undefined);
    void rpc.call('stats.series', { metrics: ['minutes', 'reviews'], days: 182 }).then(setCal, () => undefined);
    void rpc.call('stats.retention', { weeks: 12 }).then(setRet, () => undefined);
    void rpc.call('stats.forecast', { days: 14 }).then(setFc, () => undefined);
    void rpc.call('stats.stages', {}).then(r => setStages(r.stages), () => undefined);
  }, []);
  const loadInsight = useCallback(async (regenerate = false) => {
    if (!modelOk) { setIns({ state: 'nomodel' }); return; }
    setIns(s => ({ ...s, state: 'loading' }));
    try { const r = await rpc.call('stats.insight', { regenerate }); setIns({ state: 'ok', data: r.insight }); }
    catch (e) { setIns({ state: 'err', err: errorInfo(e).message }); }
  }, [modelOk]);
  useEffect(() => { void loadInsight(); }, [loadInsight]);

  const empty = sum && !sum.minutes && !sum.reviews && !sum.mastered && !stages.some(Boolean) && !(daily?.series.minutes ?? []).some(Boolean);
  const totalStages = stages.reduce((a, b) => a + b, 0);
  const retWeeks = ret?.weeks ?? []; const retTotal = retWeeks.reduce((a, w) => a + w.ratings.reduce((x, y) => x + y, 0), 0);
  const retRate = retTotal ? retWeeks.reduce((a, w) => a + w.ratings[1] + w.ratings[2] + w.ratings[3], 0) / retTotal : 0;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <>
      <Top crumbs={[{ label: tl('统计') }]} right={<div className="seg">{([30, 90, 180] as Range[]).map(r => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{RANGE_LABEL[r]}</button>)}</div>} />
      <div className="scroll"><div className="page stats">
        {empty ? <Empty image="empty-stats" title={tl('完成首次阅读或复习后将生成学习统计。')} action={<button className="btn pri" onClick={() => nav('/')}>{tl('开始阅读')}</button>} /> : <>
          <div className="tiles four">
            <button className="tile" onClick={() => jump('st-mastered')}><div className="tile-head"><span className="k">{tl('已掌握')}</span><span className="tile-ic ok"><MetricMasteredIcon /></span></div><span className="v">{(sum?.mastered ?? 0).toLocaleString()}<small>{tl('词')}</small></span><span className="d">{tl('{v0}内', { v0: RANGE_LABEL[range] })} {(sum?.mastered_delta ?? 0) >= 0 ? '+' : ''}{sum?.mastered_delta ?? 0}{sum?.prev_delta ? tl(' · 上期 +{prev_delta}', { prev_delta: sum.prev_delta }) : ''}</span></button>
            <button className="tile" onClick={() => jump('st-daily')}><div className="tile-head"><span className="k">{tl('阅读')}</span><span className="tile-ic accent"><MetricReadIcon /></span></div><span className="v">{sum?.minutes ?? 0}<small>{tl('分钟')}</small></span><span className="d">{tl('{v0} 词', { v0: (sum?.words ?? 0).toLocaleString() })}</span></button>
            <button className="tile" onClick={() => jump('st-cal')}><div className="tile-head"><span className="k">{tl('学习天数')}</span><span className="tile-ic warm"><MetricStreakIcon /></span></div><span className="v">{sum?.study_days ?? 0}<small>{tl('天')}</small></span><span className="d">{tl('连续 {v0} 天 · 最长 {v1} 天', { v0: sum?.streak ?? 0, v1: sum?.longest_streak ?? 0 })}</span></button>
            <button className="tile" onClick={() => jump('st-ret')}><div className="tile-head"><span className="k">{tl('复习')}</span><span className="tile-ic"><MetricDueIcon /></span></div><span className="v">{sum?.reviews ?? 0}<small>{tl('次')}</small></span><span className="d">{tl('记得率 {v0}', { v0: Math.round((sum?.retention ?? 0) * 100) })}%</span></button>
          </div>

          <div className="insight">
            <div className="ih"><b><TibiAvatar size={20} />{tl('Tibi 洞察')}</b><span className="sp" />{ins.state === 'ok' && <button className="linkbtn" onClick={() => void loadInsight(true)}>{tl('重新生成')}</button>}</div>
            {ins.state === 'loading' && <p className="lbl">{tl('正在分析近期学习数据…')}</p>}
            {ins.state === 'nomodel' && <p className="lbl">{tl('连接模型后可生成学习洞察。')} <button className="linkbtn" onClick={() => nav('/welcome?step=3&back=%2Fstats')}>{tl('连接模型')}</button></p>}
            {ins.state === 'err' && <p className="lbl">{ins.err}</p>}
            {ins.state === 'ok' && ins.data && <>
              <p>{ins.data.text}</p>
              {ins.data.actions.length > 0 && <div className="acts">{ins.data.actions.map(a => <button key={a.route} className="btn sm" onClick={() => nav(a.route)}>{a.label}</button>)}</div>}
            </>}
          </div>

          <section id="st-mastered">
            <SectionHeader title={tl('已掌握的词')} tip={tl('包含复习至掌握及手动标为已知的词条总数。')} meta={RANGE_LABEL[range]} />
            {mastered && <AreaChart dates={mastered.dates} main={mastered.series.mastered ?? []} />}
          </section>

          <section id="st-daily">
            <SectionHeader title={tl('每日阅读')} tip={tl('虚线表示每日 {goal} 分钟阅读目标。', { goal })} meta={tl('最近 30 天')} />
            {daily && <Bars values={daily.series.minutes ?? []} goal={goal} hi={v => v >= goal} labels={daily.dates.map((d, i, a) => (i === a.length - 1 ? tl('今天') : (a.length - 1 - i) % 7 === 0 ? new Date(d).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' }) : ''))} title={(v, i) => tl('{v0} · {v} 分钟', { v0: new Date(daily.dates[i]!).toLocaleDateString(locale), v })} />}
          </section>

          <div className="two">
            <section>
              <SectionHeader title={tl('接下来要复习')} tip={tl('按当前记忆排期预测的每日到期词量。')} meta={tl('未来 14 天')} />
              {fc && <><Bars values={fc.days} hi={(_, i) => i === 0} height={100} labels={fc.days.map((_, i) => (i === 0 ? tl('今天') : i % 3 === 0 ? tl('{i} 天后', { i }) : ''))} />
                <p className="lbl">{tl('目标记得率 {v0}%{v1}', { v0: Math.round(fc.target_retention * 100), v1: retTotal ? tl(' · 实际 {v0}%', { v0: Math.round(retRate * 100) }) : '' })}</p></>}
            </section>
            <section id="st-ret">
              <SectionHeader title={tl('复习表现')} meta={tl('最近 12 周')} />
              {ret && <><StackBars weeks={ret.weeks} height={100} />
                <p className="lbl">{tl('记得率 {v0}% · 忘了 {lapses} 次 ·', { v0: Math.round(retRate * 100), lapses: ret.lapses })} <a href="#/words?view=leech">{tl('难词 {leeches} 个', { leeches: ret.leeches })}</a></p></>}
            </section>
          </div>

          <section id="st-cal">
            <SectionHeader title={tl('学习日历')} tip={tl('颜色深浅表示当日学习时长，仅完成复习的日子也会点亮。')} meta={tl('最近 26 周')} />
            {cal && <Heatmap dates={cal.dates} values={(cal.series.minutes ?? []).map((m, i) => m || (cal.series.reviews?.[i] ? 1 : 0))}
              title={(_, i) => { const day = new Date(cal.dates[i]!).toLocaleDateString(locale); const m = cal.series.minutes?.[i] ?? 0; const r = cal.series.reviews?.[i] ?? 0; return m || !r ? tl('{v0} · {v} 分钟', { v0: day, v: m }) : tl('{v0} · 复习 {n} 次', { v0: day, n: r }); }} />}
          </section>

          <div className="two">
            <section>
              <SectionHeader title={tl('生词本熟练度')} action={<a className="more" href="#/words">{tl('生词本 →')}</a>} />
              {totalStages ? <><div className="stagebar">{stages.map((n, i) => n ? <i key={i} className={`s${i}`} style={{ flex: n }} title={`${STATUS_NAMES[i]} ${n}`} /> : null)}</div>
                <div className="stagelegend">{stages.map((n, i) => <span key={i}><i className={`s${i}`} />{STATUS_NAMES[i]}<b>{n.toLocaleString()}</b></span>)}</div></> : <p className="lbl">{tl('暂无生词数据。')}</p>}
            </section>
            <section>
              <SectionHeader title={tl('按类型阅读量')} meta={RANGE_LABEL[range]} />
              {genres.length ? <div className="grows">{genres.map(g => { const max = Math.max(...genres.map(x => x.words), 1); return <Fragment key={g.genre}><span>{GENRE_NAMES[g.genre] ?? g.genre}</span><div className="gbar"><i style={{ width: `${(g.words / max) * 100}%` }} /></div><span className="lbl">{tl('{words} 词', { words: g.words.toLocaleString() })}</span></Fragment>; })}</div> : <p className="lbl">{tl('暂无阅读记录。')}</p>}
            </section>
          </div>

          <PageFooter>
            <span>{tl('数据基于本机学习记录计算；AI 洞察由所连模型生成，仅供参考。')}</span>
            <span>{tl('更新于 {time}', { time: updatedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</span>
          </PageFooter>
        </>}
      </div></div>
    </>
  );
}
