-- 0008：从订阅里点"读"的文章用同一个阅读器打开，但不进书架（11 §5.2）。
-- shelved = 0 的文章照常有章节、句子、语境和总结，只是书架和书架计数里不显示；在阅读器里点「加入书架」或用别的方式再导入一次就变成 1。
ALTER TABLE documents ADD COLUMN shelved INTEGER NOT NULL DEFAULT 1;
