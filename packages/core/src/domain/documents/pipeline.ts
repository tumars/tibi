import { j, now, type Database } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import { normalizeForHash, sha256Hex } from '../../hash.js';
import type { Ctx } from '../../rpc/define.js';
import type { TimedSegment } from '../../platform.js';
import { TibiError, type Genre, type Kind, type Status, type Token, type TranscriptSource } from '../../types.js';
import { checkUrlShape } from '../../web/url.js';
import { alreadyDone, recordUndo, registerUndo } from '../shared/undo.js';
import { annotateSentences } from '../text/annotate.js';
import { cleanTitle, dropLeadingTitle } from '../text/title.js';
import { levelOfRatio } from '../text/level.js';
import { countWords, isTextBlock, segmentMarkdown, splitSentences, type Segmented } from '../text/segment.js';
import { groupTranscriptParagraphs, mergeTimedSegments, parseJsonChapters, parseTranscript, type TranscriptParagraph } from '../text/transcript.js';
import { bumpEncounter, contextExists, getTermsByTexts, hasPrimaryContext, insertContext, upsertForm, type TermRow } from '../terms/repo.js';
import { prefersLocalAsr, resolveAsrConfig } from '../profile/methods.js';
import { getSample, sampleUri, writeSampleAi } from './samples.js';
import { resolvePreviewEpisode } from '../feeds/preview.js';
import { linkImported, linkImportedItem } from '../feeds/repo.js';
import { putAiResult } from './analyze.js';
import { background } from './imports.js';
import { docMinutes, getDocument, getDocumentByHash, getDocumentByMediaUrl, insertDocument, insertSection, insertSentence, listSections, listSentences, setDocumentTags, TOKENIZER_VERSION } from './repo.js';

/**
 * 导入流水线（00 §3.1、05 §4.3、17 §5.2：固定流水线，不是模型驱动的技能，R10）。
 * 支持文章、书、图片 OCR、内置示例、播客单集（官方字幕流式 + 静默缓存 / 云端 BYOK ASR / 纯听兜底）与本地音频。
 */

export type ImportSource =
  | { type: 'text'; text: string; title?: string; generated?: boolean }
  | { type: 'url'; url: string; /** 网页抓不到标题时用（订阅条目自带的标题） */ title?: string }
  | { type: 'file'; path: string }
  | { type: 'images'; paths: string[] }
  | { type: 'sample'; id: string }
  | { type: 'podcast_item'; id: string }
  | { type: 'podcast_episode'; feed_url: string; guid: string; title?: string }
  | { type: 'audio'; path: string; transcript_path?: string; title?: string };

export interface ImportInput {
  source: ImportSource;
  hints?: { kind?: Kind; genre?: Genre; tags?: string[] };
  origin?: 'user' | 'deeplink' | 'mcp' | 'share' | 'chat';
  /** false：从订阅/电台里直接读，不进书架（默认进） */
  shelve?: boolean;
}

/** 一次导入：id 用来对应进度事件；progress 是界面上的一行说明 */
export interface ImportRun { id: string; signal?: AbortSignal; progress(label: string): void }

const AUDIO_EXTS = ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'opus'];
const MAX_AUDIO_BYTES = 300 * 1024 * 1024; // 单集下载上限 300 MB
const DEFAULT_CACHE_LIMIT = 2 * 1024 * 1024 * 1024; // 本地音频缓存上限 2 GB

interface Fetched {
  title: string; author?: string; markdown: string; source_type: string; source_uri?: string; published_at?: number; lang?: string; kind?: Kind; genre?: Genre;
  cover_path?: string;
  /** 电台单集专属字段 */
  media_url?: string; media_path?: string; duration_ms?: number; transcript_source?: TranscriptSource;
  timed_segments?: TimedSegment[];
  chapters_url?: string;
  need_silent_cache?: boolean;
}

function isAudioExt(ext: string) { return AUDIO_EXTS.includes(ext.toLowerCase()); }

/** 第一步：拿到干净的 Markdown（或带时间戳的电台逐字稿） */
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
    const cleaned = cleanTitle(art.title, { site: art.site_name, h1: art.h1, host: new URL(page.final_url).hostname });
    const title = cleaned && !/^https?:\/\/\S+$/i.test(cleaned) ? cleaned : s.title?.trim() || art.h1?.trim() || titleFromMarkdown(art.markdown);
    return { title, author: art.byline, markdown: dropLeadingTitle(art.markdown, title), source_type: 'url', source_uri: page.final_url, published_at: art.published_at, lang: art.lang };
  }
  if (s.type === 'podcast_item') {
    return fetchPodcastItem(job, ctx, s.id);
  }
  if (s.type === 'podcast_episode') {
    return fetchPodcastEpisode(job, ctx, s.feed_url, s.guid);
  }
  if (s.type === 'audio') {
    return fetchLocalAudio(job, ctx, s.path, s.transcript_path, s.title);
  }
  if (s.type === 'file') {
    if (!ctx.platform.isPathAllowed(s.path)) throw new TibiError('permission_denied', '这个文件没有经过选择或拖入');
    const ext = s.path.toLowerCase().split('.').pop() ?? '';
    const name = s.path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
    if (isAudioExt(ext)) return fetchLocalAudio(job, ctx, s.path, undefined, name);
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
    if (!['txt', 'md', 'markdown'].includes(ext)) throw new TibiError('invalid_source', `还不支持 .${ext} 文件。支持 EPUB、PDF、DOCX、TXT、Markdown 以及 MP3 / M4A / WAV 音频`);
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
  const { markdown } = await sample.load();
  return { title: sample.title, author: sample.author, markdown, source_type: 'sample', source_uri: sampleUri(sample.id), genre: sample.genre, kind: sample.kind };
}

