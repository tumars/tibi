import { Type } from '@sinclair/typebox';
import { j, now, type Database } from '../../db/driver.js';
import { capability, method, type CapabilityMap, type Ctx, type MethodMap } from '../../rpc/define.js';
import type { Dict } from '../../dict/types.js';
import { TibiError, type Genre, type UsageSummary } from '../../types.js';
import { parseJsonLoose } from '../documents/analyze.js';
import { forecast } from '../review/queue.js';
import { startOfToday } from '../shared/cards.js';
import { dateKey, rollupToday } from './rollup.js';

/** 统计（00 §3.6、06）：读 daily_stats（先懒汇总今天）、review_logs、documents */

async function ensureToday(db: Database, _dict?: Dict) { await rollupToday(db); }

async function dailyRows(db: Database, days: number): Promise<Map<string, Record<string, number>>> {
  const from = dateKey(now() - (days - 1) * 86_400_000);
  const rows = await db.all<Record<string, number | string>>('SELECT * FROM daily_stats WHERE date >= ? ORDER BY date', [from]);
  const m = new Map<string, Record<string, number>>();
  for (const r of rows) { const { date, ...rest } = r; m.set(String(date), Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, Number(v)]))); }
  return m;
}

function dayList(days: number): { key: string; ts: number }[] {
  const out = []; const start = startOfToday() - (days - 1) * 86_400_000;
  for (let i = 0; i < days; i++) { const ts = start + i * 86_400_000; out.push({ key: dateKey(ts), ts }); }
  return out;
}

async function streaks(db: Database): Promise<{ streak: number; longest: number; study_days: number }> {
  const goal = Number((await db.get<{ g: number }>("SELECT daily_goal_minutes AS g FROM user_profile WHERE id = '1'"))?.g ?? 20);
  const rows = await db.all<{ date: string; reading_ms: number; reviews: number }>('SELECT date, reading_ms, reviews FROM daily_stats ORDER BY date');
  const active = new Set(rows.filter(r => Number(r.reading_ms) >= goal * 60_000 || Number(r.reviews) > 0).map(r => r.date));
  let longest = 0, run = 0; let prev: number | null = null;
  for (const d of [...active].sort()) {
    const t = Date.parse(d + 'T00:00:00');
    run = prev != null && t - prev === 86_400_000 ? run + 1 : 1; prev = t; longest = Math.max(longest, run);
  }
  let streak = 0; let cur = startOfToday();
  if (!active.has(dateKey(cur))) cur -= 86_400_000;
  while (active.has(dateKey(cur))) { streak++; cur -= 86_400_000; }
  return { streak, longest, study_days: active.size };
}

export async function summary(db: Database, range: number, dict?: Dict) {
  await ensureToday(db, dict);
  const days = dayList(range); const rows = await dailyRows(db, range * 2);
  const sum = (keys: { key: string }[], f: string) => keys.reduce((s, d) => s + (rows.get(d.key)?.[f] ?? 0), 0);
  const prevDays = dayList(range * 2).slice(0, range);
  // 已掌握：用户标为掌握（5）或已知（97）的词数，只数用户自己的标记
  const mastered = rows.get(dateKey())?.mastered_total ?? 0;
  const firstKey = days[0]!.key;
  const inRange = [...rows.entries()].filter(([k]) => k >= firstKey).map(([, v]) => v.mastered_total ?? 0);
  const before = [...rows.entries()].filter(([k]) => k < firstKey).map(([, v]) => v.mastered_total ?? 0).pop() ?? inRange[0] ?? mastered;
  // 上一周期的起点：没有更早的数据时用上一周期里的第一天（再没有就等于本期起点，增长记 0）
  const prevIn = [...rows.entries()].filter(([k]) => k >= prevDays[0]!.key && k < firstKey).map(([, v]) => v.mastered_total ?? 0);
  const prevBefore = [...rows.entries()].filter(([k]) => k < prevDays[0]!.key).map(([, v]) => v.mastered_total ?? 0).pop() ?? prevIn[0] ?? before;
  const reviews = sum(days, 'reviews'), correct = sum(days, 'review_correct');
  const st = await streaks(db);
  return { mastered, mastered_delta: mastered - before, prev_delta: before - prevBefore, minutes: Math.round(sum(days, 'reading_ms') / 60_000), words: sum(days, 'words_read'), study_days: st.study_days, streak: st.streak, longest_streak: st.longest, reviews, retention: reviews ? correct / reviews : 0 };
}

