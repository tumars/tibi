import { beforeEach, describe, expect, it } from 'vitest';
import type { Core, Ctx, Dict, SectionContent, Term, TermDetail } from '../../src/index.js';
import { documentsMethods } from '../../src/domain/documents/index.js';
import { termsMethods, termsCapabilities } from '../../src/domain/terms/index.js';
import { undoMethods } from '../../src/domain/shared/undo.js';
import { imported, makeCore } from '../helpers.js';

const FREQ: Record<string, number> = { the: 1, is: 2, be: 2, a: 3, of: 4, and: 5, to: 6, it: 8, cat: 300, sit: 200, on: 9, mat: 2000, dog: 150, run: 100, fast: 400, very: 50, slowly: 7000, sleep: 350, upshot: 15000, overhead: 9500, in: 7, reclaim: 11000, cold: 300, night: 120 };
const dict: Dict = { async lookup(w) { return FREQ[w] ? { word: w, phonetic: `/${w}/`, translation: `n. ${w}义；别的`, exam: ['cet4'], forms: [`${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`, `${w}${w.slice(-1)}ed`, `${w}${w.slice(-1)}ing`, `${w.slice(0, -1)}ing`] } : undefined; }, async lemmas(f) { return f === 'sat' ? ['sit'] : []; }, async frequencyRank(l) { return FREQ[l]; } };
const TEXT = 'The cat sat on the mat. The dog ran very slowly. The upshot was overhead, reclaimed in the cold night.';

let core: Core; let ctx: Ctx; let settle: () => Promise<void>; let section: SectionContent;
beforeEach(async () => {
  const m = await makeCore({ dict }); core = m.core; ctx = m.ctx; settle = m.settle;
  core.use(documentsMethods).use(termsMethods).use(undoMethods);
  await m.db.run("UPDATE user_profile SET daily_new_cards = 2 WHERE id = '1'");
  const r = await imported(await core.call<{ import_id: string }>('documents.import', { source: { type: 'text', text: TEXT, title: 'Cats' } })); if (!r.ok) throw new Error(r.error);
  const doc = await core.call<{ sections: { id: string }[] }>('documents.get', { id: (r as unknown as { document_id: string }).document_id });
  section = await core.call('sections.get', { id: doc.sections[0]!.id });
});

const sentenceWith = (w: string) => section.sentences.find(s => s.tokens.some(t => t.t === w))!;
/** 用户标的生词（status 0，还没建卡），比如在别处标过 */
async function markNew(...words: string[]) {
  const t = Date.now();
  for (const w of words) {
    await ctx.db.run("INSERT INTO terms(id, kind, text, text_display, status, status_source, created_at, updated_at) VALUES (?, 'word', ?, ?, 0, 'user', ?, ?)", [`t-${w}`, w, w, t, t]);
    await ctx.db.run("INSERT INTO term_status_log(id, term_id, status, source, created_at) VALUES (?, ?, 0, 'user', ?)", [`l-${w}`, `t-${w}`, t]);
  }
}

