import { Type } from '@sinclair/typebox';
import { method, S, type MethodMap } from '../../rpc/define.js';
import { TibiError, type Status } from '../../types.js';
import { lemmatize } from '../text/lemma.js';
import { normalizeCase } from '../text/tokenize.js';
import { getTerm, getTermByText, readProfile, type TermRow } from './repo.js';
import { addPhrase, addWords, applyStatus, contextMeaning, pauseTerms, removeTerms, touchOnLookup } from './service.js';
import { listTerms, termDetail, toTerm, VIEWS } from './views.js';

/** terms.*（06 §3 词汇与生词本） */

async function requireTerm(db: import('../../db/driver.js').Database, id: string): Promise<TermRow> {
  const t = await getTerm(db, id);
  if (!t || t.deleted_at) throw new TibiError('not_found', '找不到这个词');
  return t;
}

export const termsMethods: MethodMap = {
  'terms.lookup': method(Type.Object({ text: Type.String({ minLength: 1 }), sentence_id: Type.Optional(S.id) }), async (p, ctx) => {
    const raw = p.text.trim();
    const isPhrase = /\s/.test(raw);
    const lemma = isPhrase ? raw.toLowerCase().replace(/\s+/g, ' ') : await lemmatize(normalizeCase(raw, true), ctx.dict);
    const dict = isPhrase ? undefined : await ctx.dict.lookup(lemma);
    let term = await getTermByText(ctx.db, lemma, isPhrase ? 'phrase' : 'word');
    let status_change: { from: Status; to: Status } | undefined; let card_created = false;
    if (p.sentence_id && !isPhrase) {
      const s = await ctx.db.get<{ section_id: string }>('SELECT section_id FROM sentences WHERE id = ?', [p.sentence_id]);
      const doc = s ? await ctx.db.get<{ document_id: string }>('SELECT document_id FROM sections WHERE id = ?', [s.section_id]) : undefined;
      const r = await ctx.db.transaction(tx => touchOnLookup(tx, ctx.dict, lemma, raw, doc?.document_id ?? null));
      term = r.term ?? term; status_change = r.status_change; card_created = r.card_created;
      if (status_change) ctx.events.emit('data.changed', { table: 'terms', ids: [term!.id] });
    }
    return {
      dict, term: term && !term.deleted_at ? await toTerm(ctx.db, ctx.dict, term) : undefined,
      context_meaning: p.sentence_id ? await contextMeaning(ctx.db, term?.id, lemma, p.sentence_id) : undefined,
      status_change, card_created,
    };
  }, '词卡；带 sentence_id 时按 R5 自动设为见过并建卡'),

  'terms.list': method(Type.Object({
    view: Type.Optional(Type.Union(VIEWS.map(v => Type.Literal(v)))), status: Type.Optional(Type.Array(S.status)), kind: Type.Optional(Type.Union([Type.Literal('word'), Type.Literal('phrase')])),
    document_id: Type.Optional(S.id), tags: Type.Optional(Type.Array(Type.String())), q: Type.Optional(Type.String()),
    sort: Type.Optional(Type.Union(['due', 'added', 'enc', 'alpha', 'stage', 'freq'].map(s => Type.Literal(s)))), ...S.page,
  }), async (p, ctx) => listTerms(ctx.db, ctx.dict, p as never), '生词本列表与视图计数'),

  'terms.get': method(Type.Union([Type.Object({ id: S.id }), Type.Object({ text: Type.String() })]), async (p, ctx) => {
    const term = 'id' in p ? await requireTerm(ctx.db, p.id) : await getTermByText(ctx.db, /\s/.test(p.text) ? p.text.toLowerCase().replace(/\s+/g, ' ') : await lemmatize(p.text.toLowerCase(), ctx.dict), /\s/.test(p.text) ? 'phrase' : 'word');
    if (!term || term.deleted_at) throw new TibiError('not_found', '找不到这个词');
    return termDetail(ctx.db, ctx.dict, term);
  }, '详情抽屉'),

  'terms.setStatus': method(Type.Object({ ids: Type.Array(S.id, { minItems: 1 }), status: S.status, source: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('page_done')])), document_id: Type.Optional(S.id) }), async (p, ctx) => {
    const r = await applyStatus(ctx, p.ids, p.status as Status, p.source ?? 'user', p.document_id ?? null);
    return { changed: r.changed, undo: r.undo };
  }, '0–5、97 标为已知、98 忽略'),

  'terms.addPhrase': method(Type.Object({ text: Type.String({ minLength: 3 }), sentence_id: S.id, surface: Type.String() }), async (p, ctx) => {
    const { term } = await addPhrase(ctx, p.text, p.sentence_id, p.surface);
    return toTerm(ctx.db, ctx.dict, term);
  }, '选中多个词标为短语'),

  'terms.add': method(Type.Object({ entries: Type.Array(Type.Object({ text: Type.String({ minLength: 1 }), meaning: Type.Optional(Type.String()) }), { minItems: 1 }) }), async (p, ctx) => {
    const r = await addWords(ctx, p.entries);
    return { created: await Promise.all(r.created.map(t => toTerm(ctx.db, ctx.dict, t))), undo: r.undo };
  }, '生词本"添加"'),

  'terms.pause': method(Type.Object({ ids: Type.Array(S.id, { minItems: 1 }), days: Type.Integer({ minimum: 1, maximum: 365 }) }), async (p, ctx) => pauseTerms(ctx, p.ids, p.days), '难词暂停复习'),

  'terms.setCardType': method(Type.Object({ id: S.id, card_type: Type.Optional(S.cardType) }), async (p, ctx) => {
    await requireTerm(ctx.db, p.id);
    await ctx.db.run('UPDATE cards SET forced_type = ?, updated_at = ? WHERE term_id = ? AND deleted_at IS NULL', [p.card_type ?? null, Date.now(), p.id]);
    const c = await ctx.db.get<{ id: string; state: number; due: number; stability: number; difficulty: number; reps: number; lapses: number; suspended: number; forced_type: string | null }>('SELECT id, state, due, stability, difficulty, reps, lapses, suspended, forced_type FROM cards WHERE term_id = ? AND deleted_at IS NULL', [p.id]);
    if (!c) throw new TibiError('not_found', '这个词还没有复习卡');
    return { card_id: c.id, term_id: p.id, state: c.state, due: Number(c.due), stability: Number(c.stability), difficulty: Number(c.difficulty), reps: Number(c.reps), lapses: Number(c.lapses), suspended: !!c.suspended, forced_type: c.forced_type ?? undefined };
  }, '难词换题型'),

  'terms.remove': method(Type.Object({ ids: Type.Array(S.id, { minItems: 1 }) }), async (p, ctx) => removeTerms(ctx, p.ids), '移出生词本'),

  'terms.import': method(Type.Object({ path: Type.String(), format: Type.Union(['csv', 'txt', 'anki', 'known'].map(s => Type.Literal(s))) }), async () => {
    throw new TibiError('invalid_source', '从文件导入生词还没做好');
  }, 'M3'),
  'terms.export': method(Type.Object({ format: Type.Union(['csv', 'anki', 'txt'].map(s => Type.Literal(s))), ids: Type.Optional(Type.Array(S.id)), with_contexts: Type.Optional(Type.Boolean()) }), async () => {
    throw new TibiError('invalid_source', '导出生词本还没做好');
  }, 'M3'),

  'profile.vocab': method(Type.Object({}), async (_p, ctx) => readProfile(ctx.db), '内部：标注用的画像'),
};
