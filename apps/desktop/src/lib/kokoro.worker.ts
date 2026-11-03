/// <reference lib="webworker" />
import { withKokoroMirror } from './kokoroMirror';

/**
 * Kokoro 放在 Worker 里跑：ONNX 推理是同步的大段 wasm 计算，在主线程上一句要算好几秒，整个界面都卡住。
 * 收：load（加载模型）、gen（合成，按句子切开一句一句回）、cancel（不要了）。
 * 发：progress（下载进度）、loaded、chunk（一句的音频）、done、error。
 * 合成一个接一个排队做：ONNX 会话不能同时跑两次。
 */
export type In = { type: 'load' } | { type: 'gen'; id: number; text: string; voice: string; speed: number } | { type: 'cancel'; id: number };
export type Out = { type: 'progress'; pct: number } | { type: 'loaded' } | { type: 'chunk'; id: number; audio: Float32Array; rate: number }
  | { type: 'done'; id: number } | { type: 'error'; id?: number; message: string };

type Splitter = { push(...t: string[]): void; close(): void };
type Model = {
  stream(text: Splitter, o: { voice: string; speed: number }): AsyncGenerator<{ audio: { audio: Float32Array; sampling_rate: number } }>;
};
const post = (m: Out, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

let model: Promise<Model> | undefined;
let Split: new () => Splitter;
function load(): Promise<Model> {
  if (!model) {
    model = (async () => {
      const [{ KokoroTTS, TextSplitterStream, env }, { default: mjs }, { default: wasm }] = await Promise.all([
        import('kokoro-js'),
        // 引擎随安装包走，默认从 jsdelivr 加载的脚本会被 CSP 拦。版本要和 @huggingface/transformers 依赖的一致
        import('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url'),
        import('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url'),
      ]);
      env.wasmPaths = { mjs, wasm } as unknown as string;
      Split = TextSplitterStream;
      globalThis.fetch = withKokoroMirror(globalThis.fetch.bind(globalThis));
      const files = new Map<string, [number, number]>();
      return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8', device: 'wasm',
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status === 'progress' && p.file && p.total) { files.set(p.file, [p.loaded ?? 0, p.total]); let l = 0, t = 0; for (const [a, b] of files.values()) { l += a; t += b; } post({ type: 'progress', pct: Math.round((l / t) * 100) }); }
        },
      }) as unknown as Model;
    })();
    model.catch(() => { model = undefined; });
  }
  return model;
}

const cancelled = new Set<number>();
let queue: Promise<void> = Promise.resolve();
async function gen(id: number, text: string, voice: string, speed: number) {
  if (cancelled.delete(id)) return post({ type: 'done', id });
  const m = await load();
  // 按句子切开（kokoro-js 自带的分句）：第一句合成完就能先出声，长段落也不会被截断（一次最多约 510 个音素）
  // 直接传字符串时 kokoro-js 不 close 分句器，最后一句永远等不到；自己建一个推完就关
  const split = new Split(); split.push(text); split.close();
  for await (const { audio } of m.stream(split, { voice, speed })) {
    if (cancelled.delete(id)) break;
    const a = new Float32Array(audio.audio);
    post({ type: 'chunk', id, audio: a, rate: audio.sampling_rate }, [a.buffer]);
  }
  cancelled.delete(id);
  post({ type: 'done', id });
}

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === 'load') void load().then(() => post({ type: 'loaded' }), err => post({ type: 'error', message: String((err as Error)?.message ?? err) }));
  else if (m.type === 'cancel') cancelled.add(m.id);
  else queue = queue.then(() => gen(m.id, m.text, m.voice, m.speed)).catch(err => post({ type: 'error', id: m.id, message: String((err as Error)?.message ?? err) }));
};
