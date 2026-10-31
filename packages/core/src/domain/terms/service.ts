import { j, now, type Database } from '../../db/driver.js';
import type { Dict } from '../../dict/types.js';
import type { Ctx } from '../../rpc/define.js';
import { TibiError, type Status, type Undo } from '../../types.js';
import { ensureCard, newCardsToday, startOfToday } from '../shared/cards.js';
import { recordUndo, registerUndo } from '../shared/undo.js';
import { lemmatize } from '../text/lemma.js';
import { prelabel } from '../text/prelabel.js';
import { getTerm, getTermByText, insertContext, insertTerm, readProfile, setTermStatus, hasPrimaryContext, contextExists, type TermRow } from './repo.js';
import { shortGloss } from './views.js';

/** 词汇的写操作（R5 点词、改状态、加入生词本、短语、暂停、移出），都带审计与撤销 */

const DAY = 86_400_000;

/** 每日新卡上限之外的卡排到后面几天：第 k 张超出的卡顺延 ceil(k / limit) 天 */
export async function dueForNewCard(db: Database, limit: number, t: number = now()): Promise<number> {
  const made = await newCardsToday(db, startOfToday(t));
  if (made < limit) return t;
  const over = made - limit + 1;
  return startOfToday(t) + Math.ceil(over / Math.max(1, limit)) * DAY;
}

/**
 * 点词（terms.lookup 的写部分，R5）：status = 0 的词（含规则判为生词、还没有行的词）自动设为 1 并建卡；
 * 99 / 97 / 98 / 其他不变；规则判为已知的词不写入。返回 status_change 与是否建卡。
 */
export async function touchOnLookup(db: Database, dict: Dict, lemma: string, display: string, document_id: string | null): Promise<{ term?: TermRow; status_change?: { from: Status; to: Status }; card_created: boolean }> {
  const profile = await readProfile(db);
  let term = await getTermByText(db, lemma);
  if (!term) {
    const rank = await dict.frequencyRank(lemma);
    if (prelabel(rank, profile.vocab_estimate) !== 'new') return { card_created: false };    // 规则判为已知 / 待确认但没行：不写入
    const entry = await dict.lookup(lemma);
    term = await insertTerm(db, { text: lemma, display, status: 0, status_source: 'auto_rule', short_gloss: shortGloss(entry?.translation), seen_at: now() });
  }
  if (term.status !== 0) return { term, card_created: false };
  const prev = await setTermStatus(db, term, 1, 'lookup', { document_id, in_wordbook: true });
  const due = await dueForNewCard(db, profile.daily_new_cards);
  const { created } = await ensureCard(db, term.id, { due });
  return { term: (await getTerm(db, term.id))!, status_change: { from: prev, to: 1 }, card_created: created };
}

export interface StatusChange { id: string; from: Status; from_source: string; in_wordbook: number; card_suspended: number | null }

/** 改熟练度（terms.setStatus、mark_term）：5 / 97 / 98 暂停卡片，97 不建卡；0–4 加入生词本并建卡 */
export async function applyStatus(ctx: Ctx, ids: string[], status: Status, source: string, document_id: string | null = null): Promise<{ changed: number; undo: Undo; changes: StatusChange[] }> {
  const db = ctx.db;
  const changes: StatusChange[] = [];
  await db.transaction(async tx => {
    for (const id of ids) {
      const term = await getTerm(tx, id);
      if (!term || term.deleted_at) continue;
      const card = await tx.get<{ suspended: number }>('SELECT suspended FROM cards WHERE term_id = ? AND deleted_at IS NULL', [id]);
      changes.push({ id, from: term.status as Status, from_source: term.status_source, in_wordbook: term.in_wordbook, card_suspended: card ? card.suspended : null });
      const toWordbook = status >= 0 && status <= 4;
      await setTermStatus(tx, term, status, source, { document_id, in_wordbook: toWordbook ? true : undefined });
      if (toWordbook) {
        const profile = await readProfile(tx);
        await ensureCard(tx, id, { due: await dueForNewCard(tx, profile.daily_new_cards) });
        await tx.run('UPDATE cards SET suspended = 0, updated_at = ? WHERE term_id = ? AND deleted_at IS NULL', [now(), id]);
      } else {
        await tx.run('UPDATE cards SET suspended = 1, updated_at = ? WHERE term_id = ? AND deleted_at IS NULL', [now(), id]);
      }
    }
  });
  const undo = await recordUndo(db, ctx, { tool: 'terms.setStatus', args: { ids, status, source }, undo_payload: { changes } });
  if (changes.length) {
    ctx.events.emit('data.changed', { table: 'terms', ids: changes.map(c => c.id) });
    ctx.events.emit('data.changed', { table: 'cards', ids: changes.map(c => c.id) });
  }
  return { changed: changes.length, undo, changes };
}

