import { beforeEach, describe, expect, it } from 'vitest';
import { openAppDb } from '@tibi/core-node';
import { assembleCore, fakePlatform, feeds } from '../../src/index.js';
import { SKILL_DEFS } from '../../src/kernel/skills.gen.js';
import type {
  Document, FeedItemView, FeedView, OpmlImportResult,
  PodcastChartItem, PodcastPreviewResult, RadioCatalogResult,
} from '../../src/index.js';
import type { FetchedPage } from '../../src/platform.js';
import { imported } from '../helpers.js';

const PREVIEW_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Preview Show</title>
    <link>https://preview.example.com/</link>
    <language>en</language>
    <description>Clear English stories for learners.</description>
    <itunes:image href="https://preview.example.com/art.jpg" />
    <item>
      <guid>p-ep-1</guid>
      <title>Episode 1: Solar Grids</title>
      <link>https://preview.example.com/1</link>
      <pubDate>Tue, 24 Nov 2026 08:00:00 GMT</pubDate>
      <description>How modern battery storage helps solar power run reliably overnight across cities.</description>
      <enclosure url="https://cdn.example.com/solar.mp3" length="5120000" type="audio/mpeg" />
      <itunes:duration>10:30</itunes:duration>
      <podcast:transcript url="https://cdn.example.com/solar.vtt" type="text/vtt" language="en" />
    </item>
    <item>
      <guid>p-ep-2</guid>
      <title>Episode 2: Ocean Cables</title>
      <link>https://preview.example.com/2</link>
      <pubDate>Tue, 17 Nov 2026 08:00:00 GMT</pubDate>
      <description>Undersea fiber cables carry nearly all intercontinental internet traffic every single day.</description>
      <enclosure url="https://cdn.example.com/cables.mp3" length="4120000" type="audio/mpeg" />
      <itunes:duration>08:15</itunes:duration>
    </item>
  </channel>
</rss>`;

const PREVIEW_VTT = `WEBVTT

00:00:00.500 --> 00:00:03.200
Welcome to Preview Show on solar grids.

