import { describe, expect, it } from 'vitest';
import { openAppDb } from '@tibi/core-node';
import { imported } from '../helpers.js';
import { assembleCore, fakePlatform, sync, uuidv7, type Database, type Dict } from '../../src/index.js';

/** 08 §11：两到三个模拟设备 + 一个内存文件夹后端 */
const dict: Dict = { async lookup(w) { return { word: w, translation: `${w}的释义`, exam: [], forms: [] }; }, async lemmas(f) { return f === 'rules' ? ['rule'] : []; }, async frequencyRank(l) { return ['the', 'a', 'of', 'from', 'set', 'small', 'build'].includes(l) ? 100 : 9000; } };
const TEXT = 'The compiler enforces a small set of rules.\n\nA parser builds a syntax tree from tokens.';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function device(name: string, files: Map<string, Uint8Array>, backend = sync.memoryBackend(files)) {
  const db = await openAppDb(':memory:');
  const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  const { core, kernel } = await assembleCore({ db, dict, platform: fakePlatform({ isOnline: () => false }), resume: false });
  const eng = new sync.SyncEngine(db, backend, { platform: 'test', app_version: 't' });
  // 导入不建词条：读的时候用户把这几个词标成生词（直接写行，不建卡，免得和下面手建的卡冲突）
  const MARKED = ['compiler', 'enforce', 'rule', 'parser', 'syntax', 'tree', 'token'];
  const importText = async (text = TEXT) => {
    const id = (await imported(await core.call<{ import_id: string }>('documents.import', { source: { type: 'text', text } })) as { document_id: string }).document_id;
    const ts = Date.now();
    for (const w of MARKED) await db.run("INSERT OR IGNORE INTO terms(id, kind, text, text_display, status, status_source, created_at, updated_at) VALUES (?, 'word', ?, ?, 0, 'user', ?, ?)", [uuidv7(), w, w, ts, ts]);
    return id;
  };
  return { name, db, core, eng, importText };
}
const term = (db: Database, text: string) => db.get<{ id: string; status: number; status_source: string; meaning: string | null; note: string | null }>('SELECT id, status, status_source, meaning, note FROM terms WHERE text = ?', [text]);

