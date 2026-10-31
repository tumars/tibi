-- 0002：任务运行时需要的几列（内核 TibiKernel，R9）。
-- pipeline：按名字找到流水线以便重开后续跑；tainted：任务是否读过不可信内容（05 §8）；
-- approval：挂起中的审批（JSON，重开后能恢复）；progress：当前步骤文案（JSON {label,index,total}）。
-- status 另外允许 'paused'（tasks.pause：完成当前步后停下）。
ALTER TABLE jobs ADD COLUMN pipeline TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN tainted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN approval TEXT;
ALTER TABLE jobs ADD COLUMN progress TEXT;
