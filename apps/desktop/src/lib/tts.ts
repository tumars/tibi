import { tl } from './i18n';
import type { In, Out } from './kokoro.worker';
export { withKokoroMirror } from './kokoroMirror';
/**
 * 朗读（00 §3.4，M4）：系统语音（默认，离线可用）/ Kokoro 本地模型（可下载，约 92 MB，第一次用时从魔搭下载，失败退回 Hugging Face，浏览器缓存）。
 * - say(text)：单词发音、句子朗读；返回播放结束的 Promise：读完是 true，被 stop() 或下一次 say() 打断是 false。
 * - pause() / resume()：停在句子中间，再接着读。
 * - Kokoro 合成的音频按 文字 + 音色 + 语速 缓存在内存（本次运行内重复播放不再合成）。
 * 设置键：tts.engine（默认引擎：system | kokoro）、tts.voice（系统音色）、tts.ai_voice（Kokoro 音色）、tts.rate。
 * 界面上能读的地方都同时给系统朗读和 AI 朗读两个按钮（components/Speak），按钮指定引擎，不看默认。
 */
export type Engine = 'system' | 'kokoro';
export interface Voice { id: string; label: string; accent: 'us' | 'gb' }

let engine: Engine = 'system';
let voiceId = '';
let aiVoice = 'af_heart';
let rate = 1;
/** engine 是默认引擎（自动播放、快捷键、全文朗读起始）；voice 是系统音色，aiVoice 是 Kokoro 音色 */
export function configure(o: { engine?: Engine; voice?: string; aiVoice?: string; rate?: number }) {
  if (o.engine) engine = o.engine; if (o.voice !== undefined) voiceId = o.voice; if (o.aiVoice) aiVoice = o.aiVoice; if (o.rate) rate = o.rate;
  // 默认用 AI 朗读：启动后先在 Worker 里把模型加载好（几秒），第一次点朗读不用干等
  if (engine === 'kokoro' && kokoroDownloaded()) setTimeout(() => { loadKokoro().catch(() => undefined); }, 3000);
}
export const current = () => ({ engine, voice: voiceId, aiVoice, rate });

/* ---------- 系统语音 ---------- */
/**
 * macOS 自带的音效 / 整活音色（Bahh、Zarvox…）和机器味很重的老音色（Eloquence 的 Eddy、Grandma…，MacinTalk 的 Fred、Kathy…），
 * 学不了发音；已经选了的照样留着
 */
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Fred|Junior|Kathy|Ralph)( \(.*\))?$/i;
export function systemVoices(): Voice[] {
  try {
    return speechSynthesis.getVoices().filter(v => /^en[-_](US|GB)/i.test(v.lang) && (!NOVELTY.test(v.name) || v.voiceURI === voiceId))
      // "Eddy (英语（英国）)"：括号里的语种后面会按英音 / 美音再标一次，去掉
      .map(v => ({ id: v.voiceURI, label: v.name.replace(/\s*[(（].*[)）]\s*$/, ''), accent: /GB/i.test(v.lang) ? 'gb' : 'us' }));
  } catch { return []; }
}
/** 中文用的系统音色：英文音色读到中文会跳过。优先婷婷（macOS 上最自然的普通话），再是别的普通话 */
function zhVoice(): SpeechSynthesisVoice | undefined {
  const vs = speechSynthesis.getVoices().filter(v => /^zh/i.test(v.lang) && !NOVELTY.test(v.name));
  return vs.find(v => /Tingting|婷婷/i.test(v.name)) ?? vs.find(v => /^zh[-_]CN/i.test(v.lang)) ?? vs[0];
}
function systemSay(text: string, r: number, zh = false): Promise<void> {
  return new Promise(resolve => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = zh ? zhVoice() : speechSynthesis.getVoices().find(x => x.voiceURI === voiceId);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = zh ? 'zh-CN' : 'en-US';
      u.rate = r; u.onend = () => resolve(); u.onerror = () => resolve();
      speechSynthesis.speak(u);
    } catch { resolve(); }
  });
}

