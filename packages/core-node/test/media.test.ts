import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMediaOps,
  measureMp3DurationMs,
  parseMp3FrameHeader,
  splitMp3ByDuration,
  splitMp3BySize,
  splitTextToTimedSegments,
  stripAsrTags,
  testAsr,
} from '../src/media.js';

/** 构造标准 MPEG-1 Layer III 128 kbps 44100 Hz 无 padding 帧（每帧 417 字节，时长 ≈ 26.122 ms） */
function makeMp3Frames(count: number, withId3 = true): Uint8Array {
  const frameLen = 417;
  const id3 = withId3 ? new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 1, 2, 3, 4]) : new Uint8Array(0);
  const out = new Uint8Array(id3.byteLength + count * frameLen);
  out.set(id3, 0);
  for (let i = 0; i < count; i++) {
    const off = id3.byteLength + i * frameLen;
    // sync=0xFFE, version=11(MPEG1), layer=01(L3), crc=1 → 0xFF 0xFB; bitrate=1001(128k), sr=00(44.1k), pad=0 → 0x90
    out[off] = 0xff;
    out[off + 1] = 0xfb;
    out[off + 2] = 0x90;
    out[off + 3] = 0x00;
  }
  return out;
}

describe('电台媒体缓存与 MP3 帧切分', () => {
  it('按 MPEG 帧头精确切分大 MP3 并累加偏移毫秒', () => {
    const buf = makeMp3Frames(100, true); // 100 帧 ≈ 41,700 字节，总时长 ≈ 2612 ms
    const header = parseMp3FrameHeader(buf, 14);
    expect(header?.length).toBe(417);
    expect(header?.durationMs).toBeCloseTo(26.122, 2);

    const chunks = splitMp3BySize(buf, 10_000); // 每块最多 23 帧 (9591 B)
    expect(chunks.length).toBe(5);
    expect(chunks[0]!.offset_ms).toBe(0);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.offset_ms).toBeGreaterThan(chunks[i - 1]!.offset_ms);
      expect(chunks[i]!.data.byteLength).toBeLessThanOrEqual(10_000);
    }
    const totalBytes = chunks.reduce((s, c) => s + c.data.byteLength, 0);
    expect(totalBytes).toBe(100 * 417);
    expect(chunks.at(-1)!.offset_ms + chunks.at(-1)!.duration_ms).toBeCloseTo(2612, -1);
  });

  it('copyMedia、mediaCacheInfo、pruneMediaCache (LRU) 与 clearMediaCache 正常工作', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibi-media-'));
    try {
      const dbPath = join(dir, 'app.db');
      const ops = createMediaOps(dbPath, '0.1.5-test');
      const src1 = join(dir, 'a.mp3');
      const src2 = join(dir, 'b.mp3');
      await writeFile(src1, new Uint8Array(2000));
      await writeFile(src2, new Uint8Array(3000));

      const c1 = await ops.copyMedia!(src1, 'ep1');
      await new Promise(r => setTimeout(r, 20));
      const c2 = await ops.copyMedia!(src2, 'ep2');
      expect(c1.path).toBe('media:podcasts/ep1.mp3');
      expect(c2.path).toBe('media:podcasts/ep2.mp3');

      const info = await ops.mediaCacheInfo!(10_000);
      expect(info).toMatchObject({ files: 2, bytes: 5000 });

      // LRU 限 3500 字节：应清掉更早的 ep1（2000B），保留 ep2（3000B）
      const pruned = await ops.pruneMediaCache!(3500);
      expect(pruned.removed_paths).toEqual(['media:podcasts/ep1.mp3']);
      expect(pruned.freed_bytes).toBe(2000);

      const cleared = await ops.clearMediaCache!();
      expect(cleared.removed_paths).toEqual(['media:podcasts/ep2.mp3']);
      expect((await ops.mediaCacheInfo!()).bytes).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('按目标时长切分 MP3 帧并测量总时长', () => {
    const buf = makeMp3Frames(100, true); // ≈ 2612 ms
    expect(measureMp3DurationMs(buf)).toBeCloseTo(2612, -1);
    const chunks = splitMp3ByDuration(buf, 1000, 1024 * 1024); // 每块 <= 1000 ms
    expect(chunks.length).toBe(3);
    expect(chunks[0]!.offset_ms).toBe(0);
    expect(chunks[0]!.duration_ms).toBeLessThanOrEqual(1000);
    expect(chunks[1]!.offset_ms).toBeCloseTo(chunks[0]!.duration_ms, -1);
    expect(chunks.at(-1)!.offset_ms + chunks.at(-1)!.duration_ms).toBeCloseTo(2612, -1);
  });
});

