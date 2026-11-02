import { Type } from '@sinclair/typebox';
import { j, now, type Database } from '../db/driver.js';
import { method, type Ctx, type MethodMap } from '../rpc/define.js';
import { TibiError } from '../types.js';
import type { CapabilityRegistry } from './capabilities.js';
import type { JobRunnerImpl } from './jobs.js';
import type { JobContext } from './types.js';

/**
 * MCP Server 的 Core 一侧（06 §6、05 §8，M5）。外部 AI 工具经 `tibi-core --mcp` 代理连进来，调用都走这里：
 * - 工具 = 能力层（不含 run_skill / tool_search）+ tibi_task_status；
 * - 读能力默认全开；写能力（write / confirm）要用户在设置里逐项打开（settings mcp.write_tools），打开后仍按权限模式审批；
 * - 写调用作为一个 trigger = mcp 的任务跑（审批卡注明来自外部工具）；两秒内没完成就先返回 pending_approval，外部工具用 tibi_task_status 轮询。
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
  out.push({ name: 'tibi_task_status', description: '查询一个 Tibi 任务的状态（写操作等用户确认时返回的 task_id）', inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] }, write: false });
  return out;
}

export function makeMcpMethods(deps: { db: Database; registry: CapabilityRegistry; runner: JobRunnerImpl; makeCtx: (caller: Ctx['caller']) => Ctx }): MethodMap {
  const { db, registry, runner } = deps;
  // 写调用的任务：在任务里调能力，需要确认时挂起等审批
  runner.register('mcp', async (job: JobContext, input: { tool: string; args: unknown; client?: string }) => {
    const ctx = deps.makeCtx({ origin: 'mcp', job_id: job.job_id });
    const result = await job.step('call', () => registry.call(input.tool, input.args, ctx), { kind: 'tool', label: input.tool });
    return { summary: `${input.client ?? '外部工具'}调用了 ${input.tool}`, result };
  });
  const status = async (task_id: string) => {
    const s = await runner.summary(task_id); if (!s) throw new TibiError('not_found', '没有这个任务');
    const row = await db.get<{ output: string | null; approval: string | null }>('SELECT output, approval FROM jobs WHERE id = ?', [task_id]);
    const out = j.parse<{ result?: unknown } | null>(row?.output, null);
    return { task_id, state: s.state, ...(s.state === 'done' ? { result: out?.result } : {}), ...(s.error ? { error: s.error } : {}), ...(s.state === 'appr' && row?.approval ? { approval: j.parse(row.approval, null) } : {}) };
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
      if (p.name === 'tibi_task_status') return status(String((p.args as { task_id?: string })?.task_id ?? ''));
      if (SKIP.has(p.name)) throw new TibiError('permission_denied', `${p.name} 不对外开放`);
      const def = registry.get(p.name); if (!def) throw new TibiError('not_found', `没有这项能力：${p.name}`);
      if (def.mcp === false) throw new TibiError('permission_denied', `${p.name} 不对外开放`);
      if (def.perm === 'read') return registry.call(p.name, p.args ?? {}, deps.makeCtx({ origin: 'mcp' }));
      if (!s.write.has(p.name)) throw new TibiError('permission_denied', `写工具 ${p.name} 没有在 Tibi 的设置里打开`);
      const { task_id } = await runner.submit('mcp', { kind: 'skill', title: `${p.client ?? '外部工具'}：${p.name}`, trigger: 'mcp', input: { tool: p.name, args: p.args ?? {}, client: p.client } });
      const r = await runner.wait(task_id, 2000);
      if (r.status === 'done') return (r.output as { result?: unknown } | undefined)?.result;
      if (r.status === 'failed' || r.status === 'cancelled') throw new TibiError('permission_denied', r.error ?? '没有执行');
      return { status: 'pending_approval', ...(await status(task_id)), poll: 'tibi_task_status' };
    }, '代理用：tools/call。读直接返回；写走任务，需要确认时先返回 pending_approval'),
  };
}
