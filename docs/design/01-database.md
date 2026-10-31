# 数据库设计 v0.1（草案）

> 状态：**草案**（2026-10-29 复审：智能体表改为技能表，providers 去掉本地 harness）。
> 数据库：SQLite。分两个文件：
> - `app.db`：用户数据（读写）
> - `dict.db`：ECDICT 词典（只读，随应用分发/升级）
>
> 约定：主键 `id INTEGER PRIMARY KEY`；时间统一存 Unix 毫秒时间戳（INTEGER）；JSON 字段存 TEXT（SQLite JSON1 可查询）。

## ER 概览

```
user_profile (1)    providers    settings

documents ──< sections ──< sentences ─ ─< term_contexts >── terms ──< cards ──< review_logs
    │            │                 （sentence_id 可空）      ├──< term_forms
    │            │                                          ├──< term_status_log
    │            └──< ai_results(scope=section)             └── (lemma 关联 dict.db.stardict)
    ├──< ai_results(scope=document)
    ├──< document_tags >── tags
    └──< reading_sessions

skills（技能配置）    thread_links ──> pi_*（对话、任务，由 pi-durable 管理）
skill_audit（写操作审计与撤销）
memories（来源可指向 thread / document / learning_event / task）
learning_events        audio_cache        daily_stats
```

## 1. 用户与配置

### user_profile（单行表）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 固定为 1 |
| level_self | TEXT | 自评水平：cet4 / cet6 / ielts6 / ... |
| display_name | TEXT | 称呼（助手使用） |
| goal | TEXT | 学习目标：exam / work / interest |
| interests | TEXT(JSON) | 常读材料类型与兴趣领域，如 `["tech_doc","news","novel","rust"]` |
| assistant_prefs | TEXT(JSON) | Tibi 对用户的称呼、对话语言、讲解详细度、权限模式等（Tibi 自己的名字固定） |
| vocab_estimate | INTEGER | 估算词汇量（测试 + 持续修正） |
| vocab_tested_at | INTEGER | 最近一次测试时间 |
| daily_goal_minutes | INTEGER | 每日阅读目标（分钟） |
| daily_new_cards | INTEGER | 每日新卡上限，默认 20 |
| desired_retention | REAL | FSRS 期望保持率，默认 0.9 |
| fsrs_params | TEXT(JSON) | FSRS 个性化参数（优化后写入）；必须带算法版本：`{ algorithm: "FSRS-6", weights: [...], optimized_at }`，权重不跨版本复用 |
| created_at / updated_at | INTEGER | |

### settings（键值表，存杂项偏好）
| 字段 | 类型 | 说明 |
|---|---|---|
| key | TEXT PK | 如 `reader.theme`, `reader.font_size`, `tts.engine` |
| value | TEXT(JSON) | |

### providers（模型/服务引擎）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| kind | TEXT | `llm` / `vision` / `image` / `tts` |
| name | TEXT | 显示名，如 "DeepSeek" |
| protocol | TEXT | `openai_compatible` / `anthropic` / `ollama` / `kokoro_local` / `web_speech` …（pi-ai 支持的 provider 类型） |
| base_url | TEXT | HTTP 类 provider 的地址 |
| auth | TEXT | `api_key` / `oauth`（ChatGPT 账号登录，条款待核实，令牌同样存钥匙串；Claude 订阅登录不做，见 05 §10） |
| tier | TEXT NULL | 作为哪一档的默认：`fast` / `deep`（只对 `llm`） |
| model | TEXT | 如 `deepseek-v4-flash`；模型名是配置项，不写死 |
| secret_ref | TEXT | **密钥不入库**，存系统钥匙串中的引用名 |
| options | TEXT(JSON) | 温度、音色等 |
| is_default | INTEGER | 每个 kind 一个默认 |
| created_at | INTEGER | |

## 2. 文档（文章 / 书籍）

层级：**documents（一篇文章或一本书）→ sections（章节；单篇文章只有一个 section）→ sentences**。
书籍按章节懒处理：导入时只拆章节，打开某章时才分句、分析。

