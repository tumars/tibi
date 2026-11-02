import { now, type Database, type Row } from '../../db/driver.js';
import type { Dict } from '../../dict/types.js';
import type { CardType, QueueItem, Status } from '../../types.js';
import { startOfToday } from '../shared/cards.js';
import { contextMeaning } from '../terms/service.js';
import { fullMeaning, glossSummary } from '../terms/views.js';
import type { CardRow } from './fsrs.js';
import { CARD_COLUMNS } from './fsrs.js';
import { levenshtein } from './grade.js';
import { getSetting, newCardsReviewedToday, termContexts, termForms, toTerm, type ContextRow, type TermRow } from './repo.js';

/**
 * 复习队列（00 §3.3）：先到期、后新词；新词 5 个一组，没在文章里见过的先"初见"再打乱回忆；
 * 题型按熟练度：生词 / 见过 → 选义，眼熟及以上 → 语境填空；识别题（M3）由设置 review.recognize 打开后在生词 / 见过里与选义交替。
 * 没有释义或凑不齐三个选项时，选义 / 识别改出填空：不出只有一两个选项的题。
 */

export const NEW_GROUP = 5;

export interface CardWithTerm { card: CardRow; term: TermRow }

export async function dueCards(db: Database, at: number, limit = 200): Promise<CardWithTerm[]> {
  const rows = await db.all<Row>(`SELECT ${CARD_COLUMNS.split(', ').map(c => `c.${c} AS c_${c}`).join(', ')}, t.*
    FROM cards c JOIN terms t ON t.id = c.term_id
    WHERE c.deleted_at IS NULL AND c.suspended = 0 AND c.state != 0 AND c.due <= ? AND t.deleted_at IS NULL AND t.in_wordbook = 1 AND t.status <= 5
      AND (t.paused_until IS NULL OR t.paused_until <= ?)
    ORDER BY c.due LIMIT ?`, [at, at, limit]);
  return rows.map(split);
}

export async function newCards(db: Database, at: number, limit: number): Promise<CardWithTerm[]> {
  if (limit <= 0) return [];
  const rows = await db.all<Row>(`SELECT ${CARD_COLUMNS.split(', ').map(c => `c.${c} AS c_${c}`).join(', ')}, t.*
    FROM cards c JOIN terms t ON t.id = c.term_id
    WHERE c.deleted_at IS NULL AND c.suspended = 0 AND c.state = 0 AND c.due <= ? AND t.deleted_at IS NULL AND t.in_wordbook = 1 AND t.status <= 5
      AND (t.paused_until IS NULL OR t.paused_until <= ?)
    ORDER BY c.due, c.created_at LIMIT ?`, [at, at, limit]);
  return rows.map(split);
}

function split(r: Row): CardWithTerm {
  const card: Record<string, unknown> = {}; const term: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) { if (k.startsWith('c_')) card[k.slice(2)] = v; else term[k] = v; }
  return { card: card as CardRow, term: term as TermRow };
}

/** 题型选择 */
export function pickCardType(card: CardRow, term: TermRow, recognizeOn: boolean): CardType {
  if (card.forced_type === 'recognize' || card.forced_type === 'choice' || card.forced_type === 'cloze') return card.forced_type;
  if (term.status >= 2) return 'cloze';
  if (recognizeOn && card.reps % 2 === 1) return 'recognize';
  return 'choice';
}

