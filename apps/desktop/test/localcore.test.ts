import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { assembleCore, fakePlatform, type SearchResult } from '@tibi/core';
import { openLocalDbs, type Invoke } from '../src/mobile/local/driver';

/**
 * 手机上 Core 的 SQLite 驱动（T28）：用 better-sqlite3 模拟壳里 local_db.rs 的四个命令，参数和结果都过一遍 JSON（和 Tauri IPC 一样），
 * 跑迁移、导入、全文搜索、同步触发器——事务跨多次调用也要成立。
 */
function fakeShell(): Invoke {
  const dbs = new Map<string, BetterSqlite3.Database>();
  const rt = <T>(v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as T;
  return async <T>(cmd: string, raw: Record<string, unknown>) => {
    const a = rt<{ name: string; sql: string; params?: unknown[] }>(raw);
    if (cmd === 'db_open') { if (a.name === 'dict') return rt<T>({ path: null }); if (!dbs.has(a.name)) dbs.set(a.name, new BetterSqlite3(':memory:')); return rt<T>({ path: ':memory:' }); }
    const db = dbs.get(a.name)!;
    if (cmd === 'db_exec') { db.exec(a.sql); return rt<T>(null); }
    const st = db.prepare(a.sql);
    if (cmd === 'db_run') { if (st.reader) { st.all(...(a.params ?? [])); return rt<T>({ changes: 0 }); } return rt<T>({ changes: st.run(...(a.params ?? [])).changes }); }
    if (cmd === 'db_all') return rt<T>(st.all(...(a.params ?? [])));
    throw new Error(`unknown ${cmd}`);
  };
}

describe('手机上的 Core：InvokeDriver（M7）', () => {
  it('迁移、导入、搜索、事务、同步触发器都能走通', async () => {
    const { db, dict } = await openLocalDbs(fakeShell());
    expect(dict).toBeUndefined();
    expect((await db.get<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(4);
    const { core, kernel } = await assembleCore({ db, platform: fakePlatform(), device: 'mobile', resume: false });
    const { task_id } = await core.call<{ task_id: string }>('documents.import', { source: { type: 'text', text: 'The compiler enforces a small set of rules.\n\nA parser builds a syntax tree.' } });
    const r = await kernel.jobs.wait(task_id);
    expect(r.status).toBe('done');
    const found = await core.call<SearchResult>('search.query', { q: 'parser' });
    expect(found.documents).toHaveLength(1);
    // 事务回滚
    await expect(db.transaction(async tx => { await tx.run("INSERT INTO tags(id, name, created_at, updated_at) VALUES ('t1', 'x', 1, 1)"); throw new Error('回滚'); })).rejects.toThrow('回滚');
    expect(await db.get("SELECT id FROM tags WHERE id = 't1'")).toBeUndefined();
    // 同步：触发器能建、能记改动（布尔、空值过 JSON）
    const { sync } = await import('@tibi/core');
    const eng = new sync.SyncEngine(db, sync.memoryBackend(), { platform: 'ios', app_version: 't' });
    await eng.enable({ device_name: 'iPhone' });
    await db.run("UPDATE terms SET meaning = '编译器', note = NULL WHERE text = 'compiler'");
    expect(await eng.outboxCount()).toBe(1);
  });
});