export async function series(db: Database, metrics: string[], days: number, dict?: Dict) {
  await ensureToday(db, dict);
  const list = dayList(days); const rows = await dailyRows(db, days);
  const map: Record<string, (r: Record<string, number> | undefined) => number> = {
    mastered: r => r?.mastered_total ?? 0,
    minutes: r => Math.round((r?.reading_ms ?? 0) / 60_000), words: r => r?.words_read ?? 0, reviews: r => r?.reviews ?? 0,
  };
  const out: Record<string, number[]> = {};
  for (const m of metrics) {
    // 已掌握是累计数：没有记录的天沿用前一天；最早一条之前的天用最早那天的值（曲线不从 0 起跳）
    if (m === 'mastered') {
      const firstRow = list.map(d => rows.get(d.key)).find(Boolean); let last = firstRow ? map.mastered!(firstRow) : 0;
      out[m] = list.map(d => { const r = rows.get(d.key); if (r) last = map.mastered!(r); return last; });
      continue;
    }
    out[m] = list.map(d => (map[m] ?? (() => 0))(rows.get(d.key)));
  }
  return { dates: list.map(d => d.ts), series: out };
}

export const statsMethods: MethodMap = {
  'stats.summary': method(Type.Object({ range: Type.Union([Type.Literal(30), Type.Literal(90), Type.Literal(180)], { default: 30 }) }), async (p, ctx) => summary(ctx.db, p.range ?? 30, ctx.dict), '四张指标卡'),
  'stats.series': method(Type.Object({ metrics: Type.Array(Type.String()), days: Type.Integer({ minimum: 1, maximum: 730, default: 30 }) }), async (p, ctx) => series(ctx.db, p.metrics, p.days ?? 30, ctx.dict), '折线、柱状、热力图共用'),
  'stats.retention': method(Type.Object({ weeks: Type.Integer({ minimum: 1, maximum: 52, default: 8 }) }), async (p, ctx) => {
    const weeks = p.weeks ?? 8; const out = [];
    const end = startOfToday() + 86_400_000;
    for (let w = weeks - 1; w >= 0; w--) {
      const to = end - w * 7 * 86_400_000, from = to - 7 * 86_400_000;
      const rows = await ctx.db.all<{ rating: number; n: number }>('SELECT rating, count(*) AS n FROM review_logs_valid WHERE reviewed_at >= ? AND reviewed_at < ? GROUP BY rating', [from, to]);
      const ratings: [number, number, number, number] = [0, 0, 0, 0];
      for (const r of rows) ratings[Number(r.rating) - 1] = Number(r.n);
      const total = ratings.reduce((a, b) => a + b, 0);
      out.push({ ratings, retention: total ? (total - ratings[0]) / total : 0 });
    }
    const lapses = Number((await ctx.db.get<{ n: number }>('SELECT COALESCE(sum(lapses), 0) AS n FROM cards WHERE deleted_at IS NULL'))?.n ?? 0);
    const leeches = Number((await ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM cards WHERE deleted_at IS NULL AND lapses >= 3'))?.n ?? 0);
    return { weeks: out, lapses, leeches };
  }, '"复习表现"面板'),
  'stats.genres': method(Type.Object({ range: Type.Integer({ minimum: 1, maximum: 730, default: 30 }) }), async (p, ctx) => {
    const from = now() - (p.range ?? 30) * 86_400_000;
    const rows = await ctx.db.all<{ genre: string; words: number }>('SELECT genre, COALESCE(sum(word_count * progress), 0) AS words FROM documents WHERE deleted_at IS NULL AND last_read_at >= ? GROUP BY genre ORDER BY words DESC', [from]);
    return rows.map(r => ({ genre: r.genre as Genre, words: Math.round(Number(r.words)) }));
  }, ''),
  'stats.insight': method(Type.Object({ regenerate: Type.Optional(Type.Boolean()) }), async (p, ctx) => insight(ctx, !!p.regenerate),
    '学习洞察（M3）：当天有缓存就直接返回；否则用快速档按固定提示写一段话 + 1–3 个动作（只能从固定的几个里挑）。没连模型 → model_unavailable'),
  'stats.forecast': method(Type.Object({ days: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })) }), async (p, ctx) => {
    const days = await forecast(ctx.db, p.days ?? 14);
    const r = await ctx.db.get<{ v: string }>("SELECT value AS v FROM settings WHERE key = 'review.retention'");
    return { days, target_retention: r ? Number(JSON.parse(r.v)) : 0.9 };
  }, '"接下来要复习"：未来 N 天每天到期的卡数（今天含逾期）'),
  'stats.stages': method(Type.Object({}), async (_p, ctx) => {
    const rows = await ctx.db.all<{ status: number; n: number }>('SELECT status, count(*) AS n FROM terms WHERE deleted_at IS NULL AND in_wordbook = 1 AND status BETWEEN 0 AND 5 GROUP BY status');
    const out = [0, 0, 0, 0, 0, 0]; for (const r of rows) out[Number(r.status)] = Number(r.n);
    return { stages: out };
  }, '"生词本熟练度"：0–5 六档的词数'),
  'stats.export_summary': method(Type.Object({}), async (_p, ctx) => exportSummary(ctx.db, ctx.platform.info().app_version), 'M1 成功标准的脱敏汇总'),
};

