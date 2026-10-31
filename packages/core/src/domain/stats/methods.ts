import { Type } from '@sinclair/typebox';
import { j, now, type Database } from '../../db/driver.js';
import { capability, method, type CapabilityMap, type MethodMap } from '../../rpc/define.js';
import type { Genre, UsageSummary } from '../../types.js';
import { startOfToday } from '../shared/cards.js';
import { dateKey, rollupToday } from './rollup.js';

/** 统计（00 §3.6、06）：读 daily_stats（先懒汇总今天）、review_logs、documents */

async function ensureToday(db: Database) { await rollupToday(db); }

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

export async function summary(db: Database, range: number) {
  await ensureToday(db);
  const days = dayList(range); const rows = await dailyRows(db, range * 2);
  const sum = (keys: { key: string }[], f: string) => keys.reduce((s, d) => s + (rows.get(d.key)?.[f] ?? 0), 0);
  const prevDays = dayList(range * 2).slice(0, range);
  const known = rows.get(dateKey())?.known_terms_total ?? 0;
  const firstKey = days[0]!.key;
  const before = [...rows.entries()].filter(([k]) => k < firstKey).map(([, v]) => v.known_terms_total ?? 0).pop() ?? 0;
  const prevBefore = [...rows.entries()].filter(([k]) => k < prevDays[0]!.key).map(([, v]) => v.known_terms_total ?? 0).pop() ?? 0;
  const reviews = sum(days, 'reviews'), correct = sum(days, 'review_correct');
  const st = await streaks(db);
  return { known, known_delta: known - before, prev_delta: before - prevBefore, minutes: Math.round(sum(days, 'reading_ms') / 60_000), words: sum(days, 'words_read'), study_days: st.study_days, streak: st.streak, longest_streak: st.longest, reviews, retention: reviews ? correct / reviews : 0 };
}

export async function series(db: Database, metrics: string[], days: number) {
  await ensureToday(db);
  const list = dayList(days); const rows = await dailyRows(db, days);
  const map: Record<string, (r: Record<string, number> | undefined) => number> = {
    known: r => r?.known_terms_total ?? 0, known_confirmed: r => r?.known_confirmed ?? 0, known_estimated: r => r?.known_estimated ?? 0,
    minutes: r => Math.round((r?.reading_ms ?? 0) / 60_000), words: r => r?.words_read ?? 0, reviews: r => r?.reviews ?? 0,
  };
  const out: Record<string, number[]> = {};
  let lastKnown = 0;
  for (const m of metrics) {
    out[m] = list.map(d => { const r = rows.get(d.key); const v = (map[m] ?? (() => 0))(r); if (m.startsWith('known')) { if (r) lastKnown = v; return r ? v : lastKnown; } return v; });
    if (m === 'known') { // 实测 / 估算两条线一并给（R8）
      out.known_confirmed = list.map(d => rows.get(d.key)?.known_confirmed ?? 0);
      out.known_estimated = list.map(d => rows.get(d.key)?.known_estimated ?? 0);
    }
  }
  return { dates: list.map(d => d.ts), series: out };
}