describe('terms.lookup（R5）', () => {
  it('点用户标的生词：0 → 1，建卡；没标过的词只查不写', async () => {
    await markNew('upshot');
    const s = sentenceWith('upshot');
    const r = await core.call<{ term?: Term; status_change?: unknown; card_created: boolean; dict?: unknown }>('terms.lookup', { text: 'upshot', sentence_id: s.id });
    expect(r.status_change).toEqual({ from: 0, to: 1 });
    expect(r.card_created).toBe(true);
    expect(r.term?.status).toBe(1);
    expect(r.dict).toMatchObject({ word: 'upshot' });
    const again = await core.call<{ status_change?: unknown; card_created: boolean }>('terms.lookup', { text: 'upshot', sentence_id: s.id });
    expect(again.status_change).toBeUndefined(); expect(again.card_created).toBe(false);
    // 没标过的词，常见（cat）还是生僻（slowly 7000、reclaim 11000）都不写入
    for (const w of ['cat', 'slowly', 'reclaimed']) {
      const k = await core.call<{ term?: Term; card_created: boolean }>('terms.lookup', { text: w, sentence_id: sentenceWith(w).id });
      expect(k.term).toBeUndefined(); expect(k.card_created).toBe(false);
    }
    expect((await ctx.db.all('SELECT text FROM terms')).length).toBe(1);
    // 旧数据里的待确认（99）：点开不变
    await ctx.db.run("INSERT INTO terms(id, kind, text, text_display, status, status_source, created_at, updated_at) VALUES ('old', 'word', 'night', 'night', 99, 'auto_rule', 1, 1)");
    const u = await core.call<{ status_change?: unknown; card_created: boolean }>('terms.lookup', { text: 'night', sentence_id: sentenceWith('night').id });
    expect(u.status_change).toBeUndefined(); expect(u.card_created).toBe(false);
    // 词形：sat → sit（词典），不带 sentence_id 只读
    const d = await core.call<{ dict?: { word: string }; term?: Term }>('terms.lookup', { text: 'Sat' });
    expect(d.dict?.word).toBe('sit');
  });

  it('terms.mark：没有词条的词直接标到某一档，历史里只有那一条（不先记一条"生词"）', async () => {
    const r = await core.call<{ term: Term }>('terms.mark', { text: 'reclaimed', status: 3, sentence_id: sentenceWith('reclaimed').id });
    expect(r.term.status).toBe(3);
    const log = await ctx.db.all<{ status: number }>('SELECT status FROM term_status_log WHERE term_id = ? ORDER BY created_at', [r.term.id]);
    expect(log.map(x => Number(x.status))).toEqual([3]);
  });

  it('terms.mark：词卡上标没有词条的词——生词进生词本并建卡，已知只记状态；可撤销', async () => {
    const a = await core.call<{ term: Term; undo: { undo_id: string } }>('terms.mark', { text: 'reclaimed', status: 0, sentence_id: sentenceWith('reclaimed').id });
    expect(a.term).toMatchObject({ text: 'reclaim', status: 0 });
    expect(await ctx.db.get("SELECT c.id FROM cards c JOIN terms t ON t.id = c.term_id WHERE t.text = 'reclaim'")).toBeTruthy();
    const sec = await core.call<SectionContent>('sections.get', { id: section.id });
    expect(sec.counts).toEqual({ new: 1, learning: 0 });
    // 阅读器收到 terms 变化后重取这一章：刚标的词带上行间释义
    expect(sec.sentences.flatMap(s => s.tokens).find(t => t.t === 'reclaimed')).toMatchObject({ status: 0, gloss: 'reclaim义' });
    // 行里没存短释义的旧词（高亮了）：取章节时查词典补上
    await markNew('upshot');
    const old = await core.call<SectionContent>('sections.get', { id: section.id });
    expect(old.sentences.flatMap(s => s.tokens).find(t => t.t === 'upshot')).toMatchObject({ status: 0, gloss: 'upshot义' });
    const b = await core.call<{ term: Term; undo: { undo_id: string } }>('terms.mark', { text: 'Slowly', status: 97 });
    expect(b.term).toMatchObject({ text: 'slowly', status: 97 });
    expect(await ctx.db.get("SELECT c.id FROM cards c JOIN terms t ON t.id = c.term_id WHERE t.text = 'slowly'")).toBeUndefined();
    await core.call('system.undo', { undo_id: b.undo.undo_id });
    expect((await ctx.db.get<{ deleted_at: number | null }>("SELECT deleted_at FROM terms WHERE text = 'slowly'"))?.deleted_at).toBeTruthy();
    // 已有的行：改状态
    const c = await core.call<{ term: Term; previous: number }>('terms.mark', { text: 'reclaim', status: 3 });
    expect(c.previous).toBe(0); expect(c.term.status).toBe(3);
    // 在文章里点的词：那一句算遇见一次（生词本"遇见"和详情里的句子对得上）
    expect((await ctx.db.get<{ encounter_count: number }>("SELECT encounter_count FROM terms WHERE text = 'reclaim'"))?.encounter_count).toBe(1);
    // 再标回来：删掉的行恢复
    const d = await core.call<{ term: Term }>('terms.mark', { text: 'slowly', status: 98 });
    expect(d.term.status).toBe(98);
  });

  it('每日新卡上限之外的卡顺延', async () => {
    await markNew('upshot', 'overhead', 'reclaim');
    const words = ['upshot', 'overhead', 'reclaimed'];
    for (const w of words) await core.call('terms.lookup', { text: w, sentence_id: sentenceWith(w).id });
    const cards = await ctx.db.all<{ due: number }>('SELECT due FROM cards ORDER BY created_at');
    expect(cards).toHaveLength(3);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    expect(cards[0]!.due).toBeLessThan(today.getTime() + 86_400_000);
    expect(cards[1]!.due).toBeLessThan(today.getTime() + 86_400_000);
    expect(cards[2]!.due).toBeGreaterThanOrEqual(today.getTime() + 86_400_000);   // 第 3 张超出上限 2，排到明天
  });
});