interface EpisodePayload {
  title: string;
  author: string;
  url: string;
  published_at?: number;
  cover_path?: string;
  audio_url: string;
  audio_mime?: string;
  duration_ms?: number;
  transcript_url?: string;
  transcript_type?: string;
  chapters_url?: string;
  notes: string;
}

/** 共用单集拉取流程：Tier 0 官方字幕（流式 + 静默缓存）> Tier 2 云端 BYOK ASR > 纯听兜底 */
async function ingestPodcastEpisode(job: ImportRun, ctx: Ctx, ep: EpisodePayload): Promise<Fetched> {
  if (!checkUrlShape(ep.audio_url).ok) throw new TibiError('invalid_source', '音频地址不对，或者是本机 / 局域网地址');
  const base: Omit<Fetched, 'markdown'> = {
    title: ep.title,
    author: ep.author,
    kind: 'episode',
    source_type: 'podcast',
    source_uri: ep.url,
    published_at: ep.published_at,
    cover_path: ep.cover_path,
    media_url: ep.audio_url,
    duration_ms: ep.duration_ms,
    chapters_url: ep.chapters_url && checkUrlShape(ep.chapters_url).ok ? ep.chapters_url : undefined,
  };

  // Tier 0：优先拉取官方 <podcast:transcript>（免费秒开）
  if (ep.transcript_url && checkUrlShape(ep.transcript_url).ok) {
    job.progress('正在拉取官方逐字稿');
    try {
      const page = await ctx.platform.fetchUrl(ep.transcript_url, { timeout_ms: 15_000, signal: job.signal });
      if (page.status < 400 && page.body.trim()) {
        const segs = parseTranscript(page.body, page.content_type || ep.transcript_type || '');
        if (segs.length) {
          const md = buildTranscriptMarkdown(segs);
          return { ...base, markdown: md, timed_segments: segs, transcript_source: 'rss_vtt', need_silent_cache: true };
        }
      }
    } catch { /* 官方字幕拉取失败，优雅降级到 ASR 或纯听 */ }
  }

  // Tier 2：若未优先使用本地离线转写且已配置云端 BYOK ASR，下载并转写
  const asrCfg = (await prefersLocalAsr(ctx)) ? undefined : await resolveAsrConfig(ctx);
  if (asrCfg && ctx.platform.downloadMedia && ctx.platform.transcribeAudio) {
    job.progress('正在下载音频准备转写');
    const cacheKey = await sha256Hex(ep.audio_url).then(h => h.slice(0, 24));
    const dl = await ctx.platform.downloadMedia(ep.audio_url, cacheKey, {
      maxBytes: MAX_AUDIO_BYTES, signal: job.signal,
      onProgress: (loaded, total) => {
        const pct = total ? ` ${Math.min(99, Math.round((loaded / total) * 100))}%` : ` ${(loaded / (1 << 20)).toFixed(1)} MB`;
        job.progress(`正在下载音频${pct}`);
      },
    });
    job.progress('正在 AI 转写逐字稿');
    const tr = await ctx.platform.transcribeAudio(
      { path: dl.path, url: ep.audio_url, mime: dl.mime || ep.audio_mime || undefined },
      { config: asrCfg, signal: job.signal, onProgress: label => job.progress(label) },
    );
    const segs = mergeTimedSegments(tr.segments);
    if (segs.length) {
      const md = buildTranscriptMarkdown(segs);
      return {
        ...base, markdown: md, media_path: dl.path, duration_ms: base.duration_ms ?? tr.duration_ms,
        timed_segments: segs, transcript_source: 'cloud_asr', need_silent_cache: false,
      };
    }
  }

  // 兜底：纯听模式（保留 Show Notes 作为简介正文，流式播放 + 后台静默缓存，随时可补转写或导入字幕）
  return { ...base, markdown: ep.notes || ep.title, transcript_source: 'none', need_silent_cache: true };
}

/** 播客单集导入（已订阅 feed_items） */
async function fetchPodcastItem(job: ImportRun, ctx: Ctx, itemId: string): Promise<Fetched> {
  const row = await ctx.db.get<{
    id: string; feed_id: string; feed_title: string; feed_artwork: string | null;
    url: string; title: string; author: string | null; published_at: number | null; excerpt: string; content_md: string | null;
    audio_url: string | null; audio_mime: string | null; duration_ms: number | null;
    transcript_url: string | null; transcript_type: string | null; chapters_url: string | null; artwork_url: string | null;
  }>(
    `SELECT i.id, i.feed_id, f.title AS feed_title, f.artwork_url AS feed_artwork,
       i.url, i.title, i.author, i.published_at, i.excerpt, i.content_md,
       i.audio_url, i.audio_mime, i.duration_ms, i.transcript_url, i.transcript_type, i.chapters_url, i.artwork_url
     FROM feed_items i JOIN feeds f ON f.id = i.feed_id WHERE i.id = ? AND i.deleted_at IS NULL`,
    [itemId],
  );
  if (!row) throw new TibiError('not_found', '找不到这期单集');
  if (!row.audio_url) throw new TibiError('invalid_source', '这期条目没有音频地址');
  return ingestPodcastEpisode(job, ctx, {
    title: row.title,
    author: row.author || row.feed_title,
    url: row.url,
    published_at: row.published_at != null ? Number(row.published_at) : undefined,
    cover_path: row.artwork_url || row.feed_artwork || undefined,
    audio_url: row.audio_url,
    audio_mime: row.audio_mime ?? undefined,
    duration_ms: row.duration_ms != null ? Number(row.duration_ms) : undefined,
    transcript_url: row.transcript_url ?? undefined,
    transcript_type: row.transcript_type ?? undefined,
    chapters_url: row.chapters_url ?? undefined,
    notes: (row.content_md || row.excerpt || row.title).trim(),
  });
}

