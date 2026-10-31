import { describe, expect, it } from 'vitest';
import { uuidv7, type UsageSummary } from '../../src/index.js';
import { makeDoc, makeReviewCore, makeWord } from '../review/fixtures.js';

const DAY = 86_400_000;

describe('统计', () => {
  it('summary / series：已知词分实测与估算，复习计数', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    await makeWord(db, { text: 'k1', meaning: '一', status: 4 }, doc);          // 实测（user）
    await makeWord(db, { text: 'k2', meaning: '二', status: 97 }, doc);
    await db.run("UPDATE terms SET status_source = 'auto_rule' WHERE text = 'k2'");   // 估算
    await db.run("INSERT INTO terms(id, kind, text, text_display, status, status_source, created_at, updated_at) VALUES (?,?,?,?,99,'auto_rule',?,?)", [uuidv7(), 'word', 'k3', 'k3', Date.now(), Date.now()]);
    const t = Date.now();
    await db.run('INSERT INTO reading_sessions(id, document_id, section_id, started_at, ended_at, words_read, terms_marked, updated_at) VALUES (?,?,?,?,?,300,2,?)', [uuidv7(), doc.document_id, doc.section_id, t - 600_000, t, t]);
    await db.run("INSERT INTO review_logs(id, card_id, rating, card_type, reviewed_at) VALUES (?,?,3,'cloze',?), (?,?,1,'choice',?)", [uuidv7(), 'c1', t, uuidv7(), 'c2', t]);
    // 已知词（00 §3.1）：词汇量 N 以内的常见词默认已知；没有词典时库里的行都算在 N 以内
    await db.run("UPDATE user_profile SET vocab_estimate = 10 WHERE id = '1'");
    const s = await core.call<Record<string, number>>('stats.summary', { range: 30 });
    expect(s.known).toBe(10); expect(s.known_delta).toBe(0);   // 第一天：实测 1 + 估算 9；之前没有记录，增量从 0 起 expect(s.minutes).toBe(10); expect(s.words).toBe(300); expect(s.reviews).toBe(2); expect(s.retention).toBe(0.5);
    expect(s.streak).toBe(1); expect(s.study_days).toBe(1);
    const se = await core.call<{ dates: number[]; series: Record<string, number[]> }>('stats.series', { metrics: ['known', 'reviews'], days: 7 });
    expect(se.dates).toHaveLength(7);
    expect(se.series.known!.at(-1)).toBe(10); expect(se.series.known_confirmed!.at(-1)).toBe(1); expect(se.series.known_estimated!.at(-1)).toBe(9);
    expect(se.series.reviews!.at(-1)).toBe(2);
    const r = await core.call<{ weeks: { ratings: number[]; retention: number }[]; leeches: number }>('stats.retention', { weeks: 2 });
    expect(r.weeks).toHaveLength(2); expect(r.weeks[1]!.ratings).toEqual([1, 0, 1, 0]); expect(r.weeks[1]!.retention).toBe(0.5);
    const g = await core.call<{ genre: string }[]>('stats.genres', { range: 30 });
    expect(g[0]?.genre).toBe('tech');
  });

  it('export_summary 的结构与 H1–H3 口径', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    const t = Date.now();
    await db.run("UPDATE user_profile SET created_at = ? WHERE id = '1'", [t - 10 * DAY]);
    await db.run("INSERT INTO learning_events(id, type, payload, consolidated, created_at) VALUES (?,?,?,0,?)", [uuidv7(), 'document_imported', JSON.stringify({ document_id: doc.document_id, source_type: 'url', prelabel_total: 20 }), t - 9 * DAY]);
    await db.run("INSERT INTO learning_events(id, type, payload, consolidated, created_at) VALUES (?,?,?,0,?)", [uuidv7(), 'section_finished', JSON.stringify({ document_id: doc.document_id, section_id: doc.section_id }), t - 8 * DAY]);
    await db.run("INSERT INTO term_status_log(id, term_id, status, source, prelabel, document_id, created_at) VALUES (?,?,2,'user','known',?,?), (?,?,97,'user','new',?,?), (?,?,99,'user','unsure',?,?)",
      [uuidv7(), 'x1', doc.document_id, t - 9 * DAY, uuidv7(), 'x2', doc.document_id, t - 9 * DAY, uuidv7(), 'x3', doc.document_id, t - 9 * DAY]);
    const w = await makeWord(db, { text: 'h3', meaning: '三' }, doc);
    await db.run('UPDATE cards SET created_at = ? WHERE id = ?', [t - 5 * DAY, w.card_id]);
    const nextDay = new Date(t - 5 * DAY); nextDay.setHours(0, 0, 0, 0);
    await db.run("INSERT INTO review_logs(id, card_id, rating, card_type, reviewed_at) VALUES (?,?,3,'choice',?)", [uuidv7(), w.card_id, nextDay.getTime() + DAY + 3600_000]);
    const u = await core.call<UsageSummary>('stats.export_summary', {});
    expect(u.schema).toBe(1); expect(u.days_since_first_use).toBe(10);
    expect(u.documents).toEqual({ samples: 0, self_imported: 1, finished: 0 });
    expect(u.h1).toEqual({ first_doc_finished: true, prelabeled_total: 20, prelabeled_changed: 2, ratio: 0.1 });
    expect(u.h2).toEqual({ window_closed: true, self_imports_7d: 1, passed: true });
    expect(u.h3).toEqual({ has_card: true, reviewed_next_day: true });
    expect(JSON.stringify(u)).not.toContain('h3 ');
  });
});

describe('已知词：有词典时按词频判断是否在词汇量以内', () => {
  it('N 以内的生词从估算里减掉，N 以外的确认词与待确认词加上', async () => {
    const { knownCounts } = await import('../../src/domain/stats/rollup.js');
    const { db } = await makeReviewCore();
    await db.run("UPDATE user_profile SET vocab_estimate = 100 WHERE id = '1'");
    const ins = (text: string, status: number, src: string) => db.run('INSERT INTO terms(id, kind, text, text_display, status, status_source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', [uuidv7(), 'word', text, text, status, src, Date.now(), Date.now()]);
    await ins('common', 0, 'user');     // rank 10：N 以内却被标成生词 → 估算 −1
    await ins('known', 5, 'user');      // rank 50：N 以内的实测 → 实测 +1、估算 −1
    await ins('rare', 97, 'user');      // rank 500：N 以外的实测 → 实测 +1
    await ins('band', 99, 'auto_rule'); // rank 300：中间带待确认 → 估算 +1
    const ranks = new Map([['common', 10], ['known', 50], ['rare', 500], ['band', 300]]);
    const dict = { lookup: async () => undefined, lemmas: async () => [], frequencyRank: async (l: string) => ranks.get(l), frequencyRanks: async (ls: string[]) => new Map(ls.filter(l => ranks.has(l)).map(l => [l, ranks.get(l)!])) };
    expect(await knownCounts(db, dict)).toEqual({ confirmed: 2, estimated: 99, total: 101 });
  });
});
