import { describe, expect, it } from 'vitest';
import { uuidv7, type UsageSummary } from '../../src/index.js';
import { makeDoc, makeReviewCore, makeWord } from '../review/fixtures.js';

const DAY = 86_400_000;

describe('统计', () => {
  it('summary / series：已掌握只数用户标的 5 / 97，复习计数', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    const ins = (text: string, status: number, src: string) => db.run('INSERT INTO terms(id, kind, text, text_display, status, status_source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', [uuidv7(), 'word', text, text, status, src, Date.now(), Date.now()]);
    await makeWord(db, { text: 'k1', meaning: '一', status: 4 }, doc);   // 学习中：不算
    await ins('k2', 97, 'user');        // 标为已知：算
    await ins('k3', 5, 'srs');          // 复习升到掌握：算
    await ins('k4', 97, 'auto_rule');   // 旧数据里规则标的：不算
    await ins('k5', 99, 'auto_rule');   // 旧数据里的待确认：不算
    const t = Date.now();
    await db.run('INSERT INTO reading_sessions(id, document_id, section_id, started_at, ended_at, words_read, terms_marked, updated_at) VALUES (?,?,?,?,?,300,2,?)', [uuidv7(), doc.document_id, doc.section_id, t - 600_000, t, t]);
    await db.run("INSERT INTO review_logs(id, card_id, rating, card_type, reviewed_at) VALUES (?,?,3,'cloze',?), (?,?,1,'choice',?)", [uuidv7(), 'c1', t, uuidv7(), 'c2', t]);
    const s = await core.call<Record<string, number>>('stats.summary', { range: 30 });
    expect(s.mastered).toBe(2); expect(s.mastered_delta).toBe(0);   // 第一天：之前没有记录，增量从 0 起
    expect(s).not.toHaveProperty('known');
    expect(s.minutes).toBe(10); expect(s.words).toBe(300); expect(s.reviews).toBe(2); expect(s.retention).toBe(0.5);
    expect(s.streak).toBe(1); expect(s.study_days).toBe(1);
    const se = await core.call<{ dates: number[]; series: Record<string, number[]> }>('stats.series', { metrics: ['mastered', 'reviews'], days: 7 });
    expect(se.dates).toHaveLength(7);
    expect(se.series.mastered).toEqual([2, 2, 2, 2, 2, 2, 2]);   // 之前没有记录的天沿用最早那天的值
    expect(se.series.reviews!.at(-1)).toBe(2);
    const r = await core.call<{ weeks: { ratings: number[]; retention: number }[]; leeches: number }>('stats.retention', { weeks: 2 });
    expect(r.weeks).toHaveLength(2); expect(r.weeks[1]!.ratings).toEqual([1, 0, 1, 0]); expect(r.weeks[1]!.retention).toBe(0.5);
    const g = await core.call<{ genre: string }[]>('stats.genres', { range: 30 });
    expect(g[0]?.genre).toBe('tech');
  });

  it('export_summary 的结构与 H2–H3 口径', async () => {
    const { core, db } = await makeReviewCore();
    const doc = await makeDoc(db);
    const t = Date.now();
    await db.run("UPDATE user_profile SET created_at = ? WHERE id = '1'", [t - 10 * DAY]);
    await db.run("INSERT INTO learning_events(id, type, payload, consolidated, created_at) VALUES (?,?,?,0,?)", [uuidv7(), 'document_imported', JSON.stringify({ document_id: doc.document_id, source_type: 'url' }), t - 9 * DAY]);
    await db.run("INSERT INTO learning_events(id, type, payload, consolidated, created_at) VALUES (?,?,?,0,?)", [uuidv7(), 'section_finished', JSON.stringify({ document_id: doc.document_id, section_id: doc.section_id }), t - 8 * DAY]);
    const w = await makeWord(db, { text: 'h3', meaning: '三' }, doc);
    await db.run('UPDATE cards SET created_at = ? WHERE id = ?', [t - 5 * DAY, w.card_id]);
    const nextDay = new Date(t - 5 * DAY); nextDay.setHours(0, 0, 0, 0);
    await db.run("INSERT INTO review_logs(id, card_id, rating, card_type, reviewed_at) VALUES (?,?,3,'choice',?)", [uuidv7(), w.card_id, nextDay.getTime() + DAY + 3600_000]);
    const u = await core.call<UsageSummary>('stats.export_summary', {});
    expect(u.schema).toBe(1); expect(u.days_since_first_use).toBe(10);
    expect(u.documents).toEqual({ samples: 0, self_imported: 1, finished: 0 });
    expect(u).not.toHaveProperty('h1'); expect(u).not.toHaveProperty('vocab_tested');
    expect(u.h2).toEqual({ window_closed: true, self_imports_7d: 1, passed: true });
    expect(u.h3).toEqual({ has_card: true, reviewed_next_day: true });
    expect(JSON.stringify(u)).not.toContain('h3 ');
  });
});

describe('学习洞察 / 预测 / 熟练度（M3）', () => {
  it('stats.insight 用模型写一段话，动作只从固定列表里挑；当天缓存', async () => {
    const { openAppDb } = await import('@tibi/core-node');
    const { assembleCore, fakePlatform } = await import('../../src/index.js');
    const { FAKE_MODEL, scriptedStream } = await import('../kernel/helpers.js');
    const db = await openAppDb(':memory:'); const t = Date.now();
    await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
    const stream = scriptedStream([{ text: '{"text":"这两周阅读时间少了一半。","actions":["review","hack"]}' }]);
    const { core } = await assembleCore({ db, platform: fakePlatform({ isOnline: () => true }), resolveModel: async () => ({ model: FAKE_MODEL, apiKey: 'k', streamFn: stream }), resume: false });
    const a = await core.call<{ insight: { text: string; actions: { route: string }[] } }>('stats.insight', {});
    expect(a.insight.text).toBe('这两周阅读时间少了一半。');
    expect(a.insight.actions.map(x => x.route)).toEqual(['/review']);
    await core.call('stats.insight', {});
    expect(stream.calls).toBe(1);
    expect((await core.call<{ days: number[] }>('stats.forecast', {})).days).toHaveLength(14);
    expect((await core.call<{ stages: number[] }>('stats.stages', {})).stages).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