/** 播客单集免订阅试听导入（来自预览缓存或直接拉取 RSS，不写 feeds 表） */
async function fetchPodcastEpisode(job: ImportRun, ctx: Ctx, feedUrl: string, guid: string): Promise<Fetched> {
  const { feed, item } = await resolvePreviewEpisode(ctx, feedUrl, guid);
  const md = item.content_html && ctx.platform.htmlToMarkdown ? (() => { try { return ctx.platform.htmlToMarkdown!(item.content_html!, item.url).trim(); } catch { return ''; } })() : '';
  return ingestPodcastEpisode(job, ctx, {
    title: item.title,
    author: item.author || feed.title,
    url: item.url,
    published_at: item.published_at,
    cover_path: item.artwork_url || feed.artwork_url,
    audio_url: item.audio_url!,
    audio_mime: item.audio_mime,
    duration_ms: item.duration_ms,
    transcript_url: item.transcript_url,
    transcript_type: item.transcript_type,
    chapters_url: item.chapters_url,
    notes: (md || item.excerpt || item.title).trim(),
  });
}

/** 本地音频文件导入（.mp3 / .m4a / .wav / .ogg），可选附带 .vtt/.srt 字幕 */
async function fetchLocalAudio(job: ImportRun, ctx: Ctx, path: string, transcriptPath?: string, title?: string): Promise<Fetched> {
  if (!ctx.platform.isPathAllowed(path)) throw new TibiError('permission_denied', '这个音频文件没有经过选择或拖入');
  if (transcriptPath && !ctx.platform.isPathAllowed(transcriptPath)) throw new TibiError('permission_denied', '字幕文件没有经过选择或拖入');
  const fileName = path.split(/[\\/]/).pop() ?? 'audio';
  const cleanName = title?.trim() || fileName.replace(/\.[^.]+$/, '');
  const key = await sha256Hex(`${path}:${Date.now()}`).then(h => h.slice(0, 24));
  let mediaPath = path;
  let mime = 'audio/mpeg';
  if (ctx.platform.copyMedia) {
    job.progress('正在整理音频文件');
    const copied = await ctx.platform.copyMedia(path, key);
    mediaPath = copied.path; mime = copied.mime;
  }

  // 若用户同时选了字幕文件
  if (transcriptPath && ctx.platform.readFile) {
    job.progress('正在解析字幕');
    const raw = new TextDecoder('utf-8').decode(await ctx.platform.readFile(transcriptPath));
    const segs = parseTranscript(raw, transcriptPath);
    if (segs.length) {
      return {
        title: cleanName, kind: 'episode', source_type: 'audio', source_uri: fileName,
        media_path: mediaPath, markdown: buildTranscriptMarkdown(segs), timed_segments: segs, transcript_source: 'manual',
      };
    }
  }

  // 否则若未优先使用本地离线转写，尝试云端 BYOK ASR
  const asrCfg = (await prefersLocalAsr(ctx)) ? undefined : await resolveAsrConfig(ctx);
  if (asrCfg && ctx.platform.transcribeAudio) {
    job.progress('正在 AI 转写逐字稿');
    const tr = await ctx.platform.transcribeAudio(
      { path: mediaPath, mime },
      { config: asrCfg, signal: job.signal, onProgress: label => job.progress(label) },
    );
    const segs = mergeTimedSegments(tr.segments);
    if (segs.length) {
      return {
        title: cleanName, kind: 'episode', source_type: 'audio', source_uri: fileName,
        media_path: mediaPath, duration_ms: tr.duration_ms, markdown: buildTranscriptMarkdown(segs), timed_segments: segs, transcript_source: 'cloud_asr',
      };
    }
  }

  return {
    title: cleanName, kind: 'episode', source_type: 'audio', source_uri: fileName,
    media_path: mediaPath, markdown: `Audio file: ${cleanName}`, transcript_source: 'none',
  };
}

