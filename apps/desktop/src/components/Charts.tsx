import { useState } from 'react';
import { locale, tl } from '../lib/i18n';

/**
 * 统计页的小图表（00 §3.6）：只用强调色与灰色，SVG 按容器宽度缩放（viewBox），深浅色跟着 CSS 变量走。
 */
const W = 640;

/** 面积折线：主线实线（强调色），可选第二条虚线（估算） */
export function AreaChart({ dates, main, dashed, height = 160, fmt = (n: number) => n.toLocaleString() }: { dates: number[]; main: number[]; dashed?: number[]; height?: number; fmt?: (n: number) => string }) {
  const [hover, setHover] = useState<number>();
  const H = height, pad = 6;
  const max = Math.max(1, ...main, ...(dashed ?? []));
  const min = Math.min(...main.filter(v => v > 0), ...(dashed ?? []).filter(v => v > 0), max) * 0.9;
  const x = (i: number) => (main.length <= 1 ? W / 2 : (i / (main.length - 1)) * W);
  const y = (v: number) => H - pad - ((v - min) / Math.max(1, max - min)) * (H - pad * 2);
  const line = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <div className="chart" onMouseLeave={() => setHover(undefined)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }} onMouseMove={e => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); setHover(Math.round(((e.clientX - r.left) / r.width) * (main.length - 1))); }}>
        <path d={`${line(main)} L${W},${H} L0,${H} Z`} fill="var(--accent-wash)" />
        <path d={line(main)} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {dashed && <path d={line(dashed)} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
        {hover !== undefined && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="var(--line-2)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {dates.length > 1 && <div className="xl ends"><span>{new Date(dates[0]!).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })}</span><span>{tl('今天')}</span></div>}
      {hover !== undefined && main[hover] !== undefined && <div className="tip" style={{ left: `${(x(hover) / W) * 100}%` }}>{new Date(dates[hover]!).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })} · {fmt(main[hover]!)}{dashed ? tl(' · 估算 {v0}', { v0: fmt(dashed[hover] ?? 0) }) : ''}</div>}
    </div>
  );
}

/** 柱状：hi(i) 为真的柱子用强调色；goal 画一条虚线 */
export function Bars({ values, labels, hi, goal, height = 120, title }: { values: number[]; labels?: string[]; hi?: (v: number, i: number) => boolean; goal?: number; height?: number; title?: (v: number, i: number) => string }) {
  const H = height; const max = Math.max(1, goal ?? 0, ...values); const bw = W / Math.max(1, values.length);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        {values.map((v, i) => { const h = (v / max) * (H - 4); return <rect key={i} x={i * bw + bw * 0.2} y={H - h} width={bw * 0.6} height={Math.max(v ? 2 : 0, h)} rx="2" fill={hi?.(v, i) ? 'var(--accent)' : 'var(--line-2)'}><title>{title?.(v, i) ?? String(v)}</title></rect>; })}
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
        {goal !== undefined && <line x1="0" x2={W} y1={H - (goal / max) * (H - 4)} y2={H - (goal / max) * (H - 4)} stroke="var(--ink-3)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      </svg>
      {labels && <div className="xl">{labels.map((l, i) => <span key={i}>{l}</span>)}</div>}
    </div>
  );
}

/** 四档评分堆叠柱（忘了 / 模糊 / 记得 / 轻松），灰到强调色；下面一行周标签 + 图例 */
const RATING_FILLS = ['var(--hard)', 'var(--line-2)', 'color-mix(in srgb, var(--accent) 55%, transparent)', 'var(--accent)'];
export function StackBars({ weeks, height = 120 }: { weeks: { ratings: [number, number, number, number]; retention: number }[]; height?: number }) {
  const H = height; const max = Math.max(1, ...weeks.map(w => w.ratings.reduce((a, b) => a + b, 0))); const bw = W / Math.max(1, weeks.length);
  const names = [tl('忘了'), tl('模糊'), tl('记得'), tl('轻松')];
  const n = weeks.length;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        {weeks.map((w, i) => { let y = H; return w.ratings.map((c, k) => { const h = (c / max) * (H - 4); y -= h; return <rect key={`${i}-${k}`} x={i * bw + bw * 0.2} y={y} width={bw * 0.6} height={h} fill={RATING_FILLS[k]}><title>{names[k]} {c}</title></rect>; }); })}
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="xl">{weeks.map((_, i) => <span key={i}>{i === n - 1 ? tl('本周') : i === 0 ? tl('{n} 周前', { n: n - 1 }) : ''}</span>)}</div>
      <div className="ckey">{names.map((l, k) => <span key={k}><i style={{ background: RATING_FILLS[k] }} />{l}</span>)}</div>
    </div>
  );
}

/** 学习日历：按周一列，五档深浅；上面标月份，左边标周一 / 三 / 五，右下角图例 */
export function Heatmap({ dates, values }: { dates: number[]; values: number[] }) {
  const max = Math.max(1, ...values);
  const level = (v: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const first = new Date(dates[0] ?? Date.now()); const offset = (first.getDay() + 6) % 7;
  const cells = [...Array(offset).fill(undefined), ...values.map((v, i) => ({ v, d: dates[i]! }))];
  const cols: (typeof cells)[] = []; for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));
  // 某列里出现某月 1 号（或第一列），就在这列上方写月份
  const month = (c: typeof cells, i: number) => { const d = c.find(Boolean); if (!d) return ''; const day = new Date(d.d); return i === 0 || day.getDate() <= 7 ? day.toLocaleDateString(locale, { month: 'short' }) : ''; };
  const weekday = (r: number) => new Date(2024, 0, 1 + r).toLocaleDateString(locale, { weekday: 'narrow' }); // 2024-01-01 是周一
  return (
    <div className="heat">
      <div className="hgrid" style={{ gridTemplateColumns: `auto repeat(${cols.length}, minmax(0, 18px))` }}>
        {cols.map((c, i) => <span key={`m${i}`} className="hm" style={{ gridColumn: i + 2, gridRow: 1 }}>{month(c, i)}</span>)}
        {[0, 2, 4].map(r => <span key={`w${r}`} className="hw" style={{ gridColumn: 1, gridRow: r + 2 }}>{weekday(r)}</span>)}
        {cols.map((c, i) => c.map((x, k) => <i key={`${i}-${k}`} style={{ gridColumn: i + 2, gridRow: k + 2 }} className={x ? `l${level(x.v)}` : 'pad'} title={x ? tl('{v0} · {v} 分钟', { v0: new Date(x.d).toLocaleDateString(locale), v: x.v }) : undefined} />))}
      </div>
      <div className="ckey hleg">{tl('少')}{[0, 1, 2, 3, 4].map(l => <i key={l} className={`l${l}`} />)}{tl('多')}</div>
    </div>
  );
}
