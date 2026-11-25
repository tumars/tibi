import type { Document, Sentence } from '@tibi/core';
import { create } from 'zustand';
import { resolveMediaSrc } from '../lib/mediaSrc';
import { rpc } from '../rpc';

/**
 * 全局电台音频播放器状态（17 §2.1 & §2.3）：
 * - 单例 HTMLAudioElement：离开听读页切去生词本/词典/复习时播放不中断，底部浮现 MiniPlayer
 * - 逐句时间戳同步、单句循环、A-B 复读、句间停顿、倍速、盲听模糊与揭晓
 * - 点词查词卡自动暂停，关词卡自动回退 0.8s 续播
 * - 节流持久化 documents.playback_ms（每 5s + 暂停/切集/页面卸载）
 */

export interface TimedLine { id: string; text: string; start_ms: number; end_ms: number; speaker?: string }

interface AudioState {
  docId?: string;
  title: string;
  author?: string;
  cover?: string;
  mediaPath?: string;
  mediaUrl?: string;
  src?: string;
  playing: boolean;
  loading: boolean;
  error?: string;
  currentMs: number;
  durationMs: number;
  rate: number;
  lines: TimedLine[];
  activeSentenceId?: string;
  loopSentenceId?: string;
  abLoop: { aMs?: number; bMs?: number };
  gapSec: number;
  blindMode: boolean;
  revealedIds: string[];

  loadEpisode(doc: Document, sentences?: Sentence[]): void;
  updateSentences(docId: string, sentences: Sentence[]): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(ms: number): void;
  skip(deltaMs: number): void;
  playSentence(sentenceId: string, autoPlay?: boolean): void;
  jumpSentence(delta: -1 | 1): void;
  replaySentence(): void;
  setRate(rate: number): void;
  toggleLoopSentence(): void;
  cycleAbLoop(): void;
  clearAbLoop(): void;
  setGapSec(sec: number): void;
  toggleBlind(): void;
  revealSentence(id: string): void;
  pauseForLookup(): void;
  resumeAfterLookup(): void;
  close(): void;
}

const RATE_KEY = 'tibi-radio-rate';
const readRate = () => {
  try { const n = Number(localStorage.getItem(RATE_KEY)); return n >= 0.5 && n <= 2.5 ? n : 1; } catch { return 1; }
};

let el: HTMLAudioElement | undefined;
let gapTimer: ReturnType<typeof setTimeout> | undefined;
let pausedByLookup = false;
let lastSavedMs = -1;
let lastSaveAt = 0;
let lastSentenceIdForGap: string | undefined;

