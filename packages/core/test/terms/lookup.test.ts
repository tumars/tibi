import { beforeEach, describe, expect, it } from 'vitest';
import type { Core, Ctx, Dict, SectionContent, Term, TermDetail } from '../../src/index.js';
import { documentsMethods, registerImportPipeline } from '../../src/domain/documents/index.js';
import { termsMethods, termsCapabilities } from '../../src/domain/terms/index.js';
import { undoMethods } from '../../src/domain/shared/undo.js';
import { makeCore, InlineJobRunner } from '../helpers.js';

const FREQ: Record<string, number> = { the: 1, is: 2, be: 2, a: 3, of: 4, and: 5, to: 6, it: 8, cat: 300, sit: 200, on: 9, mat: 2000, dog: 150, run: 100, fast: 400, very: 50, slowly: 7000, sleep: 350, upshot: 15000, overhead: 9500, in: 7, reclaim: 11000, cold: 300, night: 120 };
const dict: Dict = { async lookup(w) { return FREQ[w] ? { word: w, phonetic: `/${w}/`, translation: `n. ${w}义；别的`, exam: ['cet4'], forms: [`${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`, `${w}${w.slice(-1)}ed`, `${w}${w.slice(-1)}ing`, `${w.slice(0, -1)}ing`] } : undefined; }, async lemmas(f) { return f === 'sat' ? ['sit'] : []; }, async frequencyRank(l) { return FREQ[l]; } };
const TEXT = 'The cat sat on the mat. The dog ran very slowly. The upshot was overhead, reclaimed in the cold night.';

let core: Core; let ctx: Ctx; let jobs: InlineJobRunner; let section: SectionContent;
beforeEach(async () => {
  const m = await makeCore({ dict }); core = m.core; ctx = m.ctx; jobs = m.jobs;
  core.use(documentsMethods).use(termsMethods).use(undoMethods); registerImportPipeline(jobs, core);
  await m.db.run("UPDATE user_profile SET vocab_estimate = 6000, daily_new_cards = 2 WHERE id = '1'");
  const { task_id } = await core.call<{ task_id: string }>('documents.import', { source: { type: 'text', text: TEXT, title: 'Cats' } });
  const r = await jobs.wait(task_id); if (r.status !== 'done') throw new Error(r.error);
  const doc = await core.call<{ sections: { id: string }[] }>('documents.get', { id: (r.output as { document_id: string }).document_id });
  section = await core.call('sections.get', { id: doc.sections[0]!.id });
});

const sentenceWith = (w: string) => section.sentences.find(s => s.tokens.some(t => t.t === w))!;

describe('terms.lookup（R5）', () => {
  it('点生词：0 → 1，建卡；已知词不写入；待确认不变', async () => {
    const s = sentenceWith('upshot');
    const r = await core.call<{ term?: Term; status_change?: unknown; card_created: boolean; dict?: unknown }>('terms.lookup', { text: 'upshot', sentence_id: s.id });
    expect(r.status_change).toEqual({ from: 0, to: 1 });
    expect(r.card_created).toBe(true);
    expect(r.term?.status).toBe(1);
    expect(r.dict).toMatchObject({ word: 'upshot' });
    const again = await core.call<{ status_change?: unknown; card_created: boolean }>('terms.lookup', { text: 'upshot', sentence_id: s.id });
    expect(again.status_change).toBeUndefined(); expect(again.card_created).toBe(false);
    // 已知词（cat, rank 300）：不写入
    const k = await core.call<{ term?: Term }>('terms.lookup', { text: 'cat', sentence_id: sentenceWith('cat').id });
    expect(k.term).toBeUndefined();
    expect(await ctx.db.get('SELECT id FROM terms WHERE text = ?', ['cat'])).toBeUndefined();
    // 待确认（slowly 7000）：不变
    const u = await core.call<{ term?: Term; status_change?: unknown }>('terms.lookup', { text: 'slowly', sentence_id: sentenceWith('slowly').id });
    expect(u.term?.status).toBe(99); expect(u.status_change).toBeUndefined();
    // 词形：sat → sit（词典），不带 sentence_id 只读
    const d = await core.call<{ dict?: { word: string }; term?: Term }>('terms.lookup', { text: 'Sat' });
    expect(d.dict?.word).toBe('sit');
  });

  it('每日新卡上限之外的卡顺延', async () => {
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

  it('sections.finish 只把生词标为已知，不动待确认', async () => {
    const r = await core.call<{ marked: number; undo?: { undo_id: string } }>('sections.finish', { id: section.id, mark_rest_known: true });
    expect(r.marked).toBe(3);   // upshot overhead reclaim
    const rows = await ctx.db.all<{ text: string; status: number }>('SELECT text, status FROM terms ORDER BY text');
    expect(rows).toEqual([{ text: 'overhead', status: 97 }, { text: 'reclaim', status: 97 }, { text: 'slowly', status: 99 }, { text: 'upshot', status: 97 }]);
    const sec = await core.call<SectionContent>('sections.get', { id: section.id });
    expect(sec.counts).toEqual({ new: 0, learning: 0, unsure: 1 });
    await core.call('system.undo', { undo_id: r.undo!.undo_id });
    expect((await ctx.db.get<{ status: number }>('SELECT status FROM terms WHERE text = ?', ['upshot']))?.status).toBe(0);
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