00:00:03.500 --> 00:00:07.000
Grid batteries are getting cheaper every year.
`;

type Route = (url: string, headers?: Record<string, string>) => Partial<FetchedPage> | undefined;

async function setup(route: Route, online = true) {
  const db = await openAppDb(':memory:');
  const t = Date.now();
  await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
  await db.run('UPDATE feeds SET enabled = 0');
  const calls: string[] = [];
  const platform = fakePlatform({
    isOnline: () => online,
    fetchUrl: async (url, opts) => {
      calls.push(url);
      return { status: 404, final_url: url, content_type: 'text/plain', body: '', ...route(url, opts?.headers) };
    },
    htmlToMarkdown: html => html.replace(/<[^>]+>/g, ''),
  });
  const { core } = await assembleCore({ db, resume: false, platform });
  return { core, db, calls };
}

beforeEach(() => {
  feeds.clearChartsCache();
  feeds.clearPreviewCache();
});

describe('电台精选目录（podcasts.catalog）', () => {
  it('内置快照通过严格 schema 校验并覆盖全部 5 个场景与官方字幕节目', () => {
    const bundled = feeds.getBundledCatalog();
    expect(bundled.version).toBe(1);
    expect(bundled.podcasts.length).toBeGreaterThanOrEqual(30);
    const scenes = new Set(bundled.podcasts.map(p => p.scene));
    expect([...scenes].sort()).toEqual(['intensive', 'news_biz', 'science_story', 'spoken', 'tech']);
    expect(bundled.podcasts.some(p => p.has_transcript)).toBe(true);
    expect(() => feeds.parseRadioCatalog({ version: 1, updated_at: '2026-11-26', podcasts: [{ ...bundled.podcasts[0], feed_url: 'http://127.0.0.1/rss' }] })).toThrow();
  });

  it('按需拉取远端目录、写 24h 本机缓存、支持 304 与坏响应静默回退', async () => {
    const remoteCatalog = {
      version: 1,
      updated_at: '2026-11-26',
      podcasts: [feeds.getBundledCatalog().podcasts[0]!],
    };
    let mode: 'ok' | '304' | '500' | 'bad_json' = 'ok';
    const { core, calls } = await setup((url, headers) => {
      if (url !== feeds.RADIO_CATALOG_URL) return undefined;
      if (mode === 'ok') return { status: 200, content_type: 'application/json', headers: { etag: '"v1"' }, body: JSON.stringify(remoteCatalog) };
      if (mode === '304') {
        expect(headers?.['if-none-match']).toBe('"v1"');
        return { status: 304, content_type: 'application/json', body: '' };
      }
      if (mode === '500') return { status: 500, content_type: 'text/plain', body: 'oops' };
      return { status: 200, content_type: 'application/json', body: '{"version":99}' };
    });

    // 1. 首次拉取远端
    const r1 = await core.call<RadioCatalogResult>('podcasts.catalog', {});
    expect(r1.source).toBe('remote');
    expect(r1.podcasts).toHaveLength(1);
    expect(calls).toHaveLength(1);

    // 2. 24h 内命中本机缓存，不再联网
    const r2 = await core.call<RadioCatalogResult>('podcasts.catalog', {});
    expect(r2.source).toBe('cache');
    expect(calls).toHaveLength(1);

    // 3. force + 304 复用缓存
    mode = '304';
    const r3 = await core.call<RadioCatalogResult>('podcasts.catalog', { force: true });
    expect(r3.source).toBe('cache');
    expect(calls).toHaveLength(2);

    // 4. 远端 500 / 坏 JSON 静默回退不抛错
    mode = '500';
    const r4 = await core.call<RadioCatalogResult>('podcasts.catalog', { force: true });
    expect(r4.podcasts).toHaveLength(1);
    mode = 'bad_json';
    const r5 = await core.call<RadioCatalogResult>('podcasts.catalog', { force: true });
    expect(r5.podcasts).toHaveLength(1);

    // 5. 离线且无缓存时回退内置快照
    const off = await setup(() => undefined, false);
    const rOff = await off.core.call<RadioCatalogResult>('podcasts.catalog', {});
    expect(rOff.source).toBe('bundled');
    expect(rOff.podcasts.length).toBeGreaterThanOrEqual(30);
  });

  it('filterRadioCatalog 按场景、难度、口音、时长与官方字幕筛选', () => {
    const cat = feeds.getBundledCatalog();
    const ukShort = feeds.filterRadioCatalog(cat, { accent: 'UK', max_minutes: 10 });
    expect(ukShort.length).toBeGreaterThan(0);
    expect(ukShort.every(p => p.accent === 'UK' && p.avg_minutes <= 10)).toBe(true);
    const tr = feeds.filterRadioCatalog(cat, { has_transcript: true });
    expect(tr.length).toBeGreaterThan(0);
    expect(tr.every(p => p.has_transcript)).toBe(true);
  });
});

describe('Apple 实时分类榜单（podcasts.charts）', () => {
  it('拉取榜单并批量 lookup 换 feedUrl，语言榜过滤非英语课程，6h 内存缓存', async () => {
    const rssPayload = {
      feed: {
        entry: [
          { id: { attributes: { 'im:id': '101' } }, 'im:name': { label: 'All Ears English Podcast' }, 'im:artist': { label: 'Lindsay' }, summary: { label: 'American English idioms.' } },
          { id: { attributes: { 'im:id': '102' } }, 'im:name': { label: 'Coffee Break Spanish' }, 'im:artist': { label: 'Radio Lingua' }, summary: { label: 'Learn Spanish.' } },
          { id: { attributes: { 'im:id': '103' } }, 'im:name': { label: 'Easy German' }, 'im:artist': { label: 'Easy Languages' }, summary: { label: 'Learn German.' } },
          { id: { attributes: { 'im:id': '104' } }, 'im:name': { label: '6 Minute English' }, 'im:artist': { label: 'BBC' }, summary: { label: 'Learn British English.' } },
          { id: { attributes: { 'im:id': '105' } }, 'im:name': { label: 'Local Unsafe Show' }, 'im:artist': { label: 'Bad' }, summary: { label: 'English test.' } },
        ],
      },
    };
    const lookupPayload = {
      results: [
        { collectionId: 101, collectionName: 'All Ears English Podcast', artistName: 'Lindsay', feedUrl: 'https://feeds.example.com/allears.xml', artworkUrl600: 'https://img/1.jpg', primaryGenreName: 'Language Learning', trackCount: 2000 },
        { collectionId: 104, collectionName: '6 Minute English', artistName: 'BBC', feedUrl: 'https://feeds.example.com/6min.xml', artworkUrl600: 'https://img/4.jpg', primaryGenreName: 'Language Learning', trackCount: 350 },
        { collectionId: 105, collectionName: 'Local Unsafe Show', artistName: 'Bad', feedUrl: 'http://127.0.0.1/rss', artworkUrl600: 'https://img/5.jpg' },
      ],
    };

    const { core, calls } = await setup(url => {
      if (url.includes('/us/rss/toppodcasts/')) return { status: 200, content_type: 'application/json', body: JSON.stringify(rssPayload) };
      if (url.startsWith('https://itunes.apple.com/lookup?id=')) {
        // 确认非英语课程在 lookup 前已被剔除
        expect(url).not.toContain('102');
        expect(url).not.toContain('103');
        return { status: 200, content_type: 'application/json', body: JSON.stringify(lookupPayload) };
      }
      return undefined;
    });

    const list = await core.call<PodcastChartItem[]>('podcasts.charts', { genre: 'language', country: 'us', limit: 10 });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ rank: 1, title: 'All Ears English Podcast', feed_url: 'https://feeds.example.com/allears.xml' });
    expect(list[1]).toMatchObject({ rank: 2, title: '6 Minute English', feed_url: 'https://feeds.example.com/6min.xml' });
    expect(calls).toHaveLength(2);

    // 二次调用命中内存缓存
    const cached = await core.call<PodcastChartItem[]>('podcasts.charts', { genre: 'language', country: 'us', limit: 10 });
    expect(cached).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });
});

describe('只读单集预览与免订阅试听（podcasts.preview + podcast_episode）', () => {
  it('不写订阅表即可预览并直接听读，事后订阅自动关联去重', async () => {
    const { core, calls } = await setup(url => {
      if (url === 'https://preview.example.com/rss') return { status: 200, content_type: 'application/rss+xml', body: PREVIEW_RSS };
      if (url === 'https://cdn.example.com/solar.vtt') return { status: 200, content_type: 'text/vtt', body: PREVIEW_VTT };
      return undefined;
    });

    // 1. 只读预览
    const prev = await core.call<PodcastPreviewResult>('podcasts.preview', { url: 'https://preview.example.com/rss', limit: 8 });
    expect(prev.subscribed).toBe(false);
    expect(prev.episodes).toHaveLength(2);
    expect(prev.episodes[0]).toMatchObject({ guid: 'p-ep-1', has_transcript: true, duration_ms: 630_000 });
    // 不应写入 feeds
    const subsBefore = await core.call<FeedView[]>('feeds.list', { kind: 'podcast' });
    expect(subsBefore.some(f => f.url === 'https://preview.example.com/rss')).toBe(false);

    // 2. 免订阅直接导入试听（复用预览缓存，不重抓 RSS）
    const rssCallsBefore = calls.filter(c => c === 'https://preview.example.com/rss').length;
    const done = await imported(await core.call<{ import_id: string }>('documents.import', {
      source: { type: 'podcast_episode', feed_url: 'https://preview.example.com/rss', guid: 'p-ep-1', title: 'Episode 1: Solar Grids' },
      shelve: false,
    }));
    expect(done.ok).toBe(true);
    expect(calls.filter(c => c === 'https://preview.example.com/rss').length).toBe(rssCallsBefore);

    const doc = await core.call<Document>('documents.get', { id: done.document_id! });
    expect(doc.kind).toBe('episode');
    expect(doc.shelved).toBe(false);
    expect(doc.episode?.transcript_source).toBe('rss_vtt');

    // 3. 再次预览能看到该集已有 document_id
    const prev2 = await core.call<PodcastPreviewResult>('podcasts.preview', { url: 'https://preview.example.com/rss', limit: 8 });
    expect(prev2.episodes[0]!.document_id).toBe(doc.id);

    // 4. 事后订阅该电台，saveItems 自动关联已试听文档为 seen，不重复创建文档
    const added = await core.call<FeedView>('feeds.add', { url: 'https://preview.example.com/rss', kind: 'podcast' });
    expect(added.unread).toBe(1); // ep-1 已听读为 seen，仅 ep-2 未读
    const items = (await core.call<{ items: FeedItemView[] }>('feeds.items', { feed_id: added.id, filter: 'all' })).items;
    const ep1 = items.find(i => i.title.includes('Solar Grids'))!;
    expect(ep1.document_id).toBe(doc.id);
    expect(ep1.state).toBe('seen');
  });
});

describe('OPML 导入导出与 scout 找电台技能', () => {
  it('解析嵌套分组、过滤内网与重复源，导出后可完整回读', async () => {
    const sampleOpml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>My Podcasts</title></head>
  <body>
    <outline text="科技" title="科技">
      <outline type="rss" text="Syntax" title="Syntax" xmlUrl="https://feeds.example.com/syntax.xml" htmlUrl="https://syntax.fm" />
      <outline type="rss" text="Bad Local" xmlUrl="http://127.0.0.1/bad.xml" />
    </outline>
    <outline type="rss" text="Standalone" xmlurl="https://feeds.example.com/solo.xml" />
  </body>
</opml>`;

    const { core } = await setup(() => ({ status: 200, content_type: 'application/rss+xml', body: PREVIEW_RSS }));
    const res1 = await core.call<OpmlImportResult>('feeds.importOpml', { xml: sampleOpml, kind: 'podcast' });
    expect(res1).toEqual({ added: 2, skipped: 0, invalid: 1, total: 3 });

    // 重复导入全部跳过
    const res2 = await core.call<OpmlImportResult>('feeds.importOpml', { xml: sampleOpml, kind: 'podcast' });
    expect(res2).toEqual({ added: 0, skipped: 2, invalid: 1, total: 3 });

    const list = await core.call<FeedView[]>('feeds.list', { kind: 'podcast' });
    const syntax = list.find(f => f.url === 'https://feeds.example.com/syntax.xml');
    expect(syntax?.folder).toBe('科技');
    expect(syntax?.kind).toBe('podcast');

    // 导出 OPML 并回读校验
    const exported = await core.call<{ filename: string; xml: string; count: number }>('feeds.exportOpml', { kind: 'podcast' });
    expect(exported.filename).toBe('tibi-podcasts.opml');
    expect(exported.count).toBeGreaterThanOrEqual(2);
    const reparsed = feeds.parseOpml(exported.xml);
    expect(reparsed.some(e => e.url === 'https://feeds.example.com/syntax.xml' && e.folder === '科技')).toBe(true);
    expect(reparsed.some(e => e.url === 'https://feeds.example.com/solo.xml' && !e.folder)).toBe(true);
  });

  it('scout 技能已挂载电台发现与订阅相关能力', () => {
    const scout = SKILL_DEFS.find(s => s.id === 'scout');
    expect(scout).toBeDefined();
    expect(scout!.allowed_tools).toEqual(expect.arrayContaining([
      'list_feeds', 'list_radio_catalog', 'search_podcasts', 'preview_podcast', 'discover_feeds', 'manage_feed',
    ]));
  });
});
