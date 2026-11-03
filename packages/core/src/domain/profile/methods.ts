import { Type } from '@sinclair/typebox';
import { j, now, type Database } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import { method, S, type Ctx, type MethodMap } from '../../rpc/define.js';
import { TibiError, type Profile, type Provider } from '../../types.js';

/** 画像、设置、服务商（00 §3.7；06 settings 组）。不记英语水平、目标和词汇量：生词只看用户自己标的 */

const DEFAULT_PREFS = { nickname: '你', permission: 'default' as const };

interface ProfileRow { display_name: string | null; interests: string; daily_goal_minutes: number; daily_new_cards: number; desired_retention: number; assistant_prefs: string; [k: string]: string | number | null }

export async function getProfile(db: Database): Promise<Profile> {
  const r = await db.get<ProfileRow>("SELECT * FROM user_profile WHERE id = '1'");
  if (!r) throw new TibiError('not_found', '还没有用户档案');
  const prefs = j.parse<Partial<Profile['assistant_prefs']>>(r.assistant_prefs, {});
  return {
    display_name: r.display_name ?? '', interests: j.parse<string[]>(r.interests, []),
    daily_goal_minutes: Number(r.daily_goal_minutes), daily_new_cards: Number(r.daily_new_cards), desired_retention: Number(r.desired_retention),
    // 只取认识的键：旧数据里的 language 等不再返回
    assistant_prefs: { nickname: prefs.nickname ?? DEFAULT_PREFS.nickname, permission: prefs.permission ?? DEFAULT_PREFS.permission },
  };
}

const profilePatch = Type.Partial(Type.Object({
  display_name: Type.String(), interests: Type.Array(Type.String()),
  daily_goal_minutes: Type.Integer({ minimum: 1, maximum: 600 }), daily_new_cards: Type.Integer({ minimum: 0, maximum: 500 }), desired_retention: Type.Number({ minimum: 0.7, maximum: 0.99 }),
  assistant_prefs: Type.Partial(Type.Object({ nickname: Type.String(), permission: Type.Union(['ask', 'default', 'auto'].map(s => Type.Literal(s))) })),
}));

