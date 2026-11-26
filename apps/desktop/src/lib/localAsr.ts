import type { TimedSegment } from '@tibi/core';
import { useSyncExternalStore } from 'react';
import { rpc } from '../rpc';
import {
  DEFAULT_LOCAL_ASR_MODEL,
  isLocalAsrModelId,
  LOCAL_ASR_MODEL_IDS,
  LOCAL_ASR_MODELS,
  type LocalAsrModelId,
} from './whisperAudio';
import type { WhisperWorkerIn, WhisperWorkerOut } from './whisper.worker';

export { DEFAULT_LOCAL_ASR_MODEL, isLocalAsrModelId, LOCAL_ASR_MODELS, type LocalAsrModelId };

/**
 * 本地离线语音转写管理器（Whisper ONNX q8，运行在 WebView Worker）：
 * - 零 API 费用、音频完全不出本机、首次从魔搭国内镜像下载（失败退回 Hugging Face），离线永久可用；
 * - 设置项存入 settings 表 `radio.local_asr.*` / `radio.asr.preferred`（已归入 sync localGlobs，不同步）；
 * - 复用浏览器原生 AudioContext.decodeAudioData 解码 MP3 / M4A / WAV / OGG / AAC 并重采样到 16 kHz 单声道 PCM。
 */

export type AsrPreference = 'local' | 'cloud';

export interface LocalAsrConfig {
  enabled: boolean;
  model: LocalAsrModelId;
  preferred: AsrPreference;
}

export type LocalAsrStage =
  | { phase: 'downloading'; pct: number }
  | { phase: 'preparing' }
  | { phase: 'decoding' }
  | { phase: 'transcribing'; pct: number; doneMs: number; totalMs: number }
  | { phase: 'saving' };

const READY_PREFIX = 'tibi.whisper.ready.';
const CACHE_NAME = 'transformers-cache';

/* ---------- 配置同步存储（供 Settings / Radio / Reader 实时联动） ---------- */

let cfg: LocalAsrConfig = { enabled: false, model: DEFAULT_LOCAL_ASR_MODEL, preferred: 'local' };
let hydrated = false;
const cfgSubs = new Set<() => void>();
const notifyCfg = () => { for (const f of cfgSubs) f(); };

export function getLocalAsrConfig(): LocalAsrConfig { return cfg; }

export function useLocalAsrConfig(): LocalAsrConfig {
  return useSyncExternalStore(
    l => { cfgSubs.add(l); return () => { cfgSubs.delete(l); }; },
    () => cfg,
  );
}

/** 从 Core settings 加载本机离线转写配置（只存本机，不跨设备同步） */
export async function hydrateLocalAsrConfig(force = false): Promise<LocalAsrConfig> {
  if (hydrated && !force) return cfg;
  try {
    const r = await rpc.call('settings.get', {
      keys: ['radio.local_asr.enabled', 'radio.local_asr.model', 'radio.asr.preferred'],
    });
    const model = isLocalAsrModelId(r['radio.local_asr.model']) ? r['radio.local_asr.model'] : DEFAULT_LOCAL_ASR_MODEL;
    const enabled = r['radio.local_asr.enabled'] === true;
    const preferred: AsrPreference = r['radio.asr.preferred'] === 'cloud' ? 'cloud' : 'local';
    cfg = { enabled, model, preferred };
    hydrated = true;
    notifyCfg();
  } catch { /* Core 未连上时保留默认值 */ }
  return cfg;
}

export async function updateLocalAsrConfig(patch: Partial<LocalAsrConfig>): Promise<LocalAsrConfig> {
  const next: LocalAsrConfig = { ...cfg, ...patch };
  cfg = next;
  hydrated = true;
  notifyCfg();
  const dbPatch: Record<string, unknown> = {};
  if (patch.enabled !== undefined) dbPatch['radio.local_asr.enabled'] = patch.enabled;
  if (patch.model !== undefined) dbPatch['radio.local_asr.model'] = patch.model;
  if (patch.preferred !== undefined) dbPatch['radio.asr.preferred'] = patch.preferred;
  if (Object.keys(dbPatch).length) {
    await rpc.call('settings.set', { patch: dbPatch }).catch(() => undefined);
  }
  return next;
}

/* ---------- 本地模型下载状态与缓存清理 ---------- */

