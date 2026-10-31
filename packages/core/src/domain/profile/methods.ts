import { Type } from '@sinclair/typebox';
import { j, now, type Database } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import { method, S, type Ctx, type MethodMap } from '../../rpc/define.js';
import { TibiError, type Profile, type Provider } from '../../types.js';
import { BANDS, BUILTIN_WORDS, mutateWord, PSEUDO_PER_BAND, PSEUDO_WORDS } from './wordlists.js';

/** 画像、设置、服务商、词汇量测试（00 §3.7、§3.9；06 settings 组） */

export const LEVEL_ESTIMATE: Record<string, number> = { beginner: 2000, intermediate: 3500, upper: 6000, advanced: 9000, cet4: 3500, cet6: 5000, ielts6: 6000, ielts7: 8000 };
const DEFAULT_PREFS = { nickname: '你', language: 'mixed' as const, permission: 'default' as const };

interface ProfileRow { display_name: string | null; goal: string | null; level_self: string | null; interests: string; vocab_estimate: number; vocab_source: string; vocab_tested_at: number | null; daily_goal_minutes: number; daily_new_cards: number; desired_retention: number; assistant_prefs: string; [k: string]: string | number | null }

export async function getProfile(db: Database): Promise<Profile> {
  const r = await db.get<ProfileRow>("SELECT * FROM user_profile WHERE id = '1'");
  if (!r) throw new TibiError('not_found', '还没有用户档案');
  return {
    display_name: r.display_name ?? '', goal: r.goal ?? 'interest', level_self: r.level_self ?? 'upper', interests: j.parse<string[]>(r.interests, []),
    vocab_estimate: Number(r.vocab_estimate), vocab_source: (r.vocab_source as Profile['vocab_source']) ?? 'self', ...(r.vocab_tested_at ? { vocab_tested_at: Number(r.vocab_tested_at) } : {}),
    daily_goal_minutes: Number(r.daily_goal_minutes), daily_new_cards: Number(r.daily_new_cards), desired_retention: Number(r.desired_retention),
    assistant_prefs: { ...DEFAULT_PREFS, ...j.parse<Partial<Profile['assistant_prefs']>>(r.assistant_prefs, {}) },
  };
}

const profilePatch = Type.Partial(Type.Object({
  display_name: Type.String(), goal: Type.String(), level_self: Type.String(), interests: Type.Array(Type.String()),
  vocab_estimate: Type.Integer({ minimum: 0, maximum: 60000 }), vocab_source: Type.Union(['self', 'test', 'manual'].map(s => Type.Literal(s))),
  daily_goal_minutes: Type.Integer({ minimum: 1, maximum: 600 }), daily_new_cards: Type.Integer({ minimum: 0, maximum: 500 }), desired_retention: Type.Number({ minimum: 0.7, maximum: 0.99 }),
  assistant_prefs: Type.Partial(Type.Object({ nickname: Type.String(), language: Type.Union(['mixed', 'zh', 'en'].map(s => Type.Literal(s))), permission: Type.Union(['ask', 'default', 'auto'].map(s => Type.Literal(s))) })),
}));

