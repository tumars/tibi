-- 0010：电台（播客听读与 AI 理解，17 §4）。
-- 轻量扩展 feeds / feed_items / documents / sentences，与文章订阅、阅读器、词条语境和 FSRS 复习共用一套数据模型。

-- 1. feeds：按 kind 区分文章源与电台源
ALTER TABLE feeds ADD COLUMN kind TEXT NOT NULL DEFAULT 'article'; -- 'article' | 'podcast' | 'radio'
ALTER TABLE feeds ADD COLUMN artwork_url TEXT;
ALTER TABLE feeds ADD COLUMN language TEXT;
ALTER TABLE feeds ADD COLUMN description TEXT;
CREATE INDEX feeds_kind ON feeds(kind, deleted_at);

-- 2. feed_items：存单集音频与 Podcasting 2.0 字幕 / 章节元数据
ALTER TABLE feed_items ADD COLUMN audio_url TEXT;
ALTER TABLE feed_items ADD COLUMN audio_mime TEXT;
ALTER TABLE feed_items ADD COLUMN audio_bytes INTEGER;
ALTER TABLE feed_items ADD COLUMN duration_ms INTEGER;
ALTER TABLE feed_items ADD COLUMN transcript_url TEXT;
ALTER TABLE feed_items ADD COLUMN transcript_type TEXT;
ALTER TABLE feed_items ADD COLUMN chapters_url TEXT;
ALTER TABLE feed_items ADD COLUMN artwork_url TEXT;
ALTER TABLE feed_items ADD COLUMN season INTEGER;
ALTER TABLE feed_items ADD COLUMN episode INTEGER;

-- 3. documents：支持 kind = 'episode'，挂接音频与播放进度（media_path 为本机路径，不同步）
ALTER TABLE documents ADD COLUMN media_url TEXT;
ALTER TABLE documents ADD COLUMN media_path TEXT;
ALTER TABLE documents ADD COLUMN duration_ms INTEGER;
ALTER TABLE documents ADD COLUMN playback_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN transcript_source TEXT; -- 'rss_vtt' | 'cloud_asr' | 'local_asr' | 'manual' | 'none'

-- 4. sentences：增加句级时间戳与发言人（文章为 NULL）
ALTER TABLE sentences ADD COLUMN start_ms INTEGER;
ALTER TABLE sentences ADD COLUMN end_ms INTEGER;
ALTER TABLE sentences ADD COLUMN speaker TEXT;
CREATE INDEX sentences_time ON sentences(section_id, start_ms) WHERE start_ms IS NOT NULL;

-- 5. 内置精选英文播客种子（固定 ID，多设备同步认作同一条；用户删掉后不再种回）
INSERT INTO feeds(id, url, title, title_custom, builtin, enabled, folder, kind, language, created_at, updated_at)
SELECT b.id, b.url, b.title, 1, 1, 1, b.folder, 'podcast', 'en',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM (
  SELECT 'builtin-pod-6min' AS id, 'https://podcasts.files.bbci.co.uk/p02pc9tn.rss' AS url, 'BBC 6 Minute English' AS title, '精听' AS folder
  UNION ALL SELECT 'builtin-pod-tews', 'https://podcasts.files.bbci.co.uk/p02pc9zn.rss', 'BBC The English We Speak', '口语'
  UNION ALL SELECT 'builtin-pod-voa', 'https://learningenglish.voanews.com/podcast/?count=20&zoneId=1689', 'VOA Learning English', '慢速'
  UNION ALL SELECT 'builtin-pod-darknet', 'https://feeds.megaphone.fm/darknetdiaries', 'Darknet Diaries', '科技'
  UNION ALL SELECT 'builtin-pod-corecursive', 'https://corecursive.com/feed', 'CoRecursive', '科技'
) b
WHERE NOT EXISTS (SELECT 1 FROM feeds f WHERE f.id = b.id OR (f.url = b.url AND f.deleted_at IS NULL));