function audio(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.preload = 'metadata';
  el.playbackRate = readRate();

  el.addEventListener('loadstart', () => useAudio.setState({ loading: true, error: undefined }));
  el.addEventListener('canplay', () => useAudio.setState({ loading: false }));
  el.addEventListener('loadedmetadata', () => {
    const dur = Number.isFinite(el!.duration) && el!.duration > 0 ? Math.round(el!.duration * 1000) : 0;
    if (dur > 0) useAudio.setState({ durationMs: dur });
  });
  el.addEventListener('play', () => {
    clearGap();
    useAudio.setState({ playing: true, loading: false, error: undefined });
  });
  el.addEventListener('pause', () => {
    useAudio.setState({ playing: false });
    savePlayback(true);
  });
  el.addEventListener('ended', () => {
    const st = useAudio.getState();
    if (st.loopSentenceId) {
      const line = st.lines.find(l => l.id === st.loopSentenceId);
      if (line) { el!.currentTime = line.start_ms / 1000; void el!.play().catch(() => undefined); return; }
    }
    useAudio.setState({ playing: false });
    savePlayback(true);
  });
  el.addEventListener('error', () => {
    const st = useAudio.getState();
    // 本地缓存打不开时自动回退到远程流式地址
    if (st.mediaUrl && st.src !== st.mediaUrl) {
      el!.src = st.mediaUrl;
      useAudio.setState({ src: st.mediaUrl, error: undefined, loading: true });
      if (st.currentMs > 0) el!.currentTime = st.currentMs / 1000;
      return;
    }
    useAudio.setState({ playing: false, loading: false, error: '音频暂时无法播放，请检查网络或稍后再试' });
  });
  el.addEventListener('timeupdate', () => {
    const ms = Math.round(el!.currentTime * 1000);
    const st = useAudio.getState();

    // A-B 区间复读
    if (st.abLoop.aMs != null && st.abLoop.bMs != null && ms >= st.abLoop.bMs) {
      el!.currentTime = st.abLoop.aMs / 1000;
      useAudio.setState({ currentMs: st.abLoop.aMs });
      return;
    }

    // 单句循环
    if (st.loopSentenceId) {
      const line = st.lines.find(l => l.id === st.loopSentenceId);
      if (line && line.end_ms > line.start_ms && ms >= line.end_ms + 120) {
        if (st.gapSec > 0 && !el!.paused) {
          el!.pause();
          clearGap();
          gapTimer = setTimeout(() => {
            if (!useAudio.getState().loopSentenceId) return;
            el!.currentTime = line.start_ms / 1000;
            void el!.play().catch(() => undefined);
          }, st.gapSec * 1000);
          return;
        }
        el!.currentTime = line.start_ms / 1000;
        useAudio.setState({ currentMs: line.start_ms });
        return;
      }
    }

    const active = findLineAt(st.lines, ms);
    const activeId = active?.id;

    // 句间自动停顿（便于消化/跟读）
    if (st.gapSec > 0 && !st.loopSentenceId && st.playing && lastSentenceIdForGap && activeId && activeId !== lastSentenceIdForGap) {
      const prev = st.lines.find(l => l.id === lastSentenceIdForGap);
      if (prev && ms >= prev.end_ms - 80 && ms - prev.end_ms < 2500) {
        lastSentenceIdForGap = activeId;
        el!.pause();
        clearGap();
        gapTimer = setTimeout(() => {
          if (useAudio.getState().docId === st.docId) void el!.play().catch(() => undefined);
        }, st.gapSec * 1000);
      }
    }
    lastSentenceIdForGap = activeId;

    useAudio.setState({ currentMs: ms, ...(activeId !== st.activeSentenceId ? { activeSentenceId: activeId } : {}) });
    savePlayback(false);
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => savePlayback(true));
  }
  return el;
}

function clearGap() {
  if (gapTimer) { clearTimeout(gapTimer); gapTimer = undefined; }
}

function savePlayback(force: boolean) {
  const st = useAudio.getState();
  if (!st.docId) return;
  const nowMs = Date.now();
  if (!force && (nowMs - lastSaveAt < 5000 || Math.abs(st.currentMs - lastSavedMs) < 1500)) return;
  lastSaveAt = nowMs;
  lastSavedMs = st.currentMs;
  void rpc.call('documents.playback', {
    id: st.docId,
    playback_ms: Math.max(0, Math.round(st.currentMs)),
    ...(st.durationMs > 0 ? { duration_ms: Math.round(st.durationMs) } : {}),
  }).catch(() => undefined);
}

function extractLines(sentences?: Sentence[]): TimedLine[] {
  if (!sentences?.length) return [];
  return sentences
    .filter(s => s.start_ms != null)
    .map(s => ({ id: s.id, text: s.text, start_ms: s.start_ms!, end_ms: s.end_ms ?? s.start_ms!, speaker: s.speaker }))
    .sort((a, b) => a.start_ms - b.start_ms);
}

function findLineAt(lines: TimedLine[], ms: number): TimedLine | undefined {
  if (!lines.length) return undefined;
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.start_ms <= ms + 150) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? lines[ans] : lines[0];
}