### documents
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| title | TEXT | |
| author | TEXT | |
| kind | TEXT | `article` 文章 / `book` 书（D10：形态，导入时由来源决定，不可改；书的章节存 `sections`，文章只有一个 section） |
| genre | TEXT | `tech` / `news` / `lit` / `academic` / `general`（类型 = 处理策略：分词、着色与 AI 产出；自动识别，用户可改，改后 `ai_results` 相关条目失效） |
| source_type | TEXT | `text` / `url` / `file` / `image` / `tibi_generated`（Tibi 写的短文，G7） |
| source_uri | TEXT | 原始网址或原文件名 |
| lang | TEXT | 语言，如 `en` |
| content_hash | TEXT | 规范化正文的哈希，导入时去重（§9） |
| original_path | TEXT | 原始文件在 media/ 下的副本路径（可选） |
| cover_path | TEXT NULL | 封面图（EPUB 自带、网页配图或图像模型生成）；书架默认不显示，设置里开启后才用 |
| published_at | INTEGER | 新闻/博客的发布时间 |
| word_count | INTEGER | 全部章节合计 |
| section_count | INTEGER | |
| status | TEXT | `processing` / `ready` / `failed` |
| process_error | TEXT | |
| ai_status | TEXT | `none` / `deferred`（稍后补做：离线、没配模型或超预算）/ `running` / `done` / `failed` |
| difficulty_cefr | TEXT | 预估 CEFR：A2…C2 |
| unknown_ratio | REAL | 导入时对该用户的生词率（快照；实时值可计算） |
| progress | REAL | 全书阅读进度 0–1 |
| last_section_id | INTEGER | 上次阅读的章节 |
| is_favorite / is_archived | INTEGER | |
| created_at / last_read_at / finished_at | INTEGER | |
| deleted_at | INTEGER NULL | 软删；书架不显示，撤销时清空 |

### sections
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| document_id | INTEGER FK | |
| idx | INTEGER | 章节序号 |
| title | TEXT | 章节标题 |
| content_md | TEXT | 清洗后的正文（Markdown；代码块以围栏形式保留） |
| word_count | INTEGER | |
| status | TEXT | `pending`（未分析）/ `processing` / `ready` / `failed` |
| ai_status | TEXT | 同 `documents.ai_status`；书按章懒处理，所以按章记 |
| tokenizer_version | TEXT | 分词结果的版本；分词库升级后据此重新分词 |
| unknown_ratio | REAL | |
| progress | REAL | 本章进度 0–1 |
| last_sentence_id | INTEGER | |
| finished_at | INTEGER | |

> 全文搜索：`sections_fts`（FTS5，title + content_md）。

### sentences
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| section_id | INTEGER FK | |
| paragraph_idx | INTEGER | 所在段落序号 |
| block_type | TEXT | `prose` / `heading` / `list_item` / `quote`（代码块不拆句、不入此表，渲染时直接取自 content_md） |
| idx | INTEGER | 文章内句子序号 |
| text | TEXT | 句子原文 |
| tokens | TEXT(JSON) | 分词结果缓存：`[{t:"went", l:"go", s:12, e:16}]`（文本、lemma、偏移） |
| translation | TEXT | 句子翻译缓存（按需生成；"译文"开关打开时整篇批量生成） |

> 设计取舍：分词结果以 JSON 缓存在句子上，而不是建 tokens 大表——渲染时一次读出整篇，写入简单；词频统计等聚合查询由 term_contexts 承担。

### tags
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT UNIQUE | 自由文本，不分层级（D10）；大小写不敏感去重 |
| created_at | INTEGER | |

### document_tags
| 字段 | 类型 | 说明 |
|---|---|---|
| document_id / tag_id | INTEGER FK | 联合主键 |
| source | TEXT | `user` 用户自己加的 / `tibi` 导入时 Tibi 建议且被采纳的（用于评估建议质量） |
| created_at | INTEGER | |

> 类型（genre）不是标签，存在 `documents.genre` 上，书架筛选时与标签并排显示。词条不直接打标签：生词本按标签筛选时通过 `term_contexts → sentences → sections → documents → document_tags` 继承来源文章的标签。"找文章"技能把用户标签的使用频次当作兴趣画像的一部分。

## 3. 词条（已知词库核心）

