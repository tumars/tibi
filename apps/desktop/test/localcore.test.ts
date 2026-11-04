import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { assembleCore, documents, fakePlatform, type SearchResult } from '@tibi/core';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openLocalDbs, type Invoke } from '../src/mobile/local/driver';
import { invokeFolderBackend } from '../src/mobile/local/syncfs';

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
    expect((await db.get<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(8);
    const { core } = await assembleCore({ db, platform: fakePlatform(), device: 'mobile', resume: false });
    const { import_id } = await core.call<{ import_id: string }>('documents.import', { source: { type: 'text', text: 'The compiler enforces a small set of rules.\n\nA parser builds a syntax tree.' } });
    expect((await documents.importDone(import_id))?.ok).toBe(true);
    const found = await core.call<SearchResult>('search.query', { q: 'parser' });
    expect(found.documents).toHaveLength(1);
    await core.call('terms.add', { entries: [{ text: 'compiler' }] });   // 这里没装词典，导入不会标生词
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

  it('同步文件夹后端（iCloud 容器 / 预览里的文件夹）：两台手机经 sync_fs_* 同步，iCloud 占位文件先当作没到', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tibi-syncfs-'));
    // 按 src-tauri/src/sync_fs.rs 的语义模拟
    const fsShell = async (cmd: string, a: Record<string, any>): Promise<any> => {
      const p = join(a.root, a.path ?? a.dir ?? '');
      if (cmd === 'sync_fs_write') { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p + '.tmp', Buffer.from(a.data, 'base64')); renameSync(p + '.tmp', p); return null; }
      if (cmd === 'sync_fs_list') { try { return readdirSync(p).filter(n => statSync(join(p, n)).isFile()).map(n => n.match(/^\.(.+)\.icloud$/)?.[1] ?? n).filter(n => !n.startsWith('.')).sort(); } catch { return []; } }
      if (cmd === 'sync_fs_remove') { rmSync(p, { force: true }); return null; }
      throw new Error(cmd);
    };
    const bytes = async (_cmd: string, a: Record<string, unknown>) => { try { return new Uint8Array(readFileSync(join(a.root as string, a.path as string))); } catch { throw new Error('ENOENT'); } };
    const phone = async () => {
      const { db } = await openLocalDbs(fakeShell());
      const { core, kernel } = await assembleCore({ db, platform: fakePlatform(), device: 'mobile', resume: false });
      const { sync } = await import('@tibi/core');
      const eng = new sync.SyncEngine(db, invokeFolderBackend(fsShell as Invoke, root, 'icloud', bytes), { platform: 'ios', app_version: 't' });
      return { db, core, kernel, eng };
    };
    const A = await phone(), B = await phone();
    const { import_id } = await A.core.call<{ import_id: string }>('documents.import', { source: { type: 'text', text: 'The compiler enforces a small set of rules.' } });
    await documents.importDone(import_id);
    await A.eng.enable({ device_name: 'iPhone' });
    // B 先看到一个还没下载的占位：读不到就停在那，不报错
    const dev = readdirSync(join(root, 'changes'))[0]!;
    renameSync(join(root, 'changes', dev, '0000000001.jsonl.gz'), join(root, 'changes', dev, '.0000000001.jsonl.gz.icloud'));
    await B.eng.enable({ device_name: 'iPad' });
    expect(Number((await B.db.get<{ n: number }>('SELECT count(*) AS n FROM documents'))!.n)).toBe(0);
    // 下载完了（占位变成真文件），下次同步拿到
    renameSync(join(root, 'changes', dev, '.0000000001.jsonl.gz.icloud'), join(root, 'changes', dev, '0000000001.jsonl.gz'));
    await B.eng.sync();
    expect(Number((await B.db.get<{ n: number }>('SELECT count(*) AS n FROM documents'))!.n)).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });
});