registerUndo<{ changes: StatusChange[] }>('terms.setStatus', async (p, ctx) => {
  for (const c of p.changes) {
    const t = now();
    await ctx.db.run('UPDATE terms SET status = ?, status_source = ?, in_wordbook = ?, status_changed_at = ?, updated_at = ? WHERE id = ?', [c.from, c.from_source, c.in_wordbook, t, t, c.id]);
    await ctx.db.run('INSERT INTO term_status_log(id, term_id, status, source, created_at) VALUES (?,?,?,?,?)', [crypto.randomUUID(), c.id, c.from, 'undo', t]);
    if (c.card_suspended !== null) await ctx.db.run('UPDATE cards SET suspended = ?, updated_at = ? WHERE term_id = ? AND deleted_at IS NULL', [c.card_suspended, t, c.id]);
    else await ctx.db.run('UPDATE cards SET deleted_at = ?, updated_at = ? WHERE term_id = ? AND deleted_at IS NULL AND reps = 0', [t, t, c.id]);
  }
  ctx.events.emit('data.changed', { table: 'terms', ids: p.changes.map(c => c.id) });
});

/** 生词本"添加"（terms.add / add_to_wordbook）：查词典补释义，用词典例句做语境 */
export async function addWords(ctx: Ctx, entries: { text: string; meaning?: string; sentence_id?: string }[]): Promise<{ created: TermRow[]; existed: TermRow[]; undo: Undo }> {
  const created: TermRow[] = []; const existed: TermRow[] = [];
  const profile = await readProfile(ctx.db);
  await ctx.db.transaction(async tx => {
    for (const e of entries) {
      const raw = e.text.trim(); if (!raw) continue;
      const isPhrase = /\s/.test(raw);
      const lemma = isPhrase ? raw.toLowerCase().replace(/\s+/g, ' ') : await lemmatize(raw.toLowerCase(), ctx.dict);
      let term = await getTermByText(tx, lemma, isPhrase ? 'phrase' : 'word');
      if (term && term.deleted_at == null && term.in_wordbook && term.status >= 0 && term.status <= 4) { existed.push(term); continue; }
      const entry = isPhrase ? undefined : await ctx.dict.lookup(lemma);
      if (!term) {
        term = await insertTerm(tx, { kind: isPhrase ? 'phrase' : 'word', text: lemma, display: isPhrase ? raw : lemma, status: 0, status_source: 'user', meaning: e.meaning, short_gloss: shortGloss(entry?.translation), in_wordbook: true });
        await tx.run('INSERT INTO term_status_log(id, term_id, status, source, created_at) VALUES (?,?,?,?,?)', [crypto.randomUUID(), term.id, 0, 'user', now()]);
      } else {
        await setTermStatus(tx, term, term.status >= 0 && term.status <= 4 ? (term.status as Status) : 0, 'user', { in_wordbook: true });
        if (e.meaning) await tx.run('UPDATE terms SET meaning = ?, updated_at = ? WHERE id = ?', [e.meaning, now(), term.id]);
        term = (await getTerm(tx, term.id))!;
      }
      if (e.sentence_id) {
        if (!(await contextExists(tx, term.id, e.sentence_id))) {
          const s = await tx.get<{ section_id: string }>('SELECT section_id FROM sentences WHERE id = ?', [e.sentence_id]);
          const doc = s ? await tx.get<{ document_id: string }>('SELECT document_id FROM sections WHERE id = ?', [s.section_id]) : undefined;
          await insertContext(tx, { term_id: term.id, source: 'article', sentence_id: e.sentence_id, document_id: doc?.document_id ?? null, is_primary: !(await hasPrimaryContext(tx, term.id)) });
        }
      } else if (!(await hasPrimaryContext(tx, term.id))) {
        const ex = (await ctx.dict.examples?.(lemma))?.[0];
        if (ex) await insertContext(tx, { term_id: term.id, source: 'dictionary', text: ex.en, is_primary: true });
      }
      await ensureCard(tx, term.id, { due: await dueForNewCard(tx, profile.daily_new_cards) });
      created.push(term);
    }
  });
  const undo = await recordUndo(ctx.db, ctx, { tool: 'terms.add', args: { entries }, undo_payload: { ids: created.map(t => t.id) } });
  if (created.length) ctx.events.emit('data.changed', { table: 'terms', ids: created.map(t => t.id) });
  return { created, existed, undo };
}

