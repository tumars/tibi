import { describe, expect, it } from 'vitest';
import { makeKernelCore } from '../kernel/helpers.js';

describe('memory', () => {
  it('remember / search / list / update / delete+undo / pause / clear', async () => {
    const { kernel, core, call, db } = await makeKernelCore();
    const ui = core.ctx({ origin: 'ui' });
    const r1 = await kernel.registry.call<{ memory_id: string }>('remember', { type: 'semantic', content: '经常混淆 affect 和 effect', subject: 'term:affect', confidence: 0.7 }, ui);
    await kernel.registry.call('remember', { type: 'profile', content: '目标是雅思 7 分' }, ui);
    const old = await kernel.registry.call<{ memory_id: string }>('remember', { type: 'semantic', content: '读新闻时生词集中在政治类' }, ui);
    await db.run('UPDATE memories SET updated_at = ? WHERE id = ?', [Date.now() - 400 * 86400_000, old.memory_id]);
    const hits = await kernel.registry.call<{ content: string }[]>('search_memory', { q: 'affect effect 混淆' }, ui);
    expect(hits[0]!.content).toContain('affect');
    const all = await call('memory.list', {});
    expect(all.length).toBe(3); expect(all[0].source.label).toContain('来自');
    expect((await call('memory.list', { type: 'profile' })).length).toBe(1);
    const u = await call('memory.update', { id: r1.memory_id, content: '常混淆 affect / effect' });
    expect(u.content).toBe('常混淆 affect / effect'); expect(u.source.type).toBe('user');
    const undo = await call('memory.delete', { id: r1.memory_id });
    expect((await call('memory.list', {})).length).toBe(2);
    await call('system.undo', { undo_id: undo.undo_id });
    expect((await call('memory.list', {})).length).toBe(3);
    await call('memory.pause', { paused: true });
    await expect(kernel.registry.call('remember', { type: 'semantic', content: 'x' }, ui)).rejects.toThrow(/暂停/);
    await call('memory.pause', { paused: false });
    const undo2 = await call('memory.clear', {});
    expect((await call('memory.list', {})).length).toBe(0);
    await call('system.undo', { undo_id: undo2.undo_id });
    expect((await call('memory.list', {})).length).toBe(3);
  });

  it('list_learning_events', async () => {
    const { kernel, core, db } = await makeKernelCore();
    const t = Date.now();
    await db.run("INSERT INTO learning_events(id, type, payload, created_at) VALUES ('e1', 'document_imported', '{\"title\":\"Doc\"}', ?), ('e2', 'review_session', '{\"count\":18}', ?)", [t - 1000, t]);
    const ev = await kernel.registry.call<{ type: string; summary: string }[]>('list_learning_events', { since: t - 5000 }, core.ctx({ origin: 'skill' }));
    expect(ev.map(e => e.type)).toEqual(['review_session', 'document_imported']);
    expect(ev[1]!.summary).toContain('Doc');
    const only = await kernel.registry.call<{ type: string }[]>('list_learning_events', { types: ['review_session'] }, core.ctx({ origin: 'skill' }));
    expect(only.length).toBe(1);
  });
});
