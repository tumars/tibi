import { Type } from '@sinclair/typebox';
import { j, now, type Database } from '../db/driver.js';
import { uuidv7 } from '../ids.js';
import { method, type Ctx, type MethodMap } from '../rpc/define.js';
import { TibiError } from '../types.js';
import type { CapabilityRegistry } from './capabilities.js';
import type { Turns } from './turns.js';

/**
 * MCP Server 的 Core 一侧（06 §6、05 §8，M5）。外部 AI 工具经 `tibi-core --mcp` 代理连进来，调用都走这里：
 * - 工具 = 能力层（不含 run_skill / tool_search）；
 * - 读能力默认全开；写能力（write / confirm）要用户在设置里逐项打开（settings mcp.write_tools），打开后仍按权限模式审批；
 * - 写调用直接执行；要确认时在 Tibi 里弹审批（注明来自外部工具），等用户点，最多等 5 分钟，超时算没确认。
 */
export interface McpTool { name: string; description: string; inputSchema: unknown; write: boolean }
const SKIP = new Set(['run_skill', 'tool_search']);

async function settings(db: Database): Promise<{ enabled: boolean; write: Set<string> }> {
  const rows = await db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('mcp.enabled', 'mcp.write_tools')");
  const m = Object.fromEntries(rows.map(r => [r.key, j.parse<unknown>(r.value, null)]));
  return { enabled: m['mcp.enabled'] === true, write: new Set((m['mcp.write_tools'] as string[] | null) ?? []) };
}

export function mcpTools(registry: CapabilityRegistry, write: Set<string>, all = false): McpTool[] {
  const out: McpTool[] = [];
  for (const c of registry.listForMcp()) {
    if (SKIP.has(c.name)) continue;
    const isWrite = c.perm !== 'read';
    if (isWrite && !all && !write.has(c.name)) continue;
    const def = registry.get(c.name)!;
    out.push({ name: c.name, description: c.description + (isWrite ? '（写入，会按 Tibi 的权限模式请用户确认）' : ''), inputSchema: JSON.parse(JSON.stringify(def.params)), write: isWrite });
  }
  return out;
}

/** 写调用等用户确认最多这么久 */
export const MCP_APPROVAL_MS = 5 * 60_000;

export function makeMcpMethods(deps: { db: Database; registry: CapabilityRegistry; turns: Turns; makeCtx: (caller: Ctx['caller']) => Ctx }): MethodMap {
  const { db, registry, turns } = deps;
  /** 写调用：开一次不在对话里的运行，审批挂在它上面；超时就停掉 */
  const callWrite = async (name: string, args: unknown, client?: string) => {
    let out: { ok: true; value: unknown } | { ok: false; error: unknown } = { ok: false, error: new TibiError('busy', '没有执行') };
    const id = uuidv7();
    turns.start({ id, client: client ?? '外部工具' }, async () => {
      try { out = { ok: true, value: await registry.call(name, args, deps.makeCtx({ origin: 'mcp', turn_id: id })) }; } catch (e) { out = { ok: false, error: e }; }
    });
    const timer = setTimeout(() => void turns.cancel(id), MCP_APPROVAL_MS);
    try { await turns.wait(id); } finally { clearTimeout(timer); }
    const r = out as { ok: true; value: unknown } | { ok: false; error: unknown };
    if (r.ok) return r.value;
    if (r.error instanceof TibiError && r.error.code === 'busy') throw new TibiError('permission_denied', '用户没有在 Tibi 里确认');
    throw r.error;
  };
  return {
    'mcp.config': method(Type.Object({}), async () => {
      const s = await settings(db);
      return { enabled: s.enabled, write_tools: [...s.write], tools: mcpTools(registry, s.write, true).map(t => ({ name: t.name, description: t.description, write: t.write })) };
    }, '设置页：开关、写工具列表（含没打开的）'),
    'mcp.configure': method(Type.Object({ enabled: Type.Optional(Type.Boolean()), write_tools: Type.Optional(Type.Array(Type.String())) }), async (p, ctx) => {
      const t = now();
      if (p.enabled !== undefined) await db.run("INSERT INTO settings(key, value, updated_at) VALUES ('mcp.enabled', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [j.str(p.enabled), t]);
      if (p.write_tools) await db.run("INSERT INTO settings(key, value, updated_at) VALUES ('mcp.write_tools', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [j.str(p.write_tools), t]);
      ctx.events.emit('data.changed', { table: 'settings' });
      return { ok: true as const };
    }, '开关 MCP、选哪些写工具对外开放'),
    'mcp.tools': method(Type.Object({}), async () => { const s = await settings(db); if (!s.enabled) throw new TibiError('permission_denied', 'Tibi 的 MCP 没有打开'); return mcpTools(registry, s.write); }, '代理用：tools/list'),
    'mcp.call': method(Type.Object({ name: Type.String(), args: Type.Optional(Type.Unknown()), client: Type.Optional(Type.String()) }), async (p) => {
      const s = await settings(db); if (!s.enabled) throw new TibiError('permission_denied', 'Tibi 的 MCP 没有打开');
      if (SKIP.has(p.name)) throw new TibiError('permission_denied', `${p.name} 不对外开放`);
      const def = registry.get(p.name); if (!def) throw new TibiError('not_found', `没有这项能力：${p.name}`);
      if (def.mcp === false) throw new TibiError('permission_denied', `${p.name} 不对外开放`);
      if (def.perm === 'read') return registry.call(p.name, p.args ?? {}, deps.makeCtx({ origin: 'mcp' }));
      if (!s.write.has(p.name)) throw new TibiError('permission_denied', `写工具 ${p.name} 没有在 Tibi 的设置里打开`);
      return callWrite(p.name, p.args ?? {}, p.client);
    }, '代理用：tools/call。读直接返回；写要确认时等用户在 Tibi 里点（最多 5 分钟）'),
  };
}
