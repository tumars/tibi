import { now } from '../../db/driver.js';
import type { Ctx } from '../../rpc/define.js';
import { TibiError, type Status } from '../../types.js';
import { lemmatize } from '../text/lemma.js';
import { shortGloss } from './views.js';
import { getTermByText, insertTerm, logStatus, setTermStatus } from './repo.js';
import { addWords } from './service.js';

/**
 * 生词本导出 / 导入（00 §3.3、06 terms.export / terms.import，M3）。
 * 导出只生成文本，由壳的 save_text_file 存盘（Core 不写文件，R11）：
 * - csv：UTF-8 带 BOM，Excel 直接打开；
 * - anki：Anki"导入文件"认的纯文本（制表符分隔，带 #separator/#html/#columns 头），正面是词与音标，背面是释义和原句；
 * - txt：每行一个词。
 * 导入读用户选的文件（路径经壳登记）：known = 已知词表，直接标为已知（97）；txt / csv / anki = 加进生词本（可带释义）。
 */
const STATUS: Record<number, string> = { 0: '生词', 1: '见过', 2: '眼熟', 3: '认得', 4: '熟悉', 5: '掌握', 97: '已知', 98: '忽略', 99: '待确认' };
const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const tsvCell = (v: unknown) => (v == null ? '' : String(v)).replace(/[\t\r\n]+/g, ' ');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = (t?: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : '');

interface Row extends Record<string, string | number | null> { id: string; text: string; text_display: string; kind: string; status: number; meaning: string | null; short_gloss: string | null; encounter_count: number; created_at: number; due: number | null; sentence: string | null; surface: string | null; translation: string | null; title: string | null }

export async function exportTerms(ctx: Ctx, o: { format: 'csv' | 'anki' | 'txt'; ids?: string[]; with_contexts?: boolean }): Promise<{ filename: string; text: string; count: number }> {
  const where = o.ids?.length ? `t.id IN (${o.ids.map(() => '?').join(',')})` : 't.in_wordbook = 1';
  const rows = await ctx.db.all<Row>(`SELECT t.id, t.text, t.text_display, t.kind, t.status, t.meaning, t.short_gloss, t.encounter_count, t.created_at,
      (SELECT c.due FROM cards c WHERE c.term_id = t.id AND c.deleted_at IS NULL LIMIT 1) AS due,
      s.text AS sentence, tc.surface, s.translation, d.title
    FROM terms t
    LEFT JOIN term_contexts tc ON tc.id = (SELECT id FROM term_contexts WHERE term_id = t.id AND deleted_at IS NULL ORDER BY is_primary DESC, created_at LIMIT 1)
    LEFT JOIN sentences s ON s.id = tc.sentence_id
    LEFT JOIN documents d ON d.id = tc.document_id
    WHERE t.deleted_at IS NULL AND ${where} ORDER BY t.created_at`, o.ids ?? []);
  const withCtx = o.with_contexts !== false;
  const meaning = (r: Row) => r.meaning || r.short_gloss || '';
  const stamp = new Date().toISOString().slice(0, 10);
  if (o.format === 'txt') return { filename: `tibi-words-${stamp}.txt`, text: rows.map(r => r.text_display || r.text).join('\n') + '\n', count: rows.length };
  if (o.format === 'csv') {
    const head = ['word', 'meaning', 'status', 'encounters', 'added', 'next_review', ...(withCtx ? ['sentence', 'translation', 'source'] : [])];
    const lines = rows.map(r => [r.text_display || r.text, meaning(r), STATUS[r.status] ?? r.status, r.encounter_count, day(r.created_at), day(r.due), ...(withCtx ? [r.sentence ?? '', r.translation ?? '', r.title ?? ''] : [])].map(csvCell).join(','));
    return { filename: `tibi-words-${stamp}.csv`, text: '﻿' + [head.join(','), ...lines].join('\r\n') + '\r\n', count: rows.length };
  }
  // Anki：正面 = 词；背面 = 释义 + 原句（词加粗）+ 译文；第 3 列标签
  const header = ['#separator:tab', '#html:true', '#columns:Front\tBack\tTags', '#tags column:3', '#deck:Tibi'];
  const lines = rows.map(r => {
    const word = r.text_display || r.text;
    let back = esc(meaning(r));
    if (withCtx && r.sentence) {
      const surf = r.surface || word;
      const i = r.sentence.toLowerCase().indexOf(surf.toLowerCase());
      const sent = i >= 0 ? `${esc(r.sentence.slice(0, i))}<b>${esc(r.sentence.slice(i, i + surf.length))}</b>${esc(r.sentence.slice(i + surf.length))}` : esc(r.sentence);
      back += `<br><br><i>${sent}</i>${r.translation ? `<br>${esc(r.translation)}` : ''}${r.title ? `<br><small>${esc(r.title)}</small>` : ''}`;
    }
    return [esc(word), back, `tibi ${r.kind === 'phrase' ? 'phrase' : 'word'}`].map(tsvCell).join('\t');
  });
  return { filename: `tibi-anki-${stamp}.txt`, text: [...header, ...lines].join('\n') + '\n', count: rows.length };
}