/** M1 成功标准（00 §6、01 §6）：只有计数 */
export async function exportSummary(db: Database, app_version: string): Promise<UsageSummary> {
  const t = now();
  const prof = await db.get<{ created_at: number }>("SELECT created_at FROM user_profile WHERE id = '1'");
  const first = Number(prof?.created_at ?? t);
  const days_since_first_use = Math.floor((t - first) / 86_400_000);
  const reviews = Number((await db.get<{ n: number }>('SELECT count(*) AS n FROM review_logs_valid'))?.n ?? 0);
  const docs = await db.all<{ source_type: string; n: number; finished: number }>("SELECT source_type, count(*) AS n, sum(CASE WHEN finished_at IS NOT NULL THEN 1 ELSE 0 END) AS finished FROM documents GROUP BY source_type");
  const samples = docs.filter(d => d.source_type === 'sample').reduce((s, d) => s + Number(d.n), 0);
  const self_imported = docs.filter(d => d.source_type !== 'sample' && d.source_type !== 'tibi_generated').reduce((s, d) => s + Number(d.n), 0);
  const finished = docs.reduce((s, d) => s + Number(d.finished), 0);
  const window_closed = t - first >= 7 * 86_400_000;
  const imp7 = await db.all<{ payload: string }>("SELECT payload FROM learning_events WHERE type = 'document_imported' AND created_at < ?", [first + 7 * 86_400_000]);
  const self_imports_7d = imp7.map(r => j.parse<{ source_type?: string }>(r.payload, {})).filter(x => x.source_type && x.source_type !== 'sample' && x.source_type !== 'tibi_generated').length;
  const h2: UsageSummary['h2'] = { window_closed, self_imports_7d, ...(self_imports_7d > 0 || window_closed ? { passed: self_imports_7d > 0 } : {}) };
  const firstCard = await db.get<{ c: number | null }>('SELECT min(created_at) AS c FROM cards');
  let h3: UsageSummary['h3'] = { has_card: false };
  if (firstCard?.c) {
    const nextDay = startOfToday(Number(firstCard.c)) + 86_400_000;
    if (t >= nextDay + 86_400_000) {
      const n = Number((await db.get<{ n: number }>('SELECT count(*) AS n FROM review_logs_valid WHERE reviewed_at >= ? AND reviewed_at < ?', [nextDay, nextDay + 86_400_000]))?.n ?? 0);
      h3 = { has_card: true, reviewed_next_day: n > 0 };
    } else h3 = { has_card: true };
  }
  return { schema: 1, app_version, days_since_first_use, reviews, documents: { samples, self_imported, finished }, h2, h3 };
}

