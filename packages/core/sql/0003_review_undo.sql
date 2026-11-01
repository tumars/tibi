-- 0003：复习记录只追加（01 §8，08 §9）。撤销一次作答不再删 review_logs，而是追加一条撤销记录：
-- rating = 0、undoes_id = 被撤销那条的 id。统计、FSRS 历史、"今天新卡数"等一律读 review_logs_valid，
-- 它排除撤销记录本身和被撤销的作答。
ALTER TABLE review_logs ADD COLUMN undoes_id TEXT;
CREATE INDEX review_logs_undoes ON review_logs(undoes_id) WHERE undoes_id IS NOT NULL;
CREATE VIEW review_logs_valid AS
  SELECT * FROM review_logs l
  WHERE l.undoes_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM review_logs u WHERE u.undoes_id = l.id);