function syncMediaSession(st: Pick<AudioState, 'title' | 'author' | 'cover'>) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: st.title,
      artist: st.author || 'Tibi Radio',
      ...(st.cover ? { artwork: [{ src: st.cover }] } : {}),
    });
    navigator.mediaSession.setActionHandler('play', () => useAudio.getState().play());
    navigator.mediaSession.setActionHandler('pause', () => useAudio.getState().pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => useAudio.getState().skip(-5000));
    navigator.mediaSession.setActionHandler('seekforward', () => useAudio.getState().skip(5000));
    navigator.mediaSession.setActionHandler('previoustrack', () => useAudio.getState().jumpSentence(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => useAudio.getState().jumpSentence(1));
  } catch { /* 忽略不支持的浏览器 */ }
}

export const useAudio = create<AudioState>((set, get) => ({
  title: '', playing: false, loading: false, currentMs: 0, durationMs: 0, rate: readRate(),
  lines: [], abLoop: {}, gapSec: 0, blindMode: false, revealedIds: [],

  loadEpisode(doc, sentences) {
    if (doc.kind !== 'episode' || !doc.episode) return;
    const prev = get();
    const ep = doc.episode;
    const nextSrc = resolveMediaSrc(ep.media_path, ep.media_url);
    const lines = sentences ? extractLines(sentences) : prev.docId === doc.id ? prev.lines : [];

    // 同一集（比如后台静默缓存刚刚完成，media_path 出现了）：不中断播放，仅刷新元数据与逐字稿
    if (prev.docId === doc.id) {
      const patch: Partial<AudioState> = {
        title: doc.title, author: doc.author, cover: doc.cover_path,
        mediaPath: ep.media_path, mediaUrl: ep.media_url,
        ...(ep.duration_ms && !prev.durationMs ? { durationMs: ep.duration_ms } : {}),
        ...(sentences ? { lines, activeSentenceId: findLineAt(lines, prev.currentMs)?.id } : {}),
      };
      // 如果之前没源现在有了，或者当前暂停且刚拿到本地缓存，切到本地源
      if (nextSrc && (!prev.src || (!prev.playing && ep.media_path && prev.src !== nextSrc))) {
        const a = audio();
        a.src = nextSrc;
        a.playbackRate = prev.rate;
        if (prev.currentMs > 0) a.currentTime = prev.currentMs / 1000;
        patch.src = nextSrc;
      }
      set(patch);
      return;
    }

    // 切到新一集：先把上一集进度存下来
    if (prev.docId) savePlayback(true);
    clearGap();
    pausedByLookup = false;
    lastSavedMs = ep.playback_ms ?? 0;
    lastSentenceIdForGap = undefined;

    const a = audio();
    a.pause();
    const startMs = Math.max(0, ep.playback_ms ?? 0);
    if (nextSrc) {
      a.src = nextSrc;
      a.playbackRate = prev.rate;
      if (startMs > 0) {
        const applyStart = () => { try { a.currentTime = startMs / 1000; } catch { /* */ } };
        a.addEventListener('loadedmetadata', applyStart, { once: true });
      }
    }
    const active = findLineAt(lines, startMs);
    set({
      docId: doc.id, title: doc.title, author: doc.author, cover: doc.cover_path,
      mediaPath: ep.media_path, mediaUrl: ep.media_url, src: nextSrc,
      playing: false, loading: false, error: nextSrc ? undefined : '没有可用的音频地址',
      currentMs: startMs, durationMs: ep.duration_ms ?? 0,
      lines, activeSentenceId: active?.id, loopSentenceId: undefined, abLoop: {}, revealedIds: [],
    });
    syncMediaSession({ title: doc.title, author: doc.author, cover: doc.cover_path });
  },

  updateSentences(docId, sentences) {
    if (get().docId !== docId) return;
    const lines = extractLines(sentences);
    set({ lines, activeSentenceId: findLineAt(lines, get().currentMs)?.id });
  },

  play() {
    clearGap();
    const st = get();
    if (!st.src) return;
    const a = audio();
    if (a.src !== st.src && !a.currentSrc) a.src = st.src;
    a.playbackRate = st.rate;
    void a.play().catch(e => set({ playing: false, error: e instanceof Error ? e.message : '播放失败' }));
  },

  pause() {
    clearGap();
    pausedByLookup = false;
    audio().pause();
  },

  toggle() {
    if (get().playing) get().pause(); else get().play();
  },

  seek(ms) {
    clearGap();
    const st = get();
    const clamped = Math.max(0, st.durationMs > 0 ? Math.min(st.durationMs, ms) : ms);
    const a = audio();
    try { a.currentTime = clamped / 1000; } catch { /* metadata 未就绪 */ }
    const active = findLineAt(st.lines, clamped);
    lastSentenceIdForGap = active?.id;
    set({ currentMs: clamped, activeSentenceId: active?.id });
  },

  skip(deltaMs) {
    get().seek(get().currentMs + deltaMs);
  },

  playSentence(sentenceId, autoPlay = true) {
    const st = get();
    const line = st.lines.find(l => l.id === sentenceId);
    if (!line) return;
    get().seek(line.start_ms);
    if (st.loopSentenceId) set({ loopSentenceId: line.id });
    if (autoPlay && !get().playing) get().play();
  },

  jumpSentence(delta) {
    const st = get();
    if (!st.lines.length) { get().skip(delta * 5000); return; }
    const curIdx = st.lines.findIndex(l => l.id === st.activeSentenceId);
    const nextIdx = Math.max(0, Math.min(st.lines.length - 1, (curIdx < 0 ? 0 : curIdx) + delta));
    const target = st.lines[nextIdx];
    if (target) get().playSentence(target.id, st.playing);
  },

  replaySentence() {
    const st = get();
    const line = st.lines.find(l => l.id === st.activeSentenceId);
    if (line) get().playSentence(line.id, true);
    else get().skip(-5000);
  },

  setRate(rate) {
    const clamped = Math.max(0.5, Math.min(2.5, Math.round(rate * 100) / 100));
    audio().playbackRate = clamped;
    try { localStorage.setItem(RATE_KEY, String(clamped)); } catch { /* */ }
    set({ rate: clamped });
  },

  toggleLoopSentence() {
    const st = get();
    if (st.loopSentenceId) { set({ loopSentenceId: undefined }); return; }
    const id = st.activeSentenceId ?? st.lines[0]?.id;
    if (id) set({ loopSentenceId: id, abLoop: {} });
  },

  cycleAbLoop() {
    const st = get();
    if (st.abLoop.aMs == null) {
      set({ abLoop: { aMs: st.currentMs }, loopSentenceId: undefined });
    } else if (st.abLoop.bMs == null) {
      const aMs = Math.min(st.abLoop.aMs, st.currentMs);
      const bMs = Math.max(st.abLoop.aMs, st.currentMs);
      if (bMs - aMs < 500) set({ abLoop: {} });
      else { set({ abLoop: { aMs, bMs } }); get().seek(aMs); }
    } else {
      set({ abLoop: {} });
    }
  },

  clearAbLoop() { set({ abLoop: {} }); },

  setGapSec(sec) { set({ gapSec: sec }); },

  toggleBlind() {
    const on = !get().blindMode;
    set({ blindMode: on, revealedIds: [] });
  },

  revealSentence(id) {
    const cur = get().revealedIds;
    if (!cur.includes(id)) set({ revealedIds: [...cur, id] });
  },

  pauseForLookup() {
    if (get().playing) {
      pausedByLookup = true;
      clearGap();
      audio().pause();
    }
  },

  resumeAfterLookup() {
    if (!pausedByLookup) return;
    pausedByLookup = false;
    const ms = Math.max(0, get().currentMs - 800);
    get().seek(ms);
    get().play();
  },

  close() {
    savePlayback(true);
    clearGap();
    pausedByLookup = false;
    const a = audio();
    a.pause();
    a.removeAttribute('src');
    set({ docId: undefined, title: '', author: undefined, cover: undefined, src: undefined, playing: false, loading: false, error: undefined, currentMs: 0, durationMs: 0, lines: [], activeSentenceId: undefined, loopSentenceId: undefined, abLoop: {}, revealedIds: [] });
  },
}));
