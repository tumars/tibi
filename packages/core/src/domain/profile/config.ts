import { Type, type TSchema } from '@sinclair/typebox';
import { deepLink } from '../../deeplink.js';
import { j, now, type Database } from '../../db/driver.js';
import { capability, validateParams, type CapabilityMap, type Ctx, type Perm } from '../../rpc/define.js';
import { TibiError, type SkillId } from '../../types.js';
import { recordUndo, registerUndo } from '../shared/undo.js';
import { getProfile, profileMethods } from './methods.js';

/**
 * Tibi 自己改配置（06 §5）：只开放这张表里的项，没有通用的 settings.set，也没有 SQL。
 * settings 表里还存着权限规则（perm.auto.*）和外部工具开关（mcp.*），服务商地址一改 API Key 就发到别处，
 * 所以这些、权限模式、密钥都不在表里：Tibi 改不了，只能用 open_settings 把用户带过去。
 * tier：normal 按写操作走权限模式；always 每次都问，读过不可信内容的任务直接拒绝。
 */
interface ConfigItem { label: string; tier: 'normal' | 'always'; schema: TSchema; read(db: Database): Promise<unknown>; write(ctx: Ctx, value: unknown): Promise<void> }

async function putSetting(db: Database, key: string, value: unknown) {
  if (value === undefined) await db.run('DELETE FROM settings WHERE key = ?', [key]);
  else await db.run('INSERT INTO settings(key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [key, j.str(value), now()]);
}
async function readSetting(db: Database, key: string): Promise<unknown> {
  const r = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return r ? j.parse<unknown>(r.value, undefined) : undefined;
}
const setting = (key: string, label: string, tier: ConfigItem['tier'], schema: TSchema): ConfigItem => ({
  label, tier, schema,
  read: db => readSetting(db, key),
  async write(ctx, value) { await putSetting(ctx.db, key, value); ctx.events.emit('data.changed', { table: 'settings' }); },
});
// 走 profile.update 的处理函数：撤销在事务里跑，不能再经 ctx.call 开新事务
const updateProfile = (ctx: Ctx, patch: unknown) => profileMethods['profile.update']!.handler({ patch }, ctx);
const profileField = (field: 'interests' | 'daily_goal_minutes' | 'daily_new_cards' | 'desired_retention', label: string, tier: ConfigItem['tier'], schema: TSchema): ConfigItem => ({
  label, tier, schema,
  read: async db => (await getProfile(db))[field],
  write: (ctx, value) => updateProfile(ctx, { [field]: value }) as Promise<void>,
});
const prefField = (field: 'nickname', label: string, schema: TSchema): ConfigItem => ({
  label, tier: 'normal', schema,
  read: async db => (await getProfile(db)).assistant_prefs[field],
  write: (ctx, value) => updateProfile(ctx, { assistant_prefs: { [field]: value } }) as Promise<void>,
});
const oneOf = (...v: string[]) => Type.Union(v.map(s => Type.Literal(s)));

export const CONFIG: Record<string, ConfigItem> = {
  nickname: prefField('nickname', 'Tibi 怎么称呼你', Type.String({ minLength: 1, maxLength: 40 })),
  interests: profileField('interests', '兴趣（找文章时用）', 'normal', Type.Array(Type.String({ maxLength: 40 }), { maxItems: 30 })),
  daily_goal_minutes: profileField('daily_goal_minutes', '每日阅读目标（分钟）', 'normal', Type.Integer({ minimum: 1, maximum: 600 })),
  daily_new_cards: profileField('daily_new_cards', '每天最多新学的词', 'normal', Type.Integer({ minimum: 0, maximum: 500 })),
  'tts.rate': setting('tts.rate', '朗读语速', 'normal', Type.Number({ minimum: 0.5, maximum: 2 })),
  'reminder.time': setting('reminder.time', '每日提醒（off / morning / noon / evening）', 'normal', oneOf('off', 'morning', 'noon', 'evening')),
  desired_retention: profileField('desired_retention', '复习目标记得率（影响排期）', 'always', Type.Number({ minimum: 0.7, maximum: 0.99 })),
  web_search: setting('web_search', '网页搜索服务（值形如 { "provider": "deepseek" | "tavily" | "off" }）', 'always', Type.Object({ provider: oneOf('deepseek', 'tavily', 'off') })),
  'memory.paused': setting('memory.paused', '暂停记新的记忆', 'always', Type.Boolean()),
};

const NOT_HERE = 'API Key、服务商和地址、权限模式、MCP、登录同步、恢复备份、清空记忆：Tibi 不能改，用 open_settings 带用户去设置页。';
const SECTIONS: Record<string, string> = { general: '通用', model: '模型', learning: '学习与复习', memory: '记忆', advanced: '高级', data: '数据', about: '关于' };
const keySchema = Type.Union(Object.keys(CONFIG).map(k => Type.Literal(k)));
const parseValue = (key: string, value: unknown) => validateParams(CONFIG[key]!.schema, value);
const show = (v: unknown) => (typeof v === 'string' ? v : j.str(v));

registerUndo<{ key: string; prev: unknown }>('set_config', async (p, ctx) => { await CONFIG[p.key]!.write(ctx, p.prev ?? undefined); });
registerUndo<{ id: string; prev: { model_tier: string | null; extra_instructions: string | null; enabled: number } }>('configure_skill', async (p, ctx) => {
  await ctx.db.run('UPDATE skills SET model_tier = ?, extra_instructions = ?, enabled = ?, updated_at = ? WHERE id = ?', [p.prev.model_tier, p.prev.extra_instructions, p.prev.enabled, now(), p.id]);
  ctx.events.emit('data.changed', { table: 'skills' });
});

export const configCapabilities: CapabilityMap = {
  get_config: capability({
    name: 'get_config', description: '看 Tibi 能改的设置和现在的值', perm: 'read', mcp: false, params: Type.Object({}),
    async run(_p, ctx) {
      const items = await Promise.all(Object.entries(CONFIG).map(async ([key, c]) => ({ key, label: c.label, value: await c.read(ctx.db), asks_every_time: c.tier === 'always' })));
      return { items, not_here: NOT_HERE };
    },
  }),
  set_config: capability({
    name: 'set_config', description: '改一项设置（key 和取值见 get_config），可撤销', perm: 'write', undoable: true, mcp: false,
    params: Type.Object({ key: keySchema, value: Type.Unknown() }),
    permFor: (p): Perm => (CONFIG[p.key]!.tier === 'always' ? 'always' : 'write'),
    async describe(p) { return `把「${CONFIG[p.key]!.label}」改成 ${show(parseValue(p.key, p.value))}`; },
    async run(p, ctx) {
      const item = CONFIG[p.key]!; const value = parseValue(p.key, p.value);
      const prev = await item.read(ctx.db);
      await item.write(ctx, value);
      const undo = await recordUndo(ctx.db, ctx, { tool: 'set_config', args: p, undo_payload: { key: p.key, prev: prev ?? null } });
      return { key: p.key, value, prev, undo };
    },
  }),
  configure_skill: capability({
    name: 'configure_skill', description: '管理技能：改模型档位、附加指令或开关（每次都要用户确认），可撤销', perm: 'always', undoable: true, mcp: false,
    params: Type.Object({ id: Type.String(), patch: Type.Object({ model_tier: Type.Optional(oneOf('fast', 'deep')), extra_instructions: Type.Optional(Type.String({ maxLength: 2000 })), enabled: Type.Optional(Type.Boolean()) }) }),
    async describe(p) { return `改技能 ${p.id}：${show(p.patch)}`; },
    async run(p, ctx) {
      if (p.id === 'tibi' && p.patch.enabled === false) throw new TibiError('permission_denied', '主对话不能关');
      const cur = (await ctx.call<{ id: SkillId; model_tier: string; extra_instructions?: string; enabled: boolean }[]>('skills.list', {})).find(s => s.id === p.id);
      if (!cur) throw new TibiError('not_found', `没有这项技能：${p.id}`);
      const next = await ctx.call('skills.update', { id: p.id, patch: p.patch });
      const undo = await recordUndo(ctx.db, ctx, { tool: 'configure_skill', args: p, undo_payload: { id: p.id, prev: { model_tier: cur.model_tier, extra_instructions: cur.extra_instructions ?? null, enabled: cur.enabled ? 1 : 0 } } });
      return { skill: next, undo };
    },
  }),
  create_backup: capability({
    name: 'create_backup', description: '管理数据：立即备份一次（批量删除前先备份）', perm: 'confirm', mcp: false, params: Type.Object({}),
    async run(_p, ctx) { return ctx.call('system.backup', { reason: 'manual' }); },
  }),
  open_settings: capability({
    name: 'open_settings', description: '给用户一张卡片，点了打开设置页的某一部分（Tibi 不能改的设置用它）', perm: 'read', mcp: false,
    params: Type.Object({ section: oneOf(...Object.keys(SECTIONS)), reason: Type.String({ minLength: 1, maxLength: 200, description: '用户要去改什么' }) }),
    async run(p) { return { shown: true, ...p }; },
    widget: (_r, p) => ({ kind: 'link', summary: `给了去设置页「${SECTIONS[p.section]}」的入口：${p.reason}`, data: { text: p.reason, links: [{ label: `打开设置 · ${SECTIONS[p.section]}`, href: deepLink({ to: 'settings', section: p.section }) }] } }),
  }),
};

