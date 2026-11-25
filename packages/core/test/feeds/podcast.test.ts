import { describe, expect, it } from 'vitest';
import { openAppDb } from '@tibi/core-node';
import { assembleCore, devFakeResolver, fakePlatform, feeds, text } from '../../src/index.js';
import type { Document, FeedItemView, FeedView, PodcastSearchResult, SectionContent } from '../../src/index.js';
import type { FetchedPage, Platform } from '../../src/platform.js';
import { imported } from '../helpers.js';

const PODCAST_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Tech Talk Radio</title>
    <link>https://techtalk.example.com/</link>
    <language>en-us</language>
    <description>Deep dives into software engineering and AI.</description>
    <itunes:image href="https://techtalk.example.com/cover.jpg" />
    <itunes:author>Alex &amp; Sam</itunes:author>
    <item>
      <guid>ep-101</guid>
      <title>Episode 101: How GPUs Scale</title>
      <link>https://techtalk.example.com/101</link>
      <pubDate>Mon, 20 Nov 2026 10:00:00 GMT</pubDate>
      <description>We walk through how GPU clusters handle memory bottlenecks in modern training.</description>
      <enclosure url="https://cdn.example.com/ep101.mp3" length="12345678" type="audio/mpeg" />
      <itunes:duration>18:24</itunes:duration>
      <itunes:season>2</itunes:season>
      <itunes:episode>101</itunes:episode>
      <podcast:transcript url="https://cdn.example.com/ep101.txt" type="text/plain" language="en" />
      <podcast:transcript url="https://cdn.example.com/ep101.vtt" type="text/vtt" language="en" />
      <podcast:transcript url="https://cdn.example.com/ep101-es.vtt" type="text/vtt" language="es" />
      <podcast:chapters url="https://cdn.example.com/ep101.chapters.json" type="application/json+chapters" />
    </item>
    <item>
      <guid>ep-100</guid>
      <title>Episode 100: Plain Audio Episode</title>
      <link>https://techtalk.example.com/100</link>
      <pubDate>Mon, 13 Nov 2026 10:00:00 GMT</pubDate>
      <description>A candid conversation about debugging distributed systems in production.</description>
      <enclosure url="https://cdn.example.com/ep100.mp3" length="9876543" type="audio/mpeg" />
      <itunes:duration>01:02:05</itunes:duration>
    </item>
  </channel>
</rss>`;

const SAMPLE_VTT = `WEBVTT

00:00:01.000 --> 00:00:03.200
<v Alex>Welcome back to Tech Talk Radio,

00:00:03.300 --> 00:00:06.100
today we are unpacking GPU bottlenecks.

00:00:06.500 --> 00:00:10.000
<v Sam>Right, let's walk through how memory bandwidth shapes everything!

00:00:12.500 --> 00:00:16.000
When clusters scale up, interconnects become the real constraint.
`;

const SAMPLE_SRT = `1
00:00:00,500 --> 00:00:02,000
Host: Hello everyone,

