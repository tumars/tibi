import type { TimedSegment } from '../../platform.js';

/**
 * 字幕解析与自然句规整（17 §5.1，纯 TS，R11）：
 * - 支持 WebVTT (.vtt)、SubRip (.srt)、Podcasting 2.0 JSON transcript、以及纯文本兜底；
 * - 原始字幕常按屏幕字数硬拆（一句话拆成 3 条 cue），合并为自然句：按句末标点、发言人变化或 >1.5s 静音间隔断句，
 *   保留首 cue 的 start_ms、末 cue 的 end_ms 与 speaker，保证阅读流畅与精准句级回放。
 */

const PAUSE_BREAK_MS = 1500;
const MAX_MERGED_CHARS = 320;
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

/** 解析 00:01:23.456 / 01:23.456 / 00:01:23,456 为毫秒 */
export function parseTimestampMs(raw: string): number | undefined {
  const s = raw.trim().replace(',', '.');
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3) return undefined;
  const nums = parts.map(Number);
  if (nums.some(n => !Number.isFinite(n) || n < 0)) return undefined;
  if (nums.length === 3) return Math.round((nums[0]! * 3600 + nums[1]! * 60 + nums[2]!) * 1000);
  return Math.round((nums[0]! * 60 + nums[1]!) * 1000);
}

/** 清理 VTT / SRT 里的标签与控制符，提取 <v Speaker> 说话人 */
function cleanCueText(raw: string): { text: string; speaker?: string } {
  let speaker: string | undefined;
  let t = raw.trim();
  const vTag = t.match(/^<v(?:\.[^>\s]+)?\s+([^>]+)>/i);
  if (vTag) {
    speaker = vTag[1]!.trim();
    t = t.slice(vTag[0].length);
  }
  t = t
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  // 识别 "Host: Hello" / "[Speaker 1] Hello" 形式的前缀
  if (!speaker) {
    const colon = t.match(/^([A-Z][A-Za-z0-9 ._-]{0,28}):\s+(.+)$/);
    if (colon && !/^(https?|note|tip|warning)$/i.test(colon[1]!)) {
      speaker = colon[1]!.trim();
      t = colon[2]!.trim();
    }
  }
  return { text: t, ...(speaker ? { speaker } : {}) };
}

/** 解析 WebVTT 或 SRT 为原始片段 */
export function parseVttOrSrt(raw: string): TimedSegment[] {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const out: TimedSegment[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(lines[0]!)) continue;
    const timeIdx = lines.findIndex(l => l.includes('-->'));
    if (timeIdx < 0) continue;
    const timeLine = lines[timeIdx]!;
    const m = timeLine.match(/(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})/);
    if (!m) continue;
    const start_ms = parseTimestampMs(m[1]!);
    const end_ms = parseTimestampMs(m[2]!);
    if (start_ms === undefined || end_ms === undefined) continue;
    const body = lines.slice(timeIdx + 1).join(' ');
    const cleaned = cleanCueText(body);
    if (!cleaned.text) continue;
    out.push({ text: cleaned.text, start_ms, end_ms: Math.max(start_ms, end_ms), ...(cleaned.speaker ? { speaker: cleaned.speaker } : {}) });
  }
  return out;
}

/** 解析 Podcasting 2.0 JSON transcript（支持 { segments: [...] } 或数组） */
export function parseJsonTranscript(raw: string): TimedSegment[] {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  const list = Array.isArray(data)
    ? data
    : (data && typeof data === 'object' && Array.isArray((data as { segments?: unknown[] }).segments)
      ? (data as { segments: unknown[] }).segments
      : []);
  const out: TimedSegment[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const body = String(r.body ?? r.text ?? '').replace(/\s+/g, ' ').trim();
    if (!body) continue;
    const startSec = Number(r.startTime ?? r.start ?? 0);
    const endSec = Number(r.endTime ?? r.end ?? startSec);
    // 兼容秒与毫秒（部分生成工具给秒，部分给毫秒；Podcasting 2.0 规范是秒）
    const start_ms = Number.isFinite(startSec) ? Math.round(startSec * 1000) : 0;
    const end_ms = Number.isFinite(endSec) ? Math.max(start_ms, Math.round(endSec * 1000)) : start_ms;
    const speaker = typeof r.speaker === 'string' && r.speaker.trim() ? r.speaker.trim() : undefined;
    out.push({ text: body, start_ms, end_ms, ...(speaker ? { speaker } : {}) });
  }
  return out;
}