registerUndo<{ ids: string[] }>('terms.add', async (p, ctx) => {
  const t = now();
  for (const id of p.ids) {
    await ctx.db.run('UPDATE terms SET in_wordbook = 0, updated_at = ? WHERE id = ?', [t, id]);
    await ctx.db.run('UPDATE cards SET deleted_at = ?, updated_at = ? WHERE term_id = ? AND deleted_at IS NULL', [t, t, id]);
  }
  ctx.events.emit('data.changed', { table: 'terms', ids: p.ids });
});

/** 标为短语（terms.addPhrase / add_phrase）：选中的几个词成一条 phrase，之后全文自动识别 */
export async function addPhrase(ctx: Ctx, text: string, sentence_id: string, surface: string, meaning?: string): Promise<{ term: TermRow; undo: Undo }> {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!/\s/.test(norm)) throw new TibiError('invalid_params', '短语至少要两个词');
  const profile = await readProfile(ctx.db);
  let term: TermRow | undefined;
  await ctx.db.transaction(async tx => {
    term = await getTermByText(tx, norm, 'phrase');
    if (!term) {
      term = await insertTerm(tx, { kind: 'phrase', text: norm, display: text.trim(), status: 1, status_source: 'user', meaning, in_wordbook: true, seen_at: now() });
      await tx.run('INSERT INTO term_status_log(id, term_id, status, source, created_at) VALUES (?,?,?,?,?)', [crypto.randomUUID(), term.id, 1, 'user', now()]);
    }
    const s = await tx.get<{ section_id: string }>('SELECT section_id FROM sentences WHERE id = ?', [sentence_id]);
    if (!s) throw new TibiError('not_found', '找不到这句话');
    const doc = await tx.get<{ document_id: string }>('SELECT document_id FROM sections WHERE id = ?', [s.section_id]);
    if (!(await contextExists(tx, term.id, sentence_id))) await insertContext(tx, { term_id: term.id, source: 'article', sentence_id, document_id: doc?.document_id ?? null, surface, is_primary: !(await hasPrimaryContext(tx, term.id)) });
    await tx.run('UPDATE terms SET encounter_count = encounter_count + 1, last_seen_at = ?, updated_at = ? WHERE id = ?', [now(), now(), term.id]);
    await ensureCard(tx, term.id, { due: await dueForNewCard(tx, profile.daily_new_cards) });
  });
  const undo = await recordUndo(ctx.db, ctx, { tool: 'terms.addPhrase', args: { text, sentence_id }, undo_payload: { id: term!.id } });
  ctx.events.emit('data.changed', { table: 'terms', ids: [term!.id] });
  return { term: term!, undo };
}
registerUndo<{ id: string }>('terms.addPhrase', async (p, ctx) => {
  const t = now();
  await ctx.db.run('UPDATE terms SET deleted_at = ?, in_wordbook = 0, updated_at = ? WHERE id = ?', [t, t, p.id]);
  await ctx.db.run('UPDATE term_contexts SET deleted_at = ?, updated_at = ? WHERE term_id = ?', [t, t, p.id]);
  await ctx.db.run('UPDATE cards SET deleted_at = ?, updated_at = ? WHERE term_id = ? AND deleted_at IS NULL', [t, t, p.id]);
});

