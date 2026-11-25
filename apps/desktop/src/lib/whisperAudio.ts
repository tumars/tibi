import type { TimedSegment } from '@tibi/core';

/**
 * 本地离线 Whisper（ONNX q8）模型清单与纯函数音频切窗/结果规整。
 * 单独抽离便于 Worker 复用与 Vitest 单元测试，不依赖浏览器全局对象。
 */
export type LocalAsrModelId =
  | 'onnx-community/whisper-tiny.en'
  | 'onnx-community/whisper-base.en'
  | 'onnx-community/whisper-small.en';

export interface LocalAsrModelSpec {
  id: LocalAsrModelId;
  shortName: string;
  sizeMb: number;
  recommended?: boolean;
}

export const LOCAL_ASR_MODELS: readonly LocalAsrModelSpec[] = [
  { id: 'onnx-community/whisper-tiny.en', shortName: 'tiny.en', sizeMb: 41 },
  { id: 'onnx-community/whisper-base.en', shortName: 'base.en', sizeMb: 77, recommended: true },
  { id: 'onnx-community/whisper-small.en', shortName: 'small.en', sizeMb: 249 },
] as const;

export const LOCAL_ASR_MODEL_IDS: readonly LocalAsrModelId[] = LOCAL_ASR_MODELS.map(m => m.id);
export const DEFAULT_LOCAL_ASR_MODEL: LocalAsrModelId = 'onnx-community/whisper-base.en';

export function isLocalAsrModelId(v: unknown): v is LocalAsrModelId {
  return typeof v === 'string' && (LOCAL_ASR_MODEL_IDS as readonly string[]).includes(v);
}

export interface AudioWindow {
  startSample: number;
  endSample: number;
  startMs: number;
  durationMs: number;
}

/**
 * 将长 16 kHz 单声道 PCM 音频切分为 <= 30s 的推理窗口：
 * - 短于 maxSec（默认 29.5s）直接整段返回；
 * - 长音频在 [minSec, maxSec] 区间内按 100 ms 步长寻找能量（RMS）最低点，沿自然停顿边界切分，避免截断单词；
 * - 兼顾低内存占用、逐窗实时进度回报与随时取消。
 */
export function planAudioWindows(
  pcm: Float32Array,
  sampleRate = 16_000,
  opts: { minSec?: number; maxSec?: number; frameMs?: number } = {},
): AudioWindow[] {
  const total = pcm.length;
  if (!total || sampleRate <= 0) return [];
  const minSamples = Math.max(1, Math.round((opts.minSec ?? 22) * sampleRate));
  const maxSamples = Math.max(minSamples + 1, Math.round((opts.maxSec ?? 29.5) * sampleRate));
  const frameSamples = Math.max(1, Math.round(((opts.frameMs ?? 100) / 1000) * sampleRate));

  const windows: AudioWindow[] = [];
  let start = 0;
  while (start < total) {
    const remaining = total - start;
    let end: number;
    if (remaining <= maxSamples) {
      end = total;
    } else {
      const searchStart = start + minSamples;
      const searchEnd = Math.min(total, start + maxSamples);
      let bestPos = searchEnd;
      let bestEnergy = Infinity;
      for (let pos = searchStart; pos + frameSamples <= searchEnd; pos += frameSamples) {
        let sum = 0;
        for (let k = pos; k < pos + frameSamples; k++) {
          const s = pcm[k]!;
          sum += s * s;
        }
        const energy = sum / frameSamples;
        if (energy < bestEnergy) {
          bestEnergy = energy;
          bestPos = pos + Math.floor(frameSamples / 2);
        }
      }
      end = Math.max(start + minSamples, Math.min(total, bestPos));
    }
    windows.push({
      startSample: start,
      endSample: end,
      startMs: Math.round((start / sampleRate) * 1000),
      durationMs: Math.round(((end - start) / sampleRate) * 1000),
    });
    start = end;
  }
  return windows;
}

const NOISE_ONLY = /^[\s[\]()*♪♫.,!?;:\-–—]*((blank_audio|silence|music|applause|laughter|inaudible|no speech|noise|music playing|upbeat music)[\s[\]()*♪♫.,!?;:\-–—]*)+$/i;

export interface RawWhisperChunk {
  text?: string;
  timestamp?: [number | null, number | null];
}

/** 将单窗 Whisper 输出的 chunks（秒级相对时间）规整为带绝对毫秒偏移的 TimedSegment[] */
export function normalizeWhisperChunks(
  chunks: RawWhisperChunk[] | undefined,
  fallbackText: string | undefined,
  windowStartMs: number,
  windowDurationMs: number,
): TimedSegment[] {
  const out: TimedSegment[] = [];
  const winEndMs = windowStartMs + Math.max(0, Math.round(windowDurationMs));

  if (Array.isArray(chunks) && chunks.length) {
    for (const ch of chunks) {
      const text = (ch.text ?? '').replace(/\s+/g, ' ').trim();
      if (!text || NOISE_ONLY.test(text)) continue;
      const rawStart = ch.timestamp?.[0];
      const rawEnd = ch.timestamp?.[1];
      const startOffset = typeof rawStart === 'number' && Number.isFinite(rawStart) && rawStart >= 0 ? Math.round(rawStart * 1000) : 0;
      const start_ms = Math.min(winEndMs, windowStartMs + startOffset);
      const end_ms = typeof rawEnd === 'number' && Number.isFinite(rawEnd) && rawEnd >= 0
        ? Math.min(winEndMs, Math.max(start_ms, windowStartMs + Math.round(rawEnd * 1000)))
        : winEndMs;
      out.push({ text, start_ms, end_ms });
    }
    return out;
  }

  const text = (fallbackText ?? '').replace(/\s+/g, ' ').trim();
  if (text && !NOISE_ONLY.test(text)) {
    out.push({ text, start_ms: windowStartMs, end_ms: winEndMs });
  }
  return out;
}
