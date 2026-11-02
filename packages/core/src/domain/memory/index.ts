import { Type } from '@sinclair/typebox';
import { j, now, type Database } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import { capability, method, type CapabilityMap, type Ctx, type MethodMap } from '../../rpc/define.js';
import { recordUndo, registerUndo } from '../shared/undo.js';
import { TibiError, type LearningEventType, type Memory } from '../../types.js';

/**
 * Tibi 记忆（02 §5、01 §7 memories）：身份 / 观察 / 事件摘要 / 指令。
 * 检索：FTS5 关键词 + 时间衰减（A4）。用户可查看、编辑、删除、暂停、清空（02 §5.3）。
 */
const TYPES = ['profile', 'semantic', 'episodic', 'procedural'] as const;
const typeSchema = Type.Union(TYPES.map(t => Type.Literal(t)));

interface Row extends Record<string, string | number | null> { id: string; type: string; content: string; subject: string | null; confidence: number; source_type: string; source_ref: string | null; status: string; superseded_by: string | null; created_at: number; updated_at: number }

function toMemory(r: Row): Memory {
  return { id: r.id, type: r.type as Memory['type'], content: r.content, subject: r.subject ?? undefined, confidence: r.confidence, source: { type: r.source_type as Memory['source']['type'], ref: r.source_ref ?? undefined, label: sourceLabel(r.source_type, r.source_ref) }, status: r.status as Memory['status'], created_at: r.created_at, updated_at: r.updated_at };
}
function sourceLabel(type: string, ref: string | null): string {
  if (type === 'user') return '来自：你的修改';
  if (type === 'consolidation') return '来自：整理记忆';
  if (!ref) return '来自：和 Tibi 的对话';
  const [kind] = ref.split(':');
  return { conversation: '来自：和 Tibi 的对话', document: '来自：阅读记录', event: '来自：学习日志', task: '来自：Tibi 的任务' }[kind ?? ''] ?? '来自：Tibi';
}

export class Memories {
  constructor(private readonly db: Database) {}
  async get(id: string) { const r = await this.db.get<Row>('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL', [id]); return r ? toMemory(r) : undefined; }
  async list(opts: { type?: string; q?: string } = {}): Promise<Memory[]> {
    if (opts.q) return (await this.search(opts.q, { type: opts.type, limit: 100 }));
    const rows = await this.db.all<Row>(`SELECT * FROM memories WHERE deleted_at IS NULL ${opts.type ? 'AND type = ?' : ''} ORDER BY updated_at DESC`, opts.type ? [opts.type] : []);
    return rows.map(toMemory);
  }
  async paused(): Promise<boolean> { const r = await this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'memory.paused'"); return !!r && j.parse<boolean>(r.value, false); }
  async add(m: { type: Memory['type']; content: string; subject?: string; confidence?: number; source_type?: string; source_ref?: string; supersedes?: string }): Promise<Memory> {
    if (await this.paused()) throw new TibiError('permission_denied', '记忆已暂停，不再记新的');
    const id = uuidv7(); const t = now();
    await this.db.transaction(async tx => {
      await tx.run('INSERT INTO memories(id, type, content, subject, confidence, source_type, source_ref, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, m.type, m.content, m.subject ?? null, m.confidence ?? 0.8, m.source_type ?? 'agent', m.source_ref ?? null, 'active', t, t]);
      if (m.supersedes) await tx.run("UPDATE memories SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ?", [id, t, m.supersedes]);
    });
    return (await this.get(id))!;
  }
  async update(id: string, content: string): Promise<Memory> {
    const r = await this.db.run("UPDATE memories SET content = ?, source_type = 'user', updated_at = ? WHERE id = ? AND deleted_at IS NULL", [content, now(), id]);
    if (!r.changes) throw new TibiError('not_found', '找不到这条记忆');
    return (await this.get(id))!;
  }
  /** 硬删（隐私优先，01 §9），连同审计里的内容副本 */
  async remove(id: string): Promise<Memory | undefined> {
    const m = await this.get(id); if (!m) return undefined;
    await this.db.transaction(async tx => {
      await tx.run('DELETE FROM memories WHERE id = ?', [id]);
      await tx.run("UPDATE skill_audit SET args = '{}', undo_payload = NULL WHERE args LIKE ? OR undo_payload LIKE ?", [`%${id}%`, `%${id}%`]);
    });
    return m;
  }
  /** FTS5 + 时间衰减：半衰期 90 天 */
  async search(q: string, opts: { type?: string; limit?: number } = {}): Promise<Memory[]> {
    const words = q.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 10);
    if (!words.length) return this.list({ type: opts.type });
    const match = words.map(w => `"${w.replace(/"/g, '')}"`).join(' OR ');
    const rows = await this.db.all<Row & { rank: number }>(`SELECT m.*, bm25(memories_fts) AS rank FROM memories_fts f JOIN memories m ON m.rowid = f.rowid WHERE memories_fts MATCH ? AND m.deleted_at IS NULL AND m.status = 'active' ${opts.type ? 'AND m.type = ?' : ''} LIMIT 200`, opts.type ? [match, opts.type] : [match]);
    const t = now(); const half = 90 * 86400_000;
    return rows.map(r => ({ r, score: (-r.rank) * Math.pow(0.5, (t - r.updated_at) / half) * (0.5 + r.confidence) })).sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 20).map(x => toMemory(x.r));
  }
}

