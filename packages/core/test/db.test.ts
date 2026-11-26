import { describe, expect, it } from 'vitest';
import { uuidv7, uuidv7Time } from '../src/ids.js';
import { BetterSqliteDriver, openAppDb } from '@tibi/core-node';
import { Database, MIGRATIONS } from '../src/index.js';
import { migrate } from '../src/db/migrate.js';
import { checkUrlShape, isPrivateIp } from '../src/web/url.js';
import { parseExchange } from '../src/dict/sqlite.js';

describe('ids', () => {
  it('uuidv7 单调且带时间', () => {
    const t = Date.now();
    const a = uuidv7(t), b = uuidv7(t), c = uuidv7(t + 1);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
    expect(uuidv7Time(a)).toBe(t);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('uuidv7 时钟倒退与序号溢出仍严格单调', () => {
    const base = Date.now() + 10_000;
    let prev = uuidv7(base);
    for (let i = 1; i <= 5000; i++) {
      const next = uuidv7(base - i);
      expect(prev < next).toBe(true);
      prev = next;
    }
  });
});

describe('SSRF URL 与词典词形解析', () => {
  it('允许 fc/fd/fe 开头的合法公网域名，拦截 IPv4/IPv6 内网与回环地址', () => {
    for (const ok of ['https://fcc.gov/news', 'https://fdroid.org/en/', 'https://fdic.gov/', 'https://fe80.example.com/a']) {
      expect(checkUrlShape(ok).ok, ok).toBe(true);
    }
    for (const bad of [
      'http://127.0.0.1/',
      'http://100.64.0.1/',
      'http://169.254.169.254/latest',
      'http://[::]/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:7f00:1]/',
      'http://[fe90::1]/',
      'http://[fc00::1]/',
      'http://198.18.0.1/',
      'http://198.18.1.60/',
      'http://localhost./',
      'http://a.localhost/',
      'ftp://example.com/a',
    ]) {
      expect(checkUrlShape(bad).ok, bad).toBe(false);
    }
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:93.184.216.34')).toBe(false);
    expect(isPrivateIp('64:ff9b::127.0.0.1')).toBe(true);
    expect(isPrivateIp('64:ff9b::5db8:d822')).toBe(false);
    expect(isPrivateIp('64:ff9b::93.184.216.34')).toBe(false);
    expect(isPrivateIp('198.18.1.60')).toBe(true);
    expect(isPrivateIp('198.18.1.60', { allowFakeIp: true })).toBe(false);
    expect(isPrivateIp('fc00::42')).toBe(true);
    expect(isPrivateIp('fc00::42', { allowFakeIpV6: true })).toBe(false);
    expect(isPrivateIp('fd00:1:1003::1', { allowFakeIpV6: true })).toBe(true);
    expect(isPrivateIp('93.184.216.34')).toBe(false);
  });

  it('parseExchange 过滤 0:原形 和 1:变形标志，只保留真实词形', () => {
    expect(parseExchange('0:go/1:p/p:went/d:gone/i:going/3:goes')).toEqual(['went', 'gone', 'going', 'goes']);
    expect(parseExchange('0:run/1:i3')).toEqual([]);
  });
});

describe('migrations', () => {
  it('内存库建表并记录版本', async () => {
    const db = await openAppDb(':memory:');
    const v = await db.get<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(11);
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'")).map(r => r.name).sort();
    for (const t of ['documents', 'sections', 'sentences', 'terms', 'cards', 'review_logs', 'conversations', 'messages', 'skill_audit', 'memories', 'learning_events', 'feeds', 'feed_items']) {
      expect(tables).toContain(t);
    }
    for (const t of ['jobs', 'job_steps', 'usage_records']) expect(tables).not.toContain(t);
    // 再跑一次是幂等的
    const r = await migrate(db, []);
    expect(r).toEqual({ from: 11, to: 11 });
    await db.close();
  });

  it('事务串行化：并发写入与外部非事务调用均不交错', async () => {
    const db = await openAppDb(':memory:');
    const t = Date.now();
    await Promise.all([1, 2, 3].map(i => db.transaction(async tx => {
      await tx.run('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)', [`k${i}`, '1', t]);
      await new Promise(r => setTimeout(r, 5));
      await tx.run('UPDATE settings SET value = ? WHERE key = ?', ['2', `k${i}`]);
    })));
    const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings ORDER BY key');
    expect(rows).toEqual([{ key: 'k1', value: '2' }, { key: 'k2', value: '2' }, { key: 'k3', value: '2' }]);

    // 事务进行期间发出的外部非事务读写必须排队等待事务结束，既不报错也不读到未提交中间态
    const events: string[] = [];
    const txDone = db.transaction(async tx => {
      events.push('tx:start');
      await tx.run("INSERT INTO settings(key, value, updated_at) VALUES ('outer_check', 'in_tx', ?)", [t]);
      await new Promise(r => setTimeout(r, 15));
      await tx.run("UPDATE settings SET value = 'committed' WHERE key = 'outer_check'");
      events.push('tx:commit');
    });
    const outerRead = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'outer_check'").then(r => {
      events.push('outer:read');
      return r?.value;
    });
    const [, seen] = await Promise.all([txDone, outerRead]);
    expect(seen).toBe('committed');
    expect(events).toEqual(['tx:start', 'tx:commit', 'outer:read']);
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
  it('0007：订阅从 settings.feeds 搬进 feeds 表，关掉的内置源仍关着', async () => {
    const db = new Database(await BetterSqliteDriver.open(':memory:'));
    await migrate(db, MIGRATIONS.filter(m => m.version <= 6));
    const cfg = { custom: [{ url: 'https://ex.com/feed.xml', title: 'Ex' }, { url: 'https://noname.org/rss', title: '' }, { url: 'ftp://bad' }], disabled: ['https://hnrss.org/best', 'https://noname.org/rss'] };
    await db.run("INSERT INTO settings(key, value, updated_at) VALUES ('feeds', ?, 0)", [JSON.stringify(cfg)]);
    await migrate(db, MIGRATIONS.filter(m => m.version <= 7));
    const rows = await db.all<{ id: string; url: string; title: string; builtin: number; enabled: number }>('SELECT id, url, title, builtin, enabled FROM feeds ORDER BY builtin DESC, id, url');
    expect(rows.filter(r => r.builtin).map(r => [r.id, r.enabled])).toEqual([['builtin-ars', 1], ['builtin-go', 1], ['builtin-hn', 0], ['builtin-quanta', 1], ['builtin-rust', 1]]);
    expect(rows.filter(r => !r.builtin).sort((a, b) => a.url.localeCompare(b.url)).map(r => [r.url, r.title, r.enabled])).toEqual([['https://ex.com/feed.xml', 'Ex', 1], ['https://noname.org/rss', 'https://noname.org/rss', 0]]);
    expect(await db.get("SELECT 1 FROM settings WHERE key = 'feeds'")).toBeUndefined();
    await db.close();
  });
  it('0009：内置源只留 Hacker News，其余软删', async () => {
    const db = new Database(await BetterSqliteDriver.open(':memory:'));
    await migrate(db, MIGRATIONS.filter(m => m.version <= 9));
    const rows = await db.all<{ id: string; deleted: number }>('SELECT id, deleted_at IS NOT NULL AS deleted FROM feeds WHERE builtin = 1 ORDER BY id');
    expect(rows.map(r => [r.id, r.deleted])).toEqual([['builtin-ars', 1], ['builtin-conversation', 0], ['builtin-go', 1], ['builtin-hn', 0], ['builtin-nil', 0], ['builtin-quanta', 1], ['builtin-rust', 1]]);
    await db.close();
  });
  it('0010：电台表结构扩展与内置英文播客种子', async () => {
    const db = new Database(await BetterSqliteDriver.open(':memory:'));
    await migrate(db, MIGRATIONS.filter(m => m.version <= 10));
    const pods = await db.all<{ id: string; kind: string }>("SELECT id, kind FROM feeds WHERE kind = 'podcast' AND deleted_at IS NULL ORDER BY id");
    expect(pods.map(p => p.id)).toEqual(['builtin-pod-6min', 'builtin-pod-corecursive', 'builtin-pod-darknet', 'builtin-pod-tews', 'builtin-pod-voa']);
    const cols = await db.all<{ name: string }>('PRAGMA table_info(sentences)');
    expect(cols.map(c => c.name)).toEqual(expect.arrayContaining(['start_ms', 'end_ms', 'speaker']));
    await db.close();
  });
  it('0011：精简内置订阅与电台，软删非通用或停更源并清理未保存条目', async () => {
    const db = new Database(await BetterSqliteDriver.open(':memory:'));
    await migrate(db, MIGRATIONS.filter(m => m.version <= 10));
    const t = Date.now();
    await db.run("INSERT INTO feed_items(id, feed_id, guid, url, title, state, created_at, updated_at) VALUES ('i-del', 'builtin-hn', 'g1', 'https://hn.ex/1', 'HN Unread', 'new', ?, ?)", [t, t]);
    await db.run("INSERT INTO feed_items(id, feed_id, guid, url, title, state, document_id, created_at, updated_at) VALUES ('i-keep', 'builtin-pod-voa', 'g2', 'https://voa.ex/1', 'VOA Saved', 'saved', 'doc1', ?, ?)", [t, t]);
    await db.run("UPDATE feeds SET title = 'My VOA', updated_at = ? WHERE id = 'builtin-pod-voa'", [t]);
    await db.run("INSERT INTO feed_items(id, feed_id, guid, url, title, state, created_at, updated_at) VALUES ('i-voa-keep', 'builtin-pod-voa', 'g3', 'https://voa.ex/2', 'VOA Unread', 'new', ?, ?)", [t, t]);
    await migrate(db, MIGRATIONS);
    const active = await db.all<{ id: string; kind: string }>('SELECT id, kind FROM feeds WHERE builtin = 1 AND deleted_at IS NULL ORDER BY kind, id');
    expect(active).toEqual([
      { id: 'builtin-conversation', kind: 'article' },
      { id: 'builtin-nil', kind: 'article' },
      { id: 'builtin-pod-6min', kind: 'podcast' },
      { id: 'builtin-pod-tews', kind: 'podcast' },
      { id: 'builtin-pod-voa', kind: 'podcast' },
    ]);
    const pruned = await db.all<{ id: string }>("SELECT id FROM feeds WHERE id IN ('builtin-hn', 'builtin-pod-voa', 'builtin-pod-darknet', 'builtin-pod-corecursive') AND deleted_at IS NOT NULL ORDER BY id");
    expect(pruned.map(r => r.id)).toEqual(['builtin-hn', 'builtin-pod-corecursive', 'builtin-pod-darknet']);
    const items = await db.all<{ id: string }>('SELECT id FROM feed_items ORDER BY id');
    expect(items.map(r => r.id)).toEqual(['i-keep', 'i-voa-keep']);
    await db.close();
  });
  it('0009：用户已经订了同一个地址的，不再种内置源', async () => {
    const db = new Database(await BetterSqliteDriver.open(':memory:'));
    await migrate(db, MIGRATIONS.filter(m => m.version <= 8));
    await db.run("INSERT INTO feeds(id, url, title, created_at, updated_at) VALUES ('mine', 'https://www.newsinlevels.com/feed/', 'NIL', 0, 0)");
    await migrate(db, MIGRATIONS);
    const rows = await db.all<{ id: string }>("SELECT id FROM feeds WHERE url = 'https://www.newsinlevels.com/feed/'");
    expect(rows.map(r => r.id)).toEqual(['mine']);
    await db.close();
  });
});