### terms
用户接触过的每个单词/短语一行。**不在表中的词 = 从未遇到**，其状态由「自动预标注规则」推断。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| kind | TEXT | `word` / `phrase` |
| text | TEXT | 规范形式（单词为 lemma 小写；短语为小写、空格规范化）；词族（D11）只有原形一条，词形存 `term_forms` |
| paused_until | INTEGER NULL | 难词"暂停复习 2 周"：到期前不进复习队列 |
| text_display | TEXT | 显示形式 |
| status | INTEGER | 0=生词 1=见过 2=眼熟 3=认得 4=熟悉 5=掌握（界面只显示名称） 98=忽略 99=推断已知（待确认）（D1/D2 已确认） |
| status_source | TEXT | `user` / `auto_vocab_test` / `auto_rule` / `page_done` / `srs` / `agent` |
| category | TEXT | 可选：`general` / `domain_term`（技术术语等领域词）/ `proper_noun` |
| meaning | TEXT | 用户采用/编辑的释义 |
| short_gloss | TEXT | 简短释义（2–6 个字），用于"行间释义"；默认取词典首义或 AI 语境释义的缩写 |
| note | TEXT | 用户笔记 |
| in_wordbook | INTEGER | 是否加入生词本（生成复习卡片） |
| encounter_count | INTEGER | 遇见次数（冗余计数，便于展示） |
| first_seen_at / last_seen_at / status_changed_at / created_at | INTEGER | `last_seen_at` 供"很久没遇见"视图 |

唯一约束：`UNIQUE(kind, text)`。
> 全文搜索：`terms_fts`。

### term_forms（词族里出现过的词形）
| 字段 | 类型 | 说明 |
|---|---|---|
| term_id | INTEGER FK | 指向原形条目 |
| form | TEXT | 词形小写（verifies） |
| encounter_count | INTEGER | |
| first_seen_at | INTEGER | |

主键 `(term_id, form)`。列表、遇见次数、复习卡都按 `terms` 一条合并。

### term_status_log（熟练度变化时间线）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| term_id | INTEGER FK | |
| status | INTEGER | 变化后的值 |
| source | TEXT | 同 `terms.status_source` |
| created_at | INTEGER | |

### term_contexts
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| term_id | INTEGER FK | |
| source | TEXT | `article` / `dictionary`（词典例句）/ `manual` |
| document_id | INTEGER FK NULL | 冗余，便于按文档统计；非 `article` 为空 |
| sentence_id | INTEGER FK NULL | 非 `article` 为空；文档硬删时置空 |
| text | TEXT NULL | 没有 `sentence_id` 时的句子文本 |
| surface | TEXT NULL | 原文中的实际形式（如 went） |
| meaning_in_context | TEXT | AI 语境释义（缓存） |
| is_primary | INTEGER | 是否为复习首选语境 |
| created_at | INTEGER | |

## 4. 复习（FSRS）

### cards
字段对应 `ts-fsrs` 的 `Card` 结构。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| term_id | INTEGER FK UNIQUE | 一词一卡（D3 已确认） |
| due | INTEGER | 到期时间 |
| stability | REAL | |
| difficulty | REAL | |
| elapsed_days | INTEGER | |
| scheduled_days | INTEGER | |
| learning_steps | INTEGER | ts-fsrs 6 需要：当前学习步（新调度器 API 名为 `learningStep`，实现时映射） |
| reps | INTEGER | |
| lapses | INTEGER | 忘记次数；≥ 3 视为难词（leech），生词本"难词"视图与详情提示据此判断 |
| forced_type | TEXT NULL | 用户或 Tibi 为难词指定的题型（如 `cloze`），覆盖按熟练度的默认题型 |
| state | INTEGER | 0 New / 1 Learning / 2 Review / 3 Relearning |
| last_review | INTEGER | |
| suspended | INTEGER | 暂停 |
| created_at | INTEGER | |
| deleted_at | INTEGER NULL | 软删：移出生词本时设置，保留排期与 `review_logs`；再次加入时清空 |

索引：`(suspended, due) WHERE deleted_at IS NULL`。

> 新词是否先"初见"（G4）不加字段：`state = 0` 且该词在 `term_contexts` 里没有 `source = article` 的语境（手动添加、词表导入）时先出初见步；读文章时标的词直接进题。

