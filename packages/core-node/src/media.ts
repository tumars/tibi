import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { text as coreText, TibiError, type AsrConfig, type MediaCacheStats, type TimedSegment } from '@tibi/core';
import { checkUrl } from './platform.js';

/**
 * 桌面端电台媒体缓存与云端 BYOK ASR（17 §5.2–5.3）：
 * - 音频缓存在 <dbDir>/media/podcasts/<key>.<ext>，逻辑路径为 `media:podcasts/<key>.<ext>`（同 assets/ 约定）
 * - 支持 2 GB LRU 自动清理（仅删本地音频文件，不删数据库文档）
 * - 纯 JS MP3 帧切分器（免捆绑 ffmpeg）：大 MP3 按 MPEG 帧精确切分并累加时长偏移
 * - 云端 BYOK ASR：硅基流动（国内直连 · SenseVoiceSmall）/ Groq Whisper / OpenAI Audio Transcriptions / Deepgram Nova-3
 */

const MIME_EXT: Record<string, string> = {
  'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
  'audio/aac': '.aac', 'audio/ogg': '.ogg', 'audio/opus': '.opus', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
};
const EXT_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav',
};

const MAX_WHISPER_CHUNK_BYTES = 19 * 1024 * 1024; // 19 MB（低于 Groq / OpenAI 25 MB 单请求上限）
const SILICONFLOW_TARGET_CHUNK_MS = 45_000;       // 硅基流动 SenseVoiceSmall 不带句级时间戳：MP3 按约 45s 帧锚点分块
const SILICONFLOW_MAX_NON_MP3_BYTES = 48 * 1024 * 1024; // 硅基流动单请求 50 MB 上限留余量
const SILICONFLOW_CONCURRENCY = 3;

const DEFAULT_ASR_BASE: Record<string, string> = {
  siliconflow_asr: 'https://api.siliconflow.cn/v1',
  groq_whisper: 'https://api.groq.com/openai/v1',
  openai_whisper: 'https://api.openai.com/v1',
  deepgram: 'https://api.deepgram.com',
};
const DEFAULT_ASR_MODEL: Record<string, string> = {
  siliconflow_asr: 'FunAudioLLM/SenseVoiceSmall',
  groq_whisper: 'whisper-large-v3-turbo',
  openai_whisper: 'whisper-1',
  deepgram: 'nova-3',
};