export function isLocalAsrDownloaded(modelId: LocalAsrModelId = cfg.model): boolean {
  try { return localStorage.getItem(`${READY_PREFIX}${modelId}`) === '1'; } catch { return false; }
}

function markDownloaded(modelId: LocalAsrModelId, ready: boolean) {
  try {
    if (ready) localStorage.setItem(`${READY_PREFIX}${modelId}`, '1');
    else localStorage.removeItem(`${READY_PREFIX}${modelId}`);
  } catch { /* 无存储 */ }
}

/** 检查 Cache API 中实际已缓存的本地 Whisper 模型列表（防止浏览器清理存储后状态失真） */
export async function detectDownloadedModels(): Promise<LocalAsrModelId[]> {
  const cached = new Set<LocalAsrModelId>();
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      for (const id of LOCAL_ASR_MODEL_IDS) {
        const prefix = `https://huggingface.co/${id}/`;
        const hasEncoder = keys.some(k => k.url.startsWith(prefix) && k.url.includes('encoder_model'));
        const hasDecoder = keys.some(k => k.url.startsWith(prefix) && k.url.includes('decoder_model'));
        if (hasEncoder && hasDecoder) {
          cached.add(id);
          markDownloaded(id, true);
        } else if (isLocalAsrDownloaded(id)) {
          // 缓存已被外部清理，同步复位标记
          markDownloaded(id, false);
        }
      }
      return [...cached];
    } catch { /* 非安全上下文或无 CacheStorage */ }
  }
  return LOCAL_ASR_MODEL_IDS.filter(id => isLocalAsrDownloaded(id));
}

/** 清除本地 Whisper 模型缓存（不影响 Kokoro 朗读模型） */
export async function clearLocalAsrCache(modelId?: LocalAsrModelId): Promise<number> {
  const targets = modelId ? [modelId] : [...LOCAL_ASR_MODEL_IDS];
  let deleted = 0;
  if (worker) {
    worker.postMessage({ type: 'dispose' } satisfies WhisperWorkerIn);
  }
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      for (const req of keys) {
        if (targets.some(id => req.url.startsWith(`https://huggingface.co/${id}/`))) {
          if (await cache.delete(req)) deleted++;
        }
      }
    } catch { /* 忽略 */ }
  }
  for (const id of targets) {
    markDownloaded(id, false);
    loadingByModel.delete(id);
  }
  if (!modelId || modelId === cfg.model) {
    await updateLocalAsrConfig({ enabled: false });
  }
  return deleted;
}

/* ---------- Worker 调度 ---------- */

let worker: Worker | undefined;
let jobSeq = 0;
const loadingByModel = new Map<LocalAsrModelId, Promise<void>>();
const downloadSubs = new Map<LocalAsrModelId, Set<(pct: number) => void>>();
const loadWaiters = new Map<LocalAsrModelId, { resolve: () => void; reject: (e: Error) => void }[]>();

interface ActiveJob {
  resolve: (r: { segments: TimedSegment[]; durationMs: number }) => void;
  reject: (e: Error) => void;
  onProgress?: (p: { pct: number; doneMs: number; totalMs: number }) => void;
}
const jobs = new Map<number, ActiveJob>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WhisperWorkerOut>) => {
      const m = e.data;
      if (m.type === 'download') {
        downloadSubs.get(m.modelId)?.forEach(fn => fn(m.pct));
        return;
      }
      if (m.type === 'loaded') {
        markDownloaded(m.modelId, true);
        const list = loadWaiters.get(m.modelId) ?? [];
        loadWaiters.delete(m.modelId);
        for (const w of list) w.resolve();
        return;
      }
      if (m.type === 'progress') {
        jobs.get(m.id)?.onProgress?.({ pct: m.pct, doneMs: m.doneMs, totalMs: m.totalMs });
        return;
      }
      if (m.type === 'done') {
        const j = jobs.get(m.id);
        jobs.delete(m.id);
        j?.resolve({ segments: m.segments, durationMs: m.durationMs });
        return;
      }
      if (m.type === 'error') {
        const err = new Error(m.message || '本地转写失败');
        if (m.id !== undefined) {
          const j = jobs.get(m.id);
          jobs.delete(m.id);
          j?.reject(err);
        } else if (m.modelId) {
          const list = loadWaiters.get(m.modelId) ?? [];
          loadWaiters.delete(m.modelId);
          for (const w of list) w.reject(err);
        }
      }
    };
    worker.onerror = e => {
      const err = new Error(e.message || 'Whisper Worker 启动失败');
      for (const list of loadWaiters.values()) for (const w of list) w.reject(err);
      loadWaiters.clear();
      loadingByModel.clear();
      for (const j of jobs.values()) j.reject(err);
      jobs.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  return worker;
}

