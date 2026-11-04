-- 0006：遇到过的句子可以收藏；没收藏的每个词只留最近 10 句（复习卡用的主句不删）。
ALTER TABLE term_contexts ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;

-- 已有数据按同样规则清一遍（软删，同步能带过去）
UPDATE term_contexts SET deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id IN (
  SELECT id FROM (
    SELECT id, is_primary, ROW_NUMBER() OVER (PARTITION BY term_id ORDER BY is_primary DESC, created_at DESC, rowid DESC) AS rn
    FROM term_contexts WHERE deleted_at IS NULL AND is_favorite = 0
  ) WHERE rn > 10 AND is_primary = 0
);