export const profileMethods: MethodMap = {
  'profile.get': method(Type.Object({}), async (_p, ctx) => getProfile(ctx.db), ''),

  'profile.update': method(Type.Object({ patch: profilePatch }), async (p, ctx) => {
    const cur = await getProfile(ctx.db); const patch = p.patch; const t = now();
    const sets: string[] = []; const vals: unknown[] = [];
    const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
    for (const k of ['display_name', 'daily_goal_minutes', 'daily_new_cards', 'desired_retention'] as const) if (patch[k] !== undefined) put(k, patch[k]);
    if (patch.interests) put('interests', j.str(patch.interests));
    if (patch.assistant_prefs) put('assistant_prefs', j.str({ nickname: patch.assistant_prefs.nickname ?? cur.assistant_prefs.nickname, permission: patch.assistant_prefs.permission ?? cur.assistant_prefs.permission }));
    if (sets.length) { put('updated_at', t); await ctx.db.run(`UPDATE user_profile SET ${sets.join(', ')} WHERE id = '1'`, vals as never); }
    ctx.events.emit('data.changed', { table: 'settings' });
    return getProfile(ctx.db);
  }, '自动保存'),

  'settings.get': method(Type.Object({ keys: Type.Optional(Type.Array(Type.String())) }), async (p, ctx) => {
    const rows = p.keys?.length
      ? await ctx.db.all<{ key: string; value: string }>(`SELECT key, value FROM settings WHERE key IN (${p.keys.map(() => '?').join(',')})`, p.keys)
      : await ctx.db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key NOT LIKE 'practice.pending.%'");
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
    const t = now();
    // 没带 id：同一服务的同一档已有记录就更新它，重复连接不新增
    const same = !p.provider.id && p.provider.tier ? await ctx.db.get<{ id: string }>('SELECT id FROM providers WHERE kind = ? AND name = ? AND base_url IS ? AND tier = ? AND deleted_at IS NULL', [p.provider.kind, p.provider.name, p.provider.base_url ?? null, p.provider.tier]) : undefined;
    const id = p.provider.id ?? same?.id ?? uuidv7();
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
    // 连上模型后把"稍后补做"的文章排进任务（M2）
    void ctx.call('documents.analyze_deferred', {}).catch(() => undefined);
    return (await listProviders(ctx.db)).find(x => x.id === id)!;
  }, '密钥先由 Rust 写入密钥存储，这里只传引用；没带 id 时，同服务同档已有记录就更新它'),

  'providers.delete': method(Type.Object({ id: S.id }), async (p, ctx) => {
    const r = await ctx.db.get<{ kind: string; secret_ref: string | null; is_default: number }>('SELECT kind, secret_ref, is_default FROM providers WHERE id = ? AND deleted_at IS NULL', [p.id]);
    if (!r) throw new TibiError('not_found', '没有这个服务商');
    const t = now();
    let orphan = false;
    await ctx.db.transaction(async tx => {
      await tx.run('UPDATE providers SET deleted_at = ?, is_default = 0, updated_at = ? WHERE id = ?', [t, t, p.id]);
      // 默认被删：交给还在用的一条（快速档优先），否则没配那一档的调用会找不到模型
      if (r.is_default) await tx.run("UPDATE providers SET is_default = 1, updated_at = ? WHERE id = (SELECT id FROM providers WHERE kind = ? AND deleted_at IS NULL ORDER BY tier IS NULL, tier = 'fast' DESC, created_at LIMIT 1)", [t, r.kind]);
      if (r.secret_ref) orphan = !(await tx.get<{ id: string }>('SELECT id FROM providers WHERE secret_ref = ? AND deleted_at IS NULL LIMIT 1', [r.secret_ref]));
    });
    ctx.events.emit('data.changed', { table: 'settings' });
    return { ok: true as const, secret_ref: orphan && r.secret_ref ? r.secret_ref : undefined };
  }, '软删；默认被删时交给剩下的一条。secret_ref 只在没有别的记录再用这个密钥时返回，由调用方从密钥存储删掉'),

  'providers.test': method(Type.Object({ id: S.id }), async (p, ctx) => {
    const r = await ctx.db.get<{ id: string; secret_ref: string | null }>('SELECT id, secret_ref FROM providers WHERE id = ? AND deleted_at IS NULL', [p.id]);
    if (!r) throw new TibiError('not_found', '没有这个服务商');
    if (!r.secret_ref || !(await ctx.platform.getSecret(r.secret_ref))) return { ok: false, error: '还没有填 API Key' };
    if (!ctx.ai) return { ok: false, error: '这里不能调用模型' };
    try {
      const out = await ctx.ai.complete({ provider_id: r.id, system: 'Reply with exactly: OK', prompt: 'ping', max_tokens: 5 });
      return { ok: true, model: out.model, latency_ms: out.latency_ms };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }, '连接测试：用这个服务商发一条很短的请求，返回模型名与耗时；不计入预算检查（仍记用量）'),
};

async function listProviders(db: Database): Promise<Provider[]> {
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const rows = await db.all<{ id: string; kind: string; name: string; protocol: string; base_url: string | null; tier: string | null; model: string; secret_ref: string | null; is_default: number }>('SELECT id, kind, name, protocol, base_url, tier, model, secret_ref, is_default FROM providers WHERE deleted_at IS NULL ORDER BY created_at');
  return rows.map(r => ({ id: r.id, kind: r.kind as Provider['kind'], name: r.name, protocol: r.protocol, base_url: r.base_url ?? undefined, auth: 'api_key' as const, tier: (r.tier as Provider['tier']) ?? undefined, model: r.model, has_secret: !!r.secret_ref, is_default: !!r.is_default }));
}