describe('同步场景（08 §11）', () => {
  it('新设备加入：拿到文章、章节、句子、词和熟练度', async () => {
    const files = new Map<string, Uint8Array>();
    const A = await device('A', files), B = await device('B', files);
    const doc = await A.importText();
    await A.db.run("UPDATE terms SET status = 3, status_source = 'user' WHERE text = 'compiler'");
    await A.eng.enable({ device_name: 'Mac' });
    expect((await B.eng.probe()).library?.devices).toBe(1);
    const r = await B.eng.enable({ device_name: 'iPhone' });
    expect(r.pulled).toBeGreaterThan(5);
    expect(await B.db.get('SELECT id FROM documents WHERE id = ?', [doc])).toBeTruthy();
    expect(Number((await B.db.get<{ n: number }>('SELECT count(*) AS n FROM sentences'))!.n)).toBe(Number((await A.db.get<{ n: number }>('SELECT count(*) AS n FROM sentences'))!.n));
    expect((await term(B.db, 'compiler'))?.status).toBe(3);
    // 全文索引跟着建好了
    expect(await B.db.get("SELECT rowid FROM sections_fts WHERE sections_fts MATCH 'parser'")).toBeTruthy();
  });

  it('订阅：两台设备各订了同一个源，合并成一条；抓取状态不同步', async () => {
    const files = new Map<string, Uint8Array>();
    const A = await device('A', files), B = await device('B', files);
    await A.eng.enable({ device_name: 'A' }); await B.eng.enable({ device_name: 'B' });
    const t = Date.now();
    await A.db.run("INSERT INTO feeds(id, url, title, etag, created_at, updated_at) VALUES ('fa', 'https://ex.com/feed.xml', 'Ex', 'etag-a', ?, ?)", [t, t]);
    await B.db.run("INSERT INTO feeds(id, url, title, folder, created_at, updated_at) VALUES ('fb', 'https://ex.com/feed.xml', 'Ex', '科技', ?, ?)", [t, t]);
    await A.eng.sync(); await B.eng.sync(); await A.eng.sync();
    for (const d of [A, B]) {
      const rows = await d.db.all<{ id: string; folder: string | null }>("SELECT id, folder FROM feeds WHERE url = 'https://ex.com/feed.xml' AND deleted_at IS NULL");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.folder).toBe('科技');
    }
    expect((await B.db.get<{ etag: string | null }>("SELECT etag FROM feeds WHERE url = 'https://ex.com/feed.xml'"))!.etag).toBeNull();
    // 内置源两边 ID 一样，不会多出来
    expect(Number((await B.db.get<{ n: number }>('SELECT count(*) AS n FROM feeds WHERE builtin = 1'))!.n)).toBe(5);
  });

  it('离线各改同一个词：不同字段都留下，同一字段后改的赢', async () => {
    const files = new Map<string, Uint8Array>();
    const A = await device('A', files), B = await device('B', files);
    await A.importText(); await A.eng.enable({ device_name: 'A' }); await B.eng.enable({ device_name: 'B' });
    await A.db.run("UPDATE terms SET meaning = 'A 的释义', note = 'A 的笔记' WHERE text = 'parser'");
    await sleep(5);
    await B.db.run("UPDATE terms SET note = 'B 的笔记' WHERE text = 'parser'");
    await A.eng.sync(); await B.eng.sync(); await A.eng.sync();
    for (const d of [A, B]) { const t = await term(d.db, 'parser'); expect(t?.meaning).toBe('A 的释义'); expect(t?.note).toBe('B 的笔记'); }
  });

  it('设备时钟慢 10 分钟：看过对方的改动之后再改，仍然排在后面', async () => {
    const files = new Map<string, Uint8Array>();
    const A = await device('A', files), B = await device('B', files);
    await A.importText(); await A.eng.enable({ device_name: 'A' }); await B.eng.enable({ device_name: 'B' });
    // A 的时钟快 10 分钟：直接把它的 HLC 推到未来
    await sync.SyncEngine.set(A.db, 'hlc', sync.fmtHlc({ ms: Date.now() + 600_000, n: 0, node: 'aaaaaa' }));
    await A.db.run("UPDATE terms SET meaning = '先改' WHERE text = 'syntax'");
    await A.eng.sync(); await B.eng.sync();
    await B.db.run("UPDATE terms SET meaning = '后改' WHERE text = 'syntax'");
    await B.eng.sync(); await A.eng.sync();
    for (const d of [A, B]) expect((await term(d.db, 'syntax'))?.meaning).toBe('后改');
  });

  it('系统自动推断的熟练度不覆盖用户亲手标的', async () => {
    const files = new Map<string, Uint8Array>();
    const A = await device('A', files), B = await device('B', files);
    await A.importText();
    await A.db.run("UPDATE terms SET status_source = 'auto_rule'");   // 旧数据：系统推断的行
    await A.eng.enable({ device_name: 'A' }); await B.eng.enable({ device_name: 'B' });
    await A.db.run("UPDATE terms SET status = 5, status_source = 'user' WHERE text = 'tokens' OR text = 'token'");
    await sleep(5);
    await B.db.run("UPDATE terms SET status = 97, status_source = 'auto_rule' WHERE text = 'tokens' OR text = 'token'");
    await A.eng.sync(); await B.eng.sync(); await A.eng.sync();
    for (const d of [A, B]) { const t = (await d.db.get<{ status: number; status_source: string }>("SELECT status, status_source FROM terms WHERE text IN ('token', 'tokens')"))!; expect(t.status).toBe(5); expect(t.status_source).toBe('user'); }
  });

  it('离线各复习同一张卡：记录都留下，排期和单机按时间顺序复习一致', async () => {
    const files = new Map<string, Uint8Array>();
    const A = await device('A', files), B = await device('B', files), C = await device('C', files);
    await A.importText();
    const tid = (await term(A.db, 'compiler'))!.id;
    const card = uuidv7(); const t0 = Date.now() - 10 * 86_400_000;
    await A.db.run('INSERT INTO cards(id, term_id, due, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [card, tid, t0, t0, t0]);
    await A.eng.enable({ device_name: 'A' }); await B.eng.enable({ device_name: 'B' });
    const log = (db: Database, rating: number, at: number) => db.run('INSERT INTO review_logs(id, card_id, rating, card_type, state, due, stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days, learning_steps, duration_ms, reviewed_at) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 1000, ?)', [uuidv7(at), card, rating, 'choice', at]);
    await log(A.db, 3, t0 + 86_400_000); await log(B.db, 1, t0 + 2 * 86_400_000); await log(A.db, 4, t0 + 5 * 86_400_000);
    await A.eng.sync(); await B.eng.sync(); await A.eng.sync();
    const sched = (db: Database) => db.get<Record<string, number>>('SELECT due, reps, lapses, state, round(stability, 6) AS s, round(difficulty, 6) AS d FROM cards WHERE id = ?', [card]);
    const a = await sched(A.db), b = await sched(B.db);
    expect(a).toEqual(b);
    expect(a!.reps).toBe(3); expect(a!.lapses).toBe(1);
    // 第三台设备新加入，拿到同样的结果
    await C.eng.enable({ device_name: 'C' });
    expect(await sched(C.db)).toEqual(a);
  });

  it('两端各导入同一篇、各建同一个词：合成一条，ID 一致，句子不重复', async () => {
    const files = new Map<string, Uint8Array>();
    const A = await device('A', files), B = await device('B', files);
    await A.importText(); await sleep(3); await B.importText();
    await B.db.run("UPDATE terms SET note = 'B 记的' WHERE text = 'compiler'");
    await A.eng.enable({ device_name: 'A' }); await B.eng.enable({ device_name: 'B' }); await A.eng.sync();
    const docs = async (db: Database) => db.all<{ id: string }>('SELECT id FROM documents WHERE deleted_at IS NULL');
    expect((await docs(A.db)).map(d => d.id)).toEqual((await docs(B.db)).map(d => d.id));
    expect(await docs(A.db)).toHaveLength(1);
    const ta = await term(A.db, 'compiler'), tb = await term(B.db, 'compiler');
    expect(ta?.id).toBe(tb?.id); expect(ta?.note).toBe('B 记的');
    const sents = async (db: Database) => Number((await db.get<{ n: number }>('SELECT count(*) AS n FROM sentences'))!.n);
    expect(await sents(A.db)).toBe(await sents(B.db));
    expect(await sents(A.db)).toBe(2);
  });

  it('一端删除、另一端修改：删除标记和修改都保留，两端一致', async () => {
    const files = new Map<string, Uint8Array>();
    const A = await device('A', files), B = await device('B', files);
    const t = Date.now(); const mid = uuidv7();
    await A.db.run("INSERT INTO memories(id, type, content, source_type, status, created_at, updated_at) VALUES (?, 'profile', '喜欢科技新闻', 'user', 'active', ?, ?)", [mid, t, t]);
    await A.eng.enable({ device_name: 'A' }); await B.eng.enable({ device_name: 'B' });
    await A.db.run('UPDATE memories SET deleted_at = ? WHERE id = ?', [Date.now(), mid]);
    await B.db.run("UPDATE memories SET content = '喜欢科技和科学新闻' WHERE id = ?", [mid]);
    await A.eng.sync(); await B.eng.sync(); await A.eng.sync();
    for (const d of [A, B]) { const m = (await d.db.get<{ content: string; deleted_at: number | null }>('SELECT content, deleted_at FROM memories WHERE id = ?', [mid]))!; expect(m.deleted_at).toBeTruthy(); expect(m.content).toBe('喜欢科技和科学新闻'); }
  });

  it('批次只传了一半（写失败）：改动留在本机，下次补上，对方只收到一次', async () => {
    const files = new Map<string, Uint8Array>();
    let fail = false;
    const flaky = sync.memoryBackend(files);
    const write = flaky.write.bind(flaky);
    flaky.write = async (p, d) => { if (fail && p.startsWith('changes/')) throw new sync.SyncError('offline', '没连上网络'); return write(p, d); };
    const A = await device('A', files, flaky), B = await device('B', files);
    await A.importText(); await A.eng.enable({ device_name: 'A' }); await B.eng.enable({ device_name: 'B' });
    await A.db.run("UPDATE terms SET meaning = '断网时改的' WHERE text = 'rule'");
    fail = true;
    await expect(A.eng.sync()).rejects.toThrow();
    expect(await A.eng.outboxCount()).toBeGreaterThan(0);
    fail = false;
    await A.eng.sync(); await B.eng.sync();
    expect((await term(B.db, 'rule'))?.meaning).toBe('断网时改的');
    expect(await A.eng.outboxCount()).toBe(0);
  });

  it('本机设置（朗读、MCP）不同步，学习设置同步', async () => {
    const files = new Map<string, Uint8Array>();
    const A = await device('A', files), B = await device('B', files);
    await A.eng.enable({ device_name: 'A' }); await B.eng.enable({ device_name: 'B' });
    const t = Date.now();
    await A.db.run("INSERT INTO settings(key, value, updated_at) VALUES ('tts.engine', '\"kokoro\"', ?), ('review.recognize', 'true', ?)", [t, t]);
    await A.eng.sync(); await B.eng.sync();
    expect(await B.db.get("SELECT value FROM settings WHERE key = 'tts.engine'")).toBeUndefined();
    expect((await B.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'review.recognize'"))?.value).toBe('true');
  });

  it('压缩后：文件夹里只剩 base 和之后的批次；新设备从 base 读起，老设备照常接着读', async () => {
    const files = new Map<string, Uint8Array>();
    const A = await device('A', files), B = await device('B', files), C = await device('C', files);
    A.eng.compactAfter = 1;
    await A.importText(); await A.eng.enable({ device_name: 'A' }); await B.eng.enable({ device_name: 'B' });
    for (const m of ['一', '二', '三']) { await A.db.run('UPDATE terms SET meaning = ? WHERE text = ?', [`编译器${m}`, 'compiler']); await A.eng.sync(); }
    await B.eng.sync();          // B 读到了 A 的全部批次，写进自己的 acks
    const n = await A.eng.compact();
    expect(n).toBeGreaterThan(0);
    const aDir = [...files.keys()].filter(k => k.startsWith('changes/') && !k.includes(B.name)).map(k => k.split('/').pop()!);
    expect(aDir.some(f => f.startsWith('base-'))).toBe(true);
    // 压缩后 A 再改，B 照常收到；C 新加入，从 base 拿到全部
    await A.db.run("UPDATE terms SET note = '压缩后改的' WHERE text = 'compiler'"); await A.eng.sync();
    await B.eng.sync(); await C.eng.enable({ device_name: 'C' });
    for (const d of [B, C]) { const t = await term(d.db, 'compiler'); expect(t?.meaning).toBe('编译器三'); expect(t?.note).toBe('压缩后改的'); }
    expect(Number((await C.db.get<{ n: number }>('SELECT count(*) AS n FROM sentences'))!.n)).toBe(Number((await A.db.get<{ n: number }>('SELECT count(*) AS n FROM sentences'))!.n));
  });

  it('90 天没上线的设备不拦着压缩；它回来后从 base 读起，数据一致', async () => {
    const files = new Map<string, Uint8Array>();
    const A = await device('A', files), D = await device('D', files);
    A.eng.compactAfter = 1;
    await A.importText(); await A.eng.enable({ device_name: 'A' }); await D.eng.enable({ device_name: 'D' });
    // D 很久没上线：把它的设备文件改成 100 天前
    const dKey = [...files.keys()].find(k => k.startsWith('devices/') && JSON.parse(new TextDecoder().decode(files.get(k)!)).name === 'D')!;
    const dev = JSON.parse(new TextDecoder().decode(files.get(dKey)!)); dev.last_seen_at = Date.now() - 100 * 86_400_000; dev.acks = {};
    files.set(dKey, new TextEncoder().encode(JSON.stringify(dev)));
    await A.db.run("UPDATE terms SET meaning = '离开期间改的' WHERE text = 'parser'"); await A.eng.sync();
    expect(await A.eng.compact().then(x => x ?? 'already')).toBeTruthy();
    expect([...files.keys()].some(k => /changes\/[^/]+\/base-/.test(k))).toBe(true);
    await D.eng.sync();
    expect((await term(D.db, 'parser'))?.meaning).toBe('离开期间改的');
  });
});