describe('terms.setStatus / list / get / 撤销', () => {
  it('改状态、视图计数、撤销', async () => {
    await markNew('upshot');
    // 标过之后重新标注，才在文中登记语境（导入时这个词还没有行）
    await core.call('documents.reanalyze', { id: section.document_id });
    await settle();
    const s = sentenceWith('upshot');
    const r = await core.call<{ term: Term }>('terms.lookup', { text: 'upshot', sentence_id: s.id });
    const id = r.term.id;
    const up = await core.call<{ changed: number; undo: { undo_id: string } }>('terms.setStatus', { ids: [id], status: 97 });
    expect(up.changed).toBe(1);
    expect((await ctx.db.get<{ suspended: number }>('SELECT suspended FROM cards WHERE term_id = ?', [id]))?.suspended).toBe(1);
    let list = await core.call<{ items: Term[]; counts: Record<string, number> }>('terms.list', { view: 'known' });
    expect(list.items.map(t => t.text)).toEqual(['upshot']);
    expect(list.counts.known).toBe(1); expect(list.counts.all).toBe(0);
    await core.call('system.undo', { undo_id: up.undo.undo_id });
    list = await core.call('terms.list', { view: 'all' });
    expect(list.items.map(t => t.text)).toEqual(['upshot']);
    expect(list.items[0]!.status).toBe(1);
    expect((await ctx.db.get<{ suspended: number }>('SELECT suspended FROM cards WHERE term_id = ?', [id]))?.suspended).toBe(0);
    const detail = await core.call<TermDetail>('terms.get', { id });
    expect(detail.contexts).toHaveLength(1);
    expect(detail.contexts[0]!.sentence).toMatch(/upshot/);
    expect(detail.history.map(h => h.status)).toEqual([0, 1, 97, 1]);
    expect(detail.card?.state).toBe(0);
    expect(detail.ipa).toBe('/upshot/');
  });

  it('sections.finish 只记读完，不改用户标的词', async () => {
    await markNew('upshot', 'overhead');
    const r = await core.call<{ ok: boolean }>('sections.finish', { id: section.id });
    expect(r).toEqual({ ok: true });
    const rows = await ctx.db.all<{ text: string; status: number }>('SELECT text, status FROM terms ORDER BY text');
    expect(rows).toEqual([{ text: 'overhead', status: 0 }, { text: 'upshot', status: 0 }]);
    const sec = await core.call<SectionContent>('sections.get', { id: section.id });
    expect(sec.counts).toEqual({ new: 2, learning: 0 });
    expect(Number((await ctx.db.get<{ n: number }>('SELECT finished_at IS NOT NULL AS n FROM sections WHERE id = ?', [section.id]))?.n)).toBe(1);
  });

  it('terms.add、addPhrase、remove、能力 mark_term', async () => {
    const a = await core.call<{ created: Term[] }>('terms.add', { entries: [{ text: 'dogs' }, { text: 'kick the bucket', meaning: '死' }] });
    expect(a.created.map(t => [t.text, t.kind])).toEqual([['dog', 'word'], ['kick the bucket', 'phrase']]);
    const s = sentenceWith('cat');
    const ph = await core.call<Term>('terms.addPhrase', { text: 'on the mat', sentence_id: s.id, surface: 'on the mat' });
    expect(ph.kind).toBe('phrase');
    const sec = await core.call<SectionContent>('sections.get', { id: section.id });
    expect(sec.phrases.map(p => p.text)).toEqual(['on the mat']);
    expect(sec.sentences[0]!.tokens.filter(t => t.phrase_id === ph.id).map(t => t.t)).toEqual(['on', 'the', 'mat']);
    const rm = await core.call<{ undo_id: string }>('terms.remove', { ids: [ph.id] });
    expect((await core.call<{ counts: Record<string, number> }>('terms.list', {})).counts.all).toBe(2);   // dog 与 kick the bucket 还在
    await core.call('system.undo', { undo_id: rm.undo_id });
    expect((await core.call<{ counts: Record<string, number> }>('terms.list', {})).counts.all).toBe(3);
    const mk = await termsCapabilities['mark_term']!.run({ term: 'night', status: 3 }, ctx);
    expect(mk).toMatchObject({ previous: 0 });
    expect((await ctx.db.get<{ status: number }>('SELECT status FROM terms WHERE text = ?', ['night']))?.status).toBe(3);
  });
});