/* ---------- Kokoro ---------- */
export const KOKORO_VOICES: Voice[] = [
  { id: 'af_heart', label: tl('美音 · 女（Heart）'), accent: 'us' }, { id: 'am_michael', label: tl('美音 · 男（Michael）'), accent: 'us' },
  { id: 'bf_emma', label: tl('英音 · 女（Emma）'), accent: 'gb' }, { id: 'bm_george', label: tl('英音 · 男（George）'), accent: 'gb' },
];
/* Kokoro 在 Worker 里跑（kokoro.worker.ts），主线程只管放音。不然合成那几秒整个界面都卡住 */
let worker: Worker | undefined;
let loaded: Promise<void> | undefined;
const progressSubs = new Set<(pct: number) => void>();
let loadFail: ((e: Error) => void) | undefined;
let jobSeq = 0;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Out>) => {
      const m = e.data;
      if (m.type === 'progress') progressSubs.forEach(f => f(m.pct));
      else if (m.type === 'error' && m.id === undefined) loadFail?.(new Error(m.message));
      else if (m.type !== 'loaded' && m.id !== undefined) jobsById.get(m.id)?.on(m);
    };
    worker.onerror = e => { const err = new Error(e.message || 'Kokoro worker failed'); loadFail?.(err); for (const j of jobsById.values()) j.fail(err); };
  }
  return worker;
}

export function loadKokoro(onProgress?: (pct: number) => void): Promise<void> {
  if (onProgress) progressSubs.add(onProgress);
  if (!loaded) {
    loaded = new Promise<void>((resolve, reject) => {
      const w = getWorker();
      loadFail = reject;
      const onLoaded = (e: MessageEvent<Out>) => { if (e.data.type === 'loaded') { w.removeEventListener('message', onLoaded); resolve(); } };
      w.addEventListener('message', onLoaded);
      w.postMessage({ type: 'load' } satisfies In);
    });
    loaded.then(() => { try { localStorage.setItem('tibi.kokoro.ready', '1'); } catch { /* 无存储 */ } }, () => { loaded = undefined; });
  }
  const p = loaded;
  if (onProgress) void p.finally(() => progressSubs.delete(onProgress)).catch(() => undefined);
  return p;
}
export function kokoroDownloaded(): boolean { try { return localStorage.getItem('tibi.kokoro.ready') === '1'; } catch { return false; } }

/** 一次合成：Worker 一句一句回音频，边收边放。合成好的留着当缓存（文字 + 音色 + 语速） */
class Job {
  readonly id = ++jobSeq;
  chunks: AudioBuffer[] = []; done = false; error?: Error;
  private wake = new Set<() => void>();
  on(m: Out) {
    if (m.type === 'chunk') { const b = new AudioBuffer({ length: m.audio.length, sampleRate: m.rate, numberOfChannels: 1 }); b.copyToChannel(m.audio as Float32Array<ArrayBuffer>, 0); this.chunks.push(b); }
    else if (m.type === 'done') this.done = true;
    else if (m.type === 'error') this.error = new Error(m.message);
    if (this.done || this.error) jobsById.delete(this.id);
    this.wake.forEach(f => f()); this.wake.clear();
  }
  fail(e: Error) { this.on({ type: 'error', id: this.id, message: e.message }); }
  async *[Symbol.asyncIterator](): AsyncGenerator<AudioBuffer> {
    for (let i = 0; ; ) {
      if (i < this.chunks.length) yield this.chunks[i++]!;
      else if (this.error) throw this.error;
      else if (this.done) return;
      else await new Promise<void>(r => this.wake.add(r));
    }
  }
}
const jobs = new Map<string, Job>();       // 缓存键 → 合成（做完的和正在做的）
const jobsById = new Map<number, Job>();   // 还在合成的
function synth(text: string, r: number): Job {
  const voice = KOKORO_VOICES.some(v => v.id === aiVoice) ? aiVoice : 'af_heart';
  const key = `${voice}|${r}|${text}`;
  let j = jobs.get(key);
  if (j && !j.error) { jobs.delete(key); jobs.set(key, j); return j; }
  j = new Job(); jobs.set(key, j); jobsById.set(j.id, j);
  if (jobs.size > 300) { const [k, old] = jobs.entries().next().value!; if (old.done) jobs.delete(k); }
  getWorker().postMessage({ type: 'gen', id: j.id, text, voice, speed: r } satisfies In);
  loadKokoro().catch(() => undefined);
  return j;
}
/** 停下时扔掉还没合成完的（留着会堵住后面的），want 是马上要读的那条 */
function cancelPending(want?: Job) {
  for (const [k, j] of jobs) if (j !== want && !j.done && !j.error) { worker?.postMessage({ type: 'cancel', id: j.id } satisfies In); jobs.delete(k); jobsById.delete(j.id); }
}
/** 提前合成下一句（全文朗读用），轮到它时不用再等 */
export function prefetch(text: string, o: { rate?: number } = {}) { if (kokoroDownloaded()) synth(text, o.rate ?? rate); }