### review_sessions（进行中的复习会话，支持"稍后继续"，G6）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| kind | TEXT | `review` / `drill`（再练错词等不计分会话） |
| graded | INTEGER | 是否计分（drill 为 0） |
| steps_json | TEXT | 步骤列表：`[{ card_id, card_type, intro, retry, options?, result? }]`；答错时插入的重练步也写在这里 |
| cursor | INTEGER | 当前步 |
| status | TEXT | `active` / `paused` / `finished` |
| started_at / updated_at / finished_at | INTEGER | |

> 每次作答后更新 `cursor` 与 `steps_json`；同一时间最多一个 `active / paused` 的 review 会话，`review.start` 默认续上它。完成后保留 30 天供统计"本轮"数据，之后清理。

### review_logs
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| card_id | INTEGER FK | |
| rating | INTEGER | 1 Again / 2 Hard / 3 Good / 4 Easy |
| card_type | TEXT | 本次题型：recognize / choice / cloze / listen / spell / produce |
| auto_graded | INTEGER | 1 = 系统评分（选义、填空、听写、拼写、造句由 Tibi 批改）；0 = 用户自评（识别）（G1） |
| suggested_rating | INTEGER NULL | 系统给的评分；用户"改评分"时与 rating 不同，用于校准阈值 |
| hints | INTEGER | 用了几次逐字母提示（G5）；> 0 时系统评分最高为 Hard |
| correct | INTEGER NULL | 客观题对错；自评题为空 |
| session_id | INTEGER NULL | 所属复习会话 |
| context_id | INTEGER NULL | 本次使用的语境 |
| context_snapshot | TEXT | 本次题面的句子快照；语境或文章删除后仍可查 |
| state / due / stability / difficulty / elapsed_days / last_elapsed_days / scheduled_days / learning_steps | | ts-fsrs ReviewLog 字段 |
| duration_ms | INTEGER | 作答时长 |
| reviewed_at | INTEGER | |

> review_logs 是 FSRS 参数优化的训练数据，须完整保留。**只记每张卡在一轮里的首次作答**（G3）；答错后的重练步、再练错词、练习都不写这里。

### practice_logs（练习成绩，不影响复习排期，G8）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| mode | TEXT | `dictation` 听写原句 / `typing` 跟打原句 / `confusable` 易混词辨析 |
| source | TEXT | `recent` / `mistakes` / `leech` / `document` |
| document_id | INTEGER NULL | 来源文章 |
| items | INTEGER | 题数 |
| accuracy | REAL | 0–100 |
| wpm | REAL NULL | 跟打速度（每 5 个正确字符计 1 词） |
| duration_ms | INTEGER | |
| created_at | INTEGER | |

## 5. AI 缓存

### ai_results
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| scope | TEXT | `document` / `section` / `sentence` / `term_context` |
| target_id | INTEGER | 对应对象 id |
| task | TEXT | `summary` / `phrases` / `hard_sentences` / `advice` / `glossary`（技术术语表）/ `characters`（小说人物表）/ `recap`（前情提要）/ `background`（新闻背景知识）/ `translate` / `explain` / `grade_sentence` |
| prompt_version | TEXT | prompt 版本号，升级 prompt 后可识别旧结果 |
| provider_id | INTEGER | |
| model | TEXT | |
| output | TEXT(JSON) | 结构化结果 |
| tokens_in / tokens_out | INTEGER | 用量统计 |
| created_at | INTEGER | |

唯一键：`(scope, target_id, task, prompt_version, model)`，重新生成时覆盖（§9）。

## 6. 音频与统计

### audio_cache
| 字段 | 类型 | 说明 |
|---|---|---|
| hash | TEXT PK | `sha1(engine + voice + speed + text)` |
| engine / voice | TEXT | |
| file_path | TEXT | media/audio/ 下的文件 |
| duration_ms | INTEGER | |
| timings | TEXT(JSON) | 可选：词级时间戳 |
| created_at / last_used_at | INTEGER | 用于 LRU 清理 |

