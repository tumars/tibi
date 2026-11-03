-- Tibi app.db 0001：按 docs/design/01-database.md（2026-10-31）建表。
-- 约定（R11）：主键 UUIDv7 TEXT；要同步的表带 updated_at 与 deleted_at（墓碑）；
-- review_logs / term_status_log / learning_events / practice_logs 只追加。
-- 版本记在 PRAGMA user_version（由 migrator 写），这里不写。

-- 1. 用户与配置 ---------------------------------------------------------
CREATE TABLE user_profile (
  id TEXT PRIMARY KEY DEFAULT '1',
  display_name TEXT,
  interests TEXT NOT NULL DEFAULT '[]',
  assistant_prefs TEXT NOT NULL DEFAULT '{}',
  daily_goal_minutes INTEGER NOT NULL DEFAULT 20,
  daily_new_cards INTEGER NOT NULL DEFAULT 20,
  desired_retention REAL NOT NULL DEFAULT 0.9,
  fsrs_params TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- llm / vision / image / tts
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,             -- openai_compatible / anthropic / ollama / kokoro_local / web_speech …
  base_url TEXT,
  auth TEXT NOT NULL DEFAULT 'api_key',
  tier TEXT,                          -- fast / deep（只对 llm）
  model TEXT NOT NULL DEFAULT '',
  secret_ref TEXT,                    -- 密钥不入库，存钥匙串引用名
  options TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX providers_default ON providers(kind) WHERE is_default = 1 AND deleted_at IS NULL;

-- 2. 文档 -------------------------------------------------------------------
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  kind TEXT NOT NULL,                 -- article / book
  genre TEXT NOT NULL DEFAULT 'general',
  source_type TEXT NOT NULL,          -- text / url / file / image / sample / tibi_generated
  source_uri TEXT,
  lang TEXT NOT NULL DEFAULT 'en',
  content_hash TEXT NOT NULL,
  original_path TEXT,
  cover_path TEXT,
  published_at INTEGER,
  word_count INTEGER NOT NULL DEFAULT 0,
  section_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',   -- processing / ready / failed
  process_error TEXT,
  ai_status TEXT NOT NULL DEFAULT 'none',      -- none / deferred / running / done / failed
  difficulty_cefr TEXT,                        -- 按词频估的文本级别 A2–C2（与用户无关）
  rare_ratio REAL,                             -- 词频 3000 以外的词占比
  progress REAL NOT NULL DEFAULT 0,
  last_section_id TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_read_at INTEGER,
  finished_at INTEGER,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX documents_hash ON documents(content_hash) WHERE deleted_at IS NULL;
CREATE INDEX documents_list ON documents(deleted_at, is_archived, last_read_at);

CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  idx INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending / processing / ready / failed
  ai_status TEXT NOT NULL DEFAULT 'none',
  tokenizer_version TEXT,
  progress REAL NOT NULL DEFAULT 0,
  last_sentence_id TEXT,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX sections_doc ON sections(document_id, idx);

CREATE VIRTUAL TABLE sections_fts USING fts5(title, content_md, content='sections', content_rowid='rowid');
CREATE TRIGGER sections_ai AFTER INSERT ON sections BEGIN
  INSERT INTO sections_fts(rowid, title, content_md) VALUES (new.rowid, new.title, new.content_md);
END;
CREATE TRIGGER sections_ad AFTER DELETE ON sections BEGIN
  INSERT INTO sections_fts(sections_fts, rowid, title, content_md) VALUES ('delete', old.rowid, old.title, old.content_md);
END;
CREATE TRIGGER sections_au AFTER UPDATE OF title, content_md ON sections BEGIN
  INSERT INTO sections_fts(sections_fts, rowid, title, content_md) VALUES ('delete', old.rowid, old.title, old.content_md);
  INSERT INTO sections_fts(rowid, title, content_md) VALUES (new.rowid, new.title, new.content_md);
END;

CREATE TABLE sentences (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES sections(id),
  paragraph_idx INTEGER NOT NULL,
  block_type TEXT NOT NULL DEFAULT 'prose',    -- prose / heading / list_item / quote
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  tokens TEXT NOT NULL DEFAULT '[]',
  translation TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX sentences_section ON sentences(section_id, idx);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX tags_name ON tags(name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE document_tags (
  document_id TEXT NOT NULL REFERENCES documents(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  source TEXT NOT NULL DEFAULT 'user',          -- user / tibi
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (document_id, tag_id)
);

-- 3. 词条 -------------------------------------------------------------------
CREATE TABLE terms (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'word',           -- word / phrase
  text TEXT NOT NULL,                          -- lemma 小写
  text_display TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,           -- 0..5, 97 标为已知, 98 忽略（只有用户标过 / 查过的词才有行）
  status_source TEXT NOT NULL DEFAULT 'user',
  category TEXT,
  meaning TEXT,
  short_gloss TEXT,
  note TEXT,
  in_wordbook INTEGER NOT NULL DEFAULT 0,
  paused_until INTEGER,
  encounter_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER,
  last_seen_at INTEGER,
  status_changed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX terms_text ON terms(kind, text);
CREATE INDEX terms_status ON terms(status, in_wordbook);

CREATE VIRTUAL TABLE terms_fts USING fts5(text, text_display, meaning, content='terms', content_rowid='rowid');
CREATE TRIGGER terms_ai AFTER INSERT ON terms BEGIN
  INSERT INTO terms_fts(rowid, text, text_display, meaning) VALUES (new.rowid, new.text, new.text_display, new.meaning);
END;
CREATE TRIGGER terms_ad AFTER DELETE ON terms BEGIN
  INSERT INTO terms_fts(terms_fts, rowid, text, text_display, meaning) VALUES ('delete', old.rowid, old.text, old.text_display, old.meaning);
END;
CREATE TRIGGER terms_au AFTER UPDATE OF text, text_display, meaning ON terms BEGIN
  INSERT INTO terms_fts(terms_fts, rowid, text, text_display, meaning) VALUES ('delete', old.rowid, old.text, old.text_display, old.meaning);
  INSERT INTO terms_fts(rowid, text, text_display, meaning) VALUES (new.rowid, new.text, new.text_display, new.meaning);
END;

CREATE TABLE term_forms (
  term_id TEXT NOT NULL REFERENCES terms(id),
  form TEXT NOT NULL,
  encounter_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (term_id, form)
);

CREATE TABLE term_status_log (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL,
  status INTEGER NOT NULL,
  source TEXT NOT NULL,
  document_id TEXT,                            -- 不设外键
  created_at INTEGER NOT NULL
);
CREATE INDEX term_status_log_term ON term_status_log(term_id, created_at);

CREATE TABLE term_contexts (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL REFERENCES terms(id),
  source TEXT NOT NULL DEFAULT 'article',      -- article / dictionary / manual
  document_id TEXT,
  sentence_id TEXT,
  text TEXT,
  surface TEXT,
  meaning_in_context TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX term_contexts_term ON term_contexts(term_id);
CREATE INDEX term_contexts_sentence ON term_contexts(sentence_id);
CREATE UNIQUE INDEX term_contexts_primary ON term_contexts(term_id) WHERE is_primary = 1 AND deleted_at IS NULL;

-- 4. 复习 -------------------------------------------------------------------
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL REFERENCES terms(id),
  due INTEGER NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  stability_fast REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days REAL NOT NULL DEFAULT 0,
  scheduled_days REAL NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  forced_type TEXT,
  state INTEGER NOT NULL DEFAULT 0,            -- 0 New / 1 Learning / 2 Review / 3 Relearning
  last_review INTEGER,
  suspended INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX cards_term ON cards(term_id);
CREATE INDEX cards_due ON cards(suspended, due) WHERE deleted_at IS NULL;

CREATE TABLE review_sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'review',         -- review / drill
  graded INTEGER NOT NULL DEFAULT 1,
  steps_json TEXT NOT NULL DEFAULT '[]',
  cursor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',       -- active / paused / finished
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE UNIQUE INDEX review_sessions_open ON review_sessions(kind) WHERE kind = 'review' AND status IN ('active', 'paused');

CREATE TABLE review_logs (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  card_type TEXT NOT NULL,                     -- recognize / choice / cloze
  auto_graded INTEGER NOT NULL DEFAULT 1,
  suggested_rating INTEGER,
  hints INTEGER NOT NULL DEFAULT 0,
  correct INTEGER,
  session_id TEXT,
  context_id TEXT,
  context_snapshot TEXT,
  state INTEGER,
  due INTEGER,
  stability REAL,
  stability_fast REAL,
  difficulty REAL,
  elapsed_days REAL,
  last_elapsed_days REAL,
  scheduled_days REAL,
  learning_steps INTEGER,
  duration_ms INTEGER,
  reviewed_at INTEGER NOT NULL
);
CREATE INDEX review_logs_card ON review_logs(card_id, reviewed_at);

CREATE TABLE practice_logs (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,                          -- dictation / spell / confusable / produce
  source TEXT NOT NULL,
  document_id TEXT,
  items INTEGER NOT NULL,
  accuracy REAL NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 5. AI 缓存 ----------------------------------------------------------------
CREATE TABLE ai_results (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,                         -- document / section / sentence / term_context
  target_id TEXT NOT NULL,
  task TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT '1',
  provider_id TEXT,
  model TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX ai_results_key ON ai_results(scope, target_id, task, prompt_version, model);

-- 6. 音频与统计 ---------------------------------------------------------------
CREATE TABLE audio_cache (
  hash TEXT PRIMARY KEY,
  engine TEXT NOT NULL,
  voice TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL,
  duration_ms INTEGER,
  timings TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE TABLE reading_sessions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  words_read INTEGER NOT NULL DEFAULT 0,
  terms_marked INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX reading_sessions_time ON reading_sessions(started_at);

CREATE TABLE daily_stats (
  date TEXT PRIMARY KEY,
  words_read INTEGER NOT NULL DEFAULT 0,
  reading_ms INTEGER NOT NULL DEFAULT 0,
  new_terms INTEGER NOT NULL DEFAULT 0,
  mastered_total INTEGER NOT NULL DEFAULT 0,   -- 用户标过的已掌握（5）与已知（97）
  reviews INTEGER NOT NULL DEFAULT 0,
  review_correct INTEGER NOT NULL DEFAULT 0
);

-- 7. 技能、对话、任务 -----------------------------------------------------------
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  model_tier TEXT,
  extra_instructions TEXT,
  write_permission TEXT NOT NULL DEFAULT 'inherit',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'chat',           -- chat / day / document / skill
  day TEXT,
  device TEXT NOT NULL DEFAULT 'desktop',
  title TEXT NOT NULL DEFAULT '',
  last_message_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX conversations_day ON conversations(day) WHERE kind = 'day' AND deleted_at IS NULL;
CREATE INDEX conversations_recent ON conversations(deleted_at, last_message_at);

-- 对话记录只有这一份（10 §5）：模型和界面都读它；agent 引擎的会话是它在内存里的副本
CREATE TABLE messages (
  id TEXT PRIMARY KEY,                         -- 也用作引擎会话里的条目 ID
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  job_id TEXT,                                 -- 哪次运行产生的；界面按它合成回答气泡
  role TEXT NOT NULL,                          -- user / assistant / tool_result / compaction / note
  engine TEXT,                                 -- 哪个引擎产生的（pi）；用户消息和 note 为空
  body TEXT NOT NULL,                          -- Tibi 消息格式 v1（和 pi-ai 的 Message 同构）；compaction 原样存引擎的压缩结果
  ui TEXT NOT NULL DEFAULT '{}',               -- 只给界面：卡片、撤销回执、步骤说明、附件
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX messages_conv ON messages(conversation_id, created_at);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                          -- import / skill
  skill_id TEXT,
  parent_job_id TEXT,
  conversation_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',       -- queued / running / waiting_approval / paused / done / failed / cancelled / deferred / interrupted
  trigger TEXT NOT NULL DEFAULT 'user',
  title TEXT NOT NULL DEFAULT '',
  input TEXT NOT NULL DEFAULT '{}',
  output TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX jobs_status ON jobs(status, created_at);
CREATE INDEX jobs_parent ON jobs(parent_job_id);

CREATE TABLE job_steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL,                          -- tool / pipeline（模型调用只记 usage_records）
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',      -- running / done / failed / skipped
  input TEXT,
  output TEXT,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE UNIQUE INDEX job_steps_idx ON job_steps(job_id, idx);

CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  message_id TEXT,                             -- 对应的助手消息或压缩记录
  job_step_id TEXT,                            -- 只有流水线里的模型调用才有
  skill_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cny REAL NOT NULL DEFAULT 0,            -- 人民币；pi-ai 报美元，按 USD_CNY 换算
  created_at INTEGER NOT NULL
);
CREATE INDEX usage_records_time ON usage_records(created_at);

-- 别的引擎的原生会话缓存（10 §3.1）：只在本机、不同步；PiEngine 不用，先建表留位置
CREATE TABLE engine_sessions (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  engine TEXT NOT NULL,
  native_id TEXT,
  state TEXT,
  through_message_id TEXT NOT NULL,            -- 这份原生状态对应到哪条消息为止；对不上就重建
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, engine)
);

CREATE TABLE thread_links (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
  skill_id TEXT NOT NULL DEFAULT 'tibi',
  document_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  trigger TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX thread_links_doc ON thread_links(document_id);

CREATE TABLE skill_audit (
  id TEXT PRIMARY KEY,
  job_step_id TEXT,
  skill_id TEXT,
  idempotency_key TEXT,
  tool TEXT NOT NULL,
  args TEXT NOT NULL,
  approval TEXT NOT NULL DEFAULT 'auto',       -- auto / approved / edited / rejected
  undo_payload TEXT,
  undone_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX skill_audit_idem ON skill_audit(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                          -- profile / semantic / episodic / procedural
  content TEXT NOT NULL,
  subject TEXT,
  confidence REAL NOT NULL DEFAULT 0.8,
  source_type TEXT NOT NULL DEFAULT 'agent',
  source_ref TEXT,
  period_start INTEGER,
  period_end INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  superseded_by TEXT,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE VIRTUAL TABLE memories_fts USING fts5(content, subject, content='memories', content_rowid='rowid');
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, subject) VALUES (new.rowid, new.content, new.subject);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, subject) VALUES ('delete', old.rowid, old.content, old.subject);
END;
CREATE TRIGGER memories_au AFTER UPDATE OF content, subject ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, subject) VALUES ('delete', old.rowid, old.content, old.subject);
  INSERT INTO memories_fts(rowid, content, subject) VALUES (new.rowid, new.content, new.subject);
END;

CREATE TABLE learning_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  consolidated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX learning_events_time ON learning_events(created_at);
