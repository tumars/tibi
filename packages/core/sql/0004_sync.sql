-- 同步（08，M7）：共享文件夹 + 变更文件。触发器在开启同步时由 Core 按表结构生成（sync/capture.ts），这里只建表。
-- sync_state：本机同步配置与游标（enabled、backend、device_id、library_id、hlc、push_seq、applying 等），键值对。
CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- sync_outbox：触发器记下的本机改动，推送成功后删除。f = 改动后的整行（JSON），chg = 改了的字段（JSON 数组，INSERT 为 null 表示全部）
CREATE TABLE sync_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  t TEXT NOT NULL,
  id TEXT NOT NULL,
  op TEXT NOT NULL,                 -- put / add / del
  f TEXT,
  chg TEXT,
  ms INTEGER NOT NULL               -- 改动时的本机时间，推送时据此分配 HLC
);
-- sync_clocks：每个字段最后一次改动的 HLC；f = '*' 是整行默认（新建、初始推送），具体字段的记录优先
CREATE TABLE sync_clocks (
  t TEXT NOT NULL,
  id TEXT NOT NULL,
  f TEXT NOT NULL,
  c TEXT NOT NULL,
  PRIMARY KEY (t, id, f)
) WITHOUT ROWID;
-- sync_peers：其他设备，以及读到了它的第几批
CREATE TABLE sync_peers (
  device_id TEXT PRIMARY KEY,
  name TEXT,
  platform TEXT,
  app_version TEXT,
  last_read_seq INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  removed INTEGER NOT NULL DEFAULT 0
);
-- sync_aliases：两台设备各建了"同一个"东西（自然键相同）时，较新的 ID 指向留下的那条（08 §4）
CREATE TABLE sync_aliases (
  t TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  PRIMARY KEY (t, from_id)
) WITHOUT ROWID;
