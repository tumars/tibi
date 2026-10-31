import { j, now, type Database } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import { normalizeForHash, sha256Hex } from '../../hash.js';
import type { JobContext, JobRunner } from '../../kernel/types.js';
import type { Core } from '../../core.js';
import type { Ctx } from '../../rpc/define.js';
import { TibiError, type Genre, type Kind, type Status, type Token } from '../../types.js';
import { alreadyDone, recordUndo } from '../shared/undo.js';
import { annotateSentences } from '../text/annotate.js';
import { cleanTitle, dropLeadingTitle } from '../text/title.js';
import { cefrOfDocument, difficultyOfRatio } from '../text/prelabel.js';
import { countWords, segmentMarkdown, splitSentences, type Segmented } from '../text/segment.js';
import { bumpEncounter, contextExists, getTermsByTexts, hasPrimaryContext, insertContext, insertTerm, logStatus, readProfile, upsertForm } from '../terms/repo.js';
import { shortGloss } from '../terms/views.js';
import { getSample, sampleUri, writeSampleAi } from './samples.js';
import { analyzeDocument, translateSection } from './analyze.js';
import { getDocument, getDocumentByHash, insertDocument, insertSection, insertSentence, listSections, listSentences, setDocumentTags, TOKENIZER_VERSION, WPM } from './repo.js';

/**
 * 导入流水线（00 §3.1、05 §4.3：固定流水线，不是模型驱动的技能，R10）。
 * 注册为任务 'import'：fetch → segment → save → annotate → difficulty → event → (summary | phrases | hard_sentences)。
 * 每一步经 JobContext.step() 写检查点，重开从最后完成的步骤接着跑；save 用幂等键保证不会写两份。
 * M0 没有模型：AI 子步骤一律记 deferred（稍后补做），M2 接讲解技能。
 */

export type ImportSource = { type: 'text'; text: string; title?: string; generated?: boolean } | { type: 'url'; url: string } | { type: 'file'; path: string } | { type: 'images'; paths: string[] } | { type: 'sample'; id: string };
export interface ImportInput { source: ImportSource; hints?: { kind?: Kind; genre?: Genre; tags?: string[] }; origin?: 'user' | 'deeplink' | 'mcp' | 'share' }

interface Fetched { title: string; author?: string; markdown: string; source_type: string; source_uri?: string; published_at?: number; lang?: string; kind?: Kind; genre?: Genre }

