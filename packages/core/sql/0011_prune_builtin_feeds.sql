-- 0011：精简内置订阅与电台，仅保留通用且持续更新的英文源：
-- 文章订阅保留 News in Levels、The Conversation；电台播客保留 BBC 6 Minute English、BBC The English We Speak。
-- 仅在本地裁剪未定制过的默认内置源及这些被命中源的未保存/未导入条目；记录于本地 sync_state，exportAll 时不发墓碑，避免隐藏他端已定制的源。
INSERT OR REPLACE INTO sync_state(key, value) SELECT '_0011_cap', value FROM sync_state WHERE key = 'capture';
UPDATE sync_state SET value = '0' WHERE key = 'capture';

INSERT OR REPLACE INTO sync_state(key, value)
SELECT 'pruned_0011.' || id, '1' FROM feeds
WHERE deleted_at IS NULL
  AND (
    (id = 'builtin-hn' AND title = 'Hacker News · Best' AND folder IS '科技')
    OR (id = 'builtin-pod-voa' AND title = 'VOA Learning English' AND folder IS '慢速')
    OR (id = 'builtin-pod-darknet' AND title = 'Darknet Diaries' AND folder IS '科技')
    OR (id = 'builtin-pod-corecursive' AND title = 'CoRecursive' AND folder IS '科技')
  );

DELETE FROM feed_items
WHERE feed_id IN (
  SELECT id FROM feeds
  WHERE deleted_at IS NULL
    AND (
      (id = 'builtin-hn' AND title = 'Hacker News · Best' AND folder IS '科技')
      OR (id = 'builtin-pod-voa' AND title = 'VOA Learning English' AND folder IS '慢速')
      OR (id = 'builtin-pod-darknet' AND title = 'Darknet Diaries' AND folder IS '科技')
      OR (id = 'builtin-pod-corecursive' AND title = 'CoRecursive' AND folder IS '科技')
    )
)
  AND state != 'saved' AND document_id IS NULL;

UPDATE feeds SET deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE deleted_at IS NULL
  AND (
    (id = 'builtin-hn' AND title = 'Hacker News · Best' AND folder IS '科技')
    OR (id = 'builtin-pod-voa' AND title = 'VOA Learning English' AND folder IS '慢速')
    OR (id = 'builtin-pod-darknet' AND title = 'Darknet Diaries' AND folder IS '科技')
    OR (id = 'builtin-pod-corecursive' AND title = 'CoRecursive' AND folder IS '科技')
  );

-- 把实际写入 feeds.deleted_at 的时间戳记在标记值里，仅跳过这次系统裁剪墓碑；若日后恢复再手动删，仍正常导出用户删除
UPDATE sync_state
SET value = COALESCE(
  (SELECT CAST(deleted_at AS TEXT) FROM feeds WHERE feeds.id = substr(sync_state.key, 13) AND feeds.deleted_at IS NOT NULL),
  '1'
)
WHERE key LIKE 'pruned_0011.%' AND value = '1';

UPDATE sync_state SET value = COALESCE((SELECT value FROM sync_state WHERE key = '_0011_cap'), '0') WHERE key = 'capture';
DELETE FROM sync_state WHERE key = '_0011_cap';
