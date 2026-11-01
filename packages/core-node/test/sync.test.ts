import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { sync } from '@tibi/core';
import { createCore } from '../src/create.js';

describe('同步：文件夹后端 + sync.* 方法（M7）', () => {
  it('两台设备经同一个文件夹同步', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tibi-sync-'));
    const folder = join(root, 'shared');
    const A = await createCore({ dbPath: join(root, 'a.db'), version: 't' });
    const B = await createCore({ dbPath: join(root, 'b.db'), version: 't' });
    const { task_id } = await A.call<{ task_id: string }>('documents.import', { source: { type: 'text', text: 'The compiler enforces a small set of rules.' } });
    await new Promise(r => setTimeout(r, 1500));
    void task_id;
    await A.call('terms.add', { entries: [{ text: 'compiler' }] });     // 这里没装词典，导入不会标生词
    expect((await A.call<sync.SyncStatus>('sync.status', {})).state).toBe('off');
    const probe0 = await A.call<{ ok: boolean; library?: unknown }>('sync.probe', { backend: { kind: 'folder', path: folder } });
    expect(probe0).toEqual({ ok: true, library: undefined });
    const sa = await A.call<sync.SyncStatus>('sync.enable', { backend: { kind: 'folder', path: folder }, device_name: 'Mac' });
    expect(sa.enabled).toBe(true); expect(sa.pending).toBe(0);
    expect(readdirSync(join(folder, 'Tibi Sync'))).toEqual(expect.arrayContaining(['library.json', 'devices', 'changes']));
    const probe = await B.call<{ ok: boolean; library?: { devices: number } }>('sync.probe', { backend: { kind: 'folder', path: folder } });
    expect(probe.library?.devices).toBe(1);
    const sb = await B.call<sync.SyncStatus>('sync.enable', { backend: { kind: 'folder', path: folder }, device_name: 'iPhone' });
    expect(sb.peers.map(p => p.name)).toEqual(['Mac']);
    expect(await B.db.get("SELECT id FROM documents WHERE title LIKE 'The compiler%' OR word_count > 0")).toBeTruthy();
    // B 改，A 拉到
    await B.db.run("UPDATE terms SET meaning = '编译器（B）' WHERE text = 'compiler'");
    await B.call('sync.now', {}); await A.call('sync.now', {});
    expect((await A.db.get<{ meaning: string }>("SELECT meaning FROM terms WHERE text = 'compiler'"))?.meaning).toBe('编译器（B）');
    // 停止同步后不再记改动
    await A.call('sync.disable', {});
    await A.db.run("UPDATE terms SET meaning = 'x' WHERE text = 'compiler'");
    expect((await A.call<sync.SyncStatus>('sync.status', {})).pending).toBe(0);
  }, 30_000);
});
