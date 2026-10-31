import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AreaChart, Bars, Heatmap, StackBars } from '../components/Charts';
import { Empty } from '../components/Empty';
import { Top } from '../components/Shell';
import { GENRE_NAMES, STATUS_NAMES } from '../lib/util';
import { errorInfo, rpc, type Result } from '../rpc';
import { useCore } from '../store/core';

/**
 * 学习统计（00 §3.6，原型 stats.html，M3）：四项指标 → Tibi 的洞察 → 已知词数（实测实线 / 估算虚线，R8）→ 每日阅读 →
 * 接下来要复习 → 复习表现 → 学习日历 → 生词本熟练度 → 按类型阅读量。范围 30 天 / 90 天 / 半年。
 */
type Range = 30 | 90 | 180;
const RANGE_LABEL: Record<Range, string> = { 30: '30 天', 90: '90 天', 180: '半年' };

export function Stats() {
  const nav = useNavigate();
  const [range, setRange] = useState<Range>(30);
  const [sum, setSum] = useState<Result<'stats.summary'>>();
  const [known, setKnown] = useState<Result<'stats.series'>>();
  const [daily, setDaily] = useState<Result<'stats.series'>>();
  const [cal, setCal] = useState<Result<'stats.series'>>();
  const [ret, setRet] = useState<Result<'stats.retention'>>();
  const [fc, setFc] = useState<Result<'stats.forecast'>>();
  const [stages, setStages] = useState<number[]>([]);
  const [genres, setGenres] = useState<Result<'stats.genres'>>([]);
  const [ins, setIns] = useState<{ state: 'idle' | 'loading' | 'ok' | 'err' | 'nomodel'; data?: NonNullable<Result<'stats.insight'>['insight']>; err?: string }>({ state: 'idle' });
  const goal = useCore(s => s.goal); const modelOk = useCore(s => !!s.status?.models.ok);

  useEffect(() => {
    void rpc.call('stats.summary', { range }).then(setSum, () => undefined);
    void rpc.call('stats.series', { metrics: ['known'], days: range }).then(setKnown, () => undefined);
    void rpc.call('stats.genres', { range }).then(setGenres, () => undefined);
  }, [range]);
  useEffect(() => {
    void rpc.call('stats.series', { metrics: ['minutes', 'words'], days: 30 }).then(setDaily, () => undefined);
    void rpc.call('stats.series', { metrics: ['minutes'], days: 182 }).then(setCal, () => undefined);
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

  const empty = sum && !sum.minutes && !sum.reviews && !sum.known_delta && !stages.some(Boolean) && !(daily?.series.minutes ?? []).some(Boolean);
  const totalStages = stages.reduce((a, b) => a + b, 0);
  const retWeeks = ret?.weeks ?? []; const retTotal = retWeeks.reduce((a, w) => a + w.ratings.reduce((x, y) => x + y, 0), 0);
  const retRate = retTotal ? retWeeks.reduce((a, w) => a + w.ratings[1] + w.ratings[2] + w.ratings[3], 0) / retTotal : 0;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <>
      <Top crumbs={[{ label: '统计' }]} right={<div className="seg">{([30, 90, 180] as Range[]).map(r => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{RANGE_LABEL[r]}</button>)}</div>} />
      <div className="scroll"><div className="page stats">
        {empty ? <Empty title="还没有可以统计的东西" text="读一篇文章、复习几张卡，这里就会有数据。" action={<button className="btn pri" onClick={() => nav('/')}>去首页读一篇</button>} /> : <>
          <div className="tiles four">
            <button className="tile" onClick={() => jump('st-known')}><span className="k">已知词</span><span className="v">{(sum?.known ?? 0).toLocaleString()}<small>词</small></span><span className="d">{RANGE_LABEL[range]}内 {(sum?.known_delta ?? 0) >= 0 ? '+' : ''}{sum?.known_delta ?? 0}{sum?.prev_delta ? ` · 上期 +${sum.prev_delta}` : ''}</span></button>
            <button className="tile" onClick={() => jump('st-daily')}><span className="k">阅读</span><span className="v">{sum?.minutes ?? 0}<small>分钟</small></span><span className="d">{(sum?.words ?? 0).toLocaleString()} 词</span></button>
            <button className="tile" onClick={() => jump('st-cal')}><span className="k">学习天数</span><span className="v">{sum?.study_days ?? 0}<small>天</small></span><span className="d">连续 {sum?.streak ?? 0} 天 · 最长 {sum?.longest_streak ?? 0} 天</span></button>
            <button className="tile" onClick={() => jump('st-ret')}><span className="k">复习</span><span className="v">{sum?.reviews ?? 0}<small>次</small></span><span className="d">记得率 {Math.round((sum?.retention ?? 0) * 100)}%</span></button>
          </div>

          <div className="insight">
            <div className="ih"><b><span style={{ color: 'var(--accent)' }}>✦</span> Tibi 的洞察</b><span className="sp" />{ins.state === 'ok' && <button className="linkbtn" onClick={() => void loadInsight(true)}>重新生成</button>}</div>
            {ins.state === 'loading' && <p className="lbl">正在看你最近的学习数据…</p>}
            {ins.state === 'nomodel' && <p className="lbl">连接模型后，Tibi 会在这里写一段观察和建议。<button className="linkbtn" onClick={() => nav('/welcome?step=3&back=%2Fstats')}>去连接</button></p>}
            {ins.state === 'err' && <p className="lbl">{ins.err}</p>}
            {ins.state === 'ok' && ins.data && <>
              <p>{ins.data.text}</p>
              {ins.data.actions.length > 0 && <div className="acts">{ins.data.actions.map(a => <button key={a.route} className="btn sm" onClick={() => nav(a.route)}>{a.label}</button>)}</div>}
              <div className="lbl">Tibi · 学习洞察 · 只在打开统计页时生成</div>
            </>}
          </div>

          <section id="st-known"><div className="sech"><h2>已知词数</h2><span className="lbl">实线 = 你亲手确认的（标过、测试点亮、复习答对）+ 推断；虚线 = 按词汇量估算的部分</span></div>
            {known && <AreaChart dates={known.dates} main={known.series.known ?? []} dashed={known.series.known_estimated} />}
          </section>

          <section id="st-daily"><div className="sech"><h2>每日阅读</h2><span className="lbl">最近 30 天 · 虚线是每天 {goal} 分钟的目标</span></div>
            {daily && <Bars values={daily.series.minutes ?? []} goal={goal} hi={v => v >= goal} title={(v, i) => `${new Date(daily.dates[i]!).toLocaleDateString('zh-CN')} · ${v} 分钟`} />}
          </section>

          <div className="two">
            <section><div className="sech"><h2>接下来要复习</h2></div>
              {fc && <><Bars values={fc.days} hi={(_, i) => i === 0} height={100} labels={fc.days.map((_, i) => (i === 0 ? '今天' : i % 3 === 0 ? `${i} 天后` : ''))} />
                <p className="lbl">目标记得率 {Math.round(fc.target_retention * 100)}%{retTotal ? ` · 实际 ${Math.round(retRate * 100)}%` : ''}</p></>}
            </section>
            <section id="st-ret"><div className="sech"><h2>复习表现</h2><span className="lbl">最近 12 周</span></div>
              {ret && <><StackBars weeks={ret.weeks} height={100} />
                <p className="lbl">记得率 {Math.round(retRate * 100)}% · 忘了 {ret.lapses} 次 · <a href="#/words?view=leech">难词 {ret.leeches} 个</a></p></>}
            </section>
          </div>

          <section id="st-cal"><div className="sech"><h2>学习日历</h2><span className="lbl">最近 26 周，颜色越深学得越久</span></div>
            {cal && <Heatmap dates={cal.dates} values={cal.series.minutes ?? []} />}
          </section>

          <div className="two">
            <section><div className="sech"><h2>生词本熟练度</h2><a className="more" href="#/words">去生词本 →</a></div>
              {totalStages ? <><div className="stagebar">{stages.map((n, i) => n ? <i key={i} className={`s${i}`} style={{ flex: n }} title={`${STATUS_NAMES[i]} ${n}`} /> : null)}</div>
                <div className="stagelegend">{stages.map((n, i) => <span key={i}><i className={`s${i}`} />{STATUS_NAMES[i]} {n}</span>)}</div></> : <p className="lbl">生词本还是空的。</p>}
            </section>
            <section><div className="sech"><h2>按类型阅读量</h2></div>
              {genres.length ? genres.map(g => { const max = Math.max(...genres.map(x => x.words), 1); return <div key={g.genre} className="grow"><span>{GENRE_NAMES[g.genre] ?? g.genre}</span><div className="gbar"><i style={{ width: `${(g.words / max) * 100}%` }} /></div><span className="lbl">{g.words.toLocaleString()} 词 · 生词率 {(g.unknown_ratio * 100).toFixed(1)}%</span></div>; }) : <p className="lbl">这段时间还没读文章。</p>}
            </section>
          </div>
        </>}
      </div></div>
    </>
  );
}
