-- 0009：内置源换成更通用的：留 Hacker News，加 News in Levels（同一条新闻分三档难度）和 The Conversation（学者写的科普 / 时评，带全文）。
-- 原来的 Rust Blog、Go Blog、Quanta、Ars Technica 和用户在订阅里删源一样软删，删除会同步到别的设备；条目跟着源一起不再显示，已导入书架的文章不受影响。
UPDATE feeds SET deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id IN ('builtin-rust', 'builtin-go', 'builtin-quanta', 'builtin-ars') AND deleted_at IS NULL;

-- 新内置源用固定 ID，两台设备种出来的是同一条；用户已经自己订了同一个地址的就不再种
INSERT INTO feeds(id, url, title, title_custom, builtin, enabled, folder, created_at, updated_at)
SELECT b.id, b.url, b.title, 1, 1, 1, b.folder, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM (
  SELECT 'builtin-nil' AS id, 'https://www.newsinlevels.com/feed/' AS url, 'News in Levels' AS title, '新闻' AS folder
  UNION ALL SELECT 'builtin-conversation', 'https://theconversation.com/global/articles.atom', 'The Conversation', '科普'
) b
WHERE NOT EXISTS (SELECT 1 FROM feeds f WHERE f.id = b.id OR (f.url = b.url AND f.deleted_at IS NULL));
