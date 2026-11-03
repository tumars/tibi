-- 0005：去掉"任务"和费用计算（docs/dev/plan-no-tasks-no-cost.md）。
-- 一轮回答就是对话里的一段消息：messages.job_id 改名 turn_id，值改成这一轮第一句用户消息的 id；
-- 这一轮用的技能、结果、是否读过不可信内容从 jobs 搬到第一句用户消息的 ui.turn。之后删 jobs、job_steps、usage_records 和预算设置。
ALTER TABLE messages RENAME COLUMN job_id TO turn_id;

CREATE TEMP TABLE turn_map AS
  SELECT t.turn_id AS old,
    (SELECT m.id FROM messages m WHERE m.turn_id = t.turn_id AND m.role = 'user' ORDER BY m.created_at, m.rowid LIMIT 1) AS new
  FROM (SELECT DISTINCT turn_id FROM messages WHERE turn_id IS NOT NULL) t;

UPDATE messages SET ui = json_set(CASE WHEN json_valid(ui) THEN ui ELSE '{}' END, '$.turn', (
  SELECT json_object(
    'skill', COALESCE(j.skill_id, 'tibi'),
    'state', CASE j.status WHEN 'done' THEN 'done' WHEN 'cancelled' THEN 'cancel' ELSE 'error' END,
    'error', COALESCE(j.error, CASE WHEN j.status IN ('queued', 'running', 'waiting_approval', 'paused') THEN '上次没有回答完就中断了' END),
    'tainted', json(CASE WHEN j.tainted = 1 THEN 'true' ELSE 'false' END))
  FROM turn_map tm JOIN jobs j ON j.id = tm.old WHERE tm.new = messages.id))
WHERE id IN (SELECT tm.new FROM turn_map tm JOIN jobs j ON j.id = tm.old);

UPDATE messages SET turn_id = (SELECT new FROM turn_map WHERE old = messages.turn_id) WHERE turn_id IS NOT NULL;
DROP TABLE turn_map;

DROP TABLE job_steps;
DROP TABLE jobs;
DROP TABLE usage_records;
DELETE FROM settings WHERE key IN ('budget.month', 'budget.task') OR key LIKE 'provider.price.%';