export const statsCapabilities: CapabilityMap = {
  get_learning_stats: capability({ name: 'get_learning_stats', description: '学习概况（stats.summary 的返回）', perm: 'read', params: Type.Object({ range: Type.Union([Type.Literal(30), Type.Literal(90), Type.Literal(180)], { default: 30 }) }), run: (p, ctx) => summary(ctx.db, p.range ?? 30, ctx.dict) }),
  get_stats_series: capability({ name: 'get_stats_series', description: '按天的序列（mastered 已掌握、minutes 分钟、words 词数、reviews 复习）', perm: 'read', params: Type.Object({ metrics: Type.Array(Type.String()), days: Type.Integer({ minimum: 1, maximum: 730, default: 30 }) }), run: (p, ctx) => series(ctx.db, p.metrics, p.days ?? 30, ctx.dict) }),
};

/* ---------- 学习洞察（M3） ---------- */
const INSIGHT_ACTIONS: Record<string, { label: string; route: string }> = {
  review: { label: '复习到期的词', route: '/review' }, leech: { label: '看看难词', route: '/words?view=leech' },
  library: { label: '挑一篇来读', route: '/library' }, words: { label: '整理生词本', route: '/words' },
};
interface Insight { text: string; actions: { label: string; route: string }[]; generated_at: number; day: string }

async function insight(ctx: Ctx, regenerate: boolean) {
  const today = dateKey();
  const cached = await ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'stats.insight'");
  const c = cached ? j.parse<Insight | null>(cached.value, null) : null;
  if (c && c.day === today && !regenerate) return { insight: c };
  if (!ctx.ai) throw new TibiError('model_unavailable', '还没有连接模型');
  const s30 = await summary(ctx.db, 30, ctx.dict);
  const ser = await series(ctx.db, ['minutes', 'reviews'], 14, ctx.dict);
  const genres = await ctx.call<{ genre: string; words: number }[]>('stats.genres', { range: 30 });
  const due = (await forecast(ctx.db, 1))[0] ?? 0;
  const leeches = Number((await ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM cards WHERE deleted_at IS NULL AND lapses >= 3'))?.n ?? 0);
  const data = { last_30_days: s30, last_14_days_minutes: ser.series.minutes, last_14_days_reviews: ser.series.reviews, genres, due_today: due, leeches };
  const r = await ctx.ai.complete({ tier: 'fast',
    system: `你是英语学习教练 Tibi。根据用户最近的学习数据（JSON，只有计数），用中文写 2–3 句观察：说清一个变化或现象，再给一个具体建议。不要客套、不要打气、不要编造数据里没有的东西。再从这些动作里挑 1–3 个最相关的：${Object.keys(INSIGHT_ACTIONS).join(', ')}。只输出 JSON：{"text": "...", "actions": ["review"]}`,
    prompt: JSON.stringify(data) });
  const out = parseJsonLoose<{ text?: string; actions?: string[] }>(r.text);
  if (!out?.text) throw new TibiError('model_unavailable', '模型没有给出洞察');
  const ins: Insight = { text: out.text.trim().slice(0, 400), actions: (out.actions ?? []).filter(a => a in INSIGHT_ACTIONS).slice(0, 3).map(a => INSIGHT_ACTIONS[a]!), generated_at: now(), day: today };
  await ctx.db.run("INSERT INTO settings(key, value, updated_at) VALUES ('stats.insight', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [j.str(ins), now()]);
  return { insight: ins };
}
