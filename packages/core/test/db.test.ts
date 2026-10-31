import { describe, expect, it } from 'vitest';
import { uuidv7, uuidv7Time } from '../src/ids.js';
import { openAppDb } from '@tibi/core-node';

describe('ids', () => {
  it('uuidv7 单调且带时间', () => {
    const t = Date.now();
    const a = uuidv7(t), b = uuidv7(t), c = uuidv7(t + 1);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
    expect(uuidv7Time(a)).toBe(t);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('migrations', () => {
  it('内存库建表并记录版本', async () => {
    const db = await openAppDb(':memory:');
    const v = await db.get<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(2);
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'")).map(r => r.name).sort();
    for (const t of ['documents', 'sections', 'sentences', 'terms', 'cards', 'review_logs', 'conversations', 'messages', 'jobs', 'job_steps', 'usage_records', 'skill_audit', 'memories', 'learning_events']) {
      expect(tables).toContain(t);
    }
    // 再跑一次是幂等的
    const { migrate } = await import('../src/db/migrate.js');
    const r = await migrate(db, []);
    expect(r).toEqual({ from: 2, to: 2 });
    await db.close();
  });

  it('事务串行化：并发写入不交错', async () => {
    const db = await openAppDb(':memory:');
    const t = Date.now();
    await Promise.all([1, 2, 3].map(i => db.transaction(async tx => {
      await tx.run('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)', [`k${i}`, '1', t]);
      await new Promise(r => setTimeout(r, 5));
      await tx.run('UPDATE settings SET value = ? WHERE key = ?', ['2', `k${i}`]);
    })));
    const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings ORDER BY key');
    expect(rows).toEqual([{ key: 'k1', value: '2' }, { key: 'k2', value: '2' }, { key: 'k3', value: '2' }]);
    await db.close();
  });
});
