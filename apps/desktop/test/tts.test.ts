import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as tts from '../src/lib/tts';

/** 假的系统语音：speak 后一直"在读"，finish() 才读完；和浏览器一样 cancel 触发 onerror */
function fakeSpeech() {
  let cur: { onend?: () => void; onerror?: (event: { error: string }) => void } | undefined;
  const s = {
    speaking: false, paused: false, getVoices: () => [],
    speak(u: typeof cur) { cur = u; s.speaking = true; },
    pause() { s.paused = true; }, resume() { s.paused = false; },
    cancel() { const u = cur; cur = undefined; s.speaking = false; s.paused = false; u?.onerror?.({ error: 'canceled' }); },
    finish() { const u = cur; cur = undefined; s.speaking = false; u?.onend?.(); },
    fail() { const u = cur; cur = undefined; s.speaking = false; u?.onerror?.({ error: 'synthesis-unavailable' }); },
  };
  return s;
}

describe('Kokoro 下载源', () => {
  const HF = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin';
  const MS = 'https://modelscope.cn/models/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin';
  const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map(c => c[0]);

  it('先走魔搭，成功就不碰 Hugging Face', async () => {
    const base = vi.fn(async () => new Response('ok'));
    await tts.withKokoroMirror(base)(HF);
    expect(urls(base)).toEqual([MS]);
  });
  it('魔搭连不上或返回错误状态，退回原地址', async () => {
    const down = vi.fn(async (u: unknown) => { if (u === MS) throw new TypeError('Load failed'); return new Response('ok'); });
    expect((await tts.withKokoroMirror(down as typeof fetch)(HF)).ok).toBe(true);
    expect(urls(down)).toEqual([MS, HF]);
    const missing = vi.fn(async (u: unknown) => new Response('', { status: u === MS ? 404 : 200 }));
    expect((await tts.withKokoroMirror(missing as typeof fetch)(HF)).ok).toBe(true);
    expect(urls(missing)).toEqual([MS, HF]);
  });
  it('调用方中止不再重试；别的地址原样放行', async () => {
    const c = new AbortController(); c.abort();
    const base = vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); });
    await expect(tts.withKokoroMirror(base)(HF, { signal: c.signal })).rejects.toThrow();
    expect(urls(base)).toEqual([MS]);
    const other = vi.fn(async () => new Response('ok'));
    await tts.withKokoroMirror(other)('https://example.com/a');
    expect(urls(other)).toEqual(['https://example.com/a']);
  });
});

describe('tts 暂停', () => {
  let speech: ReturnType<typeof fakeSpeech>;
  beforeEach(() => {
    speech = fakeSpeech();
    vi.stubGlobal('speechSynthesis', speech);
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    vi.stubGlobal('navigator', { userAgent: 'Mac' });
    tts.stop();
  });

  it('暂停再继续，同一句读完算 true', async () => {
    const p = tts.say('hello');
    expect(tts.pause()).toBe(true); expect(speech.paused).toBe(true);
    expect(tts.resume()).toBe(true); expect(speech.paused).toBe(false);
    speech.finish();
    await expect(p).resolves.toBe(true);
  });

  it('暂停中被别的发音打断：原来那句 false，没得继续，新的不会卡在暂停', async () => {
    const p = tts.say('sentence'); tts.pause();
    const word = tts.say('word');
    await expect(p).resolves.toBe(false);
    expect(speech.paused).toBe(false);
    expect(tts.resume()).toBe(false);
    speech.finish();
    await expect(word).resolves.toBe(true);
  });

  it('没在出声时暂停不了', () => { expect(tts.pause()).toBe(false); expect(tts.resume()).toBe(false); });

  it('系统语音失败向界面报错，并恢复 idle，不虚报读完', async () => {
    const p = tts.say('hello');
    speech.fail();
    await expect(p).rejects.toThrow('系统朗读不可用');
    expect(tts.getStatus()).toBe('idle');
  });

  it('没有系统语音 API 时也返回可读错误', async () => {
    vi.stubGlobal('SpeechSynthesisUtterance', undefined);
    await expect(tts.say('hello')).rejects.toThrow('系统朗读不可用');
    expect(tts.getStatus()).toBe('idle');
  });

  it('Android 上 pause 等于 cancel，不用它', () => {
    vi.stubGlobal('navigator', { userAgent: 'Linux; Android 14' });
    void tts.say('hello');
    expect(tts.pause()).toBe(false); expect(speech.paused).toBe(false);
  });

  it('Kokoro 合成等待音频块期间被 stop() 打断，say() 立即结束并返回 false', async () => {
    vi.resetModules();
    vi.stubGlobal('speechSynthesis', fakeSpeech());
    vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; rate = 1; voice: unknown; constructor(public text: string) {} });
    class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: ((e: { message: string }) => void) | null = null;
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('AudioContext', class { state = 'running'; resume() { return Promise.resolve(); } });
    const freshTts = await import('../src/lib/tts');
    const p = freshTts.say('Waiting for kokoro chunk', { engine: 'kokoro' });
    freshTts.stop();
    await expect(p).resolves.toBe(false);
    expect(freshTts.getStatus()).toBe('idle');
  });
});
