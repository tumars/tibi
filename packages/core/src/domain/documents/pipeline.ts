import { j, now, type Database } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import { normalizeForHash, sha256Hex } from '../../hash.js';
import type { Ctx } from '../../rpc/define.js';
import { TibiError, type Genre, type Kind, type Status, type Token } from '../../types.js';
import { alreadyDone, recordUndo } from '../shared/undo.js';
import { annotateSentences } from '../text/annotate.js';
import { cleanTitle, dropLeadingTitle } from '../text/title.js';
import { levelOfRatio } from '../text/level.js';
import { countWords, segmentMarkdown, splitSentences, type Segmented } from '../text/segment.js';
import { bumpEncounter, contextExists, getTermsByTexts, hasPrimaryContext, insertContext, upsertForm } from '../terms/repo.js';
import { getSample, sampleUri, writeSampleAi } from './samples.js';
import { analyzeDocument } from './analyze.js';
import { linkImported } from '../feeds/repo.js';
import { background } from './imports.js';
import { getDocument, getDocumentByHash, insertDocument, insertSection, insertSentence, listSections, listSentences, setDocumentTags, TOKENIZER_VERSION, WPM } from './repo.js';

/**
 * 导入流水线（00 §3.1、05 §4.3：固定流水线，不是模型驱动的技能，R10）。
 * fetch → segment → save → annotate → difficulty → event，然后在后台做总结（summary | phrases | hard_sentences）。
 * 在后台跑（imports.ts），不存检查点：应用中途退出时这次导入就没了，文章还没入库，用户重新导入即可。
 */

export type ImportSource = { type: 'text'; text: string; title?: string; generated?: boolean } | { type: 'url'; url: string } | { type: 'file'; path: string } | { type: 'images'; paths: string[] } | { type: 'sample'; id: string };
export interface ImportInput { source: ImportSource; hints?: { kind?: Kind; genre?: Genre; tags?: string[] }; origin?: 'user' | 'deeplink' | 'mcp' | 'share' | 'chat' }

/** 一次导入：id 用来对应进度事件；progress 是界面上的一行说明 */
export interface ImportRun { id: string; signal?: AbortSignal; progress(label: string): void }

interface Fetched { title: string; author?: string; markdown: string; source_type: string; source_uri?: string; published_at?: number; lang?: string; kind?: Kind; genre?: Genre }

