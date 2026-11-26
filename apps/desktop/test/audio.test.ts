import type { Document } from '@tibi/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/rpc', () => ({
  rpc: { call: vi.fn(() => Promise.resolve({ ok: true })) },
}));

vi.mock('../src/lib/mediaSrc', () => ({
  resolveMediaSrc: (mediaPath?: string, mediaUrl?: string) => {
    if (mediaPath?.startsWith('media:')) return `asset://localhost/${mediaPath.slice(6)}`;
    if (mediaPath?.startsWith('http')) return mediaPath;
    return mediaUrl;
  },
}));

class FakeAudio {
  preload = '';
  defaultPlaybackRate = 1;
  playbackRate = 1;
  readyState = 0;
  duration = Number.NaN;
  currentTime = 0;
  paused = true;
  private _src = '';
  loadCalls = 0;
  playCalls = 0;
  private listeners = new Map<string, Set<() => void>>();

  get src() { return this._src; }
  set src(v: string) {
    this._src = v;
    this.readyState = 0;
    this.duration = Number.NaN;
    this.currentTime = 0;
    this.emit('loadstart');
  }
  get currentSrc() { return this._src; }
  getAttribute(name: string) { return name === 'src' ? (this._src || null) : null; }
  removeAttribute(name: string) { if (name === 'src') this._src = ''; }
  load() { this.loadCalls++; }
  play() {
    this.playCalls++;
    this.paused = false;
    this.emit('play');
    return Promise.resolve();
  }
  pause() {
    if (!this.paused) {
      this.paused = true;
      this.emit('pause');
    }
  }
  addEventListener(type: string, fn: () => void) {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(fn);
  }
  emit(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  finishMetadata(durationSec: number) {
    this.duration = durationSec;
    this.readyState = 1;
    this.emit('loadedmetadata');
  }
}

function makeEpisode(id: string, ep: Partial<NonNullable<Document['episode']>> = {}): Document {
  return {
    id,
    title: `Episode ${id}`,
    kind: 'episode',
    genre: 'general',
    source: 'podcast',
    source_type: 'podcast',
    status: 'ready',
    ai_status: 'none',
    tags: [],
    shelved: true,
    excerpt: '',
    minutes: 5,
    progress: 0,
    added_at: 1,
    sections: [],
    episode: {
      media_url: `https://cdn.example.com/${id}.mp3`,
      duration_ms: 120_000,
      playback_ms: 0,
      ...ep,
    },
  };
}

describe('电台全局播放器状态（store/audio）', () => {
  let fake: FakeAudio;

  beforeEach(() => {
    vi.resetModules();
    fake = new FakeAudio();
    vi.stubGlobal('Audio', vi.fn(function () { return fake; }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('metadata 就绪前的 seek 会排队应用，切集不会残留上一集的监听器', async () => {
    const { useAudio } = await import('../src/store/audio');
    useAudio.getState().loadEpisode(makeEpisode('ep1', { playback_ms: 45_000 }));
    expect(useAudio.getState().loading).toBe(false);
    // ep1 尚未 loadedmetadata 就直接切到 ep2（从 12s 开始）
    useAudio.getState().loadEpisode(makeEpisode('ep2', { playback_ms: 12_000 }));
    // 再手动 seek 到 30s（此时 readyState 仍为 0）
    useAudio.getState().seek(30_000);
    expect(fake.currentTime).toBe(0);

    fake.finishMetadata(120);
    expect(fake.currentTime).toBe(30);
    expect(useAudio.getState().currentMs).toBe(30_000);
  });

  it('本地缓存音频报错后自动回退远程流、保留进度与播放状态，且不会在 doc 刷新时弹回损坏源', async () => {
    const { useAudio } = await import('../src/store/audio');
    const doc = makeEpisode('ep-fallback', {
      media_path: 'media:podcasts/broken.mp3',
      media_url: 'https://cdn.example.com/fallback.mp3',
      playback_ms: 20_000,
    });
    useAudio.getState().loadEpisode(doc);
    useAudio.getState().setRate(1.25);
    fake.finishMetadata(120);
    useAudio.getState().play();
    expect(useAudio.getState().playing).toBe(true);
    expect(fake.src).toBe('asset://localhost/podcasts/broken.mp3');

    // 本地 asset:// 触发 error
    fake.emit('error');
    expect(useAudio.getState().src).toBe('https://cdn.example.com/fallback.mp3');
    expect(fake.src).toBe('https://cdn.example.com/fallback.mp3');

    // 远程流加载完成：自动恢复到 20s、保持 1.25x 倍速并继续播放
    fake.finishMetadata(120);
    expect(fake.currentTime).toBe(20);
    expect(fake.playbackRate).toBe(1.25);
    expect(fake.defaultPlaybackRate).toBe(1.25);
    expect(fake.paused).toBe(false);

    // 即使后续 doc 刷新仍带有 media_path，也不能切回已经失败的本地源
    useAudio.getState().pause();
    useAudio.getState().loadEpisode(doc);
    expect(useAudio.getState().src).toBe('https://cdn.example.com/fallback.mp3');
    expect(fake.src).toBe('https://cdn.example.com/fallback.mp3');
  });

  it('查词暂停期间（含句间停顿中）不会被后台缓存切换打断，且停顿定时器不会偷跑续播', async () => {
    vi.useFakeTimers();
    const { useAudio } = await import('../src/store/audio');
    const docRemote = makeEpisode('ep-lookup', { media_url: 'https://cdn.example.com/a.mp3' });
    useAudio.getState().loadEpisode(docRemote, [
      { id: 's1', paragraph_idx: 0, block_type: 'prose', idx: 0, text: 'First.', start_ms: 0, end_ms: 2000, tokens: [] },
      { id: 's2', paragraph_idx: 0, block_type: 'prose', idx: 1, text: 'Second.', start_ms: 2100, end_ms: 4000, tokens: [] },
    ]);
    fake.finishMetadata(60);
    useAudio.getState().setGapSec(2);
    useAudio.getState().play();

    // 播放跨过第一句进入句间停顿
    fake.currentTime = 1.0;
    fake.emit('timeupdate');
    fake.currentTime = 2.2;
    fake.emit('timeupdate');
    expect(fake.paused).toBe(true);

    // 在句间停顿期间点词查词
    useAudio.getState().pauseForLookup();

    // 后台静默缓存此时恰好完成并刷新 doc（带上了 media_path）
    useAudio.getState().loadEpisode(makeEpisode('ep-lookup', {
      media_path: 'media:podcasts/ep-lookup.mp3',
      media_url: 'https://cdn.example.com/a.mp3',
    }));
    // 查词暂停期间不应抢切 src
    expect(fake.src).toBe('https://cdn.example.com/a.mp3');

    // 推进 3 秒，句间停顿定时器已被取消，不能擅自续播
    vi.advanceTimersByTime(3000);
    expect(fake.paused).toBe(true);

    // 关词卡后恢复播放
    useAudio.getState().resumeAfterLookup();
    expect(fake.paused).toBe(false);
  });

  it('close() 调用 load() 释放底层资源并忽略空 src 后的 error 事件', async () => {
    const { useAudio } = await import('../src/store/audio');
    useAudio.getState().loadEpisode(makeEpisode('ep-close'));
    const beforeLoad = fake.loadCalls;

    useAudio.getState().close();
    expect(fake.src).toBe('');
    expect(fake.loadCalls).toBe(beforeLoad + 1);

    fake.emit('error');
    expect(useAudio.getState().error).toBeUndefined();
  });

  it('同集重新完成本地缓存下载时解除之前的本地失败标记', async () => {
    const { useAudio } = await import('../src/store/audio');
    const broken = makeEpisode('ep-recache', {
      media_path: 'media:podcasts/recache.mp3',
      media_url: 'https://cdn.example.com/recache.mp3',
    });
    useAudio.getState().loadEpisode(broken);
    fake.finishMetadata(60);
    fake.emit('error');
    expect(useAudio.getState().src).toBe('https://cdn.example.com/recache.mp3');

    // 先清理失效本地路径，再重新完成本地下载
    useAudio.getState().loadEpisode(makeEpisode('ep-recache', { media_url: 'https://cdn.example.com/recache.mp3' }));
    useAudio.getState().loadEpisode(broken);
    expect(useAudio.getState().src).toBe('asset://localhost/podcasts/recache.mp3');
  });
});
