import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupNow, listBackups, maybeAutoBackup } from '@tibi/core';
import { createCore } from '../src/create.js';

describe('备份', () => {
  it('手动备份可用；自动备份每天一次、只轮换自动的、保留 7 份', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibi-bk-'));
    const core = await createCore({ dbPath: join(dir, 'app.db'), version: 't' });
    const m = await core.call<{ path: string; size: number }>('system.backup', {});
    expect(existsSync(m.path)).toBe(true);
    expect(m.size).toBeGreaterThan(0);
    const day = 24 * 3600_000; const t0 = new Date(2026, 0, 1, 9, 0, 0).getTime();
    for (let i = 0; i < 9; i++) await backupNow(core.db, core.platform, 'auto', t0 + i * day);
    const list = await listBackups(core.platform);
    expect(list.filter(f => f.reason === 'auto')).toHaveLength(7);
    expect(list.filter(f => f.reason === 'manual')).toHaveLength(1);
    // 最近一份自动备份不到一天：不备；超过一天：备
    const last = t0 + 8 * day;
    expect(await maybeAutoBackup(core.db, core.platform, last + 3600_000)).toBe(false);
    expect(await maybeAutoBackup(core.db, core.platform, last + day + 1)).toBe(true);
    await core.call('settings.set', { patch: { 'backup.auto': false } });
    expect(await maybeAutoBackup(core.db, core.platform, last + 3 * day)).toBe(false);
    const r = await core.call<{ auto: boolean; items: unknown[] }>('system.backups', {});
    expect(r.auto).toBe(false);
    expect(r.items.length).toBe(readdirSync(join(dir, 'backups')).length);
  });
});