/** 第一步：拿到干净的 Markdown */
async function fetchStep(job: JobContext, ctx: Ctx, input: ImportInput): Promise<Fetched> {
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
    job.markTainted();   // 抓到的内容是不可信数据（05 §8）
    if (/text\/plain/.test(page.content_type)) return { title: new URL(page.final_url).pathname.split('/').pop() || s.url, markdown: page.body, source_type: 'url', source_uri: page.final_url };
    const art = await ctx.platform.extractReadable(page.body, page.final_url);
    if (countWords(art.markdown) < 30) throw new TibiError('invalid_source', '这个页面抓不到正文。可以复制正文后粘贴');
    const title = cleanTitle(art.title, { site: art.site_name, h1: art.h1, host: new URL(page.final_url).hostname });
    return { title, author: art.byline, markdown: dropLeadingTitle(art.markdown, title), source_type: 'url', source_uri: page.final_url, published_at: art.published_at, lang: art.lang };
  }
  if (s.type === 'file') {
    if (!ctx.platform.isPathAllowed(s.path)) throw new TibiError('permission_denied', '这个文件没有经过选择或拖入');
    if (!ctx.platform.readFile) throw new TibiError('invalid_source', '这里不能读文件');
    const ext = s.path.toLowerCase().split('.').pop() ?? '';
    if (!['txt', 'md', 'markdown'].includes(ext)) throw new TibiError('invalid_source', `还不支持 .${ext} 文件，先支持 txt 和 Markdown`);
    const text = new TextDecoder('utf-8').decode(await ctx.platform.readFile(s.path)).trim();
    if (!text) throw new TibiError('invalid_source', '文件是空的');
    const name = s.path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
    return { title: /^#\s/.test(text) ? titleFromMarkdown(text) : name, markdown: text, source_type: 'file', source_uri: name };
  }
  if (s.type === 'images') throw new TibiError('invalid_source', '图片识别还没做好（M4）');
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
async function saveStep(job: JobContext, ctx: Ctx, fetched: Fetched, seg: Segmented, input: ImportInput): Promise<SaveOut> {
  const hash = await sha256Hex(normalizeForHash(fetched.markdown));
  const key = `${job.job_id}:save`;
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

/** 第四步：分词、还原、按已知词库标状态；写 sentences.tokens、terms、term_forms、term_contexts（R7：不碰 FSRS） */
export async function annotateSection(db: Database, ctx: Ctx, section_id: string, opts: { document_id: string; genre: Genre; vocab_estimate: number }): Promise<{ counts: { total: number; new: number; learning: number; unsure: number }; unknown_ratio: number; prelabel_total: number }> {
  const sentences = await listSentences(db, section_id);
  const texts = sentences.map(s => s.text);
  const phrases = (await db.all<{ text: string }>("SELECT text FROM terms WHERE kind = 'phrase' AND deleted_at IS NULL")).map(r => r.text);
  // 先用一次空的 statusOf 跑分词，拿到全部 lemma 后再查词库，这样只查一轮
  const first = await annotateSentences({ sentences: texts, dict: ctx.dict, vocab_estimate: opts.vocab_estimate, statusOf: () => undefined, phrases, ignoreProperNouns: true });
  const lemmas = [...new Set(first.sentences.flatMap(s => s.tokens.map(t => t.l)))];
  const known = await getTermsByTexts(db, lemmas);
  const res = await annotateSentences({ sentences: texts, dict: ctx.dict, vocab_estimate: opts.vocab_estimate, statusOf: l => { const r = known.get(l); return r && !r.deleted_at ? (r.status as Status) : undefined; }, phrases, ignoreProperNouns: true });
  const t = now();
  await db.transaction(async tx => {
    // 新词建行（预标注：0 生词 / 99 待确认）
    for (const [lemma, info] of res.newTerms) {
      if (known.has(lemma)) continue;
      const entry = await ctx.dict.lookup(lemma);
      const row = await insertTerm(tx, { text: lemma, display: info.display, status: info.status, status_source: 'auto_rule', short_gloss: shortGloss(entry?.translation), seen_at: t });
      await logStatus(tx, row.id, info.status, 'auto_rule', { prelabel: info.prelabel, document_id: opts.document_id });
      known.set(lemma, row);
    }
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
    await tx.run('UPDATE sections SET status = ?, tokenizer_version = ?, unknown_ratio = ?, updated_at = ? WHERE id = ?', ['ready', TOKENIZER_VERSION, res.unknown_ratio, t, section_id]);
  });
  return { counts: { total: res.counts.total, new: res.counts.new, learning: res.counts.learning, unsure: res.counts.unsure }, unknown_ratio: res.unknown_ratio, prelabel_total: res.prelabel_total };
}

/** 整篇标注 + 难度；reanalyze 也走这里 */
async function annotateDocument(job: JobContext, ctx: Ctx, document_id: string, section_ids: string[]): Promise<{ unknown_ratio: number; prelabel_total: number; counts: { total: number; new: number; learning: number; unsure: number } }> {
  const doc = await getDocument(ctx.db, document_id); if (!doc) throw new TibiError('not_found', '文章不在了');
  const profile = await readProfile(ctx.db);
  const total = { total: 0, new: 0, learning: 0, unsure: 0 }; let prelabel_total = 0;
  for (let i = 0; i < section_ids.length; i++) {
    job.progress(section_ids.length > 1 ? `正在分析第 ${i + 1} / ${section_ids.length} 章` : '正在标注生词', { index: i, total: section_ids.length });
    const r = await job.step(`annotate:${section_ids[i]}`, () => annotateSection(ctx.db, ctx, section_ids[i]!, { document_id, genre: doc.genre, vocab_estimate: profile.vocab_estimate }));
    total.total += r.counts.total; total.new += r.counts.new; total.learning += r.counts.learning; total.unsure += r.counts.unsure; prelabel_total += r.prelabel_total;
  }
  const unknown_ratio = total.total ? total.new / total.total : 0;
  const t = now();
  await ctx.db.run('UPDATE documents SET status = ?, unknown_ratio = ?, difficulty_cefr = ?, updated_at = ? WHERE id = ?', ['ready', unknown_ratio, cefrOfDocument(unknown_ratio, profile.vocab_estimate), t, document_id]);
  return { unknown_ratio, prelabel_total, counts: total };
}

async function markDeferred(db: Database, document_id: string) {
  const t = now();
  await db.run("UPDATE documents SET ai_status = 'deferred', updated_at = ? WHERE id = ? AND ai_status IN ('none', 'running')", [t, document_id]);
  await db.run("UPDATE sections SET ai_status = 'deferred', updated_at = ? WHERE document_id = ? AND ai_status IN ('none', 'running')", [t, document_id]);
}

export async function runImport(job: JobContext, ctx: Ctx, input: ImportInput): Promise<{ summary: string; action: { label: string; route: string }; document_id: string; duplicate: boolean; title: string; unknown_ratio: number; minutes: number }> {
  const fetched = await job.step('fetch', () => fetchStep(job, ctx, input), { kind: 'pipeline', label: '取正文' });
  const seg = await job.step('segment', async () => segmentMarkdown(fetched.markdown, { kind: input.hints?.kind ?? fetched.kind ?? 'article', title: fetched.title }), { kind: 'pipeline', label: '切分' });
  if (seg.lang !== 'en') throw new TibiError('invalid_source', '目前只支持英文文章');
  if (seg.word_count < 5) throw new TibiError('invalid_source', '内容太短了');
  const saved = await job.step('save', () => saveStep(job, ctx, fetched, seg, input), { kind: 'pipeline', label: '入库' });
  if (saved.duplicate) {
    const d = (await getDocument(ctx.db, saved.document_id))!;
    return { summary: '这篇已经在书架里', action: { label: '打开', route: `/read/${saved.document_id}` }, document_id: saved.document_id, duplicate: true, title: d.title, unknown_ratio: Number(d.unknown_ratio ?? 0), minutes: Math.max(1, Math.round(Number(d.word_count) / WPM)) };
  }
  const ann = await annotateDocument(job, ctx, saved.document_id, saved.section_ids);
  await job.step('event', async () => {
    await ctx.db.run('INSERT INTO learning_events(id, type, payload, created_at) VALUES (?,?,?,?)', [uuidv7(), 'document_imported', j.str({ document_id: saved.document_id, source_type: fetched.source_type, prelabel_total: ann.prelabel_total, title: fetched.title, word_count: seg.word_count }), now()]);
    return true;
  }, { kind: 'pipeline', label: '记录' });
  const sample = input.source.type === 'sample' ? getSample(input.source.id) : undefined;
  if (sample) {
    // 内置示例：写入预生成的总结与语境释义，不调模型
    await job.step('ai:sample', () => writeSampleAi(ctx.db, saved.document_id, sample), { kind: 'pipeline', label: '预生成结果' });
    ctx.events.emit('data.changed', { table: 'documents', ids: [saved.document_id] });
    ctx.events.emit('data.changed', { table: 'terms' });
    return { summary: `已放进书架：${fetched.title}`, action: { label: '开始阅读', route: `/read/${saved.document_id}` }, document_id: saved.document_id, duplicate: false, title: fetched.title, unknown_ratio: ann.unknown_ratio, minutes: Math.max(1, Math.round(seg.word_count / WPM)) };
  }
  // AI 分析（M2）另起一个任务：正文好了就能读，总结稍后出现（00 §3.5"可先读后分析"）。没连模型或离线直接记 deferred，之后补做
  await job.step('ai:queue', async () => {
    const has = await ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM providers WHERE kind = 'llm' AND deleted_at IS NULL");
    if (!ctx.ai || !Number(has?.n ?? 0) || !ctx.platform.isOnline()) { await markDeferred(ctx.db, saved.document_id); return { queued: false }; }
    await ctx.db.run("UPDATE documents SET ai_status = 'running', updated_at = ? WHERE id = ?", [now(), saved.document_id]);
    const { task_id } = await ctx.jobs.submit('analyze', { kind: 'import', title: `总结 ${fetched.title}`, trigger: 'auto', input: { document_id: saved.document_id } });
    return { queued: true, task_id };
  }, { kind: 'pipeline', label: '排队做总结' });
  ctx.events.emit('data.changed', { table: 'documents', ids: [saved.document_id] });
  ctx.events.emit('data.changed', { table: 'terms' });
  return { summary: `已放进书架：${fetched.title}`, action: { label: '开始阅读', route: `/read/${saved.document_id}` }, document_id: saved.document_id, duplicate: false, title: fetched.title, unknown_ratio: ann.unknown_ratio, minutes: Math.max(1, Math.round(seg.word_count / WPM)) };
}

/** documents.reanalyze：按当前词库重新标注（词汇量变了、分词升级）；ai=true 时把 AI 状态重新置为 deferred 等补做 */
export async function runReanalyze(job: JobContext, ctx: Ctx, input: { document_id: string; ai?: boolean }) {
  const doc = await getDocument(ctx.db, input.document_id); if (!doc || doc.deleted_at) throw new TibiError('not_found', '文章不在了');
  const sections = await listSections(ctx.db, doc.id);
  await job.step('clear', async () => {
    const t = now();
    await ctx.db.run('UPDATE term_contexts SET deleted_at = ?, updated_at = ? WHERE document_id = ? AND deleted_at IS NULL', [t, t, doc.id]);
    return true;
  });
  const ann = await annotateDocument(job, ctx, doc.id, sections.map(s => s.id));
  if (input.ai) await markDeferred(ctx.db, doc.id);
  ctx.events.emit('data.changed', { table: 'documents', ids: [doc.id] });
  return { document_id: doc.id, unknown_ratio: ann.unknown_ratio };
}

export function registerImportPipeline(jobs: JobRunner, core: Core) {
  jobs.register('import', (job: JobContext, input: ImportInput) => runImport(job, core.ctx({ origin: 'ui', job_id: job.job_id }), input));
  jobs.register('analyze', async (job: JobContext, input: { document_id: string }) => {
    const r = await analyzeDocument(job, core.ctx({ origin: 'ui', job_id: job.job_id }), input.document_id);
    return { summary: r.ai_status === 'done' ? '总结好了' : r.ai_status === 'deferred' ? '模型暂时用不了，稍后补做' : '总结没有生成', ai_status: r.ai_status };   // 不带 document_id：后台补做不弹"开始阅读"
  });
  jobs.register('translate', async (job: JobContext, input: { section_id: string; sentence_ids?: string[] }) => {
    const r = await translateSection(job, core.ctx({ origin: 'ui', job_id: job.job_id }), input.section_id, input.sentence_ids);
    return { summary: `翻译了 ${r.translated} 句`, ...r };
  });
  jobs.register('reanalyze', (job: JobContext, input: { document_id: string; ai?: boolean }) => runReanalyze(job, core.ctx({ origin: 'ui', job_id: job.job_id }), input));
}

export { difficultyOfRatio };
