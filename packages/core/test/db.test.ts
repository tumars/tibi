import { describe, expect, it } from 'vitest';
import { uuidv7, uuidv7Time } from '../src/ids.js';
import { BetterSqliteDriver, openAppDb } from '@tibi/core-node';
import { Database, MIGRATIONS } from '../src/index.js';
import { migrate } from '../src/db/migrate.js';

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
    expect(v?.user_version).toBe(5);
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'")).map(r => r.name).sort();
    for (const t of ['documents', 'sections', 'sentences', 'terms', 'cards', 'review_logs', 'conversations', 'messages', 'skill_audit', 'memories', 'learning_events']) {
      expect(tables).toContain(t);
    }
    for (const t of ['jobs', 'job_steps', 'usage_records']) expect(tables).not.toContain(t);
    // 再跑一次是幂等的
    const r = await migrate(db, []);
    expect(r).toEqual({ from: 5, to: 5 });
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

  it('0005：任务的结果搬到这一轮第一句用户消息上，turn_id 改成那句的 id；删任务、用量和预算', async () => {
    const db = new Database(await BetterSqliteDriver.open(':memory:'));
    await migrate(db, MIGRATIONS.filter(m => m.version <= 4));
    const t = 1000;
    await db.run("INSERT INTO conversations(id, kind, device, title, created_at, updated_at) VALUES ('c', 'chat', 'desktop', '', ?, ?)", [t, t]);
    await db.run("INSERT INTO jobs(id, kind, skill_id, conversation_id, status, error, created_at, updated_at, tainted) VALUES ('j1', 'skill', 'scout', 'c', 'done', NULL, ?, ?, 1), ('j2', 'skill', 'tibi', 'c', 'running', NULL, ?, ?, 0)", [t, t, t, t]);
    const msg = (id: string, job: string, role: string, at: number) => db.run('INSERT INTO messages(id, conversation_id, job_id, role, body, ui, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, 'c', job, role, '{}', '{}', at, at]);
    await msg('u1', 'j1', 'user', 1); await msg('a1', 'j1', 'assistant', 2); await msg('u1b', 'j1', 'user', 3); await msg('u2', 'j2', 'user', 4);
    await db.run("INSERT INTO settings(key, value, updated_at) VALUES ('budget.month', '20', 0), ('provider.price.p', '{}', 0), ('tts.rate', '1', 0)");
    await migrate(db, MIGRATIONS);
    const rows = await db.all<{ id: string; turn_id: string; ui: string }>('SELECT id, turn_id, ui FROM messages ORDER BY created_at');
    expect(rows.map(r => r.turn_id)).toEqual(['u1', 'u1', 'u1', 'u2']);
    expect(JSON.parse(rows[0]!.ui).turn).toMatchObject({ skill: 'scout', state: 'done', tainted: true });
    expect(JSON.parse(rows[2]!.ui).turn).toBeUndefined();   // 回答中补充的那句不带
    expect(JSON.parse(rows[3]!.ui).turn).toMatchObject({ skill: 'tibi', state: 'error', error: '上次没有回答完就中断了' });
    expect((await db.all<{ key: string }>('SELECT key FROM settings')).map(r => r.key)).toEqual(['tts.rate']);
    await db.close();
  });
});