/** 解析导入文件：每行一个词，可用制表符 / 逗号分出释义；# 开头的行（Anki 头）和表头 word 行跳过 */
export function parseWordList(text: string): { text: string; meaning?: string }[] {
  const out: { text: string; meaning?: string }[] = []; const seen = new Set<string>();
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const cells = line.includes('\t') ? line.split('\t') : line.match(/^"/) || line.includes(',') ? line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"')) : [line];
    const word = cells[0]!.replace(/<[^>]+>/g, '').trim();
    if (!word || /^(word|front|单词)$/i.test(word) || word.length > 60 || !/[a-z]/i.test(word)) continue;
    const key = word.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    const meaning = cells[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ text: word, ...(meaning ? { meaning: meaning.slice(0, 200) } : {}) });
  }
  return out;
}

export async function importTerms(ctx: Ctx, path: string, format: 'csv' | 'txt' | 'anki' | 'known'): Promise<{ added: number; known: number; skipped: number; total: number }> {
  if (!ctx.platform.isPathAllowed(path)) throw new TibiError('permission_denied', '这个文件没有经过选择');
  if (!ctx.platform.readFile) throw new TibiError('invalid_source', '这里不能读文件');
  const list = parseWordList(new TextDecoder('utf-8').decode(await ctx.platform.readFile(path)));
  if (!list.length) throw new TibiError('invalid_source', '文件里没有找到英文单词');
  if (list.length > 20_000) throw new TibiError('invalid_source', '一次最多导入 20,000 个词');
  if (format !== 'known') {
    const r = await addWords(ctx, list);
    ctx.events.emit('data.changed', { table: 'terms' });
    return { added: r.created.length, known: 0, skipped: list.length - r.created.length, total: list.length };
  }
  let known = 0, skipped = 0; const t = now();
  await ctx.db.transaction(async tx => {
    for (const e of list) {
      const isPhrase = /\s/.test(e.text);
      const lemma = isPhrase ? e.text.toLowerCase().replace(/\s+/g, ' ') : await lemmatize(e.text.toLowerCase(), ctx.dict);
      const term = await getTermByText(tx, lemma, isPhrase ? 'phrase' : 'word');
      if (!term) {
        const entry = isPhrase ? undefined : await ctx.dict.lookup(lemma);
        const row = await insertTerm(tx, { kind: isPhrase ? 'phrase' : 'word', text: lemma, display: e.text, status: 97, status_source: 'user', short_gloss: shortGloss(entry?.translation), seen_at: t });
        await logStatus(tx, row.id, 97, 'import'); known++;
      } else if (term.deleted_at || [0, 99].includes(term.status)) {
        await setTermStatus(tx, term, 97 as Status, 'import'); known++;
      } else skipped++;   // 学习中、已知、忽略的不动
    }
  });
  ctx.events.emit('data.changed', { table: 'terms' });
  return { added: 0, known, skipped, total: list.length };
}