/** 剥离 SenseVoice 等模型偶发输出的控制标签（如 <|en|><|NEUTRAL|><|Speech|>） */
export function stripAsrTags(raw: string): string {
  return raw.replace(/<\|[^|<>]{1,32}\|>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 无 segments 时间戳时，将纯文本切为自然句并按字符长度比例线性分配起止毫秒 */
export function splitTextToTimedSegments(rawText: string, offsetMs: number, durationMs: number): TimedSegment[] {
  const clean = stripAsrTags(rawText);
  if (!clean) return [];
  const sents = coreText.splitSentences(clean).map(s => s.trim()).filter(Boolean);
  if (!sents.length) return [];
  const startBase = Math.max(0, Math.round(offsetMs));
  const dur = Math.max(0, Math.round(durationMs));
  if (dur <= 0 || sents.length === 1) {
    return sents.map(text => ({ text, start_ms: startBase, end_ms: startBase + dur }));
  }
  const weights = sents.map(s => Math.max(1, s.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return sents.map((text, i) => {
    const start_ms = startBase + Math.round((acc / totalWeight) * dur);
    acc += weights[i]!;
    const end_ms = i === sents.length - 1
      ? startBase + dur
      : Math.max(start_ms, startBase + Math.round((acc / totalWeight) * dur));
    return { text, start_ms, end_ms };
  });
}

function safeKey(key: string): string {
  const clean = key.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (!clean) throw new TibiError('invalid_params', '媒体标识无效');
  return clean;
}

function extFrom(urlOrPath: string, mime?: string): string {
  const m = (mime ?? '').toLowerCase().split(';')[0]!.trim();
  if (MIME_EXT[m]) return MIME_EXT[m]!;
  try {
    const p = urlOrPath.startsWith('http') ? new URL(urlOrPath).pathname : urlOrPath;
    const e = extname(p).toLowerCase();
    if (EXT_MIME[e]) return e;
  } catch { /* 忽略 */ }
  return '.mp3';
}

export function mediaRootDir(dbPath: string): string | undefined {
  if (!dbPath || dbPath === ':memory:') return undefined;
  return join(dirname(dbPath), 'media');
}

/** 逻辑路径 `media:podcasts/xxx.mp3` → 本机绝对路径 */
export function resolveMediaFile(dbPath: string, logicalOrAbs: string): string {
  if (logicalOrAbs.startsWith('media:')) {
    const root = mediaRootDir(dbPath);
    if (!root) throw new TibiError('invalid_source', '内存模式不支持本地媒体文件');
    const rel = logicalOrAbs.slice('media:'.length);
    if (!/^podcasts\/[\w-][\w.-]*$/.test(rel)) throw new TibiError('invalid_params', '媒体路径无效');
    return join(root, ...rel.split('/'));
  }
  return logicalOrAbs;
}

export function createMediaOps(dbPath: string, appVersion: string) {
  const root = mediaRootDir(dbPath);
  const podDir = root ? join(root, 'podcasts') : undefined;

  const downloadMedia = podDir ? async (
    url: string,
    key: string,
    opts: { maxBytes?: number; signal?: AbortSignal; onProgress?: (loaded: number, total?: number) => void } = {},
  ): Promise<{ path: string; bytes: number; mime: string }> => {
    let current = await checkUrl(url);
    const maxBytes = opts.maxBytes ?? 300 * 1024 * 1024;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5 * 60_000);
    opts.signal?.addEventListener('abort', () => ctrl.abort());
    try {
      let res: Response | undefined;
      for (let hop = 0; hop < 6; hop++) {
        res = await fetch(current, {
          redirect: 'manual', signal: ctrl.signal,
          headers: { 'user-agent': `Tibi/${appVersion} (+https://github.com/tumars/tibi)`, accept: 'audio/*,*/*;q=0.5' },
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          current = await checkUrl(new URL(res.headers.get('location')!, current).toString());
          continue;
        }
        break;
      }
      if (!res || res.status >= 400) throw new TibiError('invalid_source', `音频下载失败（${res?.status ?? '网络错误'}）`);
      const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim() || 'audio/mpeg';
      const contentLen = Number(res.headers.get('content-length') ?? 0) || undefined;
      if (contentLen && contentLen > maxBytes) throw new TibiError('invalid_source', `这期音频超过 ${(maxBytes / (1 << 20)).toFixed(0)} MB 上限`);

      const ext = extFrom(current.toString(), mime);
      const fileName = `${safeKey(key)}${ext}`;
      const absPath = join(podDir, fileName);
      await mkdir(podDir, { recursive: true });

      const chunks: Uint8Array[] = [];
      let loaded = 0;
      let lastReport = 0;
      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          loaded += value.byteLength;
          if (loaded > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new TibiError('invalid_source', `音频体积超过 ${(maxBytes / (1 << 20)).toFixed(0)} MB 上限`);
          }
          chunks.push(value);
          const nowMs = Date.now();
          if (opts.onProgress && nowMs - lastReport >= 250) { lastReport = nowMs; opts.onProgress(loaded, contentLen); }
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        loaded = buf.byteLength;
        chunks.push(buf);
      }
      const combined = concatBytes(chunks, loaded);
      await writeFile(absPath + '.tmp', combined);
      await rename(absPath + '.tmp', absPath);
      opts.onProgress?.(loaded, contentLen ?? loaded);
      return { path: `media:podcasts/${fileName}`, bytes: loaded, mime: EXT_MIME[ext] ?? mime };
    } finally {
      clearTimeout(timer);
    }
  } : undefined;

  const copyMedia = podDir ? async (srcPath: string, key: string): Promise<{ path: string; bytes: number; mime: string }> => {
    const ext = extFrom(srcPath);
    const fileName = `${safeKey(key)}${ext}`;
    const absPath = join(podDir, fileName);
    await mkdir(podDir, { recursive: true });
    await copyFile(srcPath, absPath + '.tmp');
    await rename(absPath + '.tmp', absPath);
    const st = await stat(absPath);
    return { path: `media:podcasts/${fileName}`, bytes: st.size, mime: EXT_MIME[ext] ?? 'audio/mpeg' };
  } : undefined;

  const listFiles = async () => {
    if (!podDir) return [] as { name: string; logical: string; abs: string; size: number; mtime: number }[];
    const names = await readdir(podDir).catch(() => [] as string[]);
    const out: { name: string; logical: string; abs: string; size: number; mtime: number }[] = [];
    for (const name of names) {
      if (name.endsWith('.tmp')) continue;
      const abs = join(podDir, name);
      const st = await stat(abs).catch(() => undefined);
      if (st?.isFile()) out.push({ name, logical: `media:podcasts/${name}`, abs, size: st.size, mtime: st.mtimeMs });
    }
    return out;
  };

  const mediaCacheInfo = podDir ? async (maxBytes = 2 * 1024 * 1024 * 1024): Promise<MediaCacheStats> => {
    const files = await listFiles();
    return { bytes: files.reduce((s, f) => s + f.size, 0), files: files.length, max_bytes: maxBytes };
  } : undefined;

  const pruneMediaCache = podDir ? async (maxBytes: number): Promise<{ freed_bytes: number; removed_paths: string[] }> => {
    const files = (await listFiles()).sort((a, b) => a.mtime - b.mtime); // 最旧在前
    let total = files.reduce((s, f) => s + f.size, 0);
    let freed_bytes = 0;
    const removed_paths: string[] = [];
    for (const f of files) {
      if (total <= maxBytes) break;
      await unlink(f.abs).catch(() => undefined);
      total -= f.size; freed_bytes += f.size; removed_paths.push(f.logical);
    }
    return { freed_bytes, removed_paths };
  } : undefined;

  const clearMediaCache = podDir ? async (): Promise<{ freed_bytes: number; removed_paths: string[] }> => {
    const files = await listFiles();
    let freed_bytes = 0;
    const removed_paths: string[] = [];
    for (const f of files) {
      await unlink(f.abs).catch(() => undefined);
      freed_bytes += f.size; removed_paths.push(f.logical);
    }
    return { freed_bytes, removed_paths };
  } : undefined;

  const transcribeAudio = async (
    input: { path?: string; url?: string; mime?: string },
    opts: { config: AsrConfig; signal?: AbortSignal; onProgress?: (label: string) => void },
  ): Promise<{ segments: TimedSegment[]; duration_ms?: number; engine: string }> => {
    if (!input.path) throw new TibiError('invalid_source', '缺少本地音频文件');
    const abs = resolveMediaFile(dbPath, input.path);
    const bytes = new Uint8Array(await readFile(abs));
    const ext = extFrom(abs, input.mime);
    const mime = input.mime || EXT_MIME[ext] || 'audio/mpeg';
    const { config } = opts;

    if (config.protocol === 'deepgram') {
      opts.onProgress?.('正在通过 Deepgram 转写逐字稿');
      return transcribeDeepgram(bytes, mime, config, opts.signal);
    }

    const isSiliconFlow = config.protocol === 'siliconflow_asr';
    // 硅基流动 SenseVoiceSmall 无原生句级时间戳：MP3 按 ~45s 帧锚点分块并发转写以获得稳定时间定位；
    // Groq / OpenAI Whisper 支持精确 verbose_json，仅在超 19 MB 时按体积切块
    let chunks: { data: Uint8Array; offset_ms: number; duration_ms: number }[];
    if (ext === '.mp3') {
      chunks = isSiliconFlow
        ? splitMp3ByDuration(bytes, SILICONFLOW_TARGET_CHUNK_MS, MAX_WHISPER_CHUNK_BYTES)
        : bytes.byteLength > MAX_WHISPER_CHUNK_BYTES
          ? splitMp3BySize(bytes, MAX_WHISPER_CHUNK_BYTES)
          : [{ data: bytes, offset_ms: 0, duration_ms: measureMp3DurationMs(bytes) }];
    } else {
      const limit = isSiliconFlow ? SILICONFLOW_MAX_NON_MP3_BYTES : 24 * 1024 * 1024;
      if (bytes.byteLength > limit) {
        throw new TibiError('invalid_source', isSiliconFlow
          ? '非 MP3 音频超过 48 MB，超出硅基流动单次上传上限；建议使用本地离线转写或 MP3 格式'
          : '非 MP3 音频超过 24 MB，超出 Whisper 单次上传上限；建议使用本地离线转写、MP3 或 Deepgram');
      }
      chunks = [{ data: bytes, offset_ms: 0, duration_ms: 0 }];
    }

    const results: ({ segments: TimedSegment[]; duration_ms?: number } | undefined)[] = new Array(chunks.length);
    let completed = 0;
    const workers = Math.min(isSiliconFlow ? SILICONFLOW_CONCURRENCY : 1, chunks.length);
    let nextIdx = 0;
    const runWorker = async () => {
      while (nextIdx < chunks.length) {
        const i = nextIdx++;
        const ch = chunks[i]!;
        if (chunks.length === 1) opts.onProgress?.('正在 AI 转写逐字稿');
        else if (!isSiliconFlow) opts.onProgress?.(`正在 AI 转写第 ${i + 1} / ${chunks.length} 段`);
        else if (completed === 0) opts.onProgress?.(`正在通过硅基流动转写（共 ${chunks.length} 段）`);
        results[i] = await transcribeOpenAiCompatible(ch.data, `chunk${i}${ext}`, mime, config, opts.signal, ch.duration_ms);
        completed++;
        if (isSiliconFlow && chunks.length > 1) opts.onProgress?.(`正在通过硅基流动转写第 ${completed} / ${chunks.length} 段`);
      }
    };
    await Promise.all(Array.from({ length: workers }, () => runWorker()));

    const all: TimedSegment[] = [];
    let totalDuration = 0;
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i]!;
      const r = results[i]!;
      for (const s of r.segments) {
        all.push({
          text: s.text,
          start_ms: s.start_ms + ch.offset_ms,
          end_ms: s.end_ms + ch.offset_ms,
          ...(s.speaker ? { speaker: s.speaker } : {}),
        });
      }
      if (r.duration_ms) totalDuration = Math.max(totalDuration, ch.offset_ms + r.duration_ms);
      else if (ch.duration_ms) totalDuration = Math.max(totalDuration, ch.offset_ms + ch.duration_ms);
    }
    return { segments: all, ...(totalDuration > 0 ? { duration_ms: Math.round(totalDuration) } : {}), engine: `${config.protocol}:${config.model || DEFAULT_ASR_MODEL[config.protocol] || 'whisper'}` };
  };

  return { downloadMedia, copyMedia, mediaCacheInfo, pruneMediaCache, clearMediaCache, transcribeAudio, testAsr };
}

/** 轻量校验云端 ASR 接口鉴权与连通性（不消耗转写额度） */
export async function testAsr(config: AsrConfig): Promise<{ ok: boolean; latency_ms?: number; error?: string }> {
  const t0 = Date.now();
  try {
    if (config.protocol === 'deepgram') {
      const base = (config.base_url || DEFAULT_ASR_BASE.deepgram!).replace(/\/+$/, '');
      const u = await checkUrl(`${base}/v1/projects`);
      const res = await fetch(u, { headers: { authorization: `Token ${config.api_key}` }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { ok: false, error: `鉴权失败（${res.status}）` };
      return { ok: true, latency_ms: Date.now() - t0 };
    }
    const defBase = DEFAULT_ASR_BASE[config.protocol] ?? DEFAULT_ASR_BASE.openai_whisper!;
    const base = (config.base_url || defBase).replace(/\/+$/, '');
    const u = await checkUrl(`${base}/models`);
    const res = await fetch(u, { headers: { authorization: `Bearer ${config.api_key}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, error: `连接失败（${res.status}）` };
    return { ok: true, latency_ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function transcribeOpenAiCompatible(
  audio: Uint8Array, fileName: string, mime: string, config: AsrConfig, signal?: AbortSignal, fallbackDurationMs = 0,
): Promise<{ segments: TimedSegment[]; duration_ms?: number }> {
  const isSiliconFlow = config.protocol === 'siliconflow_asr';
  const defBase = DEFAULT_ASR_BASE[config.protocol] ?? DEFAULT_ASR_BASE.openai_whisper!;
  const base = (config.base_url || defBase).replace(/\/+$/, '');
  const url = await checkUrl(`${base}/audio/transcriptions`);
  const form = new FormData();
  const ab = new ArrayBuffer(audio.byteLength);
  new Uint8Array(ab).set(audio);
  form.append('file', new Blob([ab], { type: mime }), fileName);
  form.append('model', config.model || DEFAULT_ASR_MODEL[config.protocol] || 'whisper-1');
  // 硅基流动 /v1/audio/transcriptions 文档仅定义 file + model，避免非标准参数引发 400
  if (!isSiliconFlow) {
    form.append('response_format', 'verbose_json');
    if (config.language) form.append('language', config.language);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.api_key}` },
    body: form,
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new TibiError('invalid_source', `语音转写失败（${res.status}）：${errText.slice(0, 160)}`);
  }
  const data = (await res.json()) as { text?: string; duration?: number; segments?: { start?: number; end?: number; text?: string }[] };
  const durMs = data.duration ? Math.round(data.duration * 1000) : fallbackDurationMs;
  const segs: TimedSegment[] = [];
  if (Array.isArray(data.segments) && data.segments.length) {
    for (const s of data.segments) {
      const text = stripAsrTags(s.text ?? '');
      if (!text) continue;
      const start_ms = Math.max(0, Math.round(Number(s.start ?? 0) * 1000));
      const end_ms = Math.max(start_ms, Math.round(Number(s.end ?? s.start ?? 0) * 1000));
      segs.push({ text, start_ms, end_ms });
    }
  } else if (data.text?.trim()) {
    segs.push(...splitTextToTimedSegments(data.text, 0, durMs));
  }
  return { segments: segs, ...(durMs > 0 ? { duration_ms: durMs } : {}) };
}

async function transcribeDeepgram(
  audio: Uint8Array, mime: string, config: AsrConfig, signal?: AbortSignal,
): Promise<{ segments: TimedSegment[]; duration_ms?: number; engine: string }> {
  const base = (config.base_url || 'https://api.deepgram.com').replace(/\/+$/, '');
  const model = config.model || 'nova-3';
  const lang = config.language || 'en';
  const url = await checkUrl(`${base}/v1/listen?model=${encodeURIComponent(model)}&smart_format=true&punctuate=true&utterances=true&diarize=true&language=${encodeURIComponent(lang)}`);
  const ab = new ArrayBuffer(audio.byteLength);
  new Uint8Array(ab).set(audio);
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Token ${config.api_key}`, 'content-type': mime },
    body: ab,
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new TibiError('invalid_source', `Deepgram 转写失败（${res.status}）：${errText.slice(0, 160)}`);
  }
  const data = (await res.json()) as {
    metadata?: { duration?: number };
    results?: {
      utterances?: { start?: number; end?: number; transcript?: string; speaker?: number }[];
      channels?: { alternatives?: { transcript?: string }[] }[];
    };
  };
  const segs: TimedSegment[] = [];
  for (const u of data.results?.utterances ?? []) {
    const text = (u.transcript ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start_ms = Math.max(0, Math.round(Number(u.start ?? 0) * 1000));
    const end_ms = Math.max(start_ms, Math.round(Number(u.end ?? u.start ?? 0) * 1000));
    segs.push({ text, start_ms, end_ms, ...(u.speaker != null ? { speaker: `Speaker ${u.speaker + 1}` } : {}) });
  }
  if (!segs.length) {
    const fallback = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();
    if (fallback) segs.push({ text: fallback, start_ms: 0, end_ms: Math.round(Number(data.metadata?.duration ?? 0) * 1000) });
  }
  return {
    segments: segs,
    ...(data.metadata?.duration ? { duration_ms: Math.round(data.metadata.duration * 1000) } : {}),
    engine: `deepgram:${model}`,
  };
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

/* ==================== 纯 JS MPEG Audio (MP3) 帧切分器 ==================== */

const BITRATE_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATE_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SR_V1 = [44100, 48000, 32000, 0];
const SR_V2 = [22050, 24000, 16000, 0];
const SR_V25 = [11025, 12000, 8000, 0];

/** 解析单个 MPEG Layer III 帧头，返回字节长度与毫秒时长 */
export function parseMp3FrameHeader(buf: Uint8Array, offset: number): { length: number; durationMs: number } | undefined {
  if (offset + 4 > buf.byteLength) return undefined;
  const b0 = buf[offset]!, b1 = buf[offset + 1]!, b2 = buf[offset + 2]!;
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return undefined;
  const versionId = (b1 >> 3) & 0x03; // 0=2.5, 1=reserved, 2=2, 3=1
  const layer = (b1 >> 1) & 0x03;     // 1=Layer III
  if (versionId === 1 || layer !== 1) return undefined;
  const brIdx = (b2 >> 4) & 0x0f;
  const srIdx = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  const bitrateKbps = versionId === 3 ? BITRATE_V1_L3[brIdx]! : BITRATE_V2_L3[brIdx]!;
  const sampleRate = versionId === 3 ? SR_V1[srIdx]! : versionId === 2 ? SR_V2[srIdx]! : SR_V25[srIdx]!;
  if (!bitrateKbps || !sampleRate) return undefined;
  const samples = versionId === 3 ? 1152 : 576;
  const coeff = versionId === 3 ? 144 : 72;
  const length = Math.floor((coeff * bitrateKbps * 1000) / sampleRate) + padding;
  if (length < 4 || offset + length > buf.byteLength) return undefined;
  return { length, durationMs: (samples / sampleRate) * 1000 };
}

/** 跳过开头的 ID3v2 标签 */
function skipId3v2(buf: Uint8Array): number {
  if (buf.byteLength >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f);
    return Math.min(buf.byteLength, 10 + size);
  }
  return 0;
}

/** 估算整段 MP3 的总毫秒时长 */
export function measureMp3DurationMs(buf: Uint8Array): number {
  let pos = skipId3v2(buf);
  let totalMs = 0;
  while (pos + 4 <= buf.byteLength) {
    const h = parseMp3FrameHeader(buf, pos);
    if (!h) { pos++; continue; }
    pos += h.length;
    totalMs += h.durationMs;
  }
  return Math.round(totalMs);
}

/** 按 MPEG 帧边界将大 MP3 切分为 <= maxChunkBytes 的块，精确累加每块起始偏移毫秒 */
export function splitMp3BySize(buf: Uint8Array, maxChunkBytes = MAX_WHISPER_CHUNK_BYTES): { data: Uint8Array; offset_ms: number; duration_ms: number }[] {
  if (buf.byteLength <= maxChunkBytes) return [{ data: buf, offset_ms: 0, duration_ms: measureMp3DurationMs(buf) }];
  return splitMp3Internal(buf, maxChunkBytes, Infinity);
}

/** 按目标时长（如 45s）与体积上限沿 MPEG 帧边界切分 MP3，为无原生时间戳的 ASR 服务提供精确时间锚点 */
export function splitMp3ByDuration(
  buf: Uint8Array,
  targetDurationMs = SILICONFLOW_TARGET_CHUNK_MS,
  maxChunkBytes = MAX_WHISPER_CHUNK_BYTES,
): { data: Uint8Array; offset_ms: number; duration_ms: number }[] {
  return splitMp3Internal(buf, maxChunkBytes, targetDurationMs);
}

function splitMp3Internal(buf: Uint8Array, maxChunkBytes: number, maxChunkDurationMs: number): { data: Uint8Array; offset_ms: number; duration_ms: number }[] {
  let pos = skipId3v2(buf);
  const chunks: { data: Uint8Array; offset_ms: number; duration_ms: number }[] = [];
  let chunkStart = pos;
  let chunkOffsetMs = 0;
  let chunkDurationMs = 0;
  let totalMs = 0;

  while (pos + 4 <= buf.byteLength) {
    const h = parseMp3FrameHeader(buf, pos);
    if (!h) { pos++; continue; }
    const exceedsBytes = pos - chunkStart + h.length > maxChunkBytes;
    const exceedsDur = chunkDurationMs + h.durationMs > maxChunkDurationMs;
    if ((exceedsBytes || exceedsDur) && pos > chunkStart) {
      chunks.push({ data: buf.subarray(chunkStart, pos), offset_ms: Math.round(chunkOffsetMs), duration_ms: Math.round(chunkDurationMs) });
      chunkStart = pos;
      chunkOffsetMs = totalMs;
      chunkDurationMs = 0;
    }
    pos += h.length;
    totalMs += h.durationMs;
    chunkDurationMs += h.durationMs;
  }
  if (pos > chunkStart) {
    chunks.push({ data: buf.subarray(chunkStart, pos), offset_ms: Math.round(chunkOffsetMs), duration_ms: Math.round(chunkDurationMs) });
  }
  return chunks.length ? chunks : [{ data: buf, offset_ms: 0, duration_ms: Math.round(totalMs) }];
}
