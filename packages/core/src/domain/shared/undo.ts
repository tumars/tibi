import { Type } from '@sinclair/typebox';
import { j, now, type Database } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import { method, type Ctx, type MethodMap } from '../../rpc/define.js';
import { TibiError, type Undo } from '../../types.js';

/**
 * 写操作审计与撤销（06 §1、01 §7 skill_audit）：
 * 每个写能力调 recordUndo() 留下 undo_payload，并注册同名的撤销函数；system.undo 统一执行。
 */
export const UNDO_TTL_MS = 10 * 60 * 1000;

const undoers = new Map<string, (payload: any, ctx: Ctx) => Promise<void>>();

/** 注册某个工具的撤销函数（在模块加载时调用） */
export function registerUndo<T>(tool: string, fn: (payload: T, ctx: Ctx) => Promise<void>) { undoers.set(tool, fn); }

export interface AuditInput { tool: string; args: unknown; undo_payload: unknown; approval?: 'auto' | 'approved' | 'edited' | 'rejected'; idempotency_key?: string }

/** 写一条审计；返回给界面的 Undo 凭据 */
export async function recordUndo(db: Database, ctx: Pick<Ctx, 'caller'>, input: AuditInput): Promise<Undo> {
  const id = uuidv7(); const t = now();
  await db.run(
    'INSERT INTO skill_audit(id, job_step_id, skill_id, idempotency_key, tool, args, approval, undo_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, ctx.caller.call_id ?? null, ctx.caller.skill_id ?? null, input.idempotency_key ?? null, input.tool, j.str(input.args), input.approval ?? 'auto', j.str(input.undo_payload), t],
  );
  return { undo_id: id, expires_at: t + UNDO_TTL_MS };
}

/** 幂等：同一个幂等键已经写过，返回那次的 audit id（调用方据此跳过） */
export async function alreadyDone(db: Database, idempotency_key: string): Promise<boolean> {
  const r = await db.get<{ id: string }>('SELECT id FROM skill_audit WHERE idempotency_key = ?', [idempotency_key]);
  return !!r;
}

export const undoMethods: MethodMap = {
  'system.undo': method(Type.Object({ undo_id: Type.String() }), async (p, ctx) => {
    const row = await ctx.db.get<{ tool: string; undo_payload: string; undone_at: number | null; created_at: number }>('SELECT tool, undo_payload, undone_at, created_at FROM skill_audit WHERE id = ?', [p.undo_id]);
    if (!row) throw new TibiError('not_found', '找不到这次操作');
    if (row.undone_at) throw new TibiError('conflict', '已经撤销过了');
    if (now() - row.created_at > UNDO_TTL_MS) throw new TibiError('conflict', '超过撤销时限');
    const fn = undoers.get(row.tool);
    if (!fn) throw new TibiError('conflict', `这个操作不能撤销：${row.tool}`);
    await ctx.db.transaction(async tx => {
      await fn(j.parse(row.undo_payload, null), { ...ctx, db: tx });
      await tx.run('UPDATE skill_audit SET undone_at = ? WHERE id = ?', [now(), p.undo_id]);
    });
    return { ok: true as const };
  }, '所有返回 Undo 的操作统一从这里撤销'),
};