describe('硅基流动 ASR（SenseVoiceSmall）标签清洗、句级时间插值与调用', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('剥离 SenseVoice 情感/语种控制标签并按句子比例估算时间戳', () => {
    const raw = '<|en|><|NEUTRAL|><|Speech|><|woitn|>Welcome back to the show. Today Dr. Lee explains neural nets! Ready?';
    expect(stripAsrTags(raw)).toBe('Welcome back to the show. Today Dr. Lee explains neural nets! Ready?');

    const segs = splitTextToTimedSegments(raw, 10_000, 10_000);
    expect(segs).toHaveLength(3);
    expect(segs[0]!.text).toBe('Welcome back to the show.');
    expect(segs[0]!.start_ms).toBe(10_000);
    expect(segs[1]!.text).toBe('Today Dr. Lee explains neural nets!');
    expect(segs[1]!.start_ms).toBe(segs[0]!.end_ms);
    expect(segs[2]!.text).toBe('Ready?');
    expect(segs[2]!.end_ms).toBe(20_000);
    // 每句单调不倒退
    for (const s of segs) expect(s.end_ms).toBeGreaterThanOrEqual(s.start_ms);
  });

  it('siliconflow_asr 仅发送 file + model 且正确解析纯 text 响应，testAsr 走 /models 鉴权', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibi-sf-'));
    try {
      const dbPath = join(dir, 'app.db');
      const ops = createMediaOps(dbPath, '0.1.5-test');
      const mp3 = join(dir, 'sample.mp3');
      await writeFile(mp3, makeMp3Frames(80, true)); // ~2090 ms
      const copied = await ops.copyMedia!(mp3, 'sf-ep');

      const calls: { url: string; method?: string; hasResponseFormat?: boolean; model?: string; auth?: string }[] = [];
      vi.stubGlobal('fetch', vi.fn(async (input: URL | string, init?: RequestInit) => {
        const url = String(input);
        const headers = init?.headers as Record<string, string> | undefined;
        if (url.endsWith('/models')) {
          calls.push({ url, method: init?.method ?? 'GET', auth: headers?.authorization });
          return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        const fd = init?.body as FormData;
        calls.push({
          url,
          method: init?.method,
          auth: headers?.authorization,
          model: String(fd.get('model') ?? ''),
          hasResponseFormat: fd.has('response_format'),
        });
        return new Response(
          JSON.stringify({ text: '<|en|><|Speech|>First sentence here. Second sentence follows.' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }));

      // 传公网 IP/域名会走 checkUrl；用真实可解析但被 mock fetch 拦截的域名 api.siliconflow.cn 或直接传公网 IP 测试
      const cfg = { protocol: 'siliconflow_asr', base_url: 'https://1.1.1.1/v1', model: 'FunAudioLLM/SenseVoiceSmall', api_key: 'sk-sf-test' };
      const ping = await testAsr(cfg);
      expect(ping.ok).toBe(true);
      expect(calls[0]).toMatchObject({ url: 'https://1.1.1.1/v1/models', auth: 'Bearer sk-sf-test' });

      const tr = await ops.transcribeAudio({ path: copied.path, mime: 'audio/mpeg' }, { config: cfg });
      expect(calls[1]).toMatchObject({
        url: 'https://1.1.1.1/v1/audio/transcriptions',
        method: 'POST',
        model: 'FunAudioLLM/SenseVoiceSmall',
        hasResponseFormat: false,
      });
      expect(tr.engine).toBe('siliconflow_asr:FunAudioLLM/SenseVoiceSmall');
      expect(tr.segments.map(s => s.text)).toEqual(['First sentence here.', 'Second sentence follows.']);
      expect(tr.segments[0]!.start_ms).toBe(0);
      expect(tr.segments[1]!.end_ms).toBeGreaterThan(1500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