2
00:00:02,100 --> 00:00:05,400
thanks for tuning in to our show.
`;

const SAMPLE_CHAPTERS = JSON.stringify({
  version: '1.2.0',
  chapters: [
    { startTime: 0, title: 'Intro & Setup' },
    { startTime: 6.5, title: 'Memory Bandwidth' },
  ],
});

type Route = (url: string) => Partial<FetchedPage> | undefined;

async function setup(route: Route, extra: Partial<Platform> = {}, withFakeModel = false) {
  const db = await openAppDb(':memory:');
  const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  await db.run('UPDATE feeds SET enabled = 0');
  const platform = fakePlatform({
    isOnline: () => true,
    fetchUrl: async url => ({ status: 404, final_url: url, content_type: 'text/plain', body: '', ...route(url) }),
    htmlToMarkdown: html => html.replace(/<[^>]+>/g, ''),
    ...extra,
  });
  const { core } = await assembleCore({
    db, resume: false, platform,
    ...(withFakeModel ? { resolveModel: async () => devFakeResolver() } : {}),
  });
  return { core, db };
}

describe('Podcast RSS 解析与字幕规整', () => {
  it('解析 Podcast RSS 2.0、enclosure、itunes 时长、podcast:transcript 优先级与章节', () => {
    const parsed = feeds.parseFeed(PODCAST_RSS, 'https://techtalk.example.com/rss');
    expect(parsed).toBeDefined();
    expect(parsed!.kind).toBe('podcast');
    expect(parsed!.artwork_url).toBe('https://techtalk.example.com/cover.jpg');
    expect(parsed!.items).toHaveLength(2);
    expect(parsed!.items[0]).toMatchObject({
      guid: 'ep-101',
      audio_url: 'https://cdn.example.com/ep101.mp3',
      audio_mime: 'audio/mpeg',
      audio_bytes: 12345678,
      duration_ms: (18 * 60 + 24) * 1000,
      transcript_url: 'https://cdn.example.com/ep101.vtt', // 优先选英文 text/vtt
      transcript_type: 'text/vtt',
      chapters_url: 'https://cdn.example.com/ep101.chapters.json',
      season: 2,
      episode: 101,
    });
    expect(parsed!.items[1]!.duration_ms).toBe((3600 + 120 + 5) * 1000);
    expect(feeds.parseDurationMs('420')).toBe(420_000);
  });

  it('WebVTT 与 SRT 解析并合并碎片 cue 为完整自然句，保留发言人与起止时间戳', () => {
    const vtt = text.parseTranscript(SAMPLE_VTT, 'text/vtt');
    expect(vtt).toHaveLength(3);
    expect(vtt[0]).toEqual({
      text: 'Welcome back to Tech Talk Radio, today we are unpacking GPU bottlenecks.',
      start_ms: 1000,
      end_ms: 6100,
      speaker: 'Alex',
    });
    expect(vtt[1]).toEqual({
      text: "Right, let's walk through how memory bandwidth shapes everything!",
      start_ms: 6500,
      end_ms: 10000,
      speaker: 'Sam',
    });
    expect(vtt[2]).toEqual({
      text: 'When clusters scale up, interconnects become the real constraint.',
      start_ms: 12500,
      end_ms: 16000,
    });

    const srt = text.parseTranscript(SAMPLE_SRT, 'application/srt');
    expect(srt).toHaveLength(1);
    expect(srt[0]).toMatchObject({ text: 'Hello everyone, thanks for tuning in to our show.', start_ms: 500, end_ms: 5400, speaker: 'Host' });
  });
});

describe('电台端到端流程：订阅、搜播客、听读导入、转写、进度与 AI 导听', () => {
  it('订阅播客与文章隔离、官方字幕秒开 + 后台静默缓存 + 播放进度 + 播客 AI 导听', async () => {
    let cachedUrl: string | undefined;
    const { core } = await setup(url => {
      if (url === 'https://techtalk.example.com/rss') return { status: 200, content_type: 'application/rss+xml', body: PODCAST_RSS };
      if (url === 'https://cdn.example.com/ep101.vtt') return { status: 200, content_type: 'text/vtt', body: SAMPLE_VTT };
      if (url === 'https://cdn.example.com/ep101.chapters.json') return { status: 200, content_type: 'application/json', body: SAMPLE_CHAPTERS };
      return undefined;
    }, {
      downloadMedia: async (url, key) => { cachedUrl = url; return { path: `media:podcasts/${key}.mp3`, bytes: 1024, mime: 'audio/mpeg' }; },
    }, true);

    const added = await core.call<FeedView>('feeds.add', { url: 'https://techtalk.example.com/rss', kind: 'podcast' });
    expect(added.kind).toBe('podcast');
    expect(added.unread).toBe(2);

    // 订阅（文章）与电台（播客）未读数互不串扰
    const status = await core.call<{ unread: number; radio_unread: number }>('feeds.status', {});
    expect(status.unread).toBe(0);
    expect(status.radio_unread).toBe(2);

    // 按「有字幕」筛选只返回 ep-101
    const withTr = await core.call<{ items: FeedItemView[] }>('feeds.items', { kind: 'podcast', filter: 'transcript' });
    expect(withTr.items).toHaveLength(1);
    expect(withTr.items[0]!.has_transcript).toBe(true);

    // 导入带官方字幕的单集（shelve: false，不进书架）
    const done = await imported(await core.call<{ import_id: string }>('documents.import', { source: { type: 'podcast_item', id: withTr.items[0]!.id }, shelve: false }));
    expect(done.ok).toBe(true);
    const doc = await core.call<Document>('documents.get', { id: done.document_id! });
    expect(doc.kind).toBe('episode');
    expect(doc.shelved).toBe(false);
    expect(doc.episode?.transcript_source).toBe('rss_vtt');
    expect(doc.episode?.media_url).toBe('https://cdn.example.com/ep101.mp3');

    const sec = await core.call<SectionContent>('sections.get', { id: doc.sections[0]!.id });
    expect(sec.sentences).toHaveLength(3);
    expect(sec.sentences[0]).toMatchObject({ start_ms: 1000, end_ms: 6100, speaker: 'Alex' });
    expect(sec.sentences[1]).toMatchObject({ start_ms: 6500, end_ms: 10000, speaker: 'Sam' });

    // 等后台静默缓存与官方章节落盘
    await new Promise(r => setTimeout(r, 60));
    expect(cachedUrl).toBe('https://cdn.example.com/ep101.mp3');
    const refreshed = await core.call<Document>('documents.get', { id: doc.id });
    expect(refreshed.episode?.media_path).toMatch(/^media:podcasts\//);
    expect(refreshed.ai?.chapters?.model).toBe('rss');

    // 保存播放进度（不污染撤销栈）
    await core.call('documents.playback', { id: doc.id, playback_ms: 90_000, duration_ms: 180_000 });
    const afterPlay = await core.call<Document>('documents.get', { id: doc.id });
    expect(afterPlay.episode?.playback_ms).toBe(90_000);
    expect(afterPlay.progress).toBeCloseTo(0.5, 2);

    // 运行播客 AI 导听分析（保留官方 rss 章节不覆盖；devFake 流式输出需等待完成）
    await core.call('documents.analyze', { id: doc.id });
    let analyzed = await core.call<Document>('documents.get', { id: doc.id });
    for (let i = 0; i < 40 && analyzed.ai_status === 'running'; i++) {
      await new Promise(r => setTimeout(r, 50));
      analyzed = await core.call<Document>('documents.get', { id: doc.id });
    }
    expect(analyzed.ai_status).toBe('done');
    expect(analyzed.ai?.summary?.output).toBeTruthy();
    expect(analyzed.ai?.advice?.output).toBeTruthy();
    expect(analyzed.ai?.chapters?.model).toBe('rss');
  });

  it('无官方字幕且未配 ASR 时优雅降级为纯听模式，随后可导入 .vtt 或用云端 ASR 补转写', async () => {
    const vttBytes = new TextEncoder().encode(SAMPLE_VTT);
    const { core } = await setup(url => {
      if (url === 'https://techtalk.example.com/rss') return { status: 200, content_type: 'application/rss+xml', body: PODCAST_RSS };
      return undefined;
    }, {
      readFile: async () => vttBytes,
      downloadMedia: async (_url, key) => ({ path: `media:podcasts/${key}.mp3`, bytes: 2048, mime: 'audio/mpeg' }),
      transcribeAudio: async () => ({
        segments: [{ text: 'Transcribed by cloud ASR.', start_ms: 0, end_ms: 3500, speaker: 'Speaker 1' }],
        duration_ms: 3500,
        engine: 'groq_whisper:whisper-large-v3-turbo',
      }),
      getSecret: async ref => (ref === 'provider.groq.asr' ? 'gsk_test' : undefined),
    });

    await core.call('feeds.add', { url: 'https://techtalk.example.com/rss', kind: 'podcast' });
    const items = (await core.call<{ items: FeedItemView[] }>('feeds.items', { kind: 'podcast', filter: 'all' })).items;
    const ep100 = items.find(i => i.title.includes('100'))!;
    expect(ep100.has_transcript).toBeUndefined();

    // 1. 纯听导入
    const done = await imported(await core.call<{ import_id: string }>('documents.import', { source: { type: 'podcast_item', id: ep100.id }, shelve: false }));
    expect(done.ok).toBe(true);
    let doc = await core.call<Document>('documents.get', { id: done.document_id! });
    expect(doc.episode?.transcript_source).toBe('none');

    // 2. 手动导入 .vtt 字幕补齐逐字稿
    const manual = await core.call<{ sentences: number; transcript_source: string }>('documents.transcribe', { id: doc.id, transcript_path: '/tmp/ep100.vtt' });
    expect(manual).toEqual({ sentences: 3, transcript_source: 'manual' });

    // 3. 配置 Groq ASR 后重新云端转写
    await core.call('providers.upsert', {
      provider: { kind: 'asr', name: 'Groq', protocol: 'groq_whisper', base_url: 'https://api.groq.com/openai/v1', auth: 'api_key', model: 'whisper-large-v3-turbo', is_default: true },
      secret_ref: 'provider.groq.asr',
    });
    const asr = await core.call<{ sentences: number; transcript_source: string }>('documents.transcribe', { id: doc.id });
    expect(asr).toEqual({ sentences: 1, transcript_source: 'cloud_asr' });
    doc = await core.call<Document>('documents.get', { id: doc.id });
    expect(doc.episode?.transcript_source).toBe('cloud_asr');
    const sec = await core.call<SectionContent>('sections.get', { id: doc.sections[0]!.id });
    expect(sec.sentences[0]).toMatchObject({ text: 'Transcribed by cloud ASR.', speaker: 'Speaker 1' });
  });

  it('podcasts.search 调 iTunes Search API，feeds.discover 反查 Apple Podcasts 链接', async () => {
    const { core } = await setup(url => {
      if (url.startsWith('https://itunes.apple.com/search')) {
        return {
          status: 200, content_type: 'application/json',
          body: JSON.stringify({
            results: [{ collectionName: 'Planet Money', artistName: 'NPR', feedUrl: 'https://feeds.npr.org/510289/podcast.xml', artworkUrl600: 'https://img/pm.jpg', primaryGenreName: 'Business', trackCount: 500 }],
          }),
        };
      }
      if (url.startsWith('https://itunes.apple.com/lookup?id=290783428')) {
        return { status: 200, content_type: 'application/json', body: JSON.stringify({ results: [{ feedUrl: 'https://techtalk.example.com/rss' }] }) };
      }
      if (url === 'https://techtalk.example.com/rss') return { status: 200, content_type: 'application/rss+xml', body: PODCAST_RSS };
      return undefined;
    });

    const list = await core.call<PodcastSearchResult[]>('podcasts.search', { q: 'planet money' });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Planet Money', author: 'NPR', feed_url: 'https://feeds.npr.org/510289/podcast.xml', episode_count: 500 });

    const cands = await core.call<{ url: string; kind: string }[]>('feeds.discover', { url: 'https://podcasts.apple.com/us/podcast/planet-money/id290783428' });
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ url: 'https://techtalk.example.com/rss', kind: 'podcast' });
  });

  it('documents.ensureMedia 下载并复用本地缓存；documents.transcribe 支持回写本地离线 Whisper 片段且开启本地优先时导入跳过云端 ASR', async () => {
    let downloadCalls = 0;
    let cloudAsrCalls = 0;
    const { core } = await setup(url => {
      if (url === 'https://techtalk.example.com/rss') return { status: 200, content_type: 'application/rss+xml', body: PODCAST_RSS };
      return undefined;
    }, {
      downloadMedia: async (_url, key) => {
        downloadCalls++;
        return { path: `media:podcasts/${key}.mp3`, bytes: 4096, mime: 'audio/mpeg' };
      },
      transcribeAudio: async () => {
        cloudAsrCalls++;
        return { segments: [{ text: 'Cloud result.', start_ms: 0, end_ms: 2000 }], duration_ms: 2000, engine: 'groq_whisper:test' };
      },
      getSecret: async ref => (ref === 'provider.groq.asr' ? 'gsk_test' : undefined),
    });

    // 同时配置了云端 ASR 与「本地离线优先」
    await core.call('providers.upsert', {
      provider: { kind: 'asr', name: 'Groq', protocol: 'groq_whisper', base_url: 'https://api.groq.com/openai/v1', auth: 'api_key', model: 'whisper-large-v3-turbo', is_default: true },
      secret_ref: 'provider.groq.asr',
    });
    await core.call('settings.set', { patch: { 'radio.local_asr.enabled': true, 'radio.asr.preferred': 'local' } });

    await core.call('feeds.add', { url: 'https://techtalk.example.com/rss', kind: 'podcast' });
    const items = (await core.call<{ items: FeedItemView[] }>('feeds.items', { kind: 'podcast', filter: 'all' })).items;
    const ep100 = items.find(i => i.title.includes('100'))!;

    // 导入应跳过云端 ASR，先进入纯听模式等待前端本地离线转写
    const done = await imported(await core.call<{ import_id: string }>('documents.import', { source: { type: 'podcast_item', id: ep100.id }, shelve: false }));
    expect(done.ok).toBe(true);
    expect(cloudAsrCalls).toBe(0);
    let doc = await core.call<Document>('documents.get', { id: done.document_id! });
    expect(doc.episode?.transcript_source).toBe('none');

    // 等后台静默缓存结束后，调用 ensureMedia 复用已有缓存不重复下载
    await new Promise(r => setTimeout(r, 50));
    const beforeEnsure = downloadCalls;
    const ensured = await core.call<{ media_path?: string; media_url?: string }>('documents.ensureMedia', { id: doc.id });
    expect(ensured.media_path).toMatch(/^media:podcasts\//);
    expect(downloadCalls).toBe(Math.max(1, beforeEnsure));

    // 回写本地离线 Whisper 片段（包含两段应合并为一句的碎片）
    const localRes = await core.call<{ sentences: number; transcript_source: string }>('documents.transcribe', {
      id: doc.id,
      transcript_source: 'local_asr',
      duration_ms: 9500,
      segments: [
        { text: 'Welcome back to', start_ms: 0, end_ms: 1400 },
        { text: 'our offline podcast.', start_ms: 1400, end_ms: 3600 },
        { text: 'Audio never leaves your Mac.', start_ms: 4200, end_ms: 8100 },
      ],
    });
    expect(localRes).toEqual({ sentences: 2, transcript_source: 'local_asr' });

    doc = await core.call<Document>('documents.get', { id: doc.id });
    expect(doc.episode?.transcript_source).toBe('local_asr');
    const sec = await core.call<SectionContent>('sections.get', { id: doc.sections[0]!.id });
    expect(sec.sentences).toHaveLength(2);
    expect(sec.sentences[0]).toMatchObject({ text: 'Welcome back to our offline podcast.', start_ms: 0, end_ms: 3600 });
    expect(sec.sentences[1]).toMatchObject({ text: 'Audio never leaves your Mac.', start_ms: 4200, end_ms: 8100 });
  });
});