### reading_sessions
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| document_id | INTEGER FK | |
| section_id | INTEGER FK | |
| started_at / ended_at | INTEGER | |
| words_read | INTEGER | |
| terms_marked | INTEGER | |

### daily_stats（每日汇总，便于统计页快速查询）
| 字段 | 类型 | 说明 |
|---|---|---|
| date | TEXT PK | `YYYY-MM-DD`（本地时区） |
| words_read | INTEGER | |
| reading_ms | INTEGER | |
| new_terms | INTEGER | |
| known_terms_total | INTEGER | 当天结束时已知词总数（成长曲线） |
| reviews | INTEGER | |
| review_correct | INTEGER | |

## 7. 技能（Tibi 的能力扩展）

> 设计说明见 [`05-agent-architecture.md`](./05-agent-architecture.md) 与 [`02-ai-assistant.md`](./02-ai-assistant.md)。
>
> **对话、模型轮次、工具调用、任务、子对话、用量**都由 pi-durable 存在 `app.db` 里以 `pi_` 为前缀的表中（同一个文件、同一个连接，由 Tibi Core 独占）。这些表的结构归 pi-durable 管，我们不直接改，只通过它的 API 读写。下面只列我们自己的表。

### skills（技能配置）
内置技能的定义来自随应用分发的 `SKILL.md`，这里只存用户的改动；自定义技能的 `SKILL.md` 存在 `~/Tibi/skills/<name>/`，这里存索引与设置。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | `tibi` / `importer` / `scout` / `tutor` / `coach` / `insight` / `archivist` / `custom-xxxxx` |
| source | TEXT | `builtin` / `custom` |
| path | TEXT NULL | 自定义技能的 `SKILL.md` 路径 |
| model_tier | TEXT NULL | `fast` / `deep`；NULL 跟随 `SKILL.md` |
| extra_instructions | TEXT NULL | 用户追加的指令 |
| write_permission | TEXT | `inherit` / `ask` |
| schedule_enabled | INTEGER | 例行任务开关（只对声明了 schedule 的技能有效） |
| schedule_cron | TEXT NULL | 用户改过的时间；NULL 用默认 |
| enabled | INTEGER | |
| created_at / updated_at | INTEGER | |

> 花费不单独存：从 pi-durable 的用量文档按技能汇总；每月预算、单个任务上限存在 `settings`。

### thread_links（对话线程与文章的绑定）
| 字段 | 类型 | 说明 |
|---|---|---|
| conversation_id | TEXT PK | pi-durable 的对话 ID |
| skill_id | TEXT FK | 这个对话属于哪项技能（`tibi` 为主对话；技能运行时的子对话也登记） |
| document_id | INTEGER FK NULL | 绑定的文章（在该文章中打开 Tibi 时自动续上）；NULL 为全局线程 |
| title | TEXT | 自动生成，可改 |
| trigger | TEXT | `user` / `auto`（Tibi 自动判断后运行的技能）/ `schedule` / `event` / `mcp` |
| created_at / updated_at | INTEGER | |

### skill_audit（写操作审计，支持撤销）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| task_id | TEXT NULL | pi-durable 的工具任务 ID（可跳到任务中心看过程）；界面直接调用时为空 |
| skill_id | TEXT FK NULL | 界面直接调用、MCP 直接调用时为空 |
| idempotency_key | TEXT NULL | 写能力的幂等键，崩溃重跑不重复写（§9） |
| tool | TEXT | 能力名 |
| args | TEXT(JSON) | |
| approval | TEXT | `auto` / `approved` / `edited` / `rejected` |
| undo_payload | TEXT(JSON) | 撤销所需的原状态 |
| undone_at | INTEGER NULL | |
| created_at | INTEGER | |

> 所有写操作都记，包括界面按钮直接调用的。"以后这类都自动允许"写入 `settings`（按技能 + 能力记一条规则）。删除记忆或对话时，这里引用它的 `args`、`undo_payload` 一并清除。