/** 构造一步的题面（语境、答案、提示、选项） */
export async function makeStep(db: Database, dict: Dict, cw: CardWithTerm, card_type: CardType, opts: { intro?: boolean; retry?: 0 | 1 | 2; preferContextId?: string } = {}): Promise<Omit<QueueItem, 'step'>> {
  const { card, term } = cw;
  const contexts = await termContexts(db, term.id);
  let ctx: ContextRow | undefined = opts.preferContextId ? contexts.find(c => c.id === opts.preferContextId) : undefined;
  ctx ??= contexts[0];
  const forms = await termForms(db, term);
  const surface = ctx?.surface?.toLowerCase();
  const answer = surface && !forms.includes(surface) ? [...forms, surface] : forms;
  // 释义优先级：这句里的语境义 > 用户写的释义 > 词典多义摘要 > 短释义；语境义含示例预生成的结果
  const inContext = ctx?.sentence_id ? await contextMeaning(db, term.id, term.text, ctx.sentence_id) : undefined;
  const translation = (await dict.lookup(term.text))?.translation;
  const meaning = firstMeaning(inContext) || firstMeaning(term.meaning) || glossSummary(translation) || term.short_gloss || '';
  const sentence = ctx?.sentence_text ?? ctx?.text ?? `${term.text_display}`;
  const context: QueueItem['context'] = {
    id: ctx?.id ?? '', sentence, answer, ...(ctx?.surface ? { surface: ctx.surface } : {}), translation: ctx?.translation ?? '', source: ctx?.source === 'article' ? 'article' : 'dictionary',
    ...(ctx?.document_title ? { document_title: ctx.document_title } : {}), ...(ctx?.document_id ? { document_id: ctx.document_id } : {}),
  };
  let options: { id: string; text: string; from?: string }[] | undefined;
  if (card_type === 'choice' && !opts.intro && meaning) {
    const distractors = await pickDistractors(db, dict, term, 3, ctx?.document_id ?? undefined, meaning);
    if (distractors.length >= 2) {
      // 正确项只有一个义项（如语境义）时，干扰项也只留首义：不能靠长短认出答案
      const single = !/[，；]/.test(meaning);
      options = shuffle([{ id: 'x', text: meaning }, ...distractors.map(d => ({ id: 'x', text: single ? d.text.split(/[，；]/)[0]! : d.text, from: d.from }))]);
      options.forEach((o, i) => { o.id = 'abcd'[i]!; });
    }
  }
  if (!opts.intro && ((card_type === 'choice' && !options) || (card_type === 'recognize' && !meaning))) card_type = 'cloze';
  const item: Omit<QueueItem, 'step'> = {
    // 用户没写释义时用语境释义或完整词典释义，答完（尤其答错）后答案区才有中文意思可看
    card_id: card.id, term: { ...toTerm(term, card), meaning: term.meaning || inContext || fullMeaning(translation) || meaning }, card_type, is_new: card.state === 0, intro: !!opts.intro, retry: opts.retry ?? 0,
    self_rated: card_type === 'recognize', context, hint: meaning || undefined,
    ...(card.last_review ? { last_review: card.last_review } : {}), ...(term.note ? { note: term.note } : {}),
  };
  if (options) {
    item.options = options;
    (item as QueueItem & { correct_option?: string }).correct_option = options.find(o => !o.from)!.id;
  }
  return item;
}

export function firstMeaning(m: string | null | undefined): string {
  if (!m) return '';
  // 词典释义形如"n. 钮扣, 按钮"、"[医] 库"、"信箱 n"，选项只留前几个义项
  return m.split(/\n|；|;/)[0]!.replace(/\[[^\]]*\]/g, '').replace(/^\s*[a-z]+\.\s*/i, '').replace(/\s+[a-z]+\.?\s*$/i, '').split(/[,，]\s*/).slice(0, 3).join('，').trim().slice(0, 24);
}

/** 词条的短释义：用户写的优先，没有就查词典。取词时大多数词条的 meaning 是空的 */
async function glossOf(dict: Dict, t: TermRow): Promise<string> {
  return firstMeaning(t.meaning) || glossSummary((await dict.lookup(t.text))?.translation) || t.short_gloss || '';
}

/**
 * 选义题干扰项（G2）：同篇文章其他生词 > 易混词（编辑距离 ≤ 2 的生词本词）> 生词本其他词 > 任意词条。
 * 中文释义不重叠；不足时放宽。
 */
