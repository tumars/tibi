import { j, now, type Database } from '../../db/driver.js';
import type { Dict } from '../../dict/types.js';
import type { CardState, CardType, Rating, Status, Term, TermContext, TermDetail } from '../../types.js';
import { TERM_COLS, type TermRow } from './repo.js';
import { startOfToday } from '../shared/cards.js';

/**
 * 生词本的查询（00 §3.3 左栏视图、06 terms.list / terms.get）。
 * 视图：all 在学的词（生词本里 0–4）、due 今天到期（含逾期）、late 逾期、new 本周加入、leech 难词（忘了 ≥ 3 次）、
 * stuck 遇见多但没进步（遇见 ≥ 5 且仍是生词 / 见过）、stale 很久没遇见（30 天）、ignored 98、known 97、mastered 5。
 */
export type View = 'all' | 'due' | 'late' | 'new' | 'leech' | 'stuck' | 'stale' | 'ignored' | 'known' | 'mastered';
export const VIEWS: View[] = ['all', 'due', 'late', 'new', 'leech', 'stuck', 'stale', 'ignored', 'known', 'mastered'];

const DAY = 86_400_000;

export function viewWhere(view: View, t: number = now()): { where: string; params: (string | number)[] } {
  const dayStart = startOfToday(t), dayEnd = dayStart + DAY;
  switch (view) {
    case 'all': return { where: 'tm.in_wordbook = 1 AND tm.status BETWEEN 0 AND 4', params: [] };
    case 'due': return { where: 'tm.in_wordbook = 1 AND tm.status BETWEEN 0 AND 4 AND c.id IS NOT NULL AND c.suspended = 0 AND c.due < ?', params: [dayEnd] };
    case 'late': return { where: 'tm.in_wordbook = 1 AND tm.status BETWEEN 0 AND 4 AND c.id IS NOT NULL AND c.suspended = 0 AND c.due < ?', params: [dayStart] };
    case 'new': return { where: 'tm.in_wordbook = 1 AND tm.status BETWEEN 0 AND 4 AND tm.created_at >= ?', params: [t - 7 * DAY] };
    case 'leech': return { where: 'tm.in_wordbook = 1 AND tm.status BETWEEN 0 AND 4 AND c.lapses >= 3', params: [] };
    case 'stuck': return { where: 'tm.in_wordbook = 1 AND tm.status BETWEEN 0 AND 1 AND tm.encounter_count >= 5', params: [] };
    case 'stale': return { where: 'tm.in_wordbook = 1 AND tm.status BETWEEN 0 AND 4 AND tm.last_seen_at IS NOT NULL AND tm.last_seen_at < ?', params: [t - 30 * DAY] };
    case 'ignored': return { where: 'tm.status = 98', params: [] };
    case 'known': return { where: 'tm.status = 97', params: [] };
    case 'mastered': return { where: 'tm.status = 5', params: [] };
  }
}

export interface ListOpts { view?: View; status?: Status[]; kind?: 'word' | 'phrase'; document_id?: string; tags?: string[]; q?: string; sort?: 'due' | 'added' | 'enc' | 'alpha' | 'stage' | 'freq'; cursor?: string; limit?: number }

interface ListRow extends TermRow { card_id: string | null; due: number | null; lapses: number | null; stability: number | null; doc_count: number }

const BASE = `FROM terms tm LEFT JOIN cards c ON c.term_id = tm.id AND c.deleted_at IS NULL`;

