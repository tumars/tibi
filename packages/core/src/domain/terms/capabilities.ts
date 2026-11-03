import { Type } from '@sinclair/typebox';
import { capability, S, type CapabilityMap } from '../../rpc/define.js';
import { TibiError, type Status, type TermContext } from '../../types.js';
import { lemmatize } from '../text/lemma.js';
import { getTerm, getTermByText } from './repo.js';
import { addPhrase, addWords, applyStatus, removeTerms, setContextMeaning } from './service.js';
import { listTerms, termDetail, VIEWS } from './views.js';

const firstLine = (s: string) => s.split('\n')[0]!.trim();

/** 能力层·词典与词汇（06 §5）：技能工具 / MCP 工具 / 界面直接调用共用 */
export const termsCapabilities: CapabilityMap = {
  lookup_word: capability({
    name: 'lookup_word', description: '查本地词典：音标、释义、词频、词形；带本地熟练度。只读，不改状态', perm: 'read',
    params: Type.Object({ word: Type.String({ minLength: 1 }), lemmatize: Type.Optional(Type.Boolean()) }),
    async run(p, ctx) {
      const lemma = p.lemmatize === false ? p.word.toLowerCase() : await lemmatize(p.word.toLowerCase(), ctx.dict);
      const entry = await ctx.dict.lookup(lemma);
      const term = await getTermByText(ctx.db, lemma);
      const examples = (await ctx.dict.examples?.(lemma)) ?? [];
      const live = term && !term.deleted_at ? term : undefined;
      return { entry, lemma, status: live ? (live.status as Status) : undefined, term_id: term?.id, examples, in_wordbook: !!live?.in_wordbook && live.status >= 0 && live.status <= 4 };
    },
    widget(r) {
      if (!r.entry) return undefined;
      const e = r.entry;
      return { kind: 'word', summary: `${e.word}：${firstLine(e.translation)}`, data: { word: e.word, phonetic: e.phonetic, pos: e.pos, translation: e.translation, example: r.examples[0], in_wordbook: r.in_wordbook } };
    },
  }),
  compare_words: capability({
    name: 'compare_words', description: '近义词对比的材料：各词的词典释义、搭配与用户读过的例句；解释由模型写', perm: 'read',
    params: Type.Object({ words: Type.Array(Type.String(), { minItems: 2, maxItems: 6 }) }),
    async run(p, ctx) {
      const entries = []; const corpus_examples: { word: string; sentence: string; document_id?: string }[] = []; const collocations: Record<string, string[]> = {};
      for (const w of p.words) {
        const lemma = await lemmatize(w.toLowerCase(), ctx.dict);
        const e = await ctx.dict.lookup(lemma); if (e) entries.push(e);
        collocations[lemma] = [];
        const term = await getTermByText(ctx.db, lemma);
        if (term) {
          const rows = await ctx.db.all<{ text: string; document_id: string | null }>('SELECT s.text, tc.document_id FROM term_contexts tc JOIN sentences s ON s.id = tc.sentence_id WHERE tc.term_id = ? AND tc.deleted_at IS NULL LIMIT 3', [term.id]);
          for (const r of rows) corpus_examples.push({ word: lemma, sentence: r.text, document_id: r.document_id ?? undefined });
        }
      }
      return { entries, collocations, corpus_examples };
    },
    widget(r) {
      if (r.entries.length < 2) return undefined;
      return { kind: 'compare', summary: `对比 ${r.entries.map(e => e.word).join('、')}`, data: { words: r.entries.map(e => ({ word: e.word, phonetic: e.phonetic, translation: firstLine(e.translation), example: r.corpus_examples.find(x => x.word === e.word)?.sentence })) } };
    },
  }),
  get_term: capability({
    name: 'get_term', description: '一个词的详情：状态、语境、复习记录。text 和 id 给一个', perm: 'read',
    params: Type.Object({ text: Type.Optional(Type.String()), id: Type.Optional(S.id) }),
    async run(p, ctx) {
      if (!p.id && !p.text) throw new TibiError('invalid_params', 'text 和 id 要给一个');
      const term = p.id ? await getTerm(ctx.db, p.id) : await getTermByText(ctx.db, await lemmatize(p.text!.toLowerCase(), ctx.dict));
      if (!term || term.deleted_at) throw new TibiError('not_found', '找不到这个词');
      return termDetail(ctx.db, ctx.dict, term);
    },
  }),
  remove_terms: capability({
    name: 'remove_terms', description: '管理生词本：把词移出生词本（复习卡一起停），可撤销', perm: 'confirm', undoable: true, mcp: false,
    params: Type.Object({ ids: Type.Array(S.id, { minItems: 1, maxItems: 200 }) }),
    async describe(p, ctx) {
      const rows = await ctx.db.all<{ text_display: string }>(`SELECT text_display FROM terms WHERE id IN (${p.ids.map(() => '?').join(',')})`, p.ids);
      return `移出 ${p.ids.length} 个词：${rows.slice(0, 20).map(r => r.text_display).join('、')}${rows.length > 20 ? ' 等' : ''}`;
    },
    async run(p, ctx) { return { removed: p.ids.length, undo: await removeTerms(ctx, p.ids) }; },
  }),
  list_terms: capability({
    name: 'list_terms', description: '生词本列表（到期 / 逾期 / 新词 / 难词 / 没进步 / 很久没遇见）', perm: 'read',
    params: Type.Object({ view: Type.Optional(Type.Union(VIEWS.filter(v => !['all', 'ignored', 'known', 'mastered'].includes(v)).map(v => Type.Literal(v)))), status: Type.Optional(Type.Array(S.status)), document_id: Type.Optional(S.id), tags: Type.Optional(Type.Array(Type.String())), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }),
    async run(p, ctx) { const r = await listTerms(ctx.db, ctx.dict, { ...p, limit: p.limit ?? 50 } as never); return { items: r.items, counts: r.counts }; },
  }),
  get_term_contexts: capability({
    name: 'get_term_contexts', description: '一个词遇到过的句子；prefer_i1 时只剩一个生词的句子排前面', perm: 'read',
    params: Type.Object({ term_id: S.id, limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })), prefer_i1: Type.Optional(Type.Boolean()) }),
    async run(p, ctx) {
      const term = await getTerm(ctx.db, p.term_id); if (!term) throw new TibiError('not_found', '找不到这个词');
      const d = await termDetail(ctx.db, ctx.dict, term);
      const list: TermContext[] = p.prefer_i1 === false ? [...d.contexts].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)) : d.contexts;
      return list.slice(0, p.limit ?? 10).map(c => ({ source: c.source, sentence_id: c.sentence_id, document_id: c.document_id, document_title: c.document_title, sentence: c.sentence, surface: c.surface, unknown_others: c.unknown_others, meaning_in_context: c.meaning_in_context }));
    },
  }),
  mark_term: capability({
    name: 'mark_term', description: '改一个词的熟练度（0–5、97 标为已知、98 忽略）', perm: 'write', undoable: true,
    params: Type.Object({ term: Type.String(), status: S.status, sentence_id: Type.Optional(S.id) }),
    async run(p, ctx) {
      const lemma = await lemmatize(p.term.toLowerCase(), ctx.dict);
      let term = await getTermByText(ctx.db, lemma);
      if (!term) {
        const r = await addWords(ctx, [{ text: lemma, sentence_id: p.sentence_id }]);
        term = r.created[0] ?? r.existed[0];
        if (!term) throw new TibiError('not_found', '找不到这个词');
      }
      const previous = term.status as Status;
      const r = await applyStatus(ctx, [term.id], p.status as Status, ctx.caller.origin === 'ui' ? 'user' : 'agent');
      return { term_id: term.id, previous, undo: r.undo };
    },
  }),
  add_to_wordbook: capability({
    name: 'add_to_wordbook', description: '把几个词加入生词本（查词典补释义，建复习卡）', perm: 'write', undoable: true,
    params: Type.Object({ words: Type.Array(Type.Object({ text: Type.String(), meaning: Type.Optional(Type.String()), sentence_id: Type.Optional(S.id) }), { minItems: 1, maxItems: 100 }) }),
    async run(p, ctx) { const r = await addWords(ctx, p.words); return { created: r.created.map(t => t.id), existed: r.existed.map(t => t.id), undo: r.undo }; },
  }),
  add_phrase: capability({
    name: 'add_phrase', description: '把句子里的几个词标为短语', perm: 'write', undoable: true,
    params: Type.Object({ text: Type.String(), sentence_id: S.id, surface: Type.String(), meaning: Type.Optional(Type.String()) }),
    async run(p, ctx) { const r = await addPhrase(ctx, p.text, p.sentence_id, p.surface, p.meaning); return { term_id: r.term.id, undo: r.undo }; },
  }),
  set_context_meaning: capability({
    name: 'set_context_meaning', description: '讲解技能把语境释义写回，下次点词直接用', perm: 'write',
    params: Type.Object({ term_id: S.id, sentence_id: S.id, meaning: Type.String({ minLength: 1 }), source: Type.String() }),
    async run(p, ctx) { await setContextMeaning(ctx.db, p.term_id, p.sentence_id, p.meaning); return { ok: true as const }; },
  }),
};
