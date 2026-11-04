import { Type } from '@sinclair/typebox';
import { method, type MethodMap } from '../../rpc/define.js';
import type { DictEntry, Genre, Status } from '../../types.js';
import { lemmatize } from '../text/lemma.js';
import { normalizeCase } from '../text/tokenize.js';

/**
 * 全局搜索（00 §3.8，⌘K）：一次查文章（标题 + 正文 FTS5）、单词（生词本里的词：英文或中文释义）、对话标题、词典。
 * 设置项和跳转 / 操作在界面里本地匹配，不经 Core。只读。
 */
export interface SearchResult {
  documents: { id: string; title: string; genre: Genre; snippet?: string }[];
  terms: { id: string; text: string; display: string; meaning?: string; status: Status }[];
  conversations: { id: string; title: string; kind: string; last_message_at?: number }[];
  /** 输入像一个英文单词、又不在单词结果里时，给词典释义 */
  dict?: { lemma: string; entry: DictEntry };
}

const like = (s: string) => `%${s.replace(/[\\%_]/g, m => `\\${m}`)}%`;

export const searchMethods: MethodMap = {
  'search.query': method(Type.Object({ q: Type.String(), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })) }), async (p, ctx): Promise<SearchResult> => {
    const q = p.q.trim(); const n = p.limit ?? 6;
    if (!q) return { documents: [], terms: [], conversations: [] };
    const L = like(q.toLowerCase());

    // 文章：标题命中在前，再补正文命中（FTS5，带片段）
    const byTitle = await ctx.db.all<{ id: string; title: string; genre: Genre }>(
      "SELECT id, title, genre FROM documents WHERE deleted_at IS NULL AND lower(title) LIKE ? ESCAPE '\\' ORDER BY COALESCE(last_read_at, created_at) DESC LIMIT ?", [L, n]);
    const documents: SearchResult['documents'] = byTitle.map(d => ({ ...d }));
    const words = q.replace(/["*()^:]/g, ' ').trim().split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w));
    if (words.length && documents.length < n) {
      const match = words.map((w, i) => `"${w}"${i === words.length - 1 ? '*' : ''}`).join(' ');
      try {
        const hits = await ctx.db.all<{ id: string; title: string; genre: Genre; snippet: string }>(
          `SELECT d.id, d.title, d.genre, snippet(sections_fts, 1, '[', ']', '…', 10) AS snippet
           FROM sections_fts JOIN sections sec ON sec.rowid = sections_fts.rowid JOIN documents d ON d.id = sec.document_id
           WHERE sections_fts MATCH ? AND d.deleted_at IS NULL AND sec.deleted_at IS NULL ORDER BY bm25(sections_fts) LIMIT ?`, [match, n * 2]);
        for (const h of hits) if (!documents.some(d => d.id === h.id) && documents.length < n) documents.push({ id: h.id, title: h.title, genre: h.genre, snippet: h.snippet.replace(/\s+/g, ' ').trim() });
      } catch { /* FTS 语法不合法时只给标题结果 */ }
    }

    // 单词：只列生词本里的和学过的（标为已知 97 / 忽略 98 的除外）；英文前缀、词形、中文释义都能搜
    const lemma = /^[A-Za-z][A-Za-z'-]*$/.test(q) ? await lemmatize(normalizeCase(q, true), ctx.dict) : undefined;
    const terms = (await ctx.db.all<{ id: string; text: string; text_display: string; meaning: string | null; status: Status; rank: number }>(
      `SELECT id, text, text_display, meaning, status,
              CASE WHEN text = ? OR text = ? THEN 0 WHEN text LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END AS rank
       FROM terms WHERE deleted_at IS NULL AND status NOT IN (97, 98) AND (in_wordbook = 1 OR status BETWEEN 0 AND 5)
         AND (text LIKE ? ESCAPE '\\' OR lower(text_display) LIKE ? ESCAPE '\\' OR meaning LIKE ? ESCAPE '\\')
       ORDER BY rank, length(text) LIMIT ?`,
      [q.toLowerCase(), lemma ?? '', `${q.toLowerCase().replace(/[\\%_]/g, m => `\\${m}`)}%`, L, L, like(q), n])).map(t => ({ id: t.id, text: t.text, display: t.text_display, meaning: t.meaning ?? undefined, status: t.status }));

    const conversations = (await ctx.db.all<{ id: string; title: string; kind: string; last_message_at: number | null }>(
      // 和左栏"最近"同一个口径：没说过话的（只是打开过 Tibi 面板）和技能内部的对话不算
      "SELECT id, title, kind, last_message_at FROM conversations WHERE deleted_at IS NULL AND last_message_at IS NOT NULL AND kind != 'skill' AND title != '' AND lower(title) LIKE ? ESCAPE '\\' ORDER BY last_message_at DESC LIMIT ?", [L, Math.min(n, 4)]))
      .map(c => ({ id: c.id, title: c.title, kind: c.kind, last_message_at: c.last_message_at ?? undefined }));

    let dict: SearchResult['dict'];
    if (lemma && !terms.some(t => t.text === lemma)) {
      const entry = await ctx.dict.lookup(lemma) ?? (lemma !== q.toLowerCase() ? await ctx.dict.lookup(q.toLowerCase()) : undefined);
      if (entry) dict = { lemma: entry.word, entry };
    }
    return { documents, terms, conversations, dict };
  }),
};