export const profileMethods: MethodMap = {
  'profile.get': method(Type.Object({}), async (_p, ctx) => getProfile(ctx.db), ''),

  'profile.update': method(Type.Object({ patch: profilePatch }), async (p, ctx) => {
    const cur = await getProfile(ctx.db); const patch = p.patch; const t = now();
    const sets: string[] = []; const vals: unknown[] = [];
    const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
    for (const k of ['display_name', 'goal', 'level_self', 'daily_goal_minutes', 'daily_new_cards', 'desired_retention'] as const) if (patch[k] !== undefined) put(k, patch[k]);
    if (patch.interests) put('interests', j.str(patch.interests));
    if (patch.assistant_prefs) put('assistant_prefs', j.str({ ...cur.assistant_prefs, ...patch.assistant_prefs }));
    if (patch.vocab_estimate !== undefined) { put('vocab_estimate', patch.vocab_estimate); put('vocab_source', patch.vocab_source ?? 'manual'); }
    else if (patch.vocab_source) put('vocab_source', patch.vocab_source);
    // 自评水平改了且估算仍来自自评：重算（00 §3.9）
    if (patch.level_self && patch.vocab_estimate === undefined && (patch.vocab_source ?? cur.vocab_source) === 'self') put('vocab_estimate', LEVEL_ESTIMATE[patch.level_self] ?? cur.vocab_estimate);
    if (sets.length) { put('updated_at', t); await ctx.db.run(`UPDATE user_profile SET ${sets.join(', ')} WHERE id = '1'`, vals as never); }
    ctx.events.emit('data.changed', { table: 'settings' });
    return getProfile(ctx.db);
  }, '自动保存；vocab_source = self 时改自评水平会重算 vocab_estimate'),

  'settings.get': method(Type.Object({ keys: Type.Optional(Type.Array(Type.String())) }), async (p, ctx) => {
    const rows = p.keys?.length
      ? await ctx.db.all<{ key: string; value: string }>(`SELECT key, value FROM settings WHERE key IN (${p.keys.map(() => '?').join(',')})`, p.keys)
      : await ctx.db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key NOT LIKE 'practice.pending.%' AND key NOT LIKE 'vocab.pending%'");
    return Object.fromEntries(rows.map(r => [r.key, j.parse<unknown>(r.value, null)]));
  }, 'reader.*、tts.*、ui.* 等键值'),

  'settings.set': method(Type.Object({ patch: Type.Record(Type.String(), Type.Unknown()) }), async (p, ctx) => {
    const t = now();
    await ctx.db.transaction(async tx => {
      for (const [k, v] of Object.entries(p.patch)) {
        if (v === undefined || v === null) await tx.run('DELETE FROM settings WHERE key = ?', [k]);
        else await tx.run('INSERT INTO settings(key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [k, j.str(v), t]);
      }
    });
    ctx.events.emit('data.changed', { table: 'settings' });
    return ctx.call<Record<string, unknown>>('settings.get', { keys: Object.keys(p.patch) });
  }, ''),

  'providers.list': method(Type.Object({}), async (_p, ctx) => listProviders(ctx.db), '密钥不返回，只有 has_secret'),

  'providers.upsert': method(Type.Object({
    provider: Type.Object({ id: Type.Optional(S.id), kind: Type.Union(['llm', 'vision', 'image', 'tts'].map(s => Type.Literal(s))), name: Type.String(), protocol: Type.String(), base_url: Type.Optional(Type.String()), auth: Type.Literal('api_key', { default: 'api_key' }), tier: Type.Optional(Type.Union([Type.Literal('fast'), Type.Literal('deep')])), model: Type.String(), is_default: Type.Boolean({ default: false }) }),
    secret_ref: Type.Optional(Type.String()),
  }), async (p, ctx) => {
    const t = now(); const id = p.provider.id ?? uuidv7();
    await ctx.db.transaction(async tx => {
      if (p.provider.is_default) await tx.run('UPDATE providers SET is_default = 0, updated_at = ? WHERE kind = ? AND id != ?', [t, p.provider.kind, id]);
      if (p.provider.tier) await tx.run('UPDATE providers SET tier = NULL, updated_at = ? WHERE kind = ? AND tier = ? AND id != ?', [t, p.provider.kind, p.provider.tier, id]);
      const exists = await tx.get<{ id: string }>('SELECT id FROM providers WHERE id = ?', [id]);
      if (exists) await tx.run('UPDATE providers SET kind = ?, name = ?, protocol = ?, base_url = ?, tier = ?, model = ?, secret_ref = COALESCE(?, secret_ref), is_default = ?, updated_at = ?, deleted_at = NULL WHERE id = ?',
        [p.provider.kind, p.provider.name, p.provider.protocol, p.provider.base_url ?? null, p.provider.tier ?? null, p.provider.model, p.secret_ref ?? null, p.provider.is_default ? 1 : 0, t, id]);
      else await tx.run('INSERT INTO providers(id, kind, name, protocol, base_url, auth, tier, model, secret_ref, options, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, p.provider.kind, p.provider.name, p.provider.protocol, p.provider.base_url ?? null, 'api_key', p.provider.tier ?? null, p.provider.model, p.secret_ref ?? null, '{}', p.provider.is_default ? 1 : 0, t, t]);
    });
    ctx.events.emit('data.changed', { table: 'settings' });
    return (await listProviders(ctx.db)).find(x => x.id === id)!;
  }, '密钥先由 Rust 写入钥匙串，这里只传引用'),

  'providers.test': method(Type.Object({ id: S.id }), async (p, ctx) => {
    const r = await ctx.db.get<{ id: string; secret_ref: string | null }>('SELECT id, secret_ref FROM providers WHERE id = ? AND deleted_at IS NULL', [p.id]);
    if (!r) throw new TibiError('not_found', '没有这个服务商');
    if (!r.secret_ref || !(await ctx.platform.getSecret(r.secret_ref))) return { ok: false, error: '还没有填 API Key' };
    return { ok: false, error: '连接测试在接入模型后提供（M0 还没有）' };
  }, '连接测试（M0 占位）'),

  'vocab.start': method(Type.Object({}), async (_p, ctx) => vocabStart(ctx), '词汇量测试：7 组，含伪词（不标出）'),
  'vocab.submit': method(Type.Object({ picks: Type.Array(Type.Array(Type.String())) }), async (p, ctx) => vocabSubmit(ctx, p.picks), '估算并初始化已知词库'),
};

async function listProviders(db: Database): Promise<Provider[]> {
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const rows = await db.all<{ id: string; kind: string; name: string; protocol: string; base_url: string | null; tier: string | null; model: string; secret_ref: string | null; is_default: number }>('SELECT id, kind, name, protocol, base_url, tier, model, secret_ref, is_default FROM providers WHERE deleted_at IS NULL ORDER BY created_at');
  return rows.map(r => ({ id: r.id, kind: r.kind as Provider['kind'], name: r.name, protocol: r.protocol, base_url: r.base_url ?? undefined, auth: 'api_key' as const, tier: (r.tier as Provider['tier']) ?? undefined, model: r.model, has_secret: !!r.secret_ref, is_default: !!r.is_default }));
}

/* ---------- 词汇量测试 ---------- */

interface PendingBand { label: string; lo: number; hi: number; words: string[]; pseudo: string[] }

async function vocabStart(ctx: Ctx) {
  const bands: PendingBand[] = [];
  let seed = Math.floor(Math.random() * 1e6);
  for (let i = 0; i < BANDS.length; i++) {
    const b = BANDS[i]!;
    let real: string[] = [];
    try { real = await pickByFrequency(ctx, b.lo, b.hi, b.real); } catch { real = []; }
    if (real.length < b.real) {
      const pool = shuffle([...BUILTIN_WORDS[i]!]).filter(w => !real.includes(w));
      real = [...real, ...pool].slice(0, b.real);
    }
    const pseudo: string[] = [];
    const pool = shuffle([...PSEUDO_WORDS]);
    for (const w of real) { if (pseudo.length >= PSEUDO_PER_BAND) break; const m = mutateWord(w, seed++); if (!(await ctx.dict.lookup(m)) && !real.includes(m)) pseudo.push(m); }
    while (pseudo.length < PSEUDO_PER_BAND) pseudo.push(pool.pop()!);
    bands.push({ label: b.label, lo: b.lo, hi: b.hi, words: shuffle([...real, ...pseudo]), pseudo });
  }
  await ctx.db.run('INSERT INTO settings(key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', ['vocab.pending', j.str(bands), now()]);
  return { bands: bands.map(b => ({ label: b.label, words: b.words })) };
}

/** 有词典时按词频区间随机取 */
async function pickByFrequency(ctx: Ctx, lo: number, hi: number, n: number): Promise<string[]> {
  const q = (ctx.dict as { pickByRank?: (lo: number, hi: number, n: number) => Promise<string[]> }).pickByRank;
  if (!q) return [];
  return (await q.call(ctx.dict, lo, hi, n)).filter(w => /^[a-z]{3,}$/.test(w));
}

export function estimateVocab(bands: PendingBand[], picks: string[][]): { estimate: number; ratios: number[]; pseudo_hits: number } {
  let est = 0, pseudo_hits = 0; const ratios: number[] = [];
  bands.forEach((b, i) => {
    const chosen = new Set((picks[i] ?? []).map(w => w.toLowerCase()));
    const real = b.words.filter(w => !b.pseudo.includes(w));
    const hit = real.filter(w => chosen.has(w)).length;
    pseudo_hits += b.pseudo.filter(w => chosen.has(w)).length;
    const r = real.length ? hit / real.length : 0;
    ratios.push(r);
    est += r * (b.hi - b.lo);
  });
  const totalPseudo = bands.reduce((s, b) => s + b.pseudo.length, 0);
  const penalty = totalPseudo ? pseudo_hits / totalPseudo : 0;
  est *= 1 - penalty;
  return { estimate: Math.max(0, Math.round(est / 100) * 100), ratios, pseudo_hits };
}

export function cefrOf(est: number): string { return est < 2000 ? 'A2' : est < 3500 ? 'B1' : est < 6000 ? 'B2' : est < 9000 ? 'C1' : 'C2'; }

async function vocabSubmit(ctx: Ctx, picks: string[][]) {
  const pending = await ctx.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'vocab.pending'");
  const bands = j.parse<PendingBand[]>(pending?.value, []);
  if (!bands.length) throw new TibiError('conflict', '先调用 vocab.start');
  const { estimate, ratios, pseudo_hits } = estimateVocab(bands, picks);
  const t = now();
  await ctx.db.transaction(async tx => {
    await tx.run("UPDATE user_profile SET vocab_estimate = ?, vocab_source = 'test', vocab_tested_at = ?, updated_at = ? WHERE id = '1'", [estimate, t, t]);
    await tx.run("DELETE FROM settings WHERE key = 'vocab.pending'");
    // 中间带 N..N+3000 的规则推断词改为待确认（99）；更常见的词按规则视为已知，不入库（00 §3.1）
    const rows = await tx.all<{ id: string; text: string }>("SELECT id, text FROM terms WHERE status_source = 'auto_rule' AND status IN (0, 99) AND deleted_at IS NULL");
    if (rows.length && ctx.dict.frequencyRanks) {
      const ranks = await ctx.dict.frequencyRanks(rows.map(r => r.text));
      for (const r of rows) {
        const rank = ranks.get(r.text);
        const want = rank == null ? 0 : rank < estimate ? 97 : rank < estimate + 3000 ? 99 : 0;
        if (want === 97) { await tx.run("UPDATE terms SET status = 97, status_source = 'auto_rule', status_changed_at = ?, updated_at = ? WHERE id = ?", [t, t, r.id]); }
        else if (want === 99) { await tx.run("UPDATE terms SET status = 99, status_source = 'auto_rule', status_changed_at = ?, updated_at = ? WHERE id = ?", [t, t, r.id]); }
      }
    }
    await tx.run('INSERT INTO learning_events(id, type, payload, consolidated, created_at) VALUES (?,?,?,0,?)', [uuidv7(), 'vocab_test', j.str({ estimate, ratios, pseudo_hits }), t]);
  });
  ctx.events.emit('data.changed', { table: 'settings' });
  ctx.events.emit('data.changed', { table: 'terms' });
  return { estimate, cefr: cefrOf(estimate), bands: ratios, pseudo_hits };
}

function shuffle<T>(arr: T[]): T[] { for (let i = arr.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [arr[i], arr[k]] = [arr[k]!, arr[i]!]; } return arr; }
