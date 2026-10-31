import { Type } from '@sinclair/typebox';
import { now } from '../../db/driver.js';
import { capability, S, type CapabilityMap } from '../../rpc/define.js';
import { TibiError, type AnswerResult, type CardType, type Rating } from '../../types.js';
import { loadParams, retention } from './fsrs.js';
import { gradeAnswer, judgeTyped, normalizeAnswer } from './grade.js';
import { forecast, makeStep, pickCardType, pickDistractors, shuffle } from './queue.js';
import { getCard, getCardByTerm, getTerm, termContexts } from './repo.js';
import { applyRating } from './session.js';
import { startOfToday } from '../shared/cards.js';

/** 复习相关的能力（06 §5）：技能、MCP、界面共用 */
export const reviewCapabilities: CapabilityMap = {
  get_review_stats: capability({
    name: 'get_review_stats', description: '复习概况：到期、逾期、可学新词、今日复习、记得率、连续天数、7 天预测、难词数', perm: 'read',
    params: Type.Object({ range: Type.Optional(Type.Union([Type.Literal(7), Type.Literal(30), Type.Literal(90)])) }),
    async run(p, ctx) {
      const t = now(); const day = startOfToday(t); const range = p.range ?? 30;
      const q = async (sql: string, params: unknown[] = []) => Number((await ctx.db.get<{ n: number }>(sql, params as never))?.n ?? 0);
      const due = await q('SELECT count(*) AS n FROM cards WHERE deleted_at IS NULL AND suspended = 0 AND state != 0 AND due <= ?', [t]);
      const overdue = await q('SELECT count(*) AS n FROM cards WHERE deleted_at IS NULL AND suspended = 0 AND state != 0 AND due < ?', [day]);
      const new_available = await q('SELECT count(*) AS n FROM cards WHERE deleted_at IS NULL AND suspended = 0 AND state = 0');
      const today_reviews = await q('SELECT count(*) AS n FROM review_logs WHERE reviewed_at >= ?', [day]);
      const logs = await ctx.db.get<{ n: number; ok: number }>('SELECT count(*) AS n, COALESCE(sum(CASE WHEN rating > 1 THEN 1 ELSE 0 END), 0) AS ok FROM review_logs WHERE reviewed_at >= ?', [t - range * 86_400_000]);
      const leeches = await q('SELECT count(*) AS n FROM cards WHERE deleted_at IS NULL AND lapses >= 3');
      const days = await ctx.db.all<{ d: number }>('SELECT DISTINCT (reviewed_at / 86400000) AS d FROM review_logs ORDER BY d DESC LIMIT 400');
      let streak = 0; let cur = Math.floor(day / 86_400_000);
      const set = new Set(days.map(r => Math.floor(Number(r.d))));
      if (!set.has(cur)) cur -= 1;
      while (set.has(cur)) { streak++; cur--; }
      return { due, overdue, new_available, today_reviews, retention: logs && Number(logs.n) ? Number(logs.ok) / Number(logs.n) : 0, streak, forecast: await forecast(ctx.db), leeches };
    },
  }),

  pick_distractors: capability({
    name: 'pick_distractors', description: '选义题干扰项（G2）：同词性同难度、中文不重叠；优先同一篇文章里的生词、易混词、生词本里的词', perm: 'read',
    params: Type.Object({ term_id: S.id, card_type: Type.Literal('choice'), count: Type.Optional(Type.Integer({ minimum: 1, maximum: 8, default: 3 })) }),
    async run(p, ctx) {
      const term = await getTerm(ctx.db, p.term_id);
      if (!term) throw new TibiError('not_found', '词条不存在');
      const c = (await termContexts(ctx.db, term.id)).find(x => x.document_id);
      const options = await pickDistractors(ctx.db, ctx.dict, term, p.count ?? 3, c?.document_id ?? undefined);
      return { options: options.map(o => ({ text: o.text, from: o.from })) };
    },
  }),

  grade_answer: capability({
    name: 'grade_answer', description: '规则判定 + 系统评分（G1）', perm: 'read',
    params: Type.Object({ term_id: S.id, card_type: Type.Union(['recognize', 'choice', 'cloze', 'dictation', 'spell', 'confusable', 'produce'].map(s => Type.Literal(s))), expected: Type.Array(Type.String()), answer: Type.String(), hints: Type.Optional(Type.Integer({ minimum: 0, default: 0 })), duration_ms: Type.Optional(Type.Integer({ minimum: 0, default: 0 })) }),
    async run(p) {
      const typed = ['cloze', 'dictation', 'spell', 'produce'].includes(p.card_type);
      const judged = typed ? judgeTyped(p.expected, p.answer) : { correct: p.expected.map(normalizeAnswer).includes(normalizeAnswer(p.answer)), near_miss: false as boolean, distance: undefined as number | undefined };
      const issues: ('missing_target' | 'wrong_form' | 'too_short')[] = [];
      let uses_target = true;
      if (p.card_type === 'produce') {
        const words = normalizeAnswer(p.answer).split(' ');
        uses_target = p.expected.some(e => words.includes(normalizeAnswer(e)));
        if (!uses_target) issues.push(p.expected.some(e => words.some(w => w.startsWith(normalizeAnswer(e).slice(0, 4)))) ? 'wrong_form' : 'missing_target');
        if (words.length < 4) issues.push('too_short');
        judged.correct = uses_target && words.length >= 4;
      }
      const { rating, reason } = gradeAnswer({ card_type: p.card_type as never, correct: judged.correct, near_miss: judged.near_miss, hints: p.hints ?? 0, duration_ms: p.duration_ms ?? 0 });
      return { correct: judged.correct, near_miss: judged.near_miss, distance: judged.distance, rating, reason, uses_target, issues };
    },
  }),

  record_review: capability({
    name: 'record_review', description: '记一次复习结果并排期（只记首次作答，G3）', perm: 'write', undoable: true, replay: 'never',
    params: Type.Object({ card_id: S.id, card_type: S.cardType, rating: S.rating, suggested_rating: Type.Optional(S.rating), auto: Type.Boolean(), hints: Type.Optional(Type.Integer({ minimum: 0, default: 0 })), context_id: Type.Optional(S.id), typed: Type.Optional(Type.String()), duration_ms: Type.Optional(Type.Integer({ minimum: 0, default: 0 })), session_id: Type.Optional(S.id) }),
    async run(p, ctx): Promise<AnswerResult> {
      const card = await getCard(ctx.db, p.card_id);
      if (!card) throw new TibiError('not_found', '卡片不存在');
      const term = await getTerm(ctx.db, card.term_id);
      if (!term) throw new TibiError('not_found', '词条不存在');
      const ctxs = await termContexts(ctx.db, term.id);
      const c = (p.context_id ? ctxs.find(x => x.id === p.context_id) : undefined) ?? ctxs[0];
      const stepLike = { card_id: card.id, card_type: p.card_type as CardType, term: { id: term.id } as never, context: { id: c?.id ?? '', sentence: c?.sentence_text ?? c?.text ?? '', answer: [term.text], translation: '', source: 'article' as const } };
      const applied = await ctx.db.transaction(tx => applyRating(tx, { ...ctx, db: tx }, stepLike, p.rating as Rating, { suggested: p.suggested_rating as Rating | undefined, hints: p.hints ?? 0, duration_ms: p.duration_ms ?? 0, auto: p.auto, correct: p.rating > 1, session_id: p.session_id, t: now() }));
      return { step: -1, correct: p.rating > 1, near_miss: false, rating: p.rating as Rating, auto: p.auto, ...applied.result, undo: applied.result.undo! };
    },
  }),

  create_quiz: capability({
    name: 'create_quiz', description: '临时练习题，不影响 FSRS 排期', perm: 'read',
    params: Type.Object({ term_ids: Type.Optional(Type.Array(S.id)), count: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 5 })), types: Type.Optional(Type.Array(S.cardType)), document_id: Type.Optional(S.id) }),
    async run(p, ctx) {
      let ids = p.term_ids ?? [];
      if (!ids.length) {
        const rows = p.document_id
          ? await ctx.db.all<{ id: string }>('SELECT DISTINCT t.id FROM terms t JOIN term_contexts tc ON tc.term_id = t.id WHERE tc.document_id = ? AND t.deleted_at IS NULL AND t.status <= 5 ORDER BY random() LIMIT ?', [p.document_id, p.count ?? 5])
          : await ctx.db.all<{ id: string }>('SELECT id FROM terms WHERE in_wordbook = 1 AND deleted_at IS NULL AND status <= 5 ORDER BY random() LIMIT ?', [p.count ?? 5]);
        ids = rows.map(r => r.id);
      }
      const items = [];
      for (const id of ids.slice(0, p.count ?? 50)) {
        const term = await getTerm(ctx.db, id); if (!term) continue;
        let card = await getCardByTerm(ctx.db, id);
        card ??= { id: '', term_id: id, due: 0, stability: 0, stability_fast: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, forced_type: null, state: 0, last_review: null, suspended: 0, created_at: 0, updated_at: 0, deleted_at: null };
        const allowed = (p.types?.length ? p.types : ['choice', 'cloze']) as CardType[];
        let type = pickCardType(card, term, false);
        if (!allowed.includes(type)) type = allowed[0]!;
        const step = await makeStep(ctx.db, ctx.dict, { card, term }, type);
        items.push({ term_id: id, term: term.text_display, card_type: type, prompt: type === 'cloze' ? step.context.sentence.replace(new RegExp(`\\b${term.text_display.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), '____') : step.context.sentence, answer: type === 'choice' ? [step.options!.find(o => o.id === (step as { correct_option?: string }).correct_option)!.text] : step.context.answer, options: step.options?.map(o => ({ text: o.text, from: o.from })), context: step.context.id ? { sentence_id: step.context.id, sentence: step.context.sentence } : undefined });
      }
      return { items: shuffle(items) };
    },
  }),
};

export async function cardRetention(ctx: { db: import('../../db/driver.js').Database }, card_id: string): Promise<number> {
  const card = await getCard(ctx.db, card_id);
  return card ? retention(await loadParams(ctx.db), card, now()) : 0;
}