let ctx: AudioContext | undefined; let playing: AudioBufferSourceNode | undefined; let stopResolve: (() => void) | undefined;
async function kokoroSay(job: Job, my: number): Promise<void> {
  ctx ??= new AudioContext();
  setStatus(job.chunks.length ? 'speaking' : 'loading');
  for await (const buf of job) {
    if (my !== seq) return;
    setStatus('speaking');
    await new Promise<void>(resolve => {
      const src = ctx!.createBufferSource(); src.buffer = buf; src.connect(ctx!.destination);
      src.onended = () => { if (playing === src) playing = undefined; resolve(); };
      playing = src; stopResolve = resolve; src.start();
    });
    if (my !== seq) return;
    if (!job.done && job.chunks.at(-1) === buf) setStatus('loading');   // 下一句还没合成好
  }
}

/* ---------- 状态 ---------- */
/** loading：AI 朗读在加载模型或合成，还没出声；speaking：在出声 */
export type Status = 'idle' | 'loading' | 'speaking';
let status: Status = 'idle';
const statusSubs = new Set<(s: Status) => void>();
function setStatus(s: Status) { if (s !== status) { status = s; statusSubs.forEach(f => f(s)); } }
export const getStatus = () => status;
export function onStatus(f: (s: Status) => void): () => void { statusSubs.add(f); return () => { statusSubs.delete(f); }; }

/* ---------- 对外 ---------- */
let seq = 0;
let paused = false;
export function stop() { halt(); }
function halt(want?: Job) {
  seq++; paused = false; cancelPending(want); setStatus('idle');
  // 暂停着直接 cancel，Chrome 之后再 speak 不出声；要先 resume
  try { speechSynthesis.resume(); speechSynthesis.cancel(); } catch { /* 无语音 */ }
  try { playing?.stop(); } catch { /* 已停 */ }
  if (ctx?.state === 'suspended') void ctx.resume();
  playing = undefined; stopResolve?.(); stopResolve = undefined;
}
/** 停在句子中间。没在出声（合成中、句间停顿）或平台做不到时返回 false，调用方只能 stop() 后重读这一句 */
export function pause(): boolean {
  if (paused) return true;
  if (playing && ctx) { void ctx.suspend(); paused = true; return true; }
  try {
    // Android 上 pause() 等于 cancel()（MDN）
    if (!speechSynthesis.speaking || /Android/i.test(navigator.userAgent)) return false;
    speechSynthesis.pause(); paused = true; return true;
  } catch { return false; }
}
/** 接着读；暂停之后被 stop() 或别的 say() 打断过就没得接了，返回 false */
export function resume(): boolean {
  if (!paused) return false;
  paused = false;
  if (ctx?.state === 'suspended') void ctx.resume();
  try { speechSynthesis.resume(); } catch { /* 无语音 */ }
  return true;
}
const ZH = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;
/**
 * 中英混排的文字按语言切成几段（Tibi 的回答是中文讲解夹英文例句）：中文交给系统中文音色，英文用选的音色。
 * 空格、数字、标点不算语言，跟着前一段
 */
export function splitLang(text: string): { text: string; zh: boolean }[] {
  const out: { text: string; zh?: boolean }[] = [];
  for (const ch of text) {
    const zh = ZH.test(ch) ? true : /[A-Za-z]/.test(ch) ? false : undefined;
    const last = out.at(-1);
    if (!last) out.push({ text: ch, zh });
    else if (zh === undefined || zh === last.zh) last.text += ch;
    else if (last.zh === undefined) { last.text += ch; last.zh = zh; }
    else out.push({ text: ch, zh });
  }
  return out.filter(s => /[\p{L}\p{N}]/u.test(s.text)).map(s => ({ text: s.text.trim(), zh: s.zh ?? false }));
}

/**
 * 读一段文字。zh：这段是中文，只用系统中文音色（Kokoro 只有英文音色）。engine 不传用设置里的默认（自动播放、全文朗读）：Kokoro 失败（没下载、离线）时退回系统语音；
 * 传了就是用户点的那个按钮：只用这个引擎，AI 朗读失败时抛错，由界面提示
 */
export async function say(text: string, o: { rate?: number; engine?: Engine; zh?: boolean } = {}): Promise<boolean> {
  const r = o.rate ?? rate;
  const use = o.zh ? 'system' : o.engine ?? engine;
  if (use === 'kokoro') {
    const job = synth(text, r);
    halt(job); const my = ++seq;
    try { await kokoroSay(job, my); return my === seq; }
    catch (e) { if (my !== seq) return false; if (o.engine) { setStatus('idle'); throw e; } }
    finally { if (my === seq) setStatus('idle'); }
  } else halt();
  const my = ++seq;
  setStatus('speaking');
  await systemSay(text, r, o.zh);
  if (my === seq) setStatus('idle');
  return my === seq;
}
