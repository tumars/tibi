/**
 * 朗读（00 §3.4，M4）：系统语音（默认，离线可用）/ Kokoro 本地模型（可下载，约 86 MB，第一次用时从 Hugging Face 下载，浏览器缓存）。
 * - say(text)：单词发音、句子朗读；返回播放结束的 Promise（stop() 会让它提前结束）。
 * - Kokoro 合成的音频按 文字 + 音色 + 语速 缓存在内存（本次运行内重复播放不再合成）。
 * 设置键：tts.engine（system | kokoro）、tts.voice、tts.rate。
 */
export type Engine = 'system' | 'kokoro';
export interface Voice { id: string; label: string; accent: 'us' | 'gb' }

let engine: Engine = 'system';
let voiceId = '';
let rate = 1;
export function configure(o: { engine?: Engine; voice?: string; rate?: number }) {
  if (o.engine) engine = o.engine; if (o.voice !== undefined) voiceId = o.voice; if (o.rate) rate = o.rate;
}
export const current = () => ({ engine, voice: voiceId, rate });

/* ---------- 系统语音 ---------- */
export function systemVoices(): Voice[] {
  try {
    return speechSynthesis.getVoices().filter(v => /^en[-_](US|GB)/i.test(v.lang)).map(v => ({ id: v.voiceURI, label: `${v.name}`, accent: /GB/i.test(v.lang) ? 'gb' : 'us' }));
  } catch { return []; }
}
function systemSay(text: string, r: number): Promise<void> {
  return new Promise(resolve => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = speechSynthesis.getVoices().find(x => x.voiceURI === voiceId);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
      u.rate = r; u.onend = () => resolve(); u.onerror = () => resolve();
      speechSynthesis.speak(u);
    } catch { resolve(); }
  });
}

/* ---------- Kokoro ---------- */
export const KOKORO_VOICES: Voice[] = [
  { id: 'af_heart', label: '美音 · 女（Heart）', accent: 'us' }, { id: 'am_michael', label: '美音 · 男（Michael）', accent: 'us' },
  { id: 'bf_emma', label: '英音 · 女（Emma）', accent: 'gb' }, { id: 'bm_george', label: '英音 · 男（George）', accent: 'gb' },
];
type KokoroModel = { generate(text: string, o: { voice: string; speed: number }): Promise<{ audio: Float32Array; sampling_rate: number }> };
let kokoro: Promise<KokoroModel> | undefined;
export function loadKokoro(onProgress?: (pct: number) => void): Promise<KokoroModel> {
  if (!kokoro) {
    kokoro = (async () => {
      const { KokoroTTS } = await import('kokoro-js');
      const files = new Map<string, [number, number]>();
      return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8', device: 'wasm',
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status === 'progress' && p.file && p.total) { files.set(p.file, [p.loaded ?? 0, p.total]); let l = 0, t = 0; for (const [a, b] of files.values()) { l += a; t += b; } onProgress?.(Math.round((l / t) * 100)); }
        },
      }) as unknown as KokoroModel;
    })();
    kokoro.catch(() => { kokoro = undefined; });
  }
  return kokoro;
}
export function kokoroDownloaded(): boolean { try { return localStorage.getItem('tibi.kokoro.ready') === '1'; } catch { return false; } }

const audioCache = new Map<string, AudioBuffer>();
let ctx: AudioContext | undefined; let playing: AudioBufferSourceNode | undefined; let stopResolve: (() => void) | undefined;
async function kokoroSay(text: string, r: number): Promise<void> {
  const model = await loadKokoro();
  try { localStorage.setItem('tibi.kokoro.ready', '1'); } catch { /* 无存储 */ }
  ctx ??= new AudioContext();
  const voice = KOKORO_VOICES.some(v => v.id === voiceId) ? voiceId : 'af_heart';
  const key = `${voice}|${r}|${text}`;
  let buf = audioCache.get(key);
  if (!buf) {
    const out = await model.generate(text, { voice, speed: r });
    buf = ctx.createBuffer(1, out.audio.length, out.sampling_rate); buf.copyToChannel(new Float32Array(out.audio), 0);
    if (audioCache.size > 300) audioCache.delete(audioCache.keys().next().value!);
    audioCache.set(key, buf);
  }
  return new Promise(resolve => {
    const src = ctx!.createBufferSource(); src.buffer = buf!; src.connect(ctx!.destination);
    src.onended = () => { if (playing === src) playing = undefined; resolve(); };
    playing = src; stopResolve = resolve; src.start();
  });
}

/* ---------- 对外 ---------- */
let seq = 0;
export function stop() {
  seq++;
  try { speechSynthesis.cancel(); } catch { /* 无语音 */ }
  try { playing?.stop(); } catch { /* 已停 */ }
  playing = undefined; stopResolve?.(); stopResolve = undefined;
}
/** 读一段文字；Kokoro 失败（没下载、离线）时退回系统语音 */
export async function say(text: string, o: { rate?: number } = {}): Promise<void> {
  stop(); const my = ++seq; const r = o.rate ?? rate;
  if (engine === 'kokoro') {
    try { await kokoroSay(text, r); return; } catch { if (my !== seq) return; }
  }
  await systemSay(text, r);
}
export const isStale = (my: number) => my !== seq;
export const token = () => seq;