### memories
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| type | TEXT | `profile`（身份/偏好，常驻）/ `semantic`（观察）/ `episodic`（学习日志摘要）/ `procedural`（行为指令） |
| content | TEXT | 记忆内容（自然语言） |
| subject | TEXT | 可选的关联对象，如词条 `term:123`、语法点 `grammar:subjunctive` |
| confidence | REAL | 0–1 |
| source_type | TEXT | `user` / `agent` / `consolidation` |
| source_ref | TEXT | 来源：`conversation:…`、`task:…`、`document:5`、`event:88` |
| period_start / period_end | INTEGER | 情景记忆覆盖的时间段 |
| status | TEXT | `active` / `superseded`（用户删除是硬删，不留状态） |
| superseded_by | INTEGER | 被哪条记忆替代 |
| last_used_at / created_at / updated_at | INTEGER | |

> 全文搜索：`memories_fts`。后续如引入向量检索，增加 `memory_embeddings`（sqlite-vec）。

### learning_events（学习事件流，记忆整合的原料）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| type | TEXT | `document_imported` / `section_finished` / `term_marked` / `review_session` / `vocab_test` / `quiz_done` … |
| payload | TEXT(JSON) | 事件细节 |
| consolidated | INTEGER | 是否已被整合进记忆 |
| created_at | INTEGER | |

## 8. dict.db（ECDICT，只读）

直接使用 ECDICT 的 `stardict` 表结构，关键字段：

| 字段 | 用途 |
|---|---|
| word | 词头 |
| phonetic | 音标 |
| definition | 英文释义 |
| translation | 中文释义 |
| pos | 词性分布 |
| collins | 柯林斯星级 |
| oxford | 是否牛津 3000 核心词 |
| tag | 考试标签：zk gk cet4 cet6 ky toefl ielts gre |
| bnc / frq | BNC / 当代语料库词频排名 → **难度分级与自动预标注的依据** |
| exchange | 词形变化 → **词形还原的补充** |

另在 `dict.db` 中预生成一张 `lemma_map(form TEXT, lemma TEXT, rank INTEGER, PRIMARY KEY (form, lemma))`，由 `exchange` 字段展开，用于快速词形还原；一个词形可能对应多个原形（left → leave / left），`rank` 小的优先。

## 9. 约束与迁移

**连接**：`app.db` 打开时设 `journal_mode = WAL`、`foreign_keys = ON`。

**索引**：`term_contexts(term_id)`、`review_logs(card_id, reviewed_at)`、`sentences(section_id, idx)`。

**部分唯一索引**（SQLite 的 `UNIQUE … WHERE`）：

| 表 | 约束 | 保证什么 |
|---|---|---|
| `documents` | `UNIQUE(content_hash) WHERE deleted_at IS NULL` | 同一内容不重复导入；软删后可再导入 |
| `term_contexts` | `UNIQUE(term_id) WHERE is_primary = 1` | 每词一个首选语境 |
| `providers` | `UNIQUE(kind) WHERE is_default = 1` | 每个 kind 一个默认 |
| `review_sessions` | `UNIQUE(kind) WHERE kind = 'review' AND status IN ('active', 'paused')` | 最多一个未完成的复习会话 |
| `skill_audit` | `UNIQUE(idempotency_key) WHERE idempotency_key IS NOT NULL` | 重跑不重复写 |

**删除语义**：

| 对象 | 删除方式 |
|---|---|
| 文章（`documents`） | 软删，`deleted_at`；回收期满再硬删时 `term_contexts.sentence_id` 置空，`review_logs.context_snapshot` 保留 |
| 卡片（`cards`） | 移出生词本时软删；`review_logs` 是 FSRS 优化的训练数据，不随之删除 |
| 记忆（`memories`）、对话（pi-durable） | 用户删除时硬删，含审计里的内容副本；隐私优先。记忆在撤销窗口过后执行 |

**迁移**：领域表版本记在 `PRAGMA user_version`，只向前迁移，不写回退脚本；迁移前先备份 `app.db`。`pi_` 表的迁移归 pi-durable（05 §11），同样先备份。

## 待定事项

- 是否需要 `sections` 的版本/修订（用户编辑正文后，句子与语境如何保持关联）。
- 书架卡片的"开头一句"直接取该文档第一个 `prose` 句子，不另存字段；若要支持用户改摘要再加 `documents.excerpt`。
- `learning_events` 与 `reading_sessions` / `review_logs` 存在部分信息重叠，实现时确认是否由后两者派生事件即可。
