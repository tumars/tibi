import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAudioArrayBuffer } from '../src/lib/localAsr';
import { withModelScopeMirror } from '../src/lib/modelMirror';
import { secretRef, siliconflowRegisterUrl } from '../src/lib/providers';
import {
  LOCAL_ASR_MODEL_IDS,
  normalizeWhisperChunks,
  planAudioWindows,
} from '../src/lib/whisperAudio';

describe('Whisper 本地模型魔搭镜像', () => {
  const HF = 'https://huggingface.co/onnx-community/whisper-base.en/resolve/main/onnx/encoder_model_quantized.onnx';
  const MS = 'https://modelscope.cn/models/onnx-community/whisper-base.en/resolve/main/onnx/encoder_model_quantized.onnx';
  const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map(c => c[0]);

  it('命中白名单 Whisper 仓库时优先走魔搭，成功不碰 Hugging Face', async () => {
    const base = vi.fn(async () => new Response('ok'));
    await withModelScopeMirror(base, LOCAL_ASR_MODEL_IDS)(HF);
    expect(urls(base)).toEqual([MS]);
  });

  it('魔搭不可达或 404 时自动回退 Hugging Face；已取消请求不再回退', async () => {
    const fallback = vi.fn(async (u: unknown) => new Response('', { status: u === MS ? 502 : 200 }));
    expect((await withModelScopeMirror(fallback as typeof fetch, LOCAL_ASR_MODEL_IDS)(HF)).ok).toBe(true);
    expect(urls(fallback)).toEqual([MS, HF]);

    const c = new AbortController(); c.abort();
    const aborted = vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); });
    await expect(withModelScopeMirror(aborted, LOCAL_ASR_MODEL_IDS)(HF, { signal: c.signal })).rejects.toThrow();
    expect(urls(aborted)).toEqual([MS]);
  });

  it('非白名单地址原样放行', async () => {
    const base = vi.fn(async () => new Response('ok'));
    await withModelScopeMirror(base, LOCAL_ASR_MODEL_IDS)('https://huggingface.co/other/repo/config.json');
    expect(urls(base)).toEqual(['https://huggingface.co/other/repo/config.json']);
  });
});

describe('Whisper 本地音频静音边界切窗与结果规整', () => {
  it('短于 29.5s 的音频不切分，保持单窗', () => {
    const pcm = new Float32Array(16_000 * 12);
    const wins = planAudioWindows(pcm, 16_000);
    expect(wins).toHaveLength(1);
    expect(wins[0]).toEqual({ startSample: 0, endSample: pcm.length, startMs: 0, durationMs: 12_000 });
  });

  it('长音频在 [minSec, maxSec] 区间内优先沿低能量静音停顿处切分', () => {
    const sr = 16_000;
    const pcm = new Float32Array(sr * 50);
    // 填充模拟语音能量（正弦波），在 25.0s–25.6s 处放一段真实静音停顿
    for (let i = 0; i < pcm.length; i++) {
      const t = i / sr;
      pcm[i] = t >= 25.0 && t <= 25.6 ? 0 : Math.sin(i * 0.1) * 0.6;
    }
    const wins = planAudioWindows(pcm, sr);
    expect(wins).toHaveLength(2);
    // 第一窗应落在 25.0s–25.6s 静音区内（25_000–25_600 ms）
    expect(wins[0]!.durationMs).toBeGreaterThanOrEqual(24_900);
    expect(wins[0]!.durationMs).toBeLessThanOrEqual(25_700);
    expect(wins[1]!.startSample).toBe(wins[0]!.endSample);
    expect(wins[1]!.endSample).toBe(pcm.length);
  });

  it('normalizeWhisperChunks 累加窗口偏移、钳制 null 终点并过滤空白噪声幻觉', () => {
    const segs = normalizeWhisperChunks(
      [
        { text: ' [BLANK_AUDIO] ', timestamp: [0, 1.2] },
        { text: ' (music) ', timestamp: [1.2, 2.0] },
        { text: ' Welcome   back. ', timestamp: [2.0, 4.5] },
        { text: ' Next sentence continues ', timestamp: [4.5, null] },
      ],
      undefined,
      30_000,
      10_000,
    );
    expect(segs).toEqual([
      { text: 'Welcome back.', start_ms: 32_000, end_ms: 34_500 },
      { text: 'Next sentence continues', start_ms: 34_500, end_ms: 40_000 },
    ]);

    // chunks 缺失时退回 fallbackText
    const fb = normalizeWhisperChunks(undefined, '  Hello world.  ', 5_000, 3_000);
    expect(fb).toEqual([{ text: 'Hello world.', start_ms: 5_000, end_ms: 8_000 }]);
  });
});

