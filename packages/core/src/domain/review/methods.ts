import { Type } from '@sinclair/typebox';
import { j, now } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import { method, S, type Ctx, type MethodMap } from '../../rpc/define.js';
import { TibiError, type PracticeMode, type QueueItem, type Rating } from '../../types.js';
import type { PracticeItem } from './practice-types.js';
import { loadParams, preview } from './fsrs.js';
import { buildSteps, forecast, makeStep, pickCardType, shuffle } from './queue.js';
import { getCard, getCardByTerm, getSession, getTerm, insertSession, openSession, saveSession, sessionSteps, termContexts, type TermRow } from './repo.js';
import { answerStep, nextStep, overrideRating, toReviewSession, undoLast } from './session.js';
import { pickDistractors } from './queue.js';
import { levenshtein } from './grade.js';

const answerSchema = Type.Object({ choice: Type.Optional(Type.String()), typed: Type.Optional(Type.String()), self_rating: Type.Optional(S.rating) });

/** 用生词本里的词（或指定的词）出一轮不计分的会话（G7"再练错词"、空状态"用生词出题"） */
async function drillSteps(ctx: Ctx, term_ids: string[] | undefined, count: number, from?: 'session_mistakes'): Promise<QueueItem[]> {
  let ids = term_ids ?? [];
  if (from === 'session_mistakes') {
    const last = await ctx.db.get<{ steps_json: string }>("SELECT steps_json FROM review_sessions WHERE kind = 'review' AND status = 'finished' ORDER BY finished_at DESC LIMIT 1");
    const steps = j.parse<QueueItem[]>(last?.steps_json, []);
    ids = [...new Set(steps.filter(s => s.result && !s.result.correct && s.retry === 0).map(s => s.term.id))];
  }
  if (!ids.length) {
    const rows = await ctx.db.all<{ id: string }>('SELECT t.id FROM terms t JOIN cards c ON c.term_id = t.id WHERE t.in_wordbook = 1 AND t.deleted_at IS NULL AND c.deleted_at IS NULL AND t.status <= 5 ORDER BY random() LIMIT ?', [count]);
    ids = rows.map(r => r.id);
  }
  const out: Omit<QueueItem, 'step'>[] = [];
  for (const id of ids.slice(0, count)) {
    const term = await getTerm(ctx.db, id); const card = await getCardByTerm(ctx.db, id);
    if (!term || !card) continue;
    const type = pickCardType(card, term, false);
    out.push(await makeStep(ctx.db, ctx.dict, { card, term }, type === 'recognize' ? 'choice' : type));
  }
  return shuffle(out).map((s, i) => ({ ...s, step: i }));
}