/** 下载并预加载指定本地 Whisper 模型（首次约 41–249 MB，优先魔搭镜像，后续离线秒开） */
export function loadLocalAsr(modelId: LocalAsrModelId = cfg.model, onProgress?: (pct: number) => void): Promise<void> {
  if (onProgress) {
    let set = downloadSubs.get(modelId);
    if (!set) { set = new Set(); downloadSubs.set(modelId, set); }
    set.add(onProgress);
  }
  let p = loadingByModel.get(modelId);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const list = loadWaiters.get(modelId) ?? [];
      list.push({ resolve, reject });
      loadWaiters.set(modelId, list);
      getWorker().postMessage({ type: 'load', modelId } satisfies WhisperWorkerIn);
    });
    loadingByModel.set(modelId, p);
    p.catch(() => { loadingByModel.delete(modelId); });
  }
  if (onProgress) {
    void p.finally(() => { downloadSubs.get(modelId)?.delete(onProgress); }).catch(() => undefined);
  }
  return p;
}

/* ---------- 音频解码（任意浏览器支持格式 → 16 kHz 单声道 Float32Array） ---------- */

const TARGET_SAMPLE_RATE = 16_000;

export async function decodeAudioTo16kMono(buf: ArrayBuffer): Promise<{ pcm: Float32Array; durationMs: number }> {
  const Ctx = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error('当前环境不支持 Web Audio 解码');
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(buf);
    const durationMs = Math.round(decoded.duration * 1000);
    const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
    if (decoded.sampleRate === TARGET_SAMPLE_RATE && decoded.numberOfChannels === 1) {
      return { pcm: new Float32Array(decoded.getChannelData(0)), durationMs };
    }
    const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    return { pcm: new Float32Array(rendered.getChannelData(0)), durationMs };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/* ---------- 端到端本地离线转写 ---------- */

const AUDIO_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_LOCAL_ASR_AUDIO_BYTES = 300 * 1024 * 1024;

async function readLimitedResponse(res: Response): Promise<ArrayBuffer> {
  const hdrLen = Number(res.headers.get('content-length') ?? 0);
  if (Number.isFinite(hdrLen) && hdrLen > MAX_LOCAL_ASR_AUDIO_BYTES) {
    throw new Error('本地音频超过 300 MB，无法离线转写');
  }
  if (!res.body) {
    const full = await res.arrayBuffer();
    if (full.byteLength > MAX_LOCAL_ASR_AUDIO_BYTES) throw new Error('本地音频超过 300 MB，无法离线转写');
    return full;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      loaded += value.byteLength;
      if (loaded > MAX_LOCAL_ASR_AUDIO_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('本地音频超过 300 MB，无法离线转写');
      }
      parts.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    throw e;
  }
  const out = new Uint8Array(loaded);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.byteLength; }
  return out.buffer;
}

