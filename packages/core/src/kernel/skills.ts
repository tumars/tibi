import { Type } from '@sinclair/typebox';
import { j, now, type Database } from '../db/driver.js';
import { method, type MethodMap } from '../rpc/define.js';
import { TibiError, type Skill, type SkillId, type Tier } from '../types.js';
import { SKILL_DEFS } from './skills.gen.js';

/**
 * 技能定义（05 §5 SKILL.md）：内置、随应用分发；skills 表只存用户改动（模型档、附加指令、写入权限、启用）。
 * 用户不能新建或安装（B5 已砍）。
 */
export interface SkillDef {
  id: SkillId; title: string; description: string; allowed_tools: string[]; model: Tier; write: 'inherit' | 'ask'; body: string;
}

export interface ResolvedSkill extends SkillDef { extra_instructions?: string; enabled: boolean; write_permission: 'inherit' | 'ask' }

export const SKILL_IDS = SKILL_DEFS.map(s => s.id);
export function skillDef(id: string): SkillDef | undefined { return SKILL_DEFS.find(s => s.id === id); }

interface SkillRow extends Record<string, string | number | null> { id: string; model_tier: string | null; extra_instructions: string | null; write_permission: string; enabled: number }

/** 内置定义 + 用户覆盖 */
export async function resolveSkill(db: Database, id: string): Promise<ResolvedSkill> {
  const def = skillDef(id);
  if (!def) throw new TibiError('not_found', `没有这项技能：${id}`);
  const row = await db.get<SkillRow>('SELECT id, model_tier, extra_instructions, write_permission, enabled FROM skills WHERE id = ?', [id]);
  return {
    ...def,
    model: (row?.model_tier as Tier | null) ?? def.model,
    extra_instructions: row?.extra_instructions ?? undefined,
    enabled: row ? !!row.enabled : true,
    // SKILL.md 的 write: ask 只能收紧，用户不能放宽
    write_permission: def.write === 'ask' ? 'ask' : ((row?.write_permission as 'inherit' | 'ask' | undefined) ?? 'inherit'),
  };
}

export async function skillView(db: Database, id: string): Promise<Skill> {
  const s = await resolveSkill(db, id);
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const cost = await db.get<{ c: number | null }>('SELECT sum(cost) AS c FROM usage_records WHERE skill_id = ? AND created_at >= ?', [id, month.getTime()]);
  return { id: s.id, title: s.title, description: s.description, tools: s.allowed_tools, model_tier: s.model, extra_instructions: s.extra_instructions, write_permission: s.write_permission, enabled: s.enabled, month_cost: Number(cost?.c ?? 0) };
}

export function makeSkillMethods(runNow: (skill_id: SkillId, input: string, ctxCaller: { origin: 'ui' }) => Promise<{ task_id: string }>): MethodMap {
  const idSchema = Type.Union(SKILL_IDS.map(s => Type.Literal(s)));
  return {
    'skills.list': method(Type.Object({}), async (_p, ctx) => Promise.all(SKILL_IDS.map(id => skillView(ctx.db, id))), '设置页"Tibi 能做的事"'),
    'skills.update': method(Type.Object({ id: idSchema, patch: Type.Object({ model_tier: Type.Optional(Type.Union([Type.Literal('fast'), Type.Literal('deep')])), extra_instructions: Type.Optional(Type.String()), write_permission: Type.Optional(Type.Union([Type.Literal('inherit'), Type.Literal('ask')])), enabled: Type.Optional(Type.Boolean()) }) }), async (p, ctx) => {
      const cur = await resolveSkill(ctx.db, p.id); const t = now();
      const next = { model_tier: p.patch.model_tier ?? cur.model, extra_instructions: p.patch.extra_instructions ?? cur.extra_instructions ?? null, write_permission: p.patch.write_permission ?? cur.write_permission, enabled: p.patch.enabled ?? cur.enabled };
      await ctx.db.run('INSERT INTO skills(id, model_tier, extra_instructions, write_permission, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET model_tier = excluded.model_tier, extra_instructions = excluded.extra_instructions, write_permission = excluded.write_permission, enabled = excluded.enabled, updated_at = excluded.updated_at',
        [p.id, next.model_tier, next.extra_instructions, next.write_permission, next.enabled ? 1 : 0, t, t]);
      ctx.events.emit('data.changed', { table: 'skills', ids: [p.id] });
      return skillView(ctx.db, p.id);
    }),
    'skills.reset': method(Type.Object({ id: idSchema }), async (p, ctx) => {
      await ctx.db.run('DELETE FROM skills WHERE id = ?', [p.id]);
      ctx.events.emit('data.changed', { table: 'skills', ids: [p.id] });
      return skillView(ctx.db, p.id);
    }, '恢复默认'),
    'skills.runNow': method(Type.Object({ id: idSchema, input: Type.Optional(Type.String()) }), async (p) => runNow(p.id as SkillId, p.input ?? '', { origin: 'ui' }), '/ 直接调用'),
  };
}

export const skillIdSchema = Type.Union(SKILL_IDS.map(s => Type.Literal(s)));
export { j as _j };