export const reviewMethods: MethodMap = {
  'review.start': method(Type.Object({ resume: Type.Optional(Type.Boolean()), ahead: Type.Optional(Type.Boolean()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }), async (p, ctx) => {
    const fc = await forecast(ctx.db);
    // 查"有没有未完成的一轮"和新建放在同一个事务里：界面同时发两次 review.start 时，第二次续上第一次建的那轮
    return ctx.db.transaction(async tx => {
      if (p.resume !== false) {
        const open = await openSession(tx);
        if (open) {
          if (open.status === 'paused') await tx.run("UPDATE review_sessions SET status = 'active', updated_at = ? WHERE id = ?", [now(), open.id]);
          return toReviewSession({ ...open, status: 'active' }, sessionSteps(open), true, fc);
        }
      } else {
        // 从头开始：把未完成的那轮标记为结束
        await tx.run("UPDATE review_sessions SET status = 'finished', finished_at = ?, updated_at = ? WHERE kind = 'review' AND status IN ('active', 'paused')", [now(), now()]);
      }
      const steps = await buildSteps(tx, ctx.dict, { ahead: p.ahead, limit: p.limit });
      const s = await insertSession(tx, 'review', true, steps);
      return toReviewSession(s, steps, false, fc);
    });
  }, '默认先续上未完成的会话（G6）；否则按"先到期、后新词，新词 5 个一组先初见再回忆"排好步骤'),

  'review.preview': method(Type.Object({ card_id: S.id }), async (p, ctx) => {
    const card = await getCard(ctx.db, p.card_id);
    if (!card) throw new TibiError('not_found', '卡片不存在');
    return preview(await loadParams(ctx.db), card, now());
  }, '自评题的四个按钮、"改评分"展开时的间隔文案'),

  'review.answer': method(Type.Object({ session_id: S.id, step: Type.Integer({ minimum: 0 }), answer: answerSchema, hints: Type.Integer({ minimum: 0, default: 0 }), duration_ms: Type.Integer({ minimum: 0, default: 0 }) }), async (p, ctx) => {
    return answerStep(ctx, ctx.dict, { ...p, answer: { ...p.answer, self_rating: p.answer.self_rating as Rating | undefined } });
  }, 'Core 判分（G1）；只有首次作答写 review_logs（G3）；答错插入换题型的重练步'),

  'review.override': method(Type.Object({ session_id: S.id, step: Type.Integer({ minimum: 0 }), rating: S.rating }), async (p, ctx) => overrideRating(ctx, p.session_id, p.step, p.rating as Rating), '用户改系统给的评分'),

  'review.next': method(Type.Object({ session_id: S.id, step: Type.Integer({ minimum: 0 }) }), async (p, ctx) => nextStep(ctx, p.session_id, p.step), '推进游标并保存进度'),

  'review.undo': method(Type.Object({ session_id: S.id }), async (p, ctx) => undoLast(ctx, p.session_id), '撤销上一张'),

  'review.pause': method(Type.Object({ session_id: S.id }), async (p, ctx) => {
    const s = await getSession(ctx.db, p.session_id);
    if (!s) throw new TibiError('not_found', '找不到这轮复习');
    if (s.status === 'active') await ctx.db.run("UPDATE review_sessions SET status = 'paused', updated_at = ? WHERE id = ?", [now(), s.id]);
    return { ok: true as const };
  }, '"稍后继续"'),

  'review.quiz': method(Type.Object({ term_ids: Type.Optional(Type.Array(S.id)), count: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 10 })), from: Type.Optional(Type.Literal('session_mistakes')) }), async (p, ctx) => {
    const steps = await drillSteps(ctx, p.term_ids, p.count ?? 10, p.from);
    const s = await insertSession(ctx.db, 'drill', false, steps);
    return toReviewSession(s, steps, false, await forecast(ctx.db));
  }, '不计分的会话（kind = drill）'),

  'review.grade': method(Type.Object({ session_id: S.id, step: Type.Integer(), text: Type.String() }), async () => { throw new TibiError('model_unavailable', '造句批改在 M3 提供'); }, 'M3：造句题交给出题与批改技能'),
  'review.story': method(Type.Object({ term_ids: Type.Array(S.id) }), async () => { throw new TibiError('model_unavailable', '"读一篇用到这些词的短文"在 M2 起提供'); }, 'M2：找文章 / Tibi 写短文'),
  'review.optimize': method(Type.Object({}), async (_p, ctx) => {
    const n = await ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM review_logs_valid');
    if (Number(n?.n ?? 0) < 400) throw new TibiError('conflict', `复习记录不足 400 条（现在 ${n?.n ?? 0} 条），先多复习一些`);
    throw new TibiError('model_unavailable', '参数优化在 M3 提供');
  }, 'M3：按个人记录优化 FSRS 参数'),

  /* ---------- 练习（G8，不计分，最小版） ---------- */
  'practice.start': method(Type.Object({ mode: Type.Union(['dictation', 'spell', 'confusable', 'produce'].map(m => Type.Literal(m))), source: Type.Union(['recent', 'mistakes', 'leech', 'document'].map(m => Type.Literal(m))), document_id: Type.Optional(S.id), count: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 5 })) }), async (p, ctx) => {
    const mode = p.mode as PracticeMode; const count = p.count ?? 5;
    let terms: TermRow[];
    if (p.source === 'document' && p.document_id) terms = await ctx.db.all<TermRow>('SELECT DISTINCT t.* FROM terms t JOIN term_contexts tc ON tc.term_id = t.id WHERE tc.document_id = ? AND t.deleted_at IS NULL AND t.status <= 5 ORDER BY random() LIMIT ?', [p.document_id, count]);
    else if (p.source === 'leech') terms = await ctx.db.all<TermRow>('SELECT t.* FROM terms t JOIN cards c ON c.term_id = t.id WHERE c.lapses >= 3 AND t.deleted_at IS NULL ORDER BY random() LIMIT ?', [count]);
    else if (p.source === 'mistakes') terms = await ctx.db.all<TermRow>('SELECT DISTINCT t.* FROM terms t JOIN cards c ON c.term_id = t.id JOIN review_logs_valid l ON l.card_id = c.id WHERE l.rating = 1 AND l.reviewed_at >= ? AND t.deleted_at IS NULL ORDER BY random() LIMIT ?', [now() - 7 * 86_400_000, count]);
    else terms = await ctx.db.all<TermRow>('SELECT t.* FROM terms t WHERE t.in_wordbook = 1 AND t.deleted_at IS NULL AND t.status <= 5 ORDER BY t.last_seen_at DESC, t.created_at DESC LIMIT ?', [count]);
    const items: PracticeItem[] = [];
    for (const t of terms) {
      const ctxs = await termContexts(ctx.db, t.id);
      const c = ctxs.find(x => x.source === 'article') ?? ctxs[0];
      const sentence = c?.sentence_text ?? c?.text ?? '';
      const meaning = t.short_gloss || (t.meaning ?? '').split(/\n|;/)[0] || '';
      const base: PracticeItem = { id: uuidv7(), mode, sentence, answer: t.text_display, source: { term_id: t.id, ...(c?.document_id ? { document_id: c.document_id } : {}) } };
      if (mode === 'dictation') { if (!sentence) continue; items.push(base); }
      else if (mode === 'spell') items.push({ ...base, sentence: meaning, explain: `${t.text_display.length} 个字母` });
      else if (mode === 'confusable') {
        if (!sentence) continue;
        const others = await ctx.db.all<TermRow>('SELECT * FROM terms WHERE id != ? AND deleted_at IS NULL AND kind = ? ORDER BY random() LIMIT 100', [t.id, t.kind]);
        const near = others.filter(o => levenshtein(o.text, t.text) <= 2)[0] ?? others[0];
        if (!near) continue;
        const pair: [string, string] = Math.random() < 0.5 ? [t.text_display, near.text_display] : [near.text_display, t.text_display];
        items.push({ ...base, sentence: sentence.replace(new RegExp(`\\b${escapeRe(c?.surface ?? t.text_display)}\\b`, 'i'), '____'), options: pair, explain: meaning ? `${t.text_display}：${meaning}` : undefined });
      } else items.push({ ...base, sentence: sentence || meaning, explain: '用这个词写一句话' });
    }
    const practice_id = uuidv7();
    await ctx.db.run('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [`practice.pending.${practice_id}`, j.str({ mode, source: p.source, document_id: p.document_id ?? null, items: items.length, started_at: now() }), now()]);
    return { practice_id, items };
  }, '句子来自用户读过的文章'),

  'practice.finish': method(Type.Object({ practice_id: S.id, results: Type.Array(Type.Object({ item_id: Type.String(), accuracy: Type.Number({ minimum: 0, maximum: 100 }), duration_ms: Type.Integer({ minimum: 0, default: 0 }) })) }), async (p, ctx) => {
    const key = `practice.pending.${p.practice_id}`;
    const pending = await ctx.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    const meta = j.parse<{ mode: PracticeMode; source: string; document_id: string | null; items: number }>(pending?.value, { mode: 'dictation', source: 'recent', document_id: null, items: p.results.length });
    const accuracy = p.results.length ? p.results.reduce((s, r) => s + r.accuracy, 0) / p.results.length : 0;
    const duration_ms = p.results.reduce((s, r) => s + r.duration_ms, 0);
    const t = now();
    await ctx.db.run('INSERT INTO practice_logs(id, mode, source, document_id, items, accuracy, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?)', [p.practice_id, meta.mode, meta.source, meta.document_id, p.results.length, accuracy, duration_ms, t]);
    await ctx.db.run('DELETE FROM settings WHERE key = ?', [key]);
    const best = await ctx.db.get<{ best: number; rounds: number }>("SELECT COALESCE(max(accuracy), 0) AS best, count(*) AS rounds FROM practice_logs WHERE mode = 'dictation'");
    return { practice_id: p.practice_id, accuracy, duration_ms, best: { dictation_accuracy: Number(best?.best ?? 0), rounds: Number(best?.rounds ?? 0) } };
  }, '写 practice_logs，不改 cards / review_logs'),
};

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export { pickDistractors };