/** 第一步：拿到干净的 Markdown */
async function fetchStep(job: ImportRun, ctx: Ctx, input: ImportInput): Promise<Fetched> {
  const s = input.source;
  if (s.type === 'text') {
    const md = s.text.replace(/\r\n?/g, '\n').trim();
    if (!md) throw new TibiError('invalid_source', '没有内容');
    const title = s.title?.trim() || titleFromMarkdown(md);
    return { title, markdown: md, source_type: s.generated ? 'tibi_generated' : 'text' };
  }
  if (s.type === 'url') {
    job.progress('正在抓取网页');
    const page = await ctx.platform.fetchUrl(s.url, { signal: job.signal });
    if (page.status >= 400) throw new TibiError('invalid_source', `网页打不开（${page.status}）。可以复制正文后粘贴`);
    if (/text\/plain/.test(page.content_type)) return { title: new URL(page.final_url).pathname.split('/').pop() || s.url, markdown: page.body, source_type: 'url', source_uri: page.final_url };
    const art = await ctx.platform.extractReadable(page.body, page.final_url);
    if (countWords(art.markdown) < 30) throw new TibiError('invalid_source', '这个页面抓不到正文。可以复制正文后粘贴');
    const title = cleanTitle(art.title, { site: art.site_name, h1: art.h1, host: new URL(page.final_url).hostname });
    return { title, author: art.byline, markdown: dropLeadingTitle(art.markdown, title), source_type: 'url', source_uri: page.final_url, published_at: art.published_at, lang: art.lang };
  }
  if (s.type === 'file') {
    if (!ctx.platform.isPathAllowed(s.path)) throw new TibiError('permission_denied', '这个文件没有经过选择或拖入');
    const ext = s.path.toLowerCase().split('.').pop() ?? '';
    const name = s.path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
    if (['epub', 'pdf', 'docx'].includes(ext)) {
      if (!ctx.platform.extractFile) throw new TibiError('invalid_source', `这里不能读 .${ext} 文件`);
      job.progress(ext === 'epub' ? '正在拆开这本书' : `正在读取 ${ext.toUpperCase()}`);
      const f = await ctx.platform.extractFile(s.path).catch(e => { throw new TibiError('invalid_source', `这个文件打不开：${e instanceof Error ? e.message : String(e)}`); });
      if (f.needs_ocr) {
        if (!ctx.platform.ocr) throw new TibiError('invalid_source', '这是扫描版 PDF，要先识别文字（OCR）。这里还不能识别');
        job.progress('扫描版：正在识别文字');
        const o = await ctx.platform.ocr({ pdf: s.path }, { signal: job.signal, onProgress: (d, t) => job.progress(`正在识别文字：第 ${d} / ${t} 页`) });
        return { title: f.title || name, author: f.author, markdown: o.text, source_type: 'file', source_uri: name, kind: f.kind };
      }
      if (countWords(f.markdown) < 5) throw new TibiError('invalid_source', '这个文件里没有找到正文');
      return { title: f.title || (/^#\s/.test(f.markdown.trimStart()) ? titleFromMarkdown(f.markdown) : name), author: f.author, markdown: f.markdown, source_type: 'file', source_uri: name, kind: f.kind };
    }
    if (!ctx.platform.readFile) throw new TibiError('invalid_source', '这里不能读文件');
    if (!['txt', 'md', 'markdown'].includes(ext)) throw new TibiError('invalid_source', `还不支持 .${ext} 文件。支持 EPUB、PDF、DOCX、TXT 和 Markdown`);
    const text = new TextDecoder('utf-8').decode(await ctx.platform.readFile(s.path)).trim();
    if (!text) throw new TibiError('invalid_source', '文件是空的');
    return { title: /^#\s/.test(text) ? titleFromMarkdown(text) : name, markdown: text, source_type: 'file', source_uri: name };
  }
  if (s.type === 'images') {
    for (const p of s.paths) if (!ctx.platform.isPathAllowed(p)) throw new TibiError('permission_denied', '有图片没有经过选择或拖入');
    if (!ctx.platform.ocr) throw new TibiError('invalid_source', '这里不能识别图片里的文字');
    job.progress('正在识别图片里的文字（第一次要下载约 10 MB 的英文语言包）');
    const o = await ctx.platform.ocr({ images: s.paths }, { signal: job.signal, onProgress: (d, t) => job.progress(`正在识别第 ${d} / ${t} 张`) })
      .catch(e => { throw new TibiError('invalid_source', `图片识别失败：${e instanceof Error ? e.message : String(e)}`); });
    if (countWords(o.text) < 5) throw new TibiError('invalid_source', '图片里没有识别出英文');
    const first = o.text.split('\n').find(l => l.trim())!.trim();
    const title = first.length <= 80 && !/[.!?]$/.test(first) ? first : `${s.paths.length} 张图片`;
    return { title, markdown: o.text, source_type: 'image', source_uri: s.paths[0]!.split(/[\\/]/).pop() };
  }
  const sample = getSample(s.id);
  if (!sample) throw new TibiError('not_found', '没有这篇示例');
  return { title: sample.title, author: sample.author, markdown: sample.markdown, source_type: 'sample', source_uri: sampleUri(sample.id), genre: sample.genre, kind: 'article' };
}

function titleFromMarkdown(md: string): string {
  const h = md.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (h) return h;
  const first = md.split('\n').find(l => l.trim())?.trim() ?? '未命名';
  return first.length > 80 ? first.slice(0, 77) + '…' : first;
}

/** 类型（genre）自动识别：很粗的规则，用户可改（00 §3.1） */
export function guessGenre(md: string, source_uri?: string): Genre {
  const host = source_uri ? (() => { try { return new URL(source_uri).hostname; } catch { return ''; } })() : '';
  if (/arxiv\.org|\.edu\b|acm\.org|ieee\.org|springer|nature\.com|sciencedirect/i.test(host) || /\b(abstract|we propose|et al\.)\b/i.test(md.slice(0, 3000))) return 'academic';
  const code = (md.match(/```/g) ?? []).length / 2 + (md.match(/`[^`]+`/g) ?? []).length;
  if (code >= 1 || /github\.com|stackoverflow|docs\.|developer\.|rust-lang|python\.org/i.test(host)) return 'tech';
  if (/bbc\.|nytimes|reuters|theguardian|cnn\.|apnews|bloomberg|economist|wsj\.|ft\.com/i.test(host)) return 'news';
  const quotes = (md.match(/[“"][^”"]{10,}[”"]/g) ?? []).length;
  if (quotes >= 5 && / (he|she) (said|asked|replied)/i.test(md)) return 'lit';
  return 'general';
}

interface SaveOut { document_id: string; section_ids: string[]; duplicate: boolean }

/** 第三步：入库（documents / sections / sentences），内容哈希去重 */
async function saveStep(job: ImportRun, ctx: Ctx, fetched: Fetched, seg: Segmented, input: ImportInput): Promise<SaveOut> {
  const hash = await sha256Hex(normalizeForHash(fetched.markdown));
  const key = `${job.id}:save`;
  const existing = await getDocumentByHash(ctx.db, hash);
  if (existing) return { document_id: existing.id, section_ids: (await listSections(ctx.db, existing.id)).map(s => s.id), duplicate: !(await alreadyDone(ctx.db, key)) };
  const genre = input.hints?.genre ?? fetched.genre ?? guessGenre(fetched.markdown, fetched.source_uri);
  const out = await ctx.db.transaction(async tx => {
    const document_id = await insertDocument(tx, {
      title: fetched.title, author: fetched.author, kind: seg.kind, genre, source_type: fetched.source_type, source_uri: fetched.source_uri, lang: seg.lang,
      content_hash: hash, word_count: seg.word_count, section_count: seg.sections.length, published_at: fetched.published_at,
    });
    const section_ids: string[] = [];
    for (const sec of seg.sections) {
      const content_md = sec.paragraphs.map(p => p.block_type === 'code' ? '```' + (p.lang ?? '') + '\n' + p.text + '\n```' : p.block_type === 'heading' ? '## ' + p.text : p.block_type === 'list_item' ? '- ' + p.text : p.block_type === 'quote' ? '> ' + p.text : p.text).join('\n\n');
      const section_id = await insertSection(tx, { document_id, idx: sec.idx, title: sec.title, content_md, word_count: sec.paragraphs.filter(p => p.block_type !== 'code').reduce((a, p) => a + countWords(p.text), 0) });
      section_ids.push(section_id);
      let idx = 0;
      for (const p of sec.paragraphs) {
        if (p.block_type === 'code') continue;
        for (const text of splitSentences(p.text)) await insertSentence(tx, { section_id, paragraph_idx: p.idx, block_type: p.block_type, idx: idx++, text });
      }
    }
    if (input.hints?.tags?.length) await setDocumentTags(tx, document_id, input.hints.tags, { source: 'user' });
    await recordUndo(tx, ctx, { tool: 'save_document', args: { title: fetched.title }, undo_payload: { document_id }, idempotency_key: key });
    return { document_id, section_ids, duplicate: false };
  });
  ctx.events.emit('data.changed', { table: 'documents', ids: [out.document_id] });
  return out;
}

/**
 * 第四步：分词、还原、按词库标状态；写 sentences.tokens、term_forms、term_contexts（R7：不碰 FSRS）。
 * 不建 terms 行：生词只有用户自己标的（加入生词本、点"不认识"）。已有行的词在这里登记语境和遇见次数。
 */
export async function annotateSection(db: Database, ctx: Ctx, section_id: string, opts: { document_id: string }): Promise<{ counts: { total: number; new: number; learning: number }; rare: number }> {
  const sentences = await listSentences(db, section_id);
  const texts = sentences.map(s => s.text);
  const phrases = (await db.all<{ text: string }>("SELECT text FROM terms WHERE kind = 'phrase' AND deleted_at IS NULL")).map(r => r.text);
  // 先用一次空的 statusOf 跑分词，拿到全部 lemma 后再查词库，这样只查一轮
  const first = await annotateSentences({ sentences: texts, dict: ctx.dict, statusOf: () => undefined, phrases, ignoreProperNouns: true });
  const lemmas = [...new Set(first.sentences.flatMap(s => s.tokens.map(t => t.l)))];
  const known = await getTermsByTexts(db, lemmas);
  const res = await annotateSentences({ sentences: texts, dict: ctx.dict, statusOf: l => { const r = known.get(l); return r && !r.deleted_at ? (r.status as Status) : undefined; }, phrases, ignoreProperNouns: true });
  const t = now();
  await db.transaction(async tx => {
    const encounters = new Map<string, number>();
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i]!; const a = res.sentences[i]!;
      const tokens: Token[] = a.tokens.map(tk => ({ t: tk.t, l: tk.l, s: tk.s, e: tk.e }));
      await tx.run('UPDATE sentences SET tokens = ?, updated_at = ? WHERE id = ?', [j.str(tokens), t, s.id]);
      const seen = new Set<string>();
      for (const tk of a.tokens) {
        const row = known.get(tk.l); if (!row || tk.status === undefined) continue;
        encounters.set(row.id, (encounters.get(row.id) ?? 0) + 1);
        await upsertForm(tx, row.id, tk.t.toLowerCase(), t);
        if (seen.has(row.id)) continue; seen.add(row.id);
        if (!(await contextExists(tx, row.id, s.id))) await insertContext(tx, { term_id: row.id, source: 'article', document_id: opts.document_id, sentence_id: s.id, surface: tk.t, is_primary: !(await hasPrimaryContext(tx, row.id)) });
      }
    }
    for (const [term_id, n] of encounters) await bumpEncounter(tx, term_id, n, t);
    // 已有短语：登记语境
    for (const ph of res.phrases) {
      const row = await tx.get<{ id: string }>("SELECT id FROM terms WHERE kind = 'phrase' AND text = ? AND deleted_at IS NULL", [ph.text]);
      if (!row) continue;
      for (const si of ph.sentence_idx) { const s = sentences[si]!; if (!(await contextExists(tx, row.id, s.id))) await insertContext(tx, { term_id: row.id, source: 'article', document_id: opts.document_id, sentence_id: s.id, is_primary: !(await hasPrimaryContext(tx, row.id)) }); }
      await bumpEncounter(tx, row.id, ph.sentence_idx.length, t);
    }
    await tx.run('UPDATE sections SET status = ?, tokenizer_version = ?, updated_at = ? WHERE id = ?', ['ready', TOKENIZER_VERSION, t, section_id]);
  });
  return { counts: res.counts, rare: res.rare_ratio === undefined ? -1 : Math.round(res.rare_ratio * res.counts.total) };
}

/** 整篇标注 + 难度；reanalyze 也走这里 */
const LAZY_EAGER = 2;

/** 打开一章时如果还没标注（书的后面几章），现在标；返回是否做了标注 */
export async function ensureAnnotated(ctx: Ctx, section_id: string): Promise<boolean> {
  const sec = await ctx.db.get<{ status: string; document_id: string }>('SELECT status, document_id FROM sections WHERE id = ? AND deleted_at IS NULL', [section_id]);
  if (!sec || sec.status !== 'pending') return false;
  const doc = await getDocument(ctx.db, sec.document_id); if (!doc || doc.status !== 'ready') return false;
  const inflight = ANNOTATING.get(section_id); if (inflight) { await inflight; return true; }
  const p = (async () => { await annotateSection(ctx.db, ctx, section_id, { document_id: doc.id }); })().finally(() => ANNOTATING.delete(section_id));
  ANNOTATING.set(section_id, p); await p;
  ctx.events.emit('data.changed', { table: 'terms' });
  return true;
}
const ANNOTATING = new Map<string, Promise<void>>();

async function annotateDocument(job: ImportRun | undefined, ctx: Ctx, document_id: string, section_ids: string[]): Promise<{ level?: string }> {
  const doc = await getDocument(ctx.db, document_id); if (!doc) throw new TibiError('not_found', '文章不在了');
  let total = 0, rare = 0, hasFreq = true;
  // 书按章懒处理（00 §3.1）：导入时只标前两章，其余在打开那一章时再标（sections.get → ensureAnnotated）
  const eager = doc.kind === 'book' ? section_ids.slice(0, LAZY_EAGER) : section_ids;
  for (let i = 0; i < eager.length; i++) {
    job?.progress(eager.length > 1 ? `正在分析第 ${i + 1} / ${eager.length} 章` : '正在分析');
    const r = await annotateSection(ctx.db, ctx, section_ids[i]!, { document_id });
    total += r.counts.total; if (r.rare < 0) hasFreq = false; else rare += r.rare;
  }
  // 文本级别：只看词频（常用 3000 词以外的占比），与用户无关；没有词频表时不估
  const rare_ratio = hasFreq && total ? rare / total : null;
  const level = rare_ratio === null ? undefined : levelOfRatio(rare_ratio);
  await ctx.db.run('UPDATE documents SET status = ?, rare_ratio = ?, difficulty_cefr = ?, updated_at = ? WHERE id = ?', ['ready', rare_ratio, level ?? null, now(), document_id]);
  return { level };
}

async function markDeferred(db: Database, document_id: string) {
  const t = now();
  await db.run("UPDATE documents SET ai_status = 'deferred', updated_at = ? WHERE id = ? AND ai_status IN ('none', 'running')", [t, document_id]);
  await db.run("UPDATE sections SET ai_status = 'deferred', updated_at = ? WHERE document_id = ? AND ai_status IN ('none', 'running')", [t, document_id]);
}

type ImportResult = { summary: string; action: { label: string; route: string }; document_id: string; duplicate: boolean; title: string; level?: string; minutes: number };

export async function runImport(job: ImportRun, ctx: Ctx, input: ImportInput): Promise<ImportResult> {
  const r = await importOnce(job, ctx, input);
  // 订阅里的同一篇（请求的链接或重定向后的链接）记成"在书架里"（11 §5.2）
  if (input.source.type === 'url') {
    const doc = await getDocument(ctx.db, r.document_id);
    if (await linkImported(ctx.db, [input.source.url, doc?.source_uri], r.document_id)) ctx.events.emit('data.changed', { table: 'feed_items' });
  }
  return r;
}

async function importOnce(job: ImportRun, ctx: Ctx, input: ImportInput): Promise<ImportResult> {
  job.progress('取正文');
  const fetched = await fetchStep(job, ctx, input);
  const seg = segmentMarkdown(fetched.markdown, { kind: input.hints?.kind ?? fetched.kind ?? 'article', title: fetched.title });
  if (seg.lang !== 'en') throw new TibiError('invalid_source', '目前只支持英文文章');
  if (seg.word_count < 5) throw new TibiError('invalid_source', '内容太短了');
  const saved = await saveStep(job, ctx, fetched, seg, input);
  if (saved.duplicate) {
    const d = (await getDocument(ctx.db, saved.document_id))!;
    return { summary: '这篇已经在书架里', action: { label: '打开', route: `/read/${saved.document_id}` }, document_id: saved.document_id, duplicate: true, title: d.title, level: d.difficulty_cefr ?? undefined, minutes: Math.max(1, Math.round(Number(d.word_count) / WPM)) };
  }
  const ann = await annotateDocument(job, ctx, saved.document_id, saved.section_ids);
  await ctx.db.run('INSERT INTO learning_events(id, type, payload, created_at) VALUES (?,?,?,?)', [uuidv7(), 'document_imported', j.str({ document_id: saved.document_id, source_type: fetched.source_type, title: fetched.title, word_count: seg.word_count }), now()]);
  const sample = input.source.type === 'sample' ? getSample(input.source.id) : undefined;
  if (sample) {
    // 内置示例：写入预生成的总结与语境释义，不调模型
    await writeSampleAi(ctx.db, saved.document_id, sample);
    ctx.events.emit('data.changed', { table: 'documents', ids: [saved.document_id] });
    ctx.events.emit('data.changed', { table: 'terms' });
    return { summary: `已放进书架：${fetched.title}`, action: { label: '开始阅读', route: `/read/${saved.document_id}` }, document_id: saved.document_id, duplicate: false, title: fetched.title, level: ann.level, minutes: Math.max(1, Math.round(seg.word_count / WPM)) };
  }
  // AI 分析在后台另做：正文好了就能读，总结稍后出现（00 §3.5"可先读后分析"）。没连模型或离线直接记 deferred，之后补做
  const has = await ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM providers WHERE kind = 'llm' AND deleted_at IS NULL");
  if (!ctx.ai || !Number(has?.n ?? 0) || !ctx.platform.isOnline()) await markDeferred(ctx.db, saved.document_id);
  else {
    await ctx.db.run("UPDATE documents SET ai_status = 'running', updated_at = ? WHERE id = ?", [now(), saved.document_id]);
    background(`analyze:${saved.document_id}`, () => analyzeDocument(ctx, saved.document_id));
  }
  ctx.events.emit('data.changed', { table: 'documents', ids: [saved.document_id] });
  ctx.events.emit('data.changed', { table: 'terms' });
  return { summary: `已放进书架：${fetched.title}`, action: { label: '开始阅读', route: `/read/${saved.document_id}` }, document_id: saved.document_id, duplicate: false, title: fetched.title, level: ann.level, minutes: Math.max(1, Math.round(seg.word_count / WPM)) };
}

/** documents.reanalyze：按当前词库重新标注（分词升级、词典后来才装上）；ai=true 时把 AI 状态重新置为 deferred 等补做 */
export async function runReanalyze(ctx: Ctx, input: { document_id: string; ai?: boolean }) {
  const doc = await getDocument(ctx.db, input.document_id); if (!doc || doc.deleted_at) throw new TibiError('not_found', '文章不在了');
  const sections = await listSections(ctx.db, doc.id);
  const t = now();
  await ctx.db.run('UPDATE term_contexts SET deleted_at = ?, updated_at = ? WHERE document_id = ? AND deleted_at IS NULL', [t, t, doc.id]);
  const ann = await annotateDocument(undefined, ctx, doc.id, sections.map(s => s.id));
  if (input.ai) await markDeferred(ctx.db, doc.id);
  ctx.events.emit('data.changed', { table: 'documents', ids: [doc.id] });
  return { document_id: doc.id, level: ann.level };
}

/** 应用上次退出时还在做总结的文章：改回"稍后补做"，连上模型后照常补做 */
export async function recoverAnalysis(db: Database) {
  const t = now();
  await db.run("UPDATE documents SET ai_status = 'deferred', updated_at = ? WHERE ai_status = 'running'", [t]);
  await db.run("UPDATE sections SET ai_status = 'deferred', updated_at = ? WHERE ai_status = 'running'", [t]);
}