export const statsMethods: MethodMap = {
  'stats.summary': method(Type.Object({ range: Type.Union([Type.Literal(30), Type.Literal(90), Type.Literal(180)], { default: 30 }) }), async (p, ctx) => summary(ctx.db, p.range ?? 30), '四张指标卡'),
  'stats.series': method(Type.Object({ metrics: Type.Array(Type.String()), days: Type.Integer({ minimum: 1, maximum: 730, default: 30 }) }), async (p, ctx) => series(ctx.db, p.metrics, p.days ?? 30), '折线、柱状、热力图共用'),
  'stats.retention': method(Type.Object({ weeks: Type.Integer({ minimum: 1, maximum: 52, default: 8 }) }), async (p, ctx) => {
    const weeks = p.weeks ?? 8; const out = [];
    const end = startOfToday() + 86_400_000;
    for (let w = weeks - 1; w >= 0; w--) {
      const to = end - w * 7 * 86_400_000, from = to - 7 * 86_400_000;
      const rows = await ctx.db.all<{ rating: number; n: number }>('SELECT rating, count(*) AS n FROM review_logs WHERE reviewed_at >= ? AND reviewed_at < ? GROUP BY rating', [from, to]);
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
    const rows = await ctx.db.all<{ genre: string; words: number; ur: number }>('SELECT genre, COALESCE(sum(word_count * progress), 0) AS words, COALESCE(avg(unknown_ratio), 0) AS ur FROM documents WHERE deleted_at IS NULL AND last_read_at >= ? GROUP BY genre ORDER BY words DESC', [from]);
    return rows.map(r => ({ genre: r.genre as Genre, words: Math.round(Number(r.words)), unknown_ratio: Number(r.ur) }));
  }, ''),
  'stats.insight': method(Type.Object({ regenerate: Type.Optional(Type.Boolean()) }), async () => ({}), 'M2 起：学习洞察技能'),
  'stats.export_summary': method(Type.Object({}), async (_p, ctx) => exportSummary(ctx.db, ctx.platform.info().app_version), 'M1 成功标准的脱敏汇总'),
};

/** M1 成功标准（00 §6、01 §6）：只有计数 */
export async function exportSummary(db: Database, app_version: string): Promise<UsageSummary> {
  const t = now();
  const prof = await db.get<{ created_at: number; vocab_tested_at: number | null }>("SELECT created_at, vocab_tested_at FROM user_profile WHERE id = '1'");
  const first = Number(prof?.created_at ?? t);
  const days_since_first_use = Math.floor((t - first) / 86_400_000);
  const reviews = Number((await db.get<{ n: number }>('SELECT count(*) AS n FROM review_logs'))?.n ?? 0);
  const docs = await db.all<{ source_type: string; n: number; finished: number }>("SELECT source_type, count(*) AS n, sum(CASE WHEN finished_at IS NOT NULL THEN 1 ELSE 0 END) AS finished FROM documents GROUP BY source_type");
  const samples = docs.filter(d => d.source_type === 'sample').reduce((s, d) => s + Number(d.n), 0);
  const self_imported = docs.filter(d => d.source_type !== 'sample' && d.source_type !== 'tibi_generated').reduce((s, d) => s + Number(d.n), 0);
  const finished = docs.reduce((s, d) => s + Number(d.finished), 0);
  // H1：最早读完的文章（section_finished 事件）；导入事件里的 prelabel_total；读完前 source=user 且方向相反的改动
  const finishedEv = await db.get<{ payload: string; created_at: number }>("SELECT payload, created_at FROM learning_events WHERE type = 'section_finished' ORDER BY created_at LIMIT 1");
  let h1: UsageSummary['h1'] = { first_doc_finished: false, prelabeled_total: 0, prelabeled_changed: 0 };
  if (finishedEv) {
    const doc_id = j.parse<{ document_id?: string }>(finishedEv.payload, {}).document_id;
    const imp = await db.all<{ payload: string }>("SELECT payload FROM learning_events WHERE type = 'document_imported'");
    const prelabel_total = imp.map(r => j.parse<{ document_id?: string; prelabel_total?: number }>(r.payload, {})).find(x => x.document_id === doc_id)?.prelabel_total ?? 0;
    const changed = Number((await db.get<{ n: number }>(`SELECT count(DISTINCT term_id) AS n FROM term_status_log WHERE source = 'user' AND document_id = ? AND created_at <= ? AND prelabel IS NOT NULL
      AND ((prelabel = 'known' AND status <= 4) OR (prelabel = 'new' AND status IN (5, 97)))`, [doc_id ?? '', finishedEv.created_at]))?.n ?? 0);
    h1 = { first_doc_finished: true, prelabeled_total: prelabel_total, prelabeled_changed: changed, ...(prelabel_total ? { ratio: changed / prelabel_total } : {}) };
  }
  const window_closed = t - first >= 7 * 86_400_000;
  const imp7 = await db.all<{ payload: string }>("SELECT payload FROM learning_events WHERE type = 'document_imported' AND created_at < ?", [first + 7 * 86_400_000]);
  const self_imports_7d = imp7.map(r => j.parse<{ source_type?: string }>(r.payload, {})).filter(x => x.source_type && x.source_type !== 'sample' && x.source_type !== 'tibi_generated').length;
  const h2: UsageSummary['h2'] = { window_closed, self_imports_7d, ...(self_imports_7d > 0 || window_closed ? { passed: self_imports_7d > 0 } : {}) };
  const firstCard = await db.get<{ c: number | null }>('SELECT min(created_at) AS c FROM cards');
  let h3: UsageSummary['h3'] = { has_card: false };
  if (firstCard?.c) {
    const nextDay = startOfToday(Number(firstCard.c)) + 86_400_000;
    if (t >= nextDay + 86_400_000) {
      const n = Number((await db.get<{ n: number }>('SELECT count(*) AS n FROM review_logs WHERE reviewed_at >= ? AND reviewed_at < ?', [nextDay, nextDay + 86_400_000]))?.n ?? 0);
      h3 = { has_card: true, reviewed_next_day: n > 0 };
    } else h3 = { has_card: true };
  }
  return { schema: 1, app_version, days_since_first_use, vocab_tested: !!prof?.vocab_tested_at, reviews, documents: { samples, self_imported, finished }, h1, h2, h3 };
}

export const statsCapabilities: CapabilityMap = {
  get_learning_stats: capability({ name: 'get_learning_stats', description: '学习概况（stats.summary 的返回）', perm: 'read', params: Type.Object({ range: Type.Union([Type.Literal(30), Type.Literal(90), Type.Literal(180)], { default: 30 }) }), run: (p, ctx) => summary(ctx.db, p.range ?? 30) }),
  get_stats_series: capability({ name: 'get_stats_series', description: '按天的序列（已知词、分钟、词数、复习）', perm: 'read', params: Type.Object({ metrics: Type.Array(Type.String()), days: Type.Integer({ minimum: 1, maximum: 730, default: 30 }) }), run: (p, ctx) => series(ctx.db, p.metrics, p.days ?? 30) }),
};
