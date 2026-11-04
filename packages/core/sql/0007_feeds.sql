-- 0007：订阅入库（11 §3，docs/dev/plan-rss-p1.md）。
-- 订阅从 settings.feeds 搬到 feeds 表；条目存进 feed_items（不进书架，用户点"读"才导入）。
-- 抓取状态（etag … next_fetch_at、ttl_minutes）是本机的，不同步；内置源用固定 ID，两台设备各自种出来的是同一条。
CREATE TABLE feeds (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  site_url TEXT,
  title TEXT NOT NULL,
  title_custom INTEGER NOT NULL DEFAULT 0,   -- 用户改过名就不再用源里的标题覆盖
  builtin INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  folder TEXT,
  etag TEXT,
  last_modified TEXT,
  ttl_minutes INTEGER,
  last_fetched_at INTEGER,
  last_ok_at INTEGER,
  error TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,
  next_fetch_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX feeds_url ON feeds(url) WHERE deleted_at IS NULL;

CREATE TABLE feed_items (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feeds(id),
  guid TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  published_at INTEGER,
  excerpt TEXT NOT NULL DEFAULT '',
  content_md TEXT,                   -- 源里带的全文（≤ 200 KB）
  word_count INTEGER,
  est_level TEXT,                    -- 按词频估的文本级别，与用户无关
  comments_url TEXT,
  state TEXT NOT NULL DEFAULT 'new', -- new / seen / saved / dismissed
  document_id TEXT,                  -- 导入后指向书架里的文档
  seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX feed_items_guid ON feed_items(feed_id, guid);
CREATE INDEX feed_items_list ON feed_items(deleted_at, state, published_at);
CREATE INDEX feed_items_url ON feed_items(url);

-- 内置源（原来写死在 feeds.ts 里）；关掉过的照旧关着。名字是挑过的，不用源里的标题覆盖
INSERT INTO feeds(id, url, title, title_custom, builtin, enabled, folder, created_at, updated_at)
SELECT b.id, b.url, b.title, 1, 1,
  CASE WHEN EXISTS (SELECT 1 FROM settings s, json_each(s.value, '$.disabled') d WHERE s.key = 'feeds' AND json_valid(s.value) AND d.value = b.url) THEN 0 ELSE 1 END,
  b.folder, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM (
  SELECT 'builtin-hn' AS id, 'https://hnrss.org/best' AS url, 'Hacker News · Best' AS title, '科技' AS folder
  UNION ALL SELECT 'builtin-rust', 'https://blog.rust-lang.org/feed.xml', 'Rust Blog', '科技'
  UNION ALL SELECT 'builtin-go', 'https://go.dev/blog/feed.atom', 'The Go Blog', '科技'
  UNION ALL SELECT 'builtin-quanta', 'https://www.quantamagazine.org/feed/', 'Quanta Magazine', '科普'
  UNION ALL SELECT 'builtin-ars', 'https://feeds.arstechnica.com/arstechnica/index', 'Ars Technica', '科技'
) b;

-- 用户自己加的
INSERT INTO feeds(id, url, title, builtin, enabled, created_at, updated_at)
SELECT 'f' || lower(hex(randomblob(12))), json_extract(c.value, '$.url'), COALESCE(NULLIF(json_extract(c.value, '$.title'), ''), json_extract(c.value, '$.url')), 0,
  CASE WHEN EXISTS (SELECT 1 FROM json_each(s.value, '$.disabled') d WHERE d.value = json_extract(c.value, '$.url')) THEN 0 ELSE 1 END,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM settings s, json_each(s.value, '$.custom') c
WHERE s.key = 'feeds' AND json_valid(s.value) AND json_extract(c.value, '$.url') LIKE 'http%'
  AND json_extract(c.value, '$.url') NOT IN (SELECT url FROM feeds);

DELETE FROM settings WHERE key = 'feeds';