export async function pickDistractors(db: Database, dict: Dict, term: TermRow, count = 3, document_id?: string, correct?: string): Promise<{ text: string; from: string; term_id: string }[]> {
  const target = correct ?? await glossOf(dict, term);
  const picked: { text: string; from: string; term_id: string }[] = [];
  const seen = new Set<string>([term.id]);
  const meanings = new Set<string>([target]);
  const take = async (rows: TermRow[], from: string, allowOverlap = false) => {
    for (const r of rows) {
      if (picked.length >= count) break;
      if (seen.has(r.id)) continue;
      const m = await glossOf(dict, r);
      if (!m || meanings.has(m) || (!allowOverlap && overlaps(m, target))) continue;
      seen.add(r.id); meanings.add(m); picked.push({ text: m, from, term_id: r.id });
    }
  };
  if (document_id) {
    const sameDoc = await db.all<TermRow>(`SELECT DISTINCT t.* FROM terms t JOIN term_contexts tc ON tc.term_id = t.id
      WHERE tc.document_id = ? AND t.id != ? AND t.deleted_at IS NULL AND t.status <= 5 ORDER BY random() LIMIT 40`, [document_id, term.id]);
    await take(sameDoc, '同一篇文章');
  }
  if (picked.length < count) {
    const wb = await db.all<TermRow>('SELECT * FROM terms WHERE in_wordbook = 1 AND id != ? AND deleted_at IS NULL ORDER BY random() LIMIT 200', [term.id]);
    const confusable = wb.filter(r => levenshtein(r.text, term.text) <= 2 && r.text !== term.text);
    await take(confusable, '易混词');
    await take(wb, '生词本');
  }
  if (picked.length < count) {
    const any = await db.all<TermRow>('SELECT * FROM terms WHERE id != ? AND deleted_at IS NULL ORDER BY random() LIMIT 60', [term.id]);
    await take(any, '词库');
  }
  if (picked.length < count) {
    // 还不够：放宽释义重叠限制
    const any = await db.all<TermRow>('SELECT * FROM terms WHERE id != ? AND deleted_at IS NULL ORDER BY random() LIMIT 60', [term.id]);
    await take(any, '词库', true);
  }
  return picked;
}

function overlaps(a: string, b: string): boolean {
  if (!a || !b) return false;
  const sa = a.replace(/[^一-龥]/g, ''); const sb = b.replace(/[^一-龥]/g, '');
  if (sa.length < 2 || sb.length < 2) return a === b;
  for (let i = 0; i + 2 <= sa.length; i++) if (sb.includes(sa.slice(i, i + 2))) return true;
  return false;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [arr[i], arr[k]] = [arr[k]!, arr[i]!]; }
  return arr;
}

/** 新词是否需要"初见"：没有 source = article 的语境（G4） */
export async function needsIntro(db: Database, term_id: string): Promise<boolean> {
  const r = await db.get<{ n: number }>("SELECT count(*) AS n FROM term_contexts WHERE term_id = ? AND source = 'article' AND deleted_at IS NULL", [term_id]);
  return Number(r?.n ?? 0) === 0;
}

export interface BuildOptions { ahead?: boolean; limit?: number }

/** 按规则排出一轮的全部步骤 */
export async function buildSteps(db: Database, dict: Dict, opts: BuildOptions = {}): Promise<QueueItem[]> {
  const t = now();
  const recognizeOn = await getSetting<boolean>(db, 'review.recognize', false);
  const profile = await db.get<{ daily_new_cards: number }>("SELECT daily_new_cards FROM user_profile WHERE id = '1'");
  const dailyNew = Number(profile?.daily_new_cards ?? 20);
  const steps: Omit<QueueItem, 'step'>[] = [];
  const due = await dueCards(db, opts.ahead ? t + 86_400_000 : t, opts.limit ?? 200);
  for (const cw of due) steps.push(await makeStep(db, dict, cw, pickCardType(cw.card, cw.term, recognizeOn)));
  const remaining = Math.max(0, dailyNew - await newCardsReviewedToday(db, startOfToday(t)));
  const fresh = await newCards(db, t, Math.min(remaining, opts.limit ?? 200));
  for (let i = 0; i < fresh.length; i += NEW_GROUP) {
    const group = fresh.slice(i, i + NEW_GROUP);
    const introNeeded: CardWithTerm[] = [];
    for (const cw of group) if (await needsIntro(db, cw.term.id)) introNeeded.push(cw);
    for (const cw of introNeeded) steps.push(await makeStep(db, dict, cw, 'choice', { intro: true }));
    const recall = shuffle([...group]);
    for (const cw of recall) steps.push(await makeStep(db, dict, cw, pickCardType(cw.card, cw.term, recognizeOn)));
  }
  return steps.map((s, i) => ({ ...s, step: i }));
}

/** 未来 n 天每天到期的卡数 */
export async function forecast(db: Database, days = 7, from: number = now()): Promise<number[]> {
  const out: number[] = [];
  let start = startOfToday(from);
  for (let i = 0; i < days; i++) {
    const end = start + 86_400_000;
    const r = await db.get<{ n: number }>('SELECT count(*) AS n FROM cards WHERE deleted_at IS NULL AND suspended = 0 AND due >= ? AND due < ?', [i === 0 ? 0 : start, end]);
    out.push(Number(r?.n ?? 0));
    start = end;
  }
  return out;
}

export type { Status };
