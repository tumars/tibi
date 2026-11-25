/// <reference lib="webworker" />
import type { TimedSegment } from '@tibi/core';
import { withModelScopeMirror } from './modelMirror';
import {
  LOCAL_ASR_MODEL_IDS,
  normalizeWhisperChunks,
  planAudioWindows,
  type LocalAsrModelId,
  type RawWhisperChunk,
} from './whisperAudio';

/**
 * 本地离线语音转写（Whisper ONNX q8）Web Worker：
 * - 复用安装包自带的 onnxruntime-web WASM，不联网加载 jsdelivr，满足 CSP 并支持完全离线推理；
 * - 首次下载模型优先走魔搭镜像（modelscope.cn），失败自动回退 Hugging Face，缓存于浏览器 transformers-cache；
 * - 按静音边界分窗（<= 29.5s）逐窗推理，回报实时百分比进度并支持随时取消。
 */
export type WhisperWorkerIn =
  | { type: 'load'; modelId: LocalAsrModelId }
  | { type: 'transcribe'; id: number; modelId: LocalAsrModelId; pcm: Float32Array; durationMs: number }
  | { type: 'cancel'; id: number }
  | { type: 'dispose' };

export type WhisperWorkerOut =
  | { type: 'download'; modelId: LocalAsrModelId; pct: number }
  | { type: 'loaded'; modelId: LocalAsrModelId }
  | { type: 'progress'; id: number; doneMs: number; totalMs: number; pct: number }
  | { type: 'done'; id: number; segments: TimedSegment[]; durationMs: number }
  | { type: 'error'; id?: number; modelId?: LocalAsrModelId; message: string };

type AsrOutput = { text?: string; chunks?: RawWhisperChunk[] };
type AsrPipe = ((audio: Float32Array, opts?: { return_timestamps?: boolean }) => Promise<AsrOutput>) & {
  dispose?: () => Promise<void>;
};

const post = (m: WhisperWorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

let mirrorInstalled = false;
let runtimeReady = false;
let loadedModelId: LocalAsrModelId | undefined;
let pipePromise: Promise<AsrPipe> | undefined;

async function ensureTransformers() {
  const [{ pipeline, env }, { default: mjs }, { default: wasm }] = await Promise.all([
    import('@huggingface/transformers'),
    // 引擎随安装包走（同 kokoro.worker.ts），避免被 CSP 拦或离线加载失败
    import('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url'),
    import('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url'),
  ]);
  if (!runtimeReady) {
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const onnx = env.backends?.onnx;
    if (onnx?.wasm) {
      onnx.wasm.wasmPaths = { mjs, wasm } as unknown as string;
    }
    runtimeReady = true;
  }
  if (!mirrorInstalled) {
    globalThis.fetch = withModelScopeMirror(globalThis.fetch.bind(globalThis), LOCAL_ASR_MODEL_IDS);
    mirrorInstalled = true;
  }
  return { pipeline };
}

async function disposePipe() {
  const prev = pipePromise;
  pipePromise = undefined;
  loadedModelId = undefined;
  if (prev) {
    try {
      const p = await prev;
      await p.dispose?.();
    } catch { /* 忽略 */ }
  }
}

function loadModel(modelId: LocalAsrModelId): Promise<AsrPipe> {
  if (pipePromise && loadedModelId === modelId) return pipePromise;
  const cleanup = loadedModelId && loadedModelId !== modelId ? disposePipe() : Promise.resolve();
  loadedModelId = modelId;
  const files = new Map<string, [number, number]>();
  let lastPct = -1;

  pipePromise = cleanup.then(async () => {
    const { pipeline } = await ensureTransformers();
    const pipe = await pipeline('automatic-speech-recognition', modelId, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file && p.total) {
          files.set(p.file, [p.loaded ?? 0, p.total]);
          let loaded = 0;
          let total = 0;
          for (const [a, b] of files.values()) { loaded += a; total += b; }
          const pct = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
          if (pct !== lastPct) {
            lastPct = pct;
            post({ type: 'download', modelId, pct });
          }
        }
      },
    });
    post({ type: 'download', modelId, pct: 100 });
    return pipe as unknown as AsrPipe;
  });

  pipePromise.catch(() => {
    if (loadedModelId === modelId) {
      pipePromise = undefined;
      loadedModelId = undefined;
    }
  });
  return pipePromise;
}

const cancelled = new Set<number>();
let queue: Promise<void> = Promise.resolve();

async function runTranscribe(id: number, modelId: LocalAsrModelId, pcm: Float32Array, durationMs: number) {
  if (cancelled.delete(id)) {
    post({ type: 'error', id, message: '已取消转写' });
    return;
  }
  const asr = await loadModel(modelId);
  if (cancelled.delete(id)) {
    post({ type: 'error', id, message: '已取消转写' });
    return;
  }

  const windows = planAudioWindows(pcm, 16_000);
  const totalMs = Math.max(durationMs, windows.reduce((m, w) => Math.max(m, w.startMs + w.durationMs), 0));
  const segments: TimedSegment[] = [];

  for (let i = 0; i < windows.length; i++) {
    if (cancelled.delete(id)) {
      post({ type: 'error', id, message: '已取消转写' });
      return;
    }
    const w = windows[i]!;
    const slice = pcm.subarray(w.startSample, w.endSample);
    const out = await asr(slice, { return_timestamps: true });
    const normalized = normalizeWhisperChunks(out?.chunks, out?.text, w.startMs, w.durationMs);
    segments.push(...normalized);
    const doneMs = Math.min(totalMs, w.startMs + w.durationMs);
    const pct = totalMs > 0 ? Math.min(99, Math.round((doneMs / totalMs) * 100)) : Math.round(((i + 1) / windows.length) * 100);
    post({ type: 'progress', id, doneMs, totalMs, pct });
  }

  if (cancelled.delete(id)) {
    post({ type: 'error', id, message: '已取消转写' });
    return;
  }
  post({ type: 'done', id, segments, durationMs: totalMs });
}

self.onmessage = (e: MessageEvent<WhisperWorkerIn>) => {
  const m = e.data;
  if (m.type === 'load') {
    queue = queue.then(async () => {
      try {
        await loadModel(m.modelId);
        post({ type: 'loaded', modelId: m.modelId });
      } catch (err) {
        post({ type: 'error', modelId: m.modelId, message: err instanceof Error ? err.message : String(err) });
      }
    });
  } else if (m.type === 'cancel') {
    cancelled.add(m.id);
  } else if (m.type === 'dispose') {
    queue = queue.then(() => disposePipe());
  } else if (m.type === 'transcribe') {
    queue = queue.then(() => runTranscribe(m.id, m.modelId, m.pcm, m.durationMs)).catch(err => {
      post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
    });
  }
};