registerUndo<{ memory: Memory }>('memory.delete', async (p, ctx) => {
  const m = p.memory; const t = now();
  await ctx.db.run('INSERT OR IGNORE INTO memories(id, type, content, subject, confidence, source_type, source_ref, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [m.id, m.type, m.content, m.subject ?? null, m.confidence, m.source.type, m.source.ref ?? null, m.status, m.created_at, t]);
});
registerUndo<{ memories: Memory[] }>('memory.clear', async (p, ctx) => {
  for (const m of p.memories) await ctx.db.run('INSERT OR IGNORE INTO memories(id, type, content, subject, confidence, source_type, source_ref, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [m.id, m.type, m.content, m.subject ?? null, m.confidence, m.source.type, m.source.ref ?? null, m.status, m.created_at, now()]);
});
registerUndo<{ id: string; superseded?: string }>('remember', async (p, ctx) => {
  await ctx.db.run('DELETE FROM memories WHERE id = ?', [p.id]);
  if (p.superseded) await ctx.db.run("UPDATE memories SET status = 'active', superseded_by = NULL, updated_at = ? WHERE id = ?", [now(), p.superseded]);
});
registerUndo<{ memory: Memory }>('forget', async (p, ctx) => {
  const m = p.memory;
  await ctx.db.run('INSERT OR IGNORE INTO memories(id, type, content, subject, confidence, source_type, source_ref, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [m.id, m.type, m.content, m.subject ?? null, m.confidence, m.source.type, m.source.ref ?? null, m.status, m.created_at, now()]);
});

registerUndo<{ id: string; content: string }>('update_memory', async (p, ctx) => {
  await new Memories(ctx.db).update(p.id, p.content);
  ctx.events.emit('data.changed', { table: 'memories', ids: [p.id] });
});

const changed = (ctx: Ctx, ids: string[]) => ctx.events.emit('data.changed', { table: 'memories', ids });

export const memoryMethods: MethodMap = {
  'memory.list': method(Type.Object({ type: Type.Optional(typeSchema), q: Type.Optional(Type.String()) }), async (p, ctx) => new Memories(ctx.db).list(p), '每条带来源'),
  'memory.update': method(Type.Object({ id: Type.String(), content: Type.String({ minLength: 1 }) }), async (p, ctx) => { const m = await new Memories(ctx.db).update(p.id, p.content); changed(ctx, [p.id]); return m; }),
  'memory.delete': method(Type.Object({ id: Type.String() }), async (p, ctx) => {
    const m = await new Memories(ctx.db).remove(p.id);
    if (!m) throw new TibiError('not_found', '找不到这条记忆');
    changed(ctx, [p.id]);
    return recordUndo(ctx.db, ctx, { tool: 'memory.delete', args: { id: p.id }, undo_payload: { memory: m } });
  }),
  'memory.pause': method(Type.Object({ paused: Type.Boolean() }), async (p, ctx) => {
    await ctx.db.run('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', ['memory.paused', j.str(p.paused), now()]);
    return { ok: true as const };
  }),
  'memory.clear': method(Type.Object({}), async (_p, ctx) => {
    const repo = new Memories(ctx.db);
    const all = await repo.list();
    for (const m of all) await repo.remove(m.id);
    changed(ctx, all.map(m => m.id));
    return recordUndo(ctx.db, ctx, { tool: 'memory.clear', args: {}, undo_payload: { memories: all } });
  }),
};

const EVENT_TYPES: LearningEventType[] = ['document_imported', 'section_finished', 'term_marked', 'review_session', 'vocab_test', 'quiz_done'];

export const memoryCapabilities: CapabilityMap = {
  search_memory: capability({
    name: 'search_memory', description: '搜索 Tibi 对用户的记忆', perm: 'read',
    params: Type.Object({ q: Type.Optional(Type.String()), type: Type.Optional(typeSchema), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })) }),
    async run(p, ctx) { const repo = new Memories(ctx.db); return p.q ? repo.search(p.q, { type: p.type, limit: p.limit }) : (await repo.list({ type: p.type })).slice(0, p.limit ?? 20); },
  }),
  list_learning_events: capability({
    name: 'list_learning_events', description: '读一段时间的学习事件', perm: 'read',
    params: Type.Object({ since: Type.Optional(Type.Integer()), types: Type.Optional(Type.Array(Type.Union(EVENT_TYPES.map(t => Type.Literal(t))))), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }),
    async run(p, ctx) {
      const types = p.types?.length ? p.types : EVENT_TYPES;
      const rows = await ctx.db.all<{ id: string; type: string; payload: string; created_at: number }>(`SELECT id, type, payload, created_at FROM learning_events WHERE created_at >= ? AND type IN (${types.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT ?`, [p.since ?? 0, ...types, p.limit ?? 100]);
      return rows.map(r => { const pl = j.parse<Record<string, unknown>>(r.payload, {}); return { type: r.type as LearningEventType, at: r.created_at, ref: { table: 'learning_events', id: r.id }, summary: summarizeEvent(r.type, pl) }; });
    },
  }),
  update_memory: capability({
    name: 'update_memory', description: '管理记忆：改一条记忆的内容，可撤销（先用 search_memory 找到 id）', perm: 'confirm', undoable: true, mcp: false,
    params: Type.Object({ id: Type.String(), content: Type.String({ minLength: 1, maxLength: 2000 }) }),
    async describe(p, ctx) { const m = await new Memories(ctx.db).get(p.id); return `「${m?.content ?? p.id}」→「${p.content}」`; },
    async run(p, ctx) {
      const repo = new Memories(ctx.db);
      const prev = await repo.get(p.id); if (!prev) throw new TibiError('not_found', '找不到这条记忆');
      const memory = await repo.update(p.id, p.content);
      changed(ctx, [p.id]);
      return { memory, undo: await recordUndo(ctx.db, ctx, { tool: 'update_memory', args: { id: p.id }, undo_payload: { id: p.id, content: prev.content } }) };
    },
  }),
  remember: capability({
    name: 'remember', description: '记住关于用户的一件事', perm: 'confirm', undoable: true,
    params: Type.Object({ type: typeSchema, content: Type.String({ minLength: 1 }), subject: Type.Optional(Type.String()), confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })), source_ref: Type.Optional(Type.String()), supersedes: Type.Optional(Type.String()) }),
    async run(p, ctx) {
      const m = await new Memories(ctx.db).add({ ...p, source_type: ctx.caller.skill_id === 'archivist' ? 'consolidation' : ctx.caller.origin === 'ui' ? 'user' : 'agent', source_ref: p.source_ref ?? (ctx.caller.job_id ? `task:${ctx.caller.job_id}` : undefined) });
      changed(ctx, [m.id]);
      const undo = await recordUndo(ctx.db, ctx, { tool: 'remember', args: p, undo_payload: { id: m.id, superseded: p.supersedes } });
      return { memory_id: m.id, superseded: p.supersedes, undo };
    },
  }),
  forget: capability({
    name: 'forget', description: '管理记忆：忘掉一条记忆', perm: 'confirm', undoable: true, params: Type.Object({ id: Type.String() }),
    async run(p, ctx) {
      const m = await new Memories(ctx.db).remove(p.id);
      if (!m) throw new TibiError('not_found', '找不到这条记忆');
      changed(ctx, [p.id]);
      return { undo: await recordUndo(ctx.db, ctx, { tool: 'forget', args: p, undo_payload: { memory: m } }) };
    },
  }),
};

function summarizeEvent(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case 'document_imported': return `导入了文章 ${p['title'] ?? p['document_id'] ?? ''}`;
    case 'section_finished': return `读完了 ${p['title'] ?? p['section_id'] ?? ''}`;
    case 'term_marked': return `标记了 ${p['term'] ?? ''} 为 ${p['status'] ?? ''}`;
    case 'review_session': return `复习了 ${p['count'] ?? ''} 张，首次正确率 ${p['accuracy'] ?? ''}`;
    case 'vocab_test': return `词汇量测试：${p['estimate'] ?? ''}`;
    case 'quiz_done': return `做了一组练习`;
    default: return type;
  }
}
