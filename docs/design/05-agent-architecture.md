# 技能架构 v0.1：以 pi 为 harness 底座

> 状态：**已确认**（2026-10-29，决策 B1–B8 见 §12；2026-10-31 按 R9 改为不用 `pi-durable`，对话与任务自建，见 §1、§6、§11）。已同步到 [`00-concept-design.md` §3.10 / §4](./00-concept-design.md#4-系统架构)、[`01-database.md` §7](./01-database.md#7-技能tibi-的能力扩展) 和 [`02-ai-assistant.md`](./02-ai-assistant.md)。
> 原型：[运行记录](../prototypes/tasks.html) · [首页 `/` 技能与过程卡](../prototypes/home.html) · [设置 → Tibi 的技能](../prototypes/settings.html#agents) · [统计页洞察来源](../prototypes/stats.html)；技能目录 [`v2-agents.js`](../prototypes/v2-agents.js)。
> 目标：把 Tibi 从"应用里带一个 AI 助手"改成"一只会多项技能的 Tibi"——导入文章、找文章、讲解、出题与批改、学习洞察、整理记忆都是技能，内部各自是一个专职 agent（子对话），用户只面对 Tibi 一个角色（§13）；底座使用开源 harness **pi**。
> 术语（2026-10-29 复审统一）：**技能** = 用户看到的、也是内部的单位，每项一份 `SKILL.md`；本文 §2 讲 pi 时仍用它自己的词"agent / subagent"；§12、§13 记录决策经过时会提到旧称"智能体"。术语表见 [`DECISIONS.md`](../DECISIONS.md#术语)。

---

## 1. 一句话结论

- **底座**（R9，2026-10-31 改）：用 pi 的两个稳定的库——`pi-ai`（统一模型接口，支持 DeepSeek 和任意 OpenAI 兼容接口）和 `pi-agent-core`（最小的 agent 循环）。对话和消息**自己存**在 `app.db` 里（`conversations`、`messages`，见 [01 §7](./01-database.md#7-技能tibi-的能力扩展)），由 Core 里的 `TibiKernel` 管。2026-11-04 起没有"任务"和用量表（T35、T36）：一轮回答就是对话里的一段消息，进行中的回答只在内存里，Tibi 不算钱。不用 `pi-durable`（实验性、迁库不可回退，见 §11），也不直接用 `pi-coding-agent`（它是编程 agent，带文件和 shell 工具）。
- **进程**：新增一个 **Tibi Core** 后台进程（TypeScript，Tauri sidecar），它独占 `app.db`，承载领域服务、技能运行时和 MCP Server；界面只负责展示和调用。
- **能力与技能分层**：确定性的事情（分词、词形还原、查词、FSRS 排期、统计）仍然是普通代码，包装成**能力**（工具）；需要判断和生成的事情交给**技能**（由模型完成）。同一个能力可以被界面直接调用、被技能调用、被外部 AI 工具经 MCP 调用。
- **对用户暴露**：只有 Tibi 一个角色，它会 6 件事（导入是固定流水线，其余 5 项是技能，R10）；按钮即运行、过程默认收起可展开、输入 `/` 可选技能、可以在设置里配置模型和指令（§13）。所有技能都由用户触发（2026-10-31 砍掉例行任务和自定义技能）。

---

## 2. 调研：pi 是什么

pi 是 Mario Zechner（libGDX 作者）发起的开源 agent 工具集，MIT 协议，TypeScript。2026 年起包名从 `@mariozechner/*` 迁到 `@earendil-works/*`，当前版本 **1.4.0**（2026-10-21）。

| 包 | 作用 | 与 Tibi 的关系 |
|---|---|---|
| `pi-ai` | 统一多家模型的流式接口：OpenAI、Anthropic、Google、**DeepSeek**、OpenRouter、Ollama / vLLM / LM Studio 等任意 OpenAI 兼容接口；TypeBox 定义工具参数并自动校验；统一的思考档位；每次调用返回 token 与费用；对话中途可换模型；可在浏览器运行；提供 ChatGPT / Claude / Copilot 账号登录（OAuth） | ⭐ 取代我们自己写的 provider 抽象 |
| `pi-agent-core` | 最小的 agent 循环：`Agent` 类、工具并行 / 串行执行、`beforeToolCall` / `afterToolCall` 钩子、steer（插话）/ followUp（排队）、事件流 | ⭐ 选作 agent 循环（R9）；持久化由 `TibiKernel` 自己做 |
| `pi-durable` | 持久化 harness：对话、模型轮次、工具调用、自定义状态**先写入存储再显示**，进程崩溃后从断点继续；扩展（工具 + 提示词片段 + 钩子 + 任务）；subagent（由任务拥有的对话）；子任务与任务图；定时休眠任务；代码模式；延迟加载工具与 `tool_search`；自动压缩上下文；SQLite / IndexedDB / JSONL 存储，SQLite 可加表前缀与宿主表共用一个库 | 不用（R9，2026-10-31）：**标注为实验性**，API 可能不经通知变化，1.4.0 迁库后不可回退（见 §11）；它的设计（先写存储再显示、任务拥有子对话、检查点续跑）由 `TibiKernel` 照着做 |
| `pi-coding-agent` | 终端编程 agent（read / write / edit / bash 四个工具）、JSONL 树形会话、扩展、技能（Agent Skills 规范）、MCP、RPC 模式、SDK | 不作底座；借鉴它的技能和扩展格式 |
| `pi-web-ui` | 基于 mini-lit 的聊天界面组件 | 不用（风格不符；最新版仍是 0.75，没有随 1.x 更新） |

**pi 的设计哲学**（对我们有直接影响）：
- 系统提示词和工具定义加起来尽量小（编程 agent 不到 1,000 token），**精确控制进入上下文的内容**；
- 状态放在看得见的地方（文件、文档），不藏在隐藏模式里；
- 工具很多时不要全部塞给模型：延迟加载，按需搜索（`tool_search`），或让模型写脚本批量调用（代码模式）。

**为什么选 pi 而不是其他框架**：

| 候选 | 不选的原因 |
|---|---|
| 自己写 tool-use 循环（原方案） | 持久化、子对话、并发工具、压缩、断点续跑都要自己做 |
| Vercel AI SDK / OpenAI Agents SDK | 偏无状态调用，没有持久化任务和断点续跑 |
| Mastra / LangGraph.js | 体量大、概念多，偏服务端工作流；本地桌面应用用不上 |
| pi | 小而透明；多模型（含 DeepSeek）；`pi-agent-core` 稳定、够用；MIT。持久化自己做，表结构归我们管，迁移与同步（R11）都可控 |

---

## 3. 进程架构

数据库要有唯一的写入者，MCP Server、后台任务又需要一个常驻的 JS 运行环境，所以新增 **Tibi Core**。Core 写成**不依赖 Node 专有 API 的 TS 包**（R11）：桌面上作为 sidecar 运行，手机上把同一个包放进应用自己的 JS 运行时（见 [00 §3.13](./00-concept-design.md#313-手机端d8)）：

```
┌──────────────────────────── Tauri App ────────────────────────────┐
│  WebView（React）：首页 / 阅读器 / 生词本 / 复习 / 统计 / 设置 / 运行记录 │
│        │  JSON-RPC：请求 + 事件流（经 Rust 转发 sidecar 的 stdio）       │
│  Rust 壳（很薄）：窗口、托盘、密钥存储、启动 / 守护 Tibi Core          │
└────────┼──────────────────────────────────────────────────────────┘
         ▼
┌──────────────────── Tibi Core（Node 单文件可执行，sidecar）────────────┐
│  技能层     Tibi 主对话 · 导入文章 · 找文章 · 讲解 · 出题与批改 · 学习洞察 · 整理记忆 │
│             每项技能 = 一份 SKILL.md = 一次 pi-agent-core Agent 配置（提示词 + 工具子集 + 钩子） │
│  运行时     TibiKernel：对话 · 进行中的回答（内存）· 审批 · 压缩 + pi-agent-core 循环 │
│             pi-ai：DeepSeek / OpenAI 兼容 / 账号登录                      │
│  能力层     一份 TypeBox 定义 → 技能可用的 pi 工具 / MCP 工具 / 界面直接调用   │
│  领域服务   导入解析 · 分词词形 · 词典 · 词汇 · FSRS · 统计 · TTS · 记忆     │
│  对外       MCP Server（经本地 socket 接 `tibi mcp` 代理，给 Codex / Claude Code 用）│
└────────┬──────────────────────────────────────────────────────────┘
         ▼
   app.db（领域表 + 对话表，同一个文件、同一个连接，表结构都归我们）· dict.db · media/
```

要点：
- **数据库只有一个写入者**：Tibi Core。界面不再直接连 SQLite。Core 通过一层很薄的 `Driver` 接口访问 SQLite（T2，2026-10-31 开工时定：不用 Drizzle，表结构以 `packages/core/sql/*.sql` 为唯一真相源，查询手写 SQL；桌面接 better-sqlite3，手机接平台 SQLite，测试用内存库）。对话与任务表和领域表放在同一个 `app.db`，这样"导入一篇文章 + 记录任务步骤"可以在一个事务里提交。
- **打包**（T11，2026-10-31 实测）：**Bun `--compile` 单文件**，SQLite 用 Bun 内置的 `bun:sqlite`，不带原生模块；Linux x64 约 105 MB，启动到响应第一条 JSON-RPC 114 ms。对照：Node SEA 119 MB 且 better-sqlite3 的 `.node` 还得放在旁边；Node + JS 包 139 ms。开发时用 Node + tsx 跑同一份代码（Driver 接口按运行时选 better-sqlite3 或 bun:sqlite）。Tauri 用 `externalBin` 打包为 sidecar，`pnpm --filter @tibi/core-node sidecar` 生成 `apps/desktop/src-tauri/binaries/tibi-core-<triple>`。
- **界面与 Core 的通信**：JSON-RPC 2.0；请求走 `invoke`，事件（文本增量、工具开始 / 结束、一轮结束、导入进度）走 Tauri 事件。全部方法、参数、返回值与事件载荷见 [06 接口定义](06-interface.md)。窗口关闭时 Core 可以留在托盘继续跑后台任务（可设置）。
- **单实例**：Core 持单实例锁。`tibi mcp` 只是代理，经本地 socket 加令牌连运行中的 Core，自己不开数据库，见 [06 §6](06-interface.md#6-mcp-server)。
- **业务逻辑仍在 TypeScript**，开源贡献门槛不变；Rust 只更薄了。

---

## 4. 两层：能力与技能

### 4.1 判断标准

| 交给代码（能力） | 交给技能（模型） |
|---|---|
| 结果唯一、必须正确、要离线可用、要快 | 需要理解、取舍、生成，或者要多步规划 |
| 分句分词、词形还原、查 ECDICT、按已知词库着色、FSRS 排期、统计聚合、朗读 | 语境释义、总结、挑短语和长难句、判断文章类型和难度、推荐文章、出题、批改造句、写洞察、整理记忆 |

**离线时**：所有能力照常可用，技能退化为"跳过这一步"（例如导入只做分词着色，没有总结），界面标出"AI 未运行，可稍后补做"。

### 4.2 能力层（Capabilities）

每个能力定义一次：名称、说明、TypeBox 参数、结构化返回值、**权限级别**（读 / 写 / 需确认）、是否可撤销、`replay`（崩溃后能否安全重跑）。同一份定义生成三种出口：

1. **pi 工具**：注册进 `pi-agent-core` 的工具表，供技能调用；
2. **MCP 工具**：Tibi Core 内置 MCP Server，供外部 AI 工具调用（A6）；
3. **界面直接调用**：按钮直接调用能力，不经过模型（例如"标为生词"）。

能力清单、参数、返回与权限见 [06 接口定义 §5](06-interface.md#5-能力层技能工具--mcp-工具--界面直接调用)；能力本身不调语言模型（评语、解释、推荐理由由技能完成），这也是能力与技能的分界。

工具数量会超过 40 个。按 pi 的做法，**每项技能只拿到自己那组工具**（`allowed-tools`）；Tibi 主对话默认只拿常用工具，其余标为 `deferred`，需要时用 `tool_search` 加载。

### 4.3 技能清单

| 技能（内部 id） | 职责 | 怎么触发 | 主要能力 | 默认模型档 | 产出在哪里 |
|---|---|---|---|---|---|
| **Tibi 主对话**（`tibi`） | 和你对话；理解意图后自己做，或运行一项技能 | 输入框"问 Tibi"、⌘K 问 Tibi、阅读器 / 生词本 / 复习页的 Tibi 面板 | 常用读写工具 + `run_skill` + `tool_search` | 快速 | 对话面板 |
| **导入文章**（`importer`，**固定流水线，不是模型驱动的技能**，R10） | 抓取或识别 → 提取正文与结构 → 分句着色 → 判断类型与难度（以上是代码，离线可完成）→ 总结、短语、长难句、学习建议（可选的 AI 补充，没连模型或离线时记"稍后补做"） | 输入框粘贴网址或文字、拖入文件、剪藏插件、手机分享、Tibi 主对话调用、MCP；**用户自己触发的导入不再审批** | `fetch_url` `extract_pdf` `extract_epub` `extract_docx` `ocr_image` `segment_document` `annotate_terms` `estimate_difficulty` `save_document` `save_ai_result` `tag_document` | 快速（总结可选深入） | 任务进度抽屉 → 结果卡片；阅读器"总结"面板 |
| **找文章**（`scout`） | 按你的水平、兴趣、正在学的词找文章，给推荐理由 | 输入框"找文章"、`/找文章`、首页建议 | `search_feeds` `web_search` `fetch_url` `estimate_difficulty` `list_terms` | 快速 | 推荐卡片；首页"今天推荐" |
| **讲解**（`tutor`） | 阅读时讲解：语境释义、长难句、语法、背景知识；读完出几道理解题 | 选中文本"问 Tibi"、词卡"更多解释"、读完一篇、`/讲解` | `get_document` `lookup_word` `compare_words` `get_term_contexts` `set_context_meaning` `create_quiz` `mark_term` `speak` | 快速 | 词卡、阅读器 Tibi 面板 |
| **出题与批改**（`coach`） | 生成填空 / 造句题的句子，批改造句，答错时解释；用生词出临时练习（"再练错词"）；完成页"读一篇用到这些词的短文"找不到文章时写一篇用到今天这些词的短文 | 复习页（造句批改、"为什么"、完成页）、`/出题` | `get_term` `get_term_contexts` `grade_answer` `record_review` `pick_distractors` `create_quiz` `search_feeds` `save_document` `save_ai_result` | 快速 | 复习卡片、完成页、书架（Tibi 写的短文） |
| **学习洞察**（`insight`） | 看统计数据写观察和建议 | 打开统计页、`/学习洞察` | `get_stats_series` `get_learning_stats` `get_review_stats` `list_terms` | 深入 | 统计页"Tibi 的洞察" |
| **整理记忆**（`archivist`） | 把对话和学习事件整理成记忆：去重、合并、标记过时 | 手动：`/整理记忆`、记忆管理页 | `search_memory` `remember` `forget` `list_learning_events` | 快速 | 设置 → Tibi 记忆（每条带来源） |

说明：
- 导入时固定的那部分（总结、短语、长难句）由"导入文章"一次跑完并缓存到 `ai_results`；"讲解"只处理你临时问的问题。
- **导入是流水线而不是技能**（R10，2026-10-31）：步骤固定，由代码按顺序执行，模型只负责其中几个生成步骤，不由模型决定调哪个工具。所以它没有 `SKILL.md`，也不经"技能审批"；在界面上仍和其他几项一起列为"Tibi 能做的事"。其余 5 项（找文章、讲解、出题与批改、学习洞察、整理记忆）是技能。
- Tibi 主对话通过 `run_skill(skill, input)` 运行技能：子技能在同一轮回答里跑（共用停止、审批和不可信标记），说完把结果作为工具结果交回；界面上显示为收起的过程卡"Tibi 正在…"，中途可以展开看步骤或取消。
- 用户看到的始终是 Tibi 一个角色；想控制的用户可以在设置里逐项配置技能。

---

## 5. 技能的定义格式：SKILL.md

内置技能的内部格式：一个目录，里面一份 `SKILL.md`，可以带参考资料，随应用分发。格式遵循 [Agent Skills 规范](https://agentskills.io/specification)（与 pi、Claude Code 通用），Tibi 需要的额外字段放在 `metadata` 里：

```markdown
---
name: scout
description: 按用户的水平、兴趣和正在学的词找适合阅读的英文文章，并说明推荐理由。
allowed-tools: [search_feeds, web_search, fetch_url, estimate_difficulty, list_terms]
metadata:
  title: 找文章            # 界面上显示的动词
  model: fast             # fast / deep，对应设置里的两档模型
  write: ask              # 覆盖全局权限模式（只能收紧）
---

你负责给用户挑文章。优先选生词率 2–5% 的文章……
```

- 早先文档里的 `AGENT.md` + `SKILL.md`（提示词技能）两套格式已合并为这一种（2026-10-29 复审）：一个技能既有指令也有工具子集和模型档，没必要再分两层。
- **加载方式**：Tibi Core 把每份 `SKILL.md` 转成一份 `pi-agent-core` 的 Agent 配置（正文 → 系统提示片段，`allowed-tools` → 工具子集），运行时为每次调用创建或复用一个子对话，设定模型、工具和指令。启动时只把技能的名称和说明放进 Tibi 主对话的上下文，运行时才加载全文。
- **用户能改什么**：内置技能可以追加指令、换模型档，不能删掉安全规则。**技能只能使用能力层的工具，不能执行任意代码。**
- **不做用户自定义**（B5 已砍，2026-10-31）：用户不能新建或安装技能，也没有社区技能包；`SKILL.md` 只是内部实现。

---

## 6. 运行机制（TibiKernel，R9 后自建）

| Tibi 概念 | 实现 |
|---|---|
| 一次对话线程（全局线程、某篇文章的线程、手机上的"今天"） | `conversations` 一行，消息存 `messages`（先写库再显示） |
| 一轮回答（例如出一组题） | 一句用户消息 + 助手消息和工具结果，带同一个 `turn_id`；技能和结果记在那句用户消息的 `ui.turn`。跑着的时候在内存里（`kernel/turns.ts`），步骤写在回答的过程卡里 |
| Tibi 主对话运行一项技能 | `run_skill` 在同一轮里跑子技能，不另建对话和记录 |
| 导入、导入后的总结（短语、长难句并行） | 后台函数：导入有 `import_id`，进度走 `import.progress`、结束走 `import.done`；总结状态写 `documents.ai_status` |
| 直接运行一项技能（整理记忆按钮） | 建一段 `kind = skill` 的对话，在里面跑一轮 |
| 关掉应用后 | 不续跑：还没答完的那一轮记成中断，界面显示"重试"；做了一半的总结改回"稍后补做" |
| 学习事件触发（读完一篇 → 出题建议） | Core 内事件总线 → 写入对话 |
| 权限与审批 | `beforeTool` 钩子：按权限档放行、拦截，或挂起等待界面确认 |
| 撤销 | 写类能力返回撤销信息，记入审计日志（`afterTool` 钩子） |
| 花费 | 不在 Tibi 算（T36）：用户在服务商后台看；兜底是每轮最多调用几次模型（`agent.max_turns`） |
| 长对话 | 自动压缩（摘要旧内容，原文仍保留） |

---

## 7. 上下文工程

沿用 [`02-ai-assistant.md` §4](./02-ai-assistant.md#4-上下文工程每轮注入什么) 的七个区块，按自建对话表的特点重新安排，目的是**让模型提示缓存命中**（DeepSeek 有缓存折扣）：

| 放在哪里 | 内容 | 变化频率 |
|---|---|---|
| 系统提示词片段（sections，按顺序） | 角色与规则 → 用户身份与核心记忆 → 能力清单（当前技能的工具、已配置的服务、权限档） | 很少变；变了只发送变化的部分 |
| 每轮用户消息的前缀 | 学习状态快照、当前界面上下文（页面、正在读的段落、选中的文本、当前卡片）、召回的记忆 | 每轮都变，所以**不放进系统提示词** |
| 工具 | 只给当前技能需要的；其余延迟加载 | 按技能固定 |

---

## 8. 权限、审批与安全

- 三档权限模式不变（每次都问 / 标词自动其余询问 / 全部自动），由 `beforeTool` 统一执行；技能的 `SKILL.md` 可以收紧，不能放宽。
- 需要确认时，对话里出现一张**审批卡**（外部工具来的显示在桌面窗口右下角）（"Tibi 想把《…》保存到书架" → 允许 / 拒绝 / 修改后允许 / 以后这类都自动允许）。
- 同一轮的审批一个一个弹（工具是并行的，审批只有一个位置）；审批只在内存里，应用重启后那一轮记成中断。
- 能力权限新增第四级 `always`：每次都问，全部自动和"以后这类都自动允许"都不放行，读过不可信内容的一轮直接拒绝。用于暂停记忆、技能附加指令、批量删除这类改动。
- 所有写操作进审计日志，词汇类写操作和导入都可撤销。
- **没有任意代码执行**：不注册 bash、文件读写这类工具；不做代码模式（以后需要时用 QuickJS 沙箱，只能调用能力层工具）。

**反问（`ask_user`）和后台导入的结果**（2026-11-03 改，2026-11-04 按 T35 调整）：

参照 Claude Code：Tibi 只提供工具，问用户、做事、汇报结果都在 agent 循环里，内核不替模型执行动作。

- `ask_user` 是普通工具：卡片在工具执行时就显示出来，工具在 Core 里原地等用户回答（pi 对工具执行没有超时），回答就是工具结果，模型在同一轮里接着做。用户不点卡片、直接在输入框说话，也算回答。
- 选项可以带 `url`（文章链接），必须出现在这一轮的工具结果或输入里。用户选中的网址，这一轮导入不再审批（能力用 `chosenUrl` 声明对应的网址）；模型换了网址照常审批。卡片上的内容可能来自网页，只当纯文本显示，链接只显示域名。
- 等待只在进程里：应用重启后这一轮记成中断，卡片作废（和 Claude Code 一样）。取消这一轮时卡片也作废。
- 子技能没有自己的对话：它在同一轮里跑，反问显示在主对话这次回答里，卡片跟着 `run_skill` 的结果存。
- 对话里调 `import_document`：最多等 3 分钟，导入的结果作为工具结果交回模型；没等到就告诉模型"还在导入"，结果由书架上的提示告诉用户（2026-11-04：结束后回到对话里通知这一做法暂时没有）。
- 不问密码、API Key（写在技能规则里，无法完全强制）。

**对话里的导入卡和跳转卡**（2026-11-04）：

- Tibi 在对话里调 `import_document` 时，工具先在这一轮里放出一张导入卡（`kind: 'import'`，带 `import_id`），卡片跟着 `import.progress` / `import.done` 显示进度和结果；工具等导入跑完再返回，结果也交给模型。这次导入的 `origin` 是 `chat`：首页进度条和全局提示都不显示。
- 成功后卡片上是「开始阅读」，按钮是 `tibi://read/<id>`；超过等待时间才结束的，卡片状态由内核改回库里那条。
- 跳到应用里别处统一用深链：`show_link` 放一张跳转卡，`open_settings` 也是它；按钮和系统打开的 `tibi://` 链接走同一份白名单解析，界面按平台换成路由（手机没有的页面退回最接近的）。
- 用户自己在消息里发来的网址（不含附件里的文章内容），这一轮导入不再审批，和卡片上选中的网址一样。对话页的「/导入 网址」和 ⌘ 点链接都改为发给 Tibi；粘贴的长文不过模型，仍直接在后台导入。

**Tibi 改配置和管理数据**（2026-11-03）：

- 只开放能力层里的白名单（06 §5"配置与数据管理"），不提供 SQL 和通用 `settings.set`。业务规则写在方法里（软删与撤销、改类型让 AI 结果失效），直接写库会绕过。
- `settings` 表里还存着 `perm.auto.*`、`mcp.*`，服务商地址一改 API Key 就发到别处，这些和权限模式、密钥都不开放，只能用 `open_settings` 把用户带去设置页。
- 这组能力都标 `mcp: false`：MCP 的读能力默认全开，配置和管理不该跟着开放。
- 主对话常驻 `ask_user`、`import_document`、`get_config`、`set_config`、`open_settings`；管理文章、记忆、生词本、来源、技能、备份的工具经 `tool_search("管理")` 按需加载，不占每轮的提示词。

**不可信内容**：

- 抓到的网页、导入的正文、搜索结果都视为数据，不当作指令（防提示注入）。
- 一轮回答一旦读过不可信内容，之后的写入和外联（`fetch_url`）都要审批，全部自动和"以后这类都自动允许"也不放行。`web_search` 不用审批，随时直接调用，但它的结果同样算不可信内容。例外：导入流水线的固定步骤写 `ai_results` 缓存，不动词库和记忆。
- 算读过的能力（2026-11-03）：`fetch_url`、`web_search`、`search_feeds`、`get_document`、`search_documents`、`get_term`、`get_term_contexts`，也就是结果里带网页、订阅、导入的正文或原句的。文章标题和界面选中的文字每轮都在 `<context>` 里，不算，否则所有任务都会被标记。
- 标记会传递（2026-11-03，2026-11-04 按 T35 简化）：子技能和主对话在同一轮里，共用一个标记；同一段对话的新一轮，只要历史里还有读过不可信内容的那一轮就继承（历史和摘要都会带给模型），回退作废后恢复。

**入口校验**：

- 文件：`path` 只接受 `pick_file` 所选或拖入后由 Rust 登记的路径；MCP 调用方不能传本地路径。
- 网址：只抓用户给的网址或"找文章"在白名单来源里找到的网址；由 Core 校验，只收 http(s)，解析后拒绝回环、内网、链路本地地址，重定向每跳重查。
- MCP：`tibi mcp` 经本地 socket 加令牌连 Core；默认只开读能力白名单，写能力由用户逐项开启，开启后仍走审批。
- 深链（R4）：`tibi://import?url=…` 参数视为不可信，URL 按上面的网址规则校验，弹出确认卡，用户确认后才抓取。扩展只传 URL，不传页面内容。其余 `tibi://` 只做应用内跳转，按白名单解析（`deeplink.ts`），不做任何写入。

**界面**：

- WebView 用严格 CSP：不允许内联脚本和远程脚本，只连 Tauri 通道。
- 渲染 Markdown 前先净化（去掉脚本、事件属性、`javascript:` 链接）；禁远程图，图片只显示 `media/` 下的本地副本，避免加载时外泄阅读内容。

**密钥**：

- API Key 存应用数据目录的 `secrets.json`（权限 0600；桌面和 iOS 不加密，桌面上同用户的程序能读，iOS 的设备备份可能带上；Android 再经 Keystore 加密）。Core 需要时经 sidecar 通道向 Rust 按需取（`secret_get`），只留内存；不写数据库、不写日志、不进诊断信息、不发给 WebView。

**失败路径**（细节见 [06 §1](06-interface.md#1-约定)）：

- ~~调用模型前预留预算（每月 ¥20、单个任务 ¥1）~~：2026-11-04 去掉（T36），花费在服务商后台看。
- 模型不可用时记 `ai_status = deferred`，界面显示"稍后补做"。
- 嵌套深度上限 1；写工具带幂等键。

---

## 9. 用户能看到什么

以 [§13](#13-用户可见层一个-tibi多项技能2026-10-29-已确认) 为准。早期"智能体"方案的交互变化已归档：[`archive/05-section-9-agents-ui.md`](archive/05-section-9-agents-ui.md)。

---

## 10. 外部 AI 工具（对 A2、A6 的影响）

- **MCP Server（A6）**：不变，并且更自然——就在 Tibi Core 里，暴露能力层，`tibi mcp` 只做代理。用户在 Codex / Claude Code 里说"把我今天的生词出 10 道题"即可。
- **账号登录**：pi-ai 支持用 ChatGPT（Codex）、Claude、GitHub Copilot 账号登录。**Tibi 不提供 Claude 订阅登录**：Anthropic 条款禁止第三方使用 Claude 订阅的 OAuth（[The Register，2026-02-20](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access)）；Anthropic API Key 照常可用。**ChatGPT 登录也先不做**（2026-10-31）：条款未核实，从 M5 计划里拿掉；以后 OpenAI 明确允许第三方应用使用再加。
- **ACP 客户端（A2）**：价值下降——它原本是为了"用用户已有的订阅"和"接入本地 harness"。建议 v1 先不做 ACP，用户想用 Codex / Claude Code 时走 MCP 反向接入；以后有需要再加。

---

## 11. 风险与验证

| 风险 | 应对 |
|---|---|
| ~~`pi-durable` 实验性~~：已按 R9 不用（2026-10-31）。当时核对的事实（[npm](https://www.npmjs.com/package/@earendil-works/pi-durable)）：MIT；1.x 一个月内发了 9 个版本；README 写明 API 可能不经通知变化；1.4.0 打开 SQLite 时自动迁库，迁移后旧版打不开，不可回退 | 改用 `pi-ai` + `pi-agent-core`，对话与任务自建（§1、§6）。代价：检查点、续跑、子对话、上下文压缩要自己写，约 1–2 周，M0 验证 |
| 自建持久化的工作量与正确性 | `TibiKernel` 只做 Tibi 需要的：对话、进行中的回答、审批（2026-11-04 起去掉任务树、检查点和用量，T35、T36）；用集成测试覆盖"中途杀进程再打开"（没答完的记成中断） |
| sidecar 体积和启动时间 | 先测 Node SEA 与 Bun 两种打包；Core 随应用启动，界面先显示本地数据 |
| SQLite 驱动 | 桌面用 `better-sqlite3` 或 `bun:sqlite`；手机用平台的 SQLite（经 Tauri 插件）。Core 只通过一层薄的数据库接口访问，三处都能接 |
| DeepSeek 的工具调用稳定性 | 每项技能工具少而精；能力返回结构化结果；关键流水线（导入）用固定步骤 + 模型只做其中的生成环节 |
| 花费失控 | 技能都由用户触发，没有定时运行；每轮最多调用几次模型；账单和限额在服务商后台（T36 起 Tibi 不设预算） |
| 多个内部 agent 让用户困惑 | 用户只看到 Tibi 和它的技能（§13）；进阶用户才去配置 |

**第一步建议做一个技术验证（spike）**，一周内回答：
1. （2026-10-31 的验证项，T35 后检查点和任务表已去掉）Tibi Core（Node SEA / Bun）+ `pi-agent-core` + 自建 `conversations` / `jobs` / `job_steps` 表，与领域表共用 `app.db`；中途杀进程后能从检查点续跑；
2. pi-ai 调 DeepSeek 的工具调用与流式输出；
3. 导入流水线做成可续跑的任务（含并行子任务），任务表驱动进度抽屉；
4. `beforeTool` 挂起等待界面审批的做法；
5. Tauri sidecar 打包体积、冷启动时间、Windows / macOS / Linux 三平台可运行。（2026-10-31：Linux 已测，Bun 单文件 105 MB / 114 ms；macOS、Windows 待在对应机器上跑 `pnpm --filter @tibi/core-node sidecar`）

---

## 12. 决策

| # | 问题 | 结论 | 状态 |
|---|---|---|---|
| **B1** | harness 底座 | `pi-ai` + `pi-agent-core`，对话与任务由 `TibiKernel` 自建（R9，2026-10-31 改；原为 `pi-durable`） | ✅ 已确认（2026-10-29，2026-10-31 调整） |
| **B2** | 进程架构 | 新增 Tibi Core sidecar，独占 `app.db`；界面不再直连数据库（改动原 §4 架构与数据访问方式） | ✅ 已确认（2026-10-29） |
| **B3** | 技能清单 | Tibi（主）+ 5 项技能：找文章、讲解、出题与批改、学习洞察、整理记忆；导入文章改为固定流水线（R10，2026-10-31），界面上仍一起列为"Tibi 能做的事"（初稿称"6 个专职智能体"，复审统一） | ✅ 已确认（2026-10-29，2026-10-31 调整） |
| **B4** | 用户如何接触技能 | 默认只感知 Tibi；运行记录、设置里的技能配置面向进阶用户（初稿的 @ 点名已被 C1–C5 取代，界面统一为"Tibi 的技能"） | ✅ 已确认（2026-10-29） |
| **B5** | 自定义技能 | **已砍**（R2）：用户不能新建或安装技能；内置技能仍用 `SKILL.md`（Agent Skills 格式），这是内部实现 | 🚫 已砍（2026-10-31，原 2026-10-29 确认） |
| **B6** | ACP 客户端（调整 A2） | v1 不做；外部 AI 工具走 MCP 反向接入。账号登录不做（2026-10-31：ChatGPT 条款未核实，先从计划拿掉；Claude 订阅登录本来就不做，见 §10） | ✅ 已确认（2026-10-29，2026-10-31 调整） |
| **B7** | 定时任务 | **已砍**（R2）：没有例行任务；找文章、整理记忆改为手动触发 | 🚫 已砍（2026-10-31，原 2026-10-29 确认） |
| **B8** | 先做技术验证 | 是，按 §11 的 5 项 | ✅ 已确认（2026-10-29） |

---

## 13. 用户可见层：一个 Tibi，多项技能（2026-10-29 已确认）

> 背景：B3、B4 定下了"Tibi + 6 个专职智能体"，原型里出现了 @ 点名智能体、"委派给子智能体"、"由 导入 生成"、"记忆管家想记住…"、设置里的"智能体"分组。2026-10-29 复盘：**架构上的多智能体是对的，但把"智能体"这个概念直接交给用户，会让人困惑。**

### 13.1 调研

| 产品 | 怎么把 AI 交给用户 | 启示 |
|---|---|---|
| Readwise Reader · Ghostreader | 一个助手；在选中文字、文档、整个书库三个范围里用；能力以"定义词、总结、提问"等动作出现，可加自定义指令 | 一个角色 + 就地动作，最贴近我们 |
| 多邻国 | Duo、Lily 是角色，但 AI 功能按动作命名（解释我的答案、视频通话、角色扮演），用户不需要知道背后是什么模型或几个 agent | 角色负责情感，功能用动词命名 |
| Microsoft 365 Copilot | 多个 Copilot 和 agent 并存，社区里大量反馈"太多 Copilot，困惑、低效" | 反面教材：入口和名字一多就乱 |
| Notion | 先只给每人一个 Agent；之后才给进阶用户开放自定义 agent 和子 agent | 默认一个，多 agent 留给想折腾的人 |
| 研究："Why Johnny Can't Use Agents"（2025） | 主要障碍：能力与用户心智模型不符、不会提问、过程信息过载、交互方式僵化 | 少讲概念，多给示例和就地按钮，过程默认收起 |

### 13.2 现在原型的问题

1. **同一件事有多个入口**：找文章可以用"找文章"模式、`@选文`、问 Tibi、⌘K，用户不知道该用哪个、有什么区别。
2. **暴露了内部角色**：@ 列表里有 7 个名字，其中洞察、记忆管家几乎不需要用户主动调用；"导入""选文"这些名字既像功能又像角色。
3. **吉祥物的人设被稀释**：用户刚记住 Tibi，又冒出"记忆管家想记住…""Tibi 委派给伴读"，不知道在跟谁说话。
4. **术语和信息过载**：子智能体、委派、模型档、DeepSeek · 快速出现在日常界面里。

### 13.3 建议：一个 Tibi，多项技能

**内部仍是一项技能一个子对话（本文 §3–§8 不变），用户只看到 Tibi 一个角色和它会做的事。**

| 位置 | 现在 | 改为 |
|---|---|---|
| 用户可见的概念 | 智能体、子智能体、委派 | 不出现这些词；Tibi 的能力叫**技能**，用动词命名：导入文章、找文章、讲解、出题、批改、写学习洞察、整理记忆 |
| 首页输入框 | 三个模式 + `@` 点名 7 个智能体 | 保留三个模式（导入 / 问 Tibi / 找文章）；去掉 `@`；问 Tibi 时由 Tibi 自动判断该用哪项技能；输入 `/` 可选动作（导入、找文章、出题…），列表是动词不是角色 |
| 告诉用户能做什么 | @ 列表 | 输入框下的建议胶囊随场景变化；占位文字轮换示例；第一次使用时一张"Tibi 能帮你做什么"的卡片 |
| 处理过程 | "Lexi 委派给 伴读 · 子智能体 · DeepSeek 快速" | "Tibi 正在讲解这句话"，下面是步骤，默认收起，点开才看工具调用 |
| 来源标注 | "由 导入 生成 · DeepSeek 快速" | "Tibi 生成 · 查看过程"；模型、用时、花费放进"查看过程"里 |
| 审批卡 | "记忆管家想记住…" | "Tibi 想记住…"（用到的技能写在灰字里） |
| 运行记录 | 按智能体显示头像和名字 | 统一 Tibi 头像，标题用动作（导入《…》、找文章、整理记忆）；筛选用技能；"花得最多"改成按技能 |
| 设置 | "智能体"分组，可新建智能体 | 改名"Tibi 的技能"（默认收起）：每项技能的模型档、附加指令、写入权限（初稿的例行任务、"新建技能"已于 2026-10-31 砍掉） |

**保留不变**：Tibi 的人设与动画状态、能力层、权限与审批、运行记录本身、预算（运行记录和预算 2026-11-04 去掉，T35、T36）、MCP。技能文件统一为 `SKILL.md`（§5）。

### 13.4 决策

| # | 问题 | 结论 | 状态 |
|---|---|---|---|
| **C1** | 用户界面不再出现"智能体 / 子智能体 / 委派"，改称 Tibi 的"技能" | 是 | ✅ 已确认（2026-10-29） |
| **C2** | 去掉 `@` 点名，改为 `/` 动作列表 + 自动判断 | 是 | ✅ 已确认（2026-10-29） |
| **C3** | 来源标注、审批卡、运行记录统一用 Tibi 的名字和头像，技能名作为灰字补充 | 是 | ✅ 已确认（2026-10-29） |
| **C4** | 设置"智能体"改为"Tibi 的技能"（定时改叫"例行任务"这一半已随 B7 砍掉） | 是 | ✅ 已确认（2026-10-29） |
| **C5** | 过程信息默认收起，模型 / 花费只在"查看过程"和运行记录里出现 | 是 | ✅ 已确认（2026-10-29） |

原型（已改）：首页 `/` 动作列表、自动判断技能、收起的过程卡、"Tibi · 技能 · 查看过程"、首次使用卡片；运行记录统一 Tibi 头像、按技能显示、"例行任务"；设置"Tibi 的技能"；统计页洞察来源；⌘K 搜索的设置项。例行任务、新建技能已砍（2026-10-31）。

## 参考

- 用户可见层调研（§13）：[Ghostreader 文档](https://docs.readwise.io/reader/guides/ghostreader/overview)、[Global Ghostreader](https://docs.readwise.io/reader/guides/ghostreader/global)、[Duolingo Max](https://blog.duolingo.com/duolingo-max)、["So many different Copilots — confusing, unproductive"（Microsoft 社区）](https://techcommunity.microsoft.com/discussions/microsoft365copilot/so-many-different-copilots---confusing-unproductive/4426480)、[Notion Personal Agent 评测](https://eesel.ai/blog/notion-personal-agent)、[Why Johnny Can't Use Agents（arXiv 2509.14528）](https://arxiv.org/html/2509.14528v1)

- pi 源码与文档：[earendil-works/pi（原 badlogic/pi-mono）](https://github.com/badlogic/pi-mono)；npm 包 `@earendil-works/pi-ai`、`pi-agent-core`、`pi-durable`、`pi-coding-agent`（1.4.0）的 README 与 `docs/`（sdk、extensions、skills、mcp、rpc、how-pi-works）
- 作者对设计取舍的说明：[What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- [pi-agent-core README](https://cdn.jsdelivr.net/npm/@mariozechner/pi-agent-core/README.md)、[pi-ai README](https://cdn.jsdelivr.net/npm/@mariozechner/pi-ai/README.md)
- pi 的 ACP 适配器（社区）：[svkozak/pi-acp 及其分支](https://github.com/DxTa/pi-acp)
- [Agent Skills 规范](https://agentskills.io/specification)