/** 拉取音频字节：仅整文件 200 直接流式限额读取；遇到 asset:// 413 时按 16 MiB Range 分段并校验总长与区间一致。 */
export async function fetchAudioArrayBuffer(audioUrl: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(audioUrl, { signal });
  if (res.status === 200) return readLimitedResponse(res);
  if (res.status === 206) throw new Error('读取本地音频失败（返回了不完整的 206 分段）');
  if (res.status !== 413) throw new Error(`读取本地音频失败（${res.status}）`);

  const chunks: Uint8Array[] = [];
  let offset = 0;
  let total: number | undefined;
  while (total === undefined || offset < total) {
    if (offset >= MAX_LOCAL_ASR_AUDIO_BYTES) throw new Error('本地音频超过 300 MB，无法离线转写');
    const end = Math.min(offset + AUDIO_CHUNK_BYTES, MAX_LOCAL_ASR_AUDIO_BYTES) - 1;
    const part = await fetch(audioUrl, { signal, headers: { Range: `bytes=${offset}-${end}` } });
    if (part.status === 200) {
      // 服务端忽略 Range 返回整文件时：必须在首片时处理（且流式限额），绝不和已有分片混拼
      if (chunks.length > 0) throw new Error('分段读取本地音频失败（响应模式切换）');
      return readLimitedResponse(part);
    }
    if (part.status === 416 && total === undefined && chunks.length > 0) break;
    if (part.status !== 206) throw new Error(`读取本地音频失败（${part.status}）`);
    const cr = part.headers.get('content-range');
    const m = cr && /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(cr.trim());
    if (!m) throw new Error('分段读取本地音频失败（缺少 Content-Range）');
    const rangeStart = Number(m[1]);
    const rangeEnd = Number(m[2]);
    if (rangeStart !== offset || rangeEnd < rangeStart || rangeEnd > end) {
      throw new Error('分段读取本地音频区间不一致');
    }
    if (m[3] !== '*') {
      const parsedTotal = Number(m[3]);
      if (!Number.isFinite(parsedTotal) || parsedTotal <= 0) throw new Error('分段读取本地音频总长无效');
      if (parsedTotal > MAX_LOCAL_ASR_AUDIO_BYTES) throw new Error('本地音频超过 300 MB，无法离线转写');
      if (total !== undefined && parsedTotal !== total) throw new Error('分段读取本地音频总长发生变化');
      total = parsedTotal;
    }
    const buf = new Uint8Array(await part.arrayBuffer());
    const expectedSpan = rangeEnd - rangeStart + 1;
    if (!buf.byteLength || buf.byteLength !== expectedSpan) {
      throw new Error('分段读取本地音频长度异常');
    }
    chunks.push(buf);
    offset += buf.byteLength;
  }
  const len = chunks.reduce((s, c) => s + c.byteLength, 0);
  if (total !== undefined && len !== total) {
    throw new Error('分段读取本地音频不完整');
  }
  const out = new Uint8Array(len);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.byteLength; }
  return out.buffer;
}

export async function transcribeAudioUrlLocally(
  audioUrl: string,
  opts: { modelId?: LocalAsrModelId; signal?: AbortSignal; onStage?: (stage: LocalAsrStage) => void } = {},
): Promise<{ segments: TimedSegment[]; durationMs: number }> {
  const modelId = opts.modelId ?? cfg.model;
  const checkAbort = () => { if (opts.signal?.aborted) throw new Error('已取消转写'); };

  checkAbort();
  if (!isLocalAsrDownloaded(modelId)) {
    opts.onStage?.({ phase: 'downloading', pct: 0 });
  }
  const onProgress = (pct: number) => { if (!opts.signal?.aborted) opts.onStage?.({ phase: 'downloading', pct }); };
  const loadPromise = loadLocalAsr(modelId, onProgress);
  if (opts.signal) {
    let onAbort: (() => void) | undefined;
    try {
      await Promise.race([
        loadPromise,
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error('已取消转写'));
          if (opts.signal!.aborted) onAbort();
          else opts.signal!.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } finally {
      if (onAbort) opts.signal.removeEventListener('abort', onAbort);
      downloadSubs.get(modelId)?.delete(onProgress);
    }
  } else {
    await loadPromise;
  }
  checkAbort();

  opts.onStage?.({ phase: 'decoding' });
  const arrBuf = await fetchAudioArrayBuffer(audioUrl, opts.signal);
  checkAbort();

  const { pcm, durationMs } = await decodeAudioTo16kMono(arrBuf);
  checkAbort();

  opts.onStage?.({ phase: 'transcribing', pct: 0, doneMs: 0, totalMs: durationMs });

  const id = ++jobSeq;
  return new Promise<{ segments: TimedSegment[]; durationMs: number }>((resolve, reject) => {
    const onAbort = () => {
      worker?.postMessage({ type: 'cancel', id } satisfies WhisperWorkerIn);
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    jobs.set(id, {
      resolve: r => { opts.signal?.removeEventListener('abort', onAbort); resolve(r); },
      reject: e => { opts.signal?.removeEventListener('abort', onAbort); reject(e); },
      onProgress: p => opts.onStage?.({ phase: 'transcribing', ...p }),
    });
    const w = getWorker();
    w.postMessage({ type: 'transcribe', id, modelId, pcm, durationMs } satisfies WhisperWorkerIn, [pcm.buffer]);
  });
}