/** 根据内容与 MIME 类型自动解析字幕并规整为自然句 */
export function parseTranscript(raw: string, contentType = ''): TimedSegment[] {
  const head = raw.replace(/^\uFEFF/, '').trimStart();
  if (!head) return [];
  let segments: TimedSegment[] = [];
  if (/json/i.test(contentType) || head.startsWith('{') || head.startsWith('[')) {
    segments = parseJsonTranscript(head);
  }
  if (!segments.length && (/vtt|srt/i.test(contentType) || /^WEBVTT\b/i.test(head) || /\d{2}:\d{2}[.,]\d{3}\s*-->/.test(head.slice(0, 4096)))) {
    segments = parseVttOrSrt(head);
  }
  if (segments.length) return mergeTimedSegments(segments);
  // 纯文本兜底（无时间戳，按段落/句拆，start_ms/end_ms 置 0）
  return head
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(text => ({ text, start_ms: 0, end_ms: 0 }));
}

/**
 * 将碎片 cue 合并为自然句，同时保持精准起止时间戳与发言人边界。
 * 也用于清洗云端 ASR 返回的过碎片段。
 */
export function mergeTimedSegments(raw: TimedSegment[]): TimedSegment[] {
  if (!raw.length) return [];
  const sorted = [...raw].sort((a, b) => a.start_ms - b.start_ms);
  const out: TimedSegment[] = [];
  let cur: TimedSegment | undefined;

  for (const seg of sorted) {
    const text = seg.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start_ms = Math.max(0, Math.round(seg.start_ms));
    const end_ms = Math.max(start_ms, Math.round(seg.end_ms));
    const speaker = seg.speaker?.trim() || undefined;

    if (!cur) {
      cur = { text, start_ms, end_ms, ...(speaker ? { speaker } : {}) };
      continue;
    }

    const speakerChanged = !!(speaker && cur.speaker && speaker !== cur.speaker) || (!!speaker && !cur.speaker && cur.text.length > 0 && SENTENCE_END.test(cur.text));
    const longPause = start_ms - cur.end_ms > PAUSE_BREAK_MS;
    const ended = SENTENCE_END.test(cur.text);
    const tooLong = cur.text.length + 1 + text.length > MAX_MERGED_CHARS;

    if (speakerChanged || longPause || ended || tooLong) {
      out.push(cur);
      cur = { text, start_ms, end_ms, ...(speaker ? { speaker } : {}) };
    } else {
      cur.text = `${cur.text} ${text}`;
      cur.end_ms = Math.max(cur.end_ms, end_ms);
      if (!cur.speaker && speaker) cur.speaker = speaker;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 将 TimedSegment[] 按发言人与时间间隙组织为段落（用于写 content_md 与 paragraph_idx） */
export interface TranscriptParagraph {
  paragraph_idx: number;
  speaker?: string;
  sentences: TimedSegment[];
}

export function groupTranscriptParagraphs(segments: TimedSegment[], maxPerPara = 4): TranscriptParagraph[] {
  const out: TranscriptParagraph[] = [];
  let cur: TranscriptParagraph | undefined;
  for (const s of segments) {
    const prev = cur?.sentences[cur.sentences.length - 1];
    const speakerChanged = !!(s.speaker && cur?.speaker && s.speaker !== cur.speaker);
    const gapBreak = prev ? s.start_ms - prev.end_ms > 4000 : false;
    const full = cur ? cur.sentences.length >= maxPerPara : false;
    if (!cur || speakerChanged || gapBreak || full) {
      cur = { paragraph_idx: out.length, ...(s.speaker ? { speaker: s.speaker } : {}), sentences: [s] };
      out.push(cur);
    } else {
      cur.sentences.push(s);
    }
  }
  return out;
}

/** 解析 Podcasting 2.0 JSON chapters（{ chapters: [{ startTime, title }] }） */
export function parseJsonChapters(raw: string): { start_ms: number; title_zh: string; title_en?: string }[] {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  const list = data && typeof data === 'object' && Array.isArray((data as { chapters?: unknown[] }).chapters)
    ? (data as { chapters: unknown[] }).chapters : [];
  const out: { start_ms: number; title_zh: string; title_en?: string }[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const title = String(r.title ?? '').trim();
    const startSec = Number(r.startTime ?? 0);
    if (!title || !Number.isFinite(startSec) || startSec < 0) continue;
    out.push({ start_ms: Math.round(startSec * 1000), title_zh: title, title_en: title });
  }
  return out;
}