describe('硅基流动注册链接与非 ASCII 密钥引用名', () => {
  it('留空邀请码直达官网，填邀请码拼出官方 /i/<code> 链接', () => {
    expect(siliconflowRegisterUrl('')).toBe('https://cloud.siliconflow.cn/');
    expect(siliconflowRegisterUrl('  ')).toBe('https://cloud.siliconflow.cn/');
    expect(siliconflowRegisterUrl('AbC123')).toBe('https://cloud.siliconflow.cn/i/AbC123');
  });

  it('中文服务商名退回域名 slug，避免钥匙串引用碰撞，DeepSeek 保持原命名兼容', () => {
    expect(secretRef('DeepSeek', 'llm', 'https://api.deepseek.com')).toBe('provider.deepseek.llm');
    expect(secretRef('硅基流动', 'llm', 'https://api.siliconflow.cn/v1')).toBe('provider.api-siliconflow-cn.llm');
    expect(secretRef('硅基流动 SenseVoice', 'asr', 'https://api.siliconflow.cn/v1')).toBe('provider.sensevoice.asr');
  });
});

describe('本地离线转写音频拉取（64 MiB 整文件限制回退）', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('遇到 413 时自动改用 Range 206 分段拼接完整音频', async () => {
    const full = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const mockFetch = vi.fn(async (_u: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (!range) return new Response('too large', { status: 413 });
      expect(range).toBe(`bytes=0-${16 * 1024 * 1024 - 1}`);
      return new Response(full, {
        status: 206,
        headers: { 'Content-Range': `bytes 0-${full.length - 1}/${full.length}` },
      });
    });
    vi.stubGlobal('fetch', mockFetch);
    const buf = await fetchAudioArrayBuffer('asset://localhost/podcasts/huge.mp3');
    expect(new Uint8Array(buf)).toEqual(full);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('缺 Content-Range 或超过 300 MB 上限时拒绝', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (!range) return new Response('too large', { status: 413 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 206 });
    }));
    await expect(fetchAudioArrayBuffer('asset://localhost/podcasts/bad.mp3')).rejects.toThrow('Content-Range');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200, headers: { 'Content-Length': String(301 * 1024 * 1024) } })));
    await expect(fetchAudioArrayBuffer('asset://localhost/podcasts/over.mp3')).rejects.toThrow('300 MB');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 206, headers: { 'Content-Range': 'bytes 0-1/10' } })));
    await expect(fetchAudioArrayBuffer('asset://localhost/podcasts/partial.mp3')).rejects.toThrow('206');

    let step = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (!range) return new Response('too large', { status: 413 });
      step++;
      if (step === 1) return new Response(new Uint8Array(16 * 1024 * 1024), { status: 206, headers: { 'Content-Range': `bytes 0-${16 * 1024 * 1024 - 1}/${16 * 1024 * 1024 + 4}` } });
      return new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 206, headers: { 'Content-Range': `bytes ${16 * 1024 * 1024}-${16 * 1024 * 1024 + 4}/${16 * 1024 * 1024 + 5}` } });
    }));
    await expect(fetchAudioArrayBuffer('asset://localhost/podcasts/drift.mp3')).rejects.toThrow('总长');

    // 超出请求区间上限的分片必须拒绝
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (!range) return new Response('too large', { status: 413 });
      return new Response(new Uint8Array(16 * 1024 * 1024 + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes 0-${16 * 1024 * 1024}/${16 * 1024 * 1024 + 5}` },
      });
    }));
    await expect(fetchAudioArrayBuffer('asset://localhost/podcasts/overshoot.mp3')).rejects.toThrow('区间');

    // total 为 * 时不把短分片直接当 EOF，需续拉并在 416 后收尾
    let starStep = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (!range) return new Response('too large', { status: 413 });
      starStep++;
      if (starStep === 1) return new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'Content-Range': 'bytes 0-2/*' } });
      if (starStep === 2) return new Response(new Uint8Array([4, 5]), { status: 206, headers: { 'Content-Range': 'bytes 3-4/*' } });
      return new Response('', { status: 416 });
    }));
    expect(new Uint8Array(await fetchAudioArrayBuffer('asset://localhost/podcasts/star.mp3'))).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });
});