function buildTranscriptMarkdown(segments: TimedSegment[]): string {
  const paras = groupTranscriptParagraphs(segments);
  return paras.map(p => p.sentences.map(s => s.text).join(' ')).join('\n\n');
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
  if (code >= 1 || /github\.com|stackoverflow|docs\.|developer\.|rust-lang|python\.org|syntax\.fm|changelog|darknetdiaries|corecursive/i.test(host)) return 'tech';
  if (/bbc\.|bbci\.|nytimes|reuters|theguardian|cnn\.|apnews|bloomberg|economist|wsj\.|ft\.com|npr\.org|voanews/i.test(host)) return 'news';
  const quotes = (md.match(/[“"][^”"]{10,}[”"]/g) ?? []).length;
  if (quotes >= 5 && / (he|she) (said|asked|replied)/i.test(md)) return 'lit';
  return 'general';
}

async function insertTimedSentences(tx: Database, section_id: string, paras: TranscriptParagraph[]): Promise<void> {
  let idx = 0;
  for (const p of paras) {
    for (const s of p.sentences) {
      await insertSentence(tx, {
        section_id, paragraph_idx: p.paragraph_idx, block_type: 'prose', idx: idx++, text: s.text,
        start_ms: s.start_ms, end_ms: s.end_ms, speaker: s.speaker,
      });
    }
  }
}

registerUndo<{ document_id: string }>('save_document', async (p, ctx) => {
  const t = now();
  await ctx.db.run('UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ?', [t, t, p.document_id]);
  ctx.events.emit('data.changed', { table: 'documents', ids: [p.document_id] });
});

interface SaveOut { document_id: string; section_ids: string[]; duplicate: boolean; /** 之前读过但不在书架里，这次导入把它放进了书架 */ shelvedNow?: boolean }

/** 第三步：入库（documents / sections / sentences），内容哈希去重（播客优先按 media_url 去重） */
async function saveStep(job: ImportRun, ctx: Ctx, fetched: Fetched, seg: Segmented | undefined, input: ImportInput): Promise<SaveOut> {
  const hashSeed = fetched.media_url ? `media:${fetched.media_url}` : fetched.media_path && fetched.transcript_source === 'none' ? `audio:${fetched.media_path}` : normalizeForHash(fetched.markdown);
  const hash = await sha256Hex(hashSeed);
  const key = `${job.id}:save`;
  const existing = (fetched.media_url ? await getDocumentByMediaUrl(ctx.db, fetched.media_url) : undefined) ?? await getDocumentByHash(ctx.db, hash);
  if (existing) {
    const shelvedNow = input.shelve !== false && Number(existing.shelved) === 0;
    if (shelvedNow) { await ctx.db.run('UPDATE documents SET shelved = 1, updated_at = ? WHERE id = ?', [now(), existing.id]); ctx.events.emit('data.changed', { table: 'documents', ids: [existing.id] }); }
    return { document_id: existing.id, section_ids: (await listSections(ctx.db, existing.id)).map(s => s.id), duplicate: !(await alreadyDone(ctx.db, key)), shelvedNow };
  }
  const genre = input.hints?.genre ?? fetched.genre ?? guessGenre(fetched.markdown, fetched.source_uri);
  const out = await ctx.db.transaction(async tx => {
    if (fetched.timed_segments?.length) {
      const paras = groupTranscriptParagraphs(fetched.timed_segments);
      const content_md = paras.map(p => p.sentences.map(s => s.text).join(' ')).join('\n\n');
      const word_count = countWords(content_md);
      const lastEnd = fetched.timed_segments.reduce((m, s) => Math.max(m, s.end_ms), 0);
      const document_id = await insertDocument(tx, {
        title: fetched.title, author: fetched.author, kind: 'episode', genre, source_type: fetched.source_type, source_uri: fetched.source_uri,
        lang: 'en', content_hash: hash, word_count, section_count: 1, published_at: fetched.published_at, cover_path: fetched.cover_path,
        shelved: input.shelve !== false, media_url: fetched.media_url, media_path: fetched.media_path,
        duration_ms: fetched.duration_ms ?? (lastEnd > 0 ? lastEnd : undefined), transcript_source: fetched.transcript_source,
      });
      const section_id = await insertSection(tx, { document_id, idx: 0, title: fetched.title, content_md, word_count });
      await insertTimedSentences(tx, section_id, paras);
      if (input.hints?.tags?.length) await setDocumentTags(tx, document_id, input.hints.tags, { source: 'user' });
      await recordUndo(tx, ctx, { tool: 'save_document', args: { title: fetched.title }, undo_payload: { document_id }, idempotency_key: key });
      return { document_id, section_ids: [section_id], duplicate: false };
    }

    const s = seg!;
    const document_id = await insertDocument(tx, {
      title: fetched.title, author: fetched.author, kind: fetched.kind === 'episode' ? 'episode' : s.kind, genre,
      source_type: fetched.source_type, source_uri: fetched.source_uri, lang: s.lang,
      content_hash: hash, word_count: s.word_count, section_count: s.sections.length, published_at: fetched.published_at,
      cover_path: fetched.cover_path, shelved: input.shelve !== false,
      media_url: fetched.media_url, media_path: fetched.media_path, duration_ms: fetched.duration_ms, transcript_source: fetched.transcript_source,
    });
    const section_ids: string[] = [];
    for (const sec of s.sections) {
      const content_md = sec.paragraphs.map(p => p.block_type === 'code' ? '```' + (p.lang ?? '') + '\n' + p.text + '\n```' : p.block_type === 'image' ? `![${p.text}](${p.src})` : p.block_type === 'heading' ? '## ' + p.text : p.block_type === 'list_item' ? '- ' + p.text : p.block_type === 'quote' ? '> ' + p.text : p.text).join('\n\n');
      const section_id = await insertSection(tx, { document_id, idx: sec.idx, title: sec.title, content_md, word_count: sec.paragraphs.filter(isTextBlock).reduce((a, p) => a + countWords(p.text), 0) });
      section_ids.push(section_id);
      let idx = 0;
      for (const p of sec.paragraphs) {
        if (!isTextBlock(p)) continue;
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

/** 下载并落盘电台单集音频，同时按 2 GB LRU 清理旧缓存并更新 documents.media_path */
async function cacheEpisodeMedia(
  ctx: Ctx,
  document_id: string,
  media_url: string,
  opts?: { onProgress?: (loaded: number, total?: number) => void },
): Promise<string> {
  if (!checkUrlShape(media_url).ok) throw new TibiError('invalid_source', '音频地址不对，或者是本机 / 局域网地址');
  const dl = await ctx.platform.downloadMedia!(media_url, document_id, { maxBytes: MAX_AUDIO_BYTES, onProgress: opts?.onProgress });
  const t = now();
  await ctx.db.run('UPDATE documents SET media_path = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [dl.path, t, document_id]);
  if (ctx.platform.pruneMediaCache) {
    const { removed_paths } = await ctx.platform.pruneMediaCache(DEFAULT_CACHE_LIMIT);
    for (const rp of removed_paths) {
      if (rp !== dl.path) await ctx.db.run('UPDATE documents SET media_path = NULL, updated_at = ? WHERE media_path = ?', [t, rp]);
    }
  }
  ctx.events.emit('data.changed', { table: 'documents', ids: [document_id] });
  return dl.path;
}

/** 后台静默缓存音频（流式先播、后台落盘，并按 2 GB LRU 清理） */
function scheduleSilentCache(ctx: Ctx, document_id: string, media_url: string) {
  if (!ctx.platform.downloadMedia) return;
  background(`media_cache:${document_id}`, async () => {
    try { await cacheEpisodeMedia(ctx, document_id, media_url); }
    catch { /* 静默缓存失败不影响流式播放 */ }
  });
}

/** 后台拉取 Podcasting 2.0 官方 JSON 章节 */
function scheduleFetchChapters(ctx: Ctx, document_id: string, chapters_url: string) {
  if (!checkUrlShape(chapters_url).ok) return;
  background(`chapters:${document_id}`, async () => {
    try {
      const page = await ctx.platform.fetchUrl(chapters_url, { timeout_ms: 10_000 });
      if (page.status >= 400) return;
      const chapters = parseJsonChapters(page.body);
      if (!chapters.length) return;
      await putAiResult(ctx.db, document_id, 'chapters', chapters, 'rss');
      ctx.events.emit('data.changed', { table: 'documents', ids: [document_id] });
    } catch { /* 官方章节拉取失败不影响 AI 生成章节 */ }
  });
}

/**
 * 第四步：分词、还原、按词库标状态；写 sentences.tokens、term_forms、term_contexts（R7：不碰 FSRS）。
 */
export async function annotateSection(db: Database, ctx: Ctx, section_id: string, opts: { document_id: string; bumpEncounters?: boolean }): Promise<{ counts: { total: number; new: number; learning: number }; rare: number }> {
  const sentences = await listSentences(db, section_id);
  const texts = sentences.map(s => s.text);
  const phrases = (await db.all<{ text: string }>("SELECT text FROM terms WHERE kind = 'phrase' AND deleted_at IS NULL")).map(r => r.text);
  let known = new Map<string, TermRow>();
  const res = await annotateSentences({
    sentences: texts, dict: ctx.dict, phrases, ignoreProperNouns: true,
    statusesOf: async lemmas => {
      known = await getTermsByTexts(db, lemmas);
      const out = new Map<string, Status | undefined>();
      for (const [k, r] of known) if (!r.deleted_at) out.set(k, r.status as Status);
      return out;
    },
  });
  const bump = opts.bumpEncounters !== false;
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
        if (bump) {
          encounters.set(row.id, (encounters.get(row.id) ?? 0) + 1);
          await upsertForm(tx, row.id, tk.t.toLowerCase(), t);
        }
        if (seen.has(row.id)) continue; seen.add(row.id);
        if (!(await contextExists(tx, row.id, s.id))) await insertContext(tx, { term_id: row.id, source: 'article', document_id: opts.document_id, sentence_id: s.id, surface: tk.t, is_primary: !(await hasPrimaryContext(tx, row.id)) });
      }
    }
    if (bump) for (const [term_id, n] of encounters) await bumpEncounter(tx, term_id, n, t);
    for (const ph of res.phrases) {
      const row = await tx.get<{ id: string }>("SELECT id FROM terms WHERE kind = 'phrase' AND text = ? AND deleted_at IS NULL", [ph.text]);
      if (!row) continue;
      for (const si of ph.sentence_idx) { const s = sentences[si]!; if (!(await contextExists(tx, row.id, s.id))) await insertContext(tx, { term_id: row.id, source: 'article', document_id: opts.document_id, sentence_id: s.id, is_primary: !(await hasPrimaryContext(tx, row.id)) }); }
      if (bump) await bumpEncounter(tx, row.id, ph.sentence_idx.length, t);
    }
    await tx.run('UPDATE sections SET status = ?, tokenizer_version = ?, updated_at = ? WHERE id = ?', ['ready', TOKENIZER_VERSION, t, section_id]);
  });
  return { counts: res.counts, rare: res.rare_ratio === undefined ? -1 : Math.round(res.rare_ratio * res.counts.total) };
}

const LAZY_EAGER = 2;

const ANNOTATING = new Map<string, Promise<unknown>>();

function withSectionLock<T>(section_id: string, fn: () => Promise<T>): Promise<T> {
  const prev = ANNOTATING.get(section_id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  // tracked 只负责清理槽位，吞掉副本的拒绝状态以免产生 UnhandledPromiseRejection 弄挂进程
  const tracked = next.catch(() => undefined).finally(() => { if (ANNOTATING.get(section_id) === tracked) ANNOTATING.delete(section_id); });
  ANNOTATING.set(section_id, tracked);
  return next;
}

export async function ensureAnnotated(ctx: Ctx, section_id: string): Promise<boolean> {
  const pre = await ctx.db.get<{ status: string }>('SELECT status FROM sections WHERE id = ? AND deleted_at IS NULL', [section_id]);
  if (!pre || pre.status !== 'pending') return false;
  const ran = await withSectionLock(section_id, async () => {
    const sec = await ctx.db.get<{ status: string; document_id: string; tokenizer_version: string | null }>('SELECT status, document_id, tokenizer_version FROM sections WHERE id = ? AND deleted_at IS NULL', [section_id]);
    if (!sec || sec.status !== 'pending') return false;
    const doc = await getDocument(ctx.db, sec.document_id); if (!doc || doc.status !== 'ready') return false;
    await annotateSection(ctx.db, ctx, section_id, { document_id: doc.id, bumpEncounters: !sec.tokenizer_version });
    return true;
  });
  if (ran) ctx.events.emit('data.changed', { table: 'terms' });
  return ran;
}

async function annotateDocument(job: ImportRun | undefined, ctx: Ctx, document_id: string, section_ids: string[], opts: { bumpEncounters?: boolean } = {}): Promise<{ level?: string }> {
  const doc = await getDocument(ctx.db, document_id); if (!doc) throw new TibiError('not_found', '文章不在了');
  let total = 0, rare = 0, hasFreq = true;
  const eager = doc.kind === 'book' ? section_ids.slice(0, LAZY_EAGER) : section_ids;
  for (let i = 0; i < eager.length; i++) {
    job?.progress(eager.length > 1 ? `正在分析第 ${i + 1} / ${eager.length} 章` : '正在分析');
    const r = await withSectionLock(section_ids[i]!, () => annotateSection(ctx.db, ctx, section_ids[i]!, { document_id, bumpEncounters: opts.bumpEncounters }));
    total += r.counts.total; if (r.rare < 0) hasFreq = false; else rare += r.rare;
  }
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
  if (input.source.type === 'url') {
    const doc = await getDocument(ctx.db, r.document_id);
    if (await linkImported(ctx.db, [input.source.url, doc?.source_uri], r.document_id)) ctx.events.emit('data.changed', { table: 'feed_items' });
  } else if (input.source.type === 'podcast_item') {
    if (await linkImportedItem(ctx.db, input.source.id, r.document_id)) ctx.events.emit('data.changed', { table: 'feed_items' });
  } else if (input.source.type === 'podcast_episode') {
    const doc = await getDocument(ctx.db, r.document_id);
    if (await linkImported(ctx.db, [doc?.source_uri, doc?.media_url], r.document_id)) ctx.events.emit('data.changed', { table: 'feed_items' });
  }
  return r;
}

async function importOnce(job: ImportRun, ctx: Ctx, input: ImportInput): Promise<ImportResult> {
  job.progress(input.source.type === 'podcast_item' || input.source.type === 'podcast_episode' || input.source.type === 'audio' ? '准备电台单集' : '取正文');
  const fetched = await fetchStep(job, ctx, input);
  const isTimedEpisode = !!fetched.timed_segments?.length;
  const seg = isTimedEpisode ? undefined : segmentMarkdown(fetched.markdown, { kind: input.hints?.kind ?? (fetched.kind === 'episode' ? 'article' : fetched.kind) ?? 'article', title: fetched.title });
  if (!isTimedEpisode) {
    if (fetched.kind !== 'episode' && seg!.lang !== 'en') throw new TibiError('invalid_source', '目前只支持英文文章');
    if (fetched.kind !== 'episode' && seg!.word_count < 5) throw new TibiError('invalid_source', '内容太短了');
  }
  const saved = await saveStep(job, ctx, fetched, seg, input);
  if (saved.duplicate) {
    const d = (await getDocument(ctx.db, saved.document_id))!;
    const mins = docMinutes(d);
    return { summary: saved.shelvedNow ? `已放进书架：${d.title}` : Number(d.shelved) ? '这篇已经在书架里' : `可以听读了：${d.title}`, action: { label: '打开', route: `/read/${saved.document_id}` }, document_id: saved.document_id, duplicate: true, title: d.title, level: d.difficulty_cefr ?? undefined, minutes: mins };
  }
  const ann = await annotateDocument(job, ctx, saved.document_id, saved.section_ids);
  const wordCount = isTimedEpisode ? countWords(fetched.markdown) : seg!.word_count;
  const minutes = docMinutes({ kind: fetched.kind ?? 'article', duration_ms: fetched.duration_ms ?? null, word_count: wordCount });
  await ctx.db.run('INSERT INTO learning_events(id, type, payload, created_at) VALUES (?,?,?,?)', [uuidv7(), 'document_imported', j.str({ document_id: saved.document_id, source_type: fetched.source_type, title: fetched.title, word_count: wordCount }), now()]);
  if (fetched.chapters_url) scheduleFetchChapters(ctx, saved.document_id, fetched.chapters_url);
  if (fetched.need_silent_cache && fetched.media_url) scheduleSilentCache(ctx, saved.document_id, fetched.media_url);

  const sample = input.source.type === 'sample' ? getSample(input.source.id) : undefined;
  if (sample) {
    await writeSampleAi(ctx.db, saved.document_id, (await sample.load()).ai);
    ctx.events.emit('data.changed', { table: 'documents', ids: [saved.document_id] });
    ctx.events.emit('data.changed', { table: 'terms' });
    return { summary: `已放进书架：${fetched.title}`, action: { label: '开始阅读', route: `/read/${saved.document_id}` }, document_id: saved.document_id, duplicate: false, title: fetched.title, level: ann.level, minutes };
  }
  ctx.events.emit('data.changed', { table: 'documents', ids: [saved.document_id] });
  ctx.events.emit('data.changed', { table: 'terms' });
  const openVerb = fetched.kind === 'episode' ? '可以听读了' : '可以读了';
  return { summary: input.shelve === false ? `${openVerb}：${fetched.title}` : `已放进书架：${fetched.title}`, action: { label: fetched.kind === 'episode' ? '开始听读' : '开始阅读', route: `/read/${saved.document_id}` }, document_id: saved.document_id, duplicate: false, title: fetched.title, level: ann.level, minutes };
}

/** 确保电台单集音频已缓存在本机（供桌面本地离线 ASR 读取，避开浏览器 CORS 并复用 SSRF 校验） */
export async function ensureEpisodeMedia(ctx: Ctx, document_id: string): Promise<{ media_path?: string; media_url?: string; duration_ms?: number }> {
  const doc = await getDocument(ctx.db, document_id);
  if (!doc || doc.deleted_at) throw new TibiError('not_found', '找不到这期单集');
  if (doc.kind !== 'episode') throw new TibiError('invalid_params', '只有电台单集才有音频文件');
  const duration_ms = doc.duration_ms != null ? Number(doc.duration_ms) : undefined;
  if (doc.media_path) {
    return { media_path: doc.media_path, ...(doc.media_url ? { media_url: doc.media_url } : {}), ...(duration_ms ? { duration_ms } : {}) };
  }
  if (!doc.media_url) throw new TibiError('invalid_source', '缺少音频文件');
  if (!ctx.platform.downloadMedia) {
    return { media_url: doc.media_url, ...(duration_ms ? { duration_ms } : {}) };
  }
  const mediaPath = await cacheEpisodeMedia(ctx, doc.id, doc.media_url);
  return { media_path: mediaPath, media_url: doc.media_url, ...(duration_ms ? { duration_ms } : {}) };
}

/** 对已有电台单集事后补跑云端 ASR 转写、写入本地离线转写结果，或导入本地 .vtt / .srt 字幕文件 */
export async function transcribeEpisode(
  ctx: Ctx,
  p: { document_id: string; transcript_path?: string; segments?: TimedSegment[]; duration_ms?: number; transcript_source?: TranscriptSource; onProgress?: (label: string) => void },
): Promise<{ sentences: number; transcript_source: TranscriptSource }> {
  const doc = await getDocument(ctx.db, p.document_id);
  if (!doc || doc.deleted_at) throw new TibiError('not_found', '找不到这期单集');
  if (doc.kind !== 'episode') throw new TibiError('invalid_params', '只有电台单集才能转写逐字稿');

  let segs: TimedSegment[] = [];
  let source: TranscriptSource = 'cloud_asr';
  let durationMs = doc.duration_ms != null ? Number(doc.duration_ms) : undefined;
  let mediaPath = doc.media_path ?? undefined;

  if (p.segments) {
    segs = mergeTimedSegments(p.segments);
    if (!segs.length) throw new TibiError('invalid_source', '语音转写没有识别出有效文本');
    durationMs = durationMs ?? (p.duration_ms && p.duration_ms > 0 ? p.duration_ms : undefined);
    source = p.transcript_source ?? 'local_asr';
  } else if (p.transcript_path) {
    if (!ctx.platform.isPathAllowed(p.transcript_path)) throw new TibiError('permission_denied', '字幕文件没有经过选择或拖入');
    if (!ctx.platform.readFile) throw new TibiError('invalid_source', '这里不能读取本地字幕文件');
    p.onProgress?.('正在解析字幕文件');
    const raw = new TextDecoder('utf-8').decode(await ctx.platform.readFile(p.transcript_path));
    segs = parseTranscript(raw, p.transcript_path);
    if (!segs.length) throw new TibiError('invalid_source', '字幕文件里没有解析出有效内容');
    source = 'manual';
  } else {
    const asrCfg = await resolveAsrConfig(ctx);
    if (!asrCfg) throw new TibiError('model_unavailable', '还没有配置语音转写服务。可以开启本地离线转写，或到 设置 → 模型 中添加硅基流动 / Groq / OpenAI / Deepgram');
    if (!ctx.platform.transcribeAudio) throw new TibiError('invalid_source', '当前运行环境不支持云端语音转写');
    if (!mediaPath) {
      if (!doc.media_url || !ctx.platform.downloadMedia) throw new TibiError('invalid_source', '缺少音频文件，无法转写');
      p.onProgress?.('正在下载音频准备转写');
      mediaPath = await cacheEpisodeMedia(ctx, doc.id, doc.media_url, {
        onProgress: (loaded, total) => p.onProgress?.(`正在下载音频${total ? ` ${Math.min(99, Math.round((loaded / total) * 100))}%` : ''}`),
      });
    }
    p.onProgress?.('正在 AI 转写逐字稿');
    const tr = await ctx.platform.transcribeAudio({ path: mediaPath, url: doc.media_url ?? undefined }, { config: asrCfg, onProgress: p.onProgress });
    segs = mergeTimedSegments(tr.segments);
    if (!segs.length) throw new TibiError('invalid_source', '语音转写没有识别出文本');
    durationMs = durationMs ?? tr.duration_ms;
    source = 'cloud_asr';
  }

  const paras = groupTranscriptParagraphs(segs);
  const content_md = paras.map(x => x.sentences.map(s => s.text).join(' ')).join('\n\n');
  const word_count = countWords(content_md);
  const lastEnd = segs.reduce((m, s) => Math.max(m, s.end_ms), 0);
  const finalDuration = durationMs ?? (lastEnd > 0 ? lastEnd : null);
  const t = now();

  const sections = await listSections(ctx.db, doc.id);
  const sectionId = sections[0]?.id;
  if (!sectionId) throw new TibiError('not_found', '缺少章节记录');

  await withSectionLock(sectionId, async () => {
    await ctx.db.transaction(async tx => {
      await tx.run('UPDATE sentences SET deleted_at = ?, updated_at = ? WHERE section_id = ? AND deleted_at IS NULL', [t, t, sectionId]);
      await tx.run('UPDATE term_contexts SET deleted_at = ?, updated_at = ? WHERE document_id = ? AND deleted_at IS NULL', [t, t, doc.id]);
      await tx.run('UPDATE sections SET content_md = ?, word_count = ?, status = ?, tokenizer_version = NULL, updated_at = ? WHERE id = ?', [content_md, word_count, 'pending', t, sectionId]);
      await insertTimedSentences(tx, sectionId, paras);
      await tx.run('UPDATE documents SET word_count = ?, duration_ms = COALESCE(?, duration_ms), transcript_source = ?, ai_status = ?, updated_at = ? WHERE id = ?',
        [word_count, finalDuration, source, 'deferred', t, doc.id]);
      await tx.run("UPDATE ai_results SET deleted_at = ?, updated_at = ? WHERE scope = 'document' AND target_id = ? AND model != 'rss' AND deleted_at IS NULL", [t, t, doc.id]);
    });
    const r = await annotateSection(ctx.db, ctx, sectionId, { document_id: doc.id });
    const rare_ratio = r.rare < 0 || !r.counts.total ? null : r.rare / r.counts.total;
    const level = rare_ratio === null ? null : levelOfRatio(rare_ratio);
    await ctx.db.run('UPDATE documents SET status = ?, rare_ratio = ?, difficulty_cefr = ?, updated_at = ? WHERE id = ?', ['ready', rare_ratio, level, now(), doc.id]);
  });
  ctx.events.emit('data.changed', { table: 'documents', ids: [doc.id] });
  ctx.events.emit('data.changed', { table: 'sentences', ids: [sectionId] });
  return { sentences: segs.length, transcript_source: source };
}

/** documents.reanalyze：按当前词库重新标注；ai=true 时把 AI 状态置回 deferred */
export async function runReanalyze(ctx: Ctx, input: { document_id: string; ai?: boolean }) {
  const doc = await getDocument(ctx.db, input.document_id); if (!doc || doc.deleted_at) throw new TibiError('not_found', '文章不在了');
  const sections = await listSections(ctx.db, doc.id);
  const t = now();
  await ctx.db.transaction(async tx => {
    // 保留用户收藏或写了语境义的句子；其余由重新标注重建，并把全部章节置回 pending（书的后几章打开时懒重标）
    await tx.run('UPDATE term_contexts SET deleted_at = ?, updated_at = ? WHERE document_id = ? AND deleted_at IS NULL AND is_favorite = 0 AND meaning_in_context IS NULL', [t, t, doc.id]);
    await tx.run("UPDATE sections SET status = 'pending', updated_at = ? WHERE document_id = ? AND deleted_at IS NULL", [t, doc.id]);
  });
  const ann = await annotateDocument(undefined, ctx, doc.id, sections.map(s => s.id), { bumpEncounters: false });
  if (input.ai) await markDeferred(ctx.db, doc.id);
  ctx.events.emit('data.changed', { table: 'documents', ids: [doc.id] });
  return { document_id: doc.id, level: ann.level };
}

export async function recoverAnalysis(db: Database) {
  const t = now();
  await db.run("UPDATE documents SET ai_status = 'deferred', updated_at = ? WHERE ai_status = 'running'", [t]);
  await db.run("UPDATE sections SET ai_status = 'deferred', updated_at = ? WHERE ai_status = 'running'", [t]);
}