export async function listTerms(db: Database, dict: Dict, opts: ListOpts): Promise<{ items: Term[]; total: number; cursor?: string; counts: Record<string, number> }> {
  const t = now();
  const conds: string[] = ['tm.deleted_at IS NULL'];
  const params: (string | number)[] = [];
  const v = viewWhere(opts.view ?? 'all', t); conds.push(v.where); params.push(...v.params);
  if (opts.status?.length) { conds.push(`tm.status IN (${opts.status.map(() => '?').join(',')})`); params.push(...opts.status); }
  if (opts.kind) { conds.push('tm.kind = ?'); params.push(opts.kind); }
  if (opts.document_id) { conds.push('EXISTS (SELECT 1 FROM term_contexts tc WHERE tc.term_id = tm.id AND tc.document_id = ? AND tc.deleted_at IS NULL)'); params.push(opts.document_id); }
  if (opts.tags?.length) {
    // 词继承来源文章的标签（01 §2）：每个标签都要有一篇来源文章带它
    for (const tag of opts.tags) {
      conds.push(`EXISTS (SELECT 1 FROM term_contexts tc JOIN document_tags dt ON dt.document_id = tc.document_id AND dt.deleted_at IS NULL JOIN tags tg ON tg.id = dt.tag_id WHERE tc.term_id = tm.id AND tc.deleted_at IS NULL AND tg.name = ? COLLATE NOCASE)`);
      params.push(tag);
    }
  }
  if (opts.q) {
    conds.push('(tm.text LIKE ? OR tm.text_display LIKE ? OR tm.meaning LIKE ? OR EXISTS (SELECT 1 FROM term_forms f WHERE f.term_id = tm.id AND f.form LIKE ?) OR EXISTS (SELECT 1 FROM term_contexts tc JOIN sentences s ON s.id = tc.sentence_id WHERE tc.term_id = tm.id AND s.text LIKE ?))');
    const like = `%${opts.q.toLowerCase()}%`; params.push(like, like, like, like, like);
  }
  const where = conds.join(' AND ');
  const order = { due: 'COALESCE(c.due, 9e15) ASC, tm.text', added: 'tm.created_at DESC', enc: 'tm.encounter_count DESC, tm.text', alpha: 'tm.text ASC', stage: 'tm.status ASC, tm.text', freq: 'tm.encounter_count DESC, tm.text' }[opts.sort ?? 'due'];
  const limit = opts.limit ?? 50; const offset = opts.cursor ? Number(opts.cursor) || 0 : 0;
  const total = Number((await db.get<{ n: number }>(`SELECT count(*) AS n ${BASE} WHERE ${where}`, params))?.n ?? 0);
  const rows = await db.all<ListRow>(`SELECT ${TERM_COLS.split(', ').map(c => 'tm.' + c).join(', ')}, c.id AS card_id, c.due, c.lapses, c.stability, (SELECT count(DISTINCT document_id) FROM term_contexts tc WHERE tc.term_id = tm.id AND tc.document_id IS NOT NULL AND tc.deleted_at IS NULL) AS doc_count ${BASE} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const items = await Promise.all(rows.map(r => toTerm(db, dict, r)));
  const counts: Record<string, number> = {};
  for (const view of VIEWS) {
    const w = viewWhere(view, t);
    counts[view] = Number((await db.get<{ n: number }>(`SELECT count(*) AS n ${BASE} WHERE tm.deleted_at IS NULL AND ${w.where}`, w.params))?.n ?? 0);
  }
  return { items, total, cursor: offset + rows.length < total ? String(offset + rows.length) : undefined, counts };
}

export async function toTerm(db: Database, dict: Dict, r: ListRow | TermRow, opts: { withDict?: boolean } = { withDict: true }): Promise<Term> {
  const forms = (await db.all<{ form: string }>('SELECT form FROM term_forms WHERE term_id = ? ORDER BY encounter_count DESC', [r.id])).map(f => f.form);
  const entry = opts.withDict && r.kind === 'word' ? await dict.lookup(r.text) : undefined;
  const tags = (await db.all<{ name: string }>('SELECT DISTINCT tg.name FROM term_contexts tc JOIN document_tags dt ON dt.document_id = tc.document_id AND dt.deleted_at IS NULL JOIN tags tg ON tg.id = dt.tag_id WHERE tc.term_id = ? AND tc.deleted_at IS NULL', [r.id])).map(x => x.name);
  const card = 'card_id' in r && r.card_id ? r : await db.get<{ card_id: string; due: number; lapses: number; stability: number }>('SELECT id AS card_id, due, lapses, stability FROM cards WHERE term_id = ? AND deleted_at IS NULL', [r.id]);
  const doc_count = 'doc_count' in r ? Number(r.doc_count) : Number((await db.get<{ n: number }>('SELECT count(DISTINCT document_id) AS n FROM term_contexts WHERE term_id = ? AND document_id IS NOT NULL AND deleted_at IS NULL', [r.id]))?.n ?? 0);
  return {
    id: r.id, kind: r.kind, text: r.text, display: r.text_display, ipa: entry?.phonetic, meaning: r.meaning ?? fullMeaning(entry?.translation) ?? '', short_gloss: r.short_gloss ?? undefined,
    status: r.status as Status, forms, star: entry?.collins, exam: entry?.exam ?? [], tags, encounter_count: Number(r.encounter_count), doc_count,
    due: card?.due != null ? Number(card.due) : undefined, lapses: Number(card?.lapses ?? 0), added_at: Number(r.created_at), last_seen_at: r.last_seen_at != null ? Number(r.last_seen_at) : undefined,
  };
}

export function firstLine(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  return s.split('\n')[0]!.trim();
}

/** 完整词典释义，排成一行（词卡、列表、导出用）；"n. 编辑者\n[计] 编译程序" → "n. 编辑者；[计] 编译程序" */
export function fullMeaning(s: string | undefined | null): string | undefined {
  return s?.split('\n').map(l => l.trim()).filter(Boolean).join('；') || undefined;
}

/** 题面用的多义摘要：首行前几个义项 + 第一条领域义（没有语境时不替用户猜是哪个意思）；"编辑者；编译程序" */
export function glossSummary(translation: string | undefined | null): string | undefined {
  const lines = translation?.split('\n').map(l => l.trim()).filter(Boolean) ?? [];
  const senses = (l: string) => l.split(/;|；/)[0]!.replace(/\[[^\]]*\]/g, '').replace(/^\s*[a-z]+\.\s*/i, '').replace(/\s+[a-z]+\.?\s*$/i, '').split(/[,，]\s*/).map(s => s.trim()).filter(Boolean);
  const head = lines[0] ? senses(lines[0]).slice(0, 3) : [];
  const domain = lines.slice(1).find(l => /^\[[^\]]+\]/.test(l));
  const extra = domain ? senses(domain)[0] : undefined;
  const text = head.join('，') + (extra && !head.includes(extra) ? `；${extra}` : '');
  return text.slice(0, 24) || undefined;
}

/** 简短释义（2–6 字，行间释义用）：取词典首义去掉词性与分号后面的部分 */
export function shortGloss(translation: string | undefined | null): string | undefined {
  // 首行去掉词性、领域标签和括号后可能是空的（"n. (Monday)"），就往下一行找
  for (const line of translation?.split('\n') ?? []) {
    // 括号里的补充说明先去掉，不然 8 字一截只剩半句："词法单元（token）" → "词法单元"
    const g = line.trim().replace(/^[a-z]+\.\s*/i, '').replace(/^\[[^\]]*\]\s*/, '').replace(/[（(][^）)]*[）)]/g, '').split(/[;，,；、]/)[0]!.trim().slice(0, 8);
    if (g) return g;
  }
  return undefined;
}

export async function termDetail(db: Database, dict: Dict, r: TermRow): Promise<TermDetail> {
  const base = await toTerm(db, dict, r);
  const entry = r.kind === 'word' ? await dict.lookup(r.text) : undefined;
  const ctxRows = await db.all<{ id: string; source: 'article' | 'dictionary' | 'manual'; document_id: string | null; sentence_id: string | null; text: string | null; surface: string | null; meaning_in_context: string | null; is_primary: number; is_favorite: number; sentence_text: string | null; tokens: string | null; document_title: string | null }>(
    `SELECT tc.id, tc.source, tc.document_id, tc.sentence_id, tc.text, tc.surface, tc.meaning_in_context, tc.is_primary, tc.is_favorite, s.text AS sentence_text, s.tokens, d.title AS document_title
     FROM term_contexts tc LEFT JOIN sentences s ON s.id = tc.sentence_id LEFT JOIN documents d ON d.id = tc.document_id WHERE tc.term_id = ? AND tc.deleted_at IS NULL ORDER BY tc.created_at`, [r.id]);
  // i+1：句子里其它词都认识的排前面（Migaku）
  const contexts: TermContext[] = [];
  for (const c of ctxRows) {
    const toks = j.parse<{ l: string; status?: number }[]>(c.tokens, []);
    const others = toks.filter(tk => tk.l !== r.text);
    const lemmas = [...new Set(others.map(tk => tk.l))];
    let unknown_others = 0;
    if (lemmas.length) {
      const rows = await db.all<{ text: string; status: number }>(`SELECT text, status FROM terms WHERE kind = 'word' AND deleted_at IS NULL AND text IN (${lemmas.map(() => '?').join(',')})`, lemmas);
      unknown_others = rows.filter(x => x.status === 0 || x.status === 1).length;
    }
    contexts.push({ id: c.id, source: c.source, document_id: c.document_id ?? undefined, document_title: c.document_title ?? undefined, sentence_id: c.sentence_id ?? undefined, sentence: c.sentence_text ?? c.text ?? '', surface: c.surface ?? undefined, meaning_in_context: c.meaning_in_context ?? undefined, is_primary: !!c.is_primary, is_favorite: !!c.is_favorite, unknown_others });
  }
  contexts.sort((a, b) => a.unknown_others - b.unknown_others || (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
  const cardRow = await db.get<{ id: string; state: number; due: number; stability: number; difficulty: number; reps: number; lapses: number; suspended: number; forced_type: string | null }>('SELECT id, state, due, stability, difficulty, reps, lapses, suspended, forced_type FROM cards WHERE term_id = ? AND deleted_at IS NULL', [r.id]);
  const card: CardState | undefined = cardRow ? { card_id: cardRow.id, term_id: r.id, state: cardRow.state as 0 | 1 | 2 | 3, due: Number(cardRow.due), stability: Number(cardRow.stability), difficulty: Number(cardRow.difficulty), reps: Number(cardRow.reps), lapses: Number(cardRow.lapses), suspended: !!cardRow.suspended, forced_type: (cardRow.forced_type as CardType | null) ?? undefined } : undefined;
  const reviews = cardRow ? (await db.all<{ rating: number; card_type: string; reviewed_at: number }>('SELECT rating, card_type, reviewed_at FROM review_logs_valid WHERE card_id = ? ORDER BY reviewed_at DESC LIMIT 20', [cardRow.id])).map(x => ({ rating: x.rating as Rating, card_type: x.card_type as CardType, reviewed_at: Number(x.reviewed_at) })) : [];
  const history = (await db.all<{ status: number; created_at: number; source: string }>('SELECT status, created_at, source FROM term_status_log WHERE term_id = ? ORDER BY created_at', [r.id])).map(x => ({ status: x.status as Status, at: Number(x.created_at), source: x.source }));
  return { ...base, en: entry?.definition ? firstLine(entry.definition) : undefined, note: r.note ?? undefined, contexts, card, reviews, history };
}