/** 难词暂停复习 N 天 */
export async function pauseTerms(ctx: Ctx, ids: string[], days: number): Promise<{ changed: number; undo: Undo }> {
  const until = now() + days * DAY;
  const prev = await ctx.db.all<{ id: string; paused_until: number | null }>(`SELECT id, paused_until FROM terms WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await ctx.db.run(`UPDATE terms SET paused_until = ?, updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`, [until, now(), ...ids]);
  const undo = await recordUndo(ctx.db, ctx, { tool: 'terms.pause', args: { ids, days }, undo_payload: { prev } });
  ctx.events.emit('data.changed', { table: 'terms', ids });
  return { changed: prev.length, undo };
}
registerUndo<{ prev: { id: string; paused_until: number | null }[] }>('terms.pause', async (p, ctx) => {
  for (const r of p.prev) await ctx.db.run('UPDATE terms SET paused_until = ?, updated_at = ? WHERE id = ?', [r.paused_until, now(), r.id]);
});

/** 移出生词本：in_wordbook = 0，卡片软删，review_logs 保留 */
export async function removeTerms(ctx: Ctx, ids: string[]): Promise<Undo> {
  const t = now();
  const prev = await ctx.db.all<{ id: string; in_wordbook: number }>(`SELECT id, in_wordbook FROM terms WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await ctx.db.transaction(async tx => {
    await tx.run(`UPDATE terms SET in_wordbook = 0, updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`, [t, ...ids]);
    await tx.run(`UPDATE cards SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND term_id IN (${ids.map(() => '?').join(',')})`, [t, t, ...ids]);
  });
  const undo = await recordUndo(ctx.db, ctx, { tool: 'terms.remove', args: { ids }, undo_payload: { prev } });
  ctx.events.emit('data.changed', { table: 'terms', ids });
  ctx.events.emit('data.changed', { table: 'cards', ids });
  return undo;
}
registerUndo<{ prev: { id: string; in_wordbook: number }[] }>('terms.remove', async (p, ctx) => {
  const t = now();
  for (const r of p.prev) {
    await ctx.db.run('UPDATE terms SET in_wordbook = ?, updated_at = ? WHERE id = ?', [r.in_wordbook, t, r.id]);
    await ctx.db.run('UPDATE cards SET deleted_at = NULL, updated_at = ? WHERE term_id = ?', [t, r.id]);
  }
});

/** 讲解技能把语境释义写回（set_context_meaning） */
export async function setContextMeaning(db: Database, term_id: string, sentence_id: string, meaning: string): Promise<void> {
  const t = now();
  const r = await db.run('UPDATE term_contexts SET meaning_in_context = ?, updated_at = ? WHERE term_id = ? AND sentence_id = ? AND deleted_at IS NULL', [meaning, t, term_id, sentence_id]);
  if (!r.changes) {
    const s = await db.get<{ section_id: string }>('SELECT section_id FROM sentences WHERE id = ?', [sentence_id]);
    const doc = s ? await db.get<{ document_id: string }>('SELECT document_id FROM sections WHERE id = ?', [s.section_id]) : undefined;
    await insertContext(db, { term_id, source: 'article', sentence_id, document_id: doc?.document_id ?? null, meaning_in_context: meaning, is_primary: !(await hasPrimaryContext(db, term_id)) });
  }
}

/** 语境释义缓存：先看 term_contexts，再看内置示例预生成的 ai_results（scope = sentence, task = context_meanings） */
export async function contextMeaning(db: Database, term_id: string | undefined, lemma: string, sentence_id: string): Promise<string | undefined> {
  if (term_id) {
    const c = await db.get<{ meaning_in_context: string | null }>('SELECT meaning_in_context FROM term_contexts WHERE term_id = ? AND sentence_id = ? AND deleted_at IS NULL', [term_id, sentence_id]);
    if (c?.meaning_in_context) return c.meaning_in_context;
  }
  const ai = await db.get<{ output: string }>("SELECT output FROM ai_results WHERE scope = 'sentence' AND target_id = ? AND task = 'context_meanings' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [sentence_id]);
  if (ai) { const m = j.parse<Record<string, string>>(ai.output, {}); if (m[lemma]) return m[lemma]; }
  return undefined;
}
