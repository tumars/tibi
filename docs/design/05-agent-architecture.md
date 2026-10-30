# 智能体化架构 v0.1：以 pi 为 harness 底座

> 状态：**已确认**（2026-10-29，决策 B1–B8 见 §12）。已同步到 [`00-concept-design.md` §3.10 / §4](./00-concept-design.md#4-系统架构)、[`01-database.md` §7](./01-database.md#7-智能体) 和 [`02-ai-assistant.md`](./02-ai-assistant.md)。
> 原型：[任务中心](../prototypes/tasks.html) · [首页 `/` 技能与过程卡](../prototypes/home.html) · [设置 → Tibi 的技能](../prototypes/settings.html#agents) · [统计页洞察来源](../prototypes/stats.html)；技能目录 [`v2-agents.js`](../prototypes/v2-agents.js)。
> 目标：把 Tibi 从"应用里带一个 AI 助手"改成"一只会多项技能的 Tibi"——导入文章、找文章、讲解、出题与批改、学习洞察、整理记忆都是技能，内部各自是一个专职 agent（子对话），用户只面对 Tibi 一个角色（§13）；底座使用开源 harness **pi**。
> 术语（2026-10-29 复审统一）：**技能** = 用户看到的、也是内部的单位，每项一份 `SKILL.md`；本文 §2 讲 pi 时仍用它自己的词"agent / subagent"。

---

## 1. 一句话结论

- **底座**：用 pi 的两个库——`pi-ai`（统一模型接口，支持 DeepSeek 和任意 OpenAI 兼容接口）和 `pi-durable`（持久化的智能体运行时：会话、任务、子智能体、断点续跑、SQLite 存储）。不直接用 `pi-coding-agent`（它是编程 agent，带文件和 shell 工具）。
- **进程**：新增一个 **Tibi Core** 后台进程（TypeScript，Tauri sidecar），它独占 `app.db`，承载领域服务、智能体运行时和 MCP Server；界面只负责展示和调用。
- **能力与技能分层**：确定性的事情（分词、词形还原、查词、FSRS 排期、统计）仍然是普通代码，包装成**能力**（工具）；需要判断和生成的事情交给**技能**（由模型完成）。同一个能力可以被界面直接调用、被技能调用、被外部 AI 工具经 MCP 调用。
- **对用户暴露**：只有 Tibi 一个角色，它会 6 项技能；按钮即运行、过程默认收起可展开、输入 `/` 可选技能、可以在设置里配置模型和指令、可以设为例行任务（§13）。

---

## 2. 调研：pi 是什么

pi 是 Mario Zechner（libGDX 作者）发起的开源 agent 工具集，MIT 协议，TypeScript。2026 年起包名从 `@mariozechner/*` 迁到 `@earendil-works/*`，当前版本 **1.4.0**（2026-10-21）。

| 包 | 作用 | 与 Tibi 的关系 |
|---|---|---|
| `pi-ai` | 统一多家模型的流式接口：OpenAI、Anthropic、Google、**DeepSeek**、OpenRouter、Ollama / vLLM / LM Studio 等任意 OpenAI 兼容接口；TypeBox 定义工具参数并自动校验；统一的思考档位；每次调用返回 token 与费用；对话中途可换模型；可在浏览器运行；提供 ChatGPT / Claude / Copilot 账号登录（OAuth） | ⭐ 取代我们自己写的 provider 抽象 |
| `pi-agent-core` | 最小的 agent 循环：`Agent` 类、工具并行 / 串行执行、`beforeToolCall` / `afterToolCall` 钩子、steer（插话）/ followUp（排队）、事件流 | 备选底座（稳定、简单，但持久化要自己做） |
| `pi-durable` | 持久化 harness：对话、模型轮次、工具调用、自定义状态**先写入存储再显示**，进程崩溃后从断点继续；扩展（工具 + 提示词片段 + 钩子 + 任务）；子智能体（由任务拥有的对话）；子任务与任务图；定时休眠任务；代码模式；延迟加载工具与 `tool_search`；自动压缩上下文；SQLite / IndexedDB / JSONL 存储，SQLite 可加表前缀与宿主表共用一个库 | ⭐ 选作运行时；**标注为实验性**，API 可能不经通知变化（见 §11） |
| `pi-coding-agent` | 终端编程 agent（read / write / edit / bash 四个工具）、JSONL 树形会话、扩展、技能（Agent Skills 规范）、MCP、RPC 模式、SDK | 不作底座；借鉴它的技能和扩展格式 |
| `pi-web-ui` | 基于 mini-lit 的聊天界面组件 | 不用（风格不符；最新版仍是 0.75，没有随 1.x 更新） |

**pi 的设计哲学**（对我们有直接影响）：
- 系统提示词和工具定义加起来尽量小（编程 agent 不到 1,000 token），**精确控制进入上下文的内容**；
- 状态放在看得见的地方（文件、文档），不藏在隐藏模式里；
- 工具很多时不要全部塞给模型：延迟加载，按需搜索（`tool_search`），或让模型写脚本批量调用（代码模式）。

**为什么选 pi 而不是其他框架**：

| 候选 | 不选的原因 |
|---|---|
| 自己写 tool-use 循环（原方案） | 持久化、子智能体、并发工具、压缩、断点续跑都要自己做 |
| Vercel AI SDK / OpenAI Agents SDK | 偏无状态调用，没有持久化任务和断点续跑 |
| Mastra / LangGraph.js | 体量大、概念多，偏服务端工作流；本地桌面应用用不上 |
| pi | 小而透明；多模型（含 DeepSeek）；`pi-durable` 正好提供"后台任务 + 子智能体 + 本地 SQLite"；MIT |

---

## 3. 进程架构

pi-durable 要求"一个进程独占一份存储"，同时 MCP Server、启动本地 AI 工具、后台定时任务都需要一个常驻的 Node 环境。所以新增 **Tibi Core**：

```
┌──────────────────────────── Tauri App ────────────────────────────┐
│  WebView（React）：首页 / 阅读器 / 生词本 / 复习 / 统计 / 设置 / 任务中心 │
│        │  JSON-RPC：请求 + 事件流（经 Rust 转发 sidecar 的 stdio）       │
│  Rust 壳（很薄）：窗口、托盘、keyring 密钥、启动 / 守护 Tibi Core          │
└────────┼──────────────────────────────────────────────────────────┘
         ▼
┌──────────────────── Tibi Core（Node 单文件可执行，sidecar）────────────┐
│  技能层     Tibi 主对话 · 导入文章 · 找文章 · 讲解 · 出题与批改 · 学习洞察 · 整理记忆 │
│             每项技能 = 一份 SKILL.md = 一个 pi-durable 扩展（提示词片段 + 工具子集 + 钩子 + 任务） │
│  运行时     pi-durable Harness：对话 · 任务图 · 子对话 · 定时 · 压缩       │
│             pi-ai：DeepSeek / OpenAI 兼容 / 账号登录                      │
│  能力层     一份 TypeBox 定义 → 技能可用的 pi 工具 / MCP 工具 / 界面直接调用   │
│  领域服务   导入解析 · 分词词形 · 词典 · 词汇 · FSRS · 统计 · TTS · 记忆     │
│  对外       MCP Server（给 Codex / Claude Code 用）                        │
└────────┬──────────────────────────────────────────────────────────┘
         ▼
   app.db（领域表 + pi_ 前缀的对话 / 任务表，同一个文件、同一个连接）· dict.db · media/
```

要点：
- **数据库只有一个写入者**：Tibi Core。界面不再直接连 SQLite（原方案的 `tauri-plugin-sql` + Drizzle sqlite-proxy 改为 Tibi Core 内的 Drizzle）。pi-durable 的表用 `pi_` 前缀与领域表放在同一个 `app.db`，这样"导入一篇文章 + 记录智能体的步骤"可以在一个事务里提交。
- **打包**：Node 22 的单文件可执行（SEA）或 Bun `--compile`，体积约 50–90 MB。Tauri 用 `externalBin` 打包为 sidecar。
- **界面与 Core 的通信**：JSON-RPC 2.0；请求走 `invoke`，事件（文本增量、工具开始 / 结束、任务状态）走 Tauri 事件。全部方法、参数、返回值与事件载荷见 [06 接口定义](06-interface.md)。窗口关闭时 Core 可以留在托盘继续跑后台任务（可设置）。
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

1. **pi 工具**：注册进 pi-durable，供技能调用；
2. **MCP 工具**：Tibi Core 内置 MCP Server，供外部 AI 工具调用（A6）；
3. **界面直接调用**：按钮直接调用能力，不经过模型（例如"标为生词"）。

能力分组沿用 [`02-ai-assistant.md` §6](./02-ai-assistant.md#6-工具learning-tools) 的清单，再补上导入与选文需要的：`fetch_url`、`extract_pdf`、`ocr_image`、`segment_document`、`annotate_terms`、`estimate_difficulty`、`save_document`、`search_feeds`、`web_search`（可选，需配置）、`schedule_review_session`、`grade_answer`、`get_stats_series`。

每个能力的参数、返回与权限见 [06 接口定义 §5](06-interface.md#5-能力层技能工具--mcp-工具--界面直接调用)；能力本身不调语言模型（评语、解释、推荐理由由技能完成），这也是能力与技能的分界。

工具数量会超过 40 个。按 pi 的做法，**每项技能只拿到自己那组工具**（`allowed-tools`）；Tibi 主对话默认只拿常用工具，其余标为 `deferred`，需要时用 `tool_search` 加载。

### 4.3 技能清单

| 技能（内部 id） | 职责 | 怎么触发 | 主要能力 | 默认模型档 | 产出在哪里 |
|---|---|---|---|---|---|
| **Tibi 主对话**（`tibi`） | 和你对话；理解意图后自己做，或运行一项技能 | 输入框"问 Tibi"、⌘K 问 Tibi、阅读器 / 生词本 / 复习页的 Tibi 面板 | 常用读写工具 + `run_skill` + `tool_search` | 快速 | 对话面板 |
| **导入文章**（`importer`） | 抓取或识别 → 提取正文与结构 → 分句着色 → 判断类型与难度 → 总结、短语、长难句、学习建议 | 输入框"导入"、拖入文件、Tibi 自动判断、MCP | `fetch_url` `extract_pdf` `ocr_image` `segment_document` `annotate_terms` `estimate_difficulty` `save_document` | 快速（总结可选深入） | 任务进度抽屉 → 结果卡片；阅读器"总结"面板 |
| **找文章**（`scout`） | 按你的水平、兴趣、正在学的词找文章，给推荐理由 | 输入框"找文章"、`/找文章`、首页建议、**例行任务**（可开） | `search_feeds` `web_search` `fetch_url` `estimate_difficulty` `list_terms` | 快速 | 推荐卡片；首页"今天推荐" |
| **讲解**（`tutor`） | 阅读时讲解：语境释义、长难句、语法、背景知识；读完出几道理解题 | 选中文本"问 Tibi"、词卡"更多解释"、读完一篇、`/讲解` | `get_document` `lookup_word` `get_term_contexts` `create_quiz` `mark_term` | 快速 | 词卡、阅读器 Tibi 面板 |
| **出题与批改**（`coach`） | 生成填空 / 造句题的句子，批改造句，答错时解释；用生词出临时练习（"再练错词"）；完成页"趁热读一篇"找不到文章时写一篇用到今天这些词的短文 | 复习页（造句批改、"为什么"、完成页）、`/出题` | `get_term` `get_term_contexts` `grade_answer` `pick_distractors` `create_quiz` `search_feeds` `save_document` | 快速 | 复习卡片、完成页、书架（Tibi 写的短文） |
| **学习洞察**（`insight`） | 看统计数据写观察和建议 | 打开统计页、`/学习洞察`、**例行任务**（每周，可开） | `get_stats_series` `get_learning_stats` `list_terms` | 深入 | 统计页"Tibi 的洞察"、周报 |
| **整理记忆**（`archivist`） | 把对话和学习事件整理成记忆：去重、合并、标记过时 | **例行任务**（每晚，默认开）、会话结束、`/整理记忆` | `search_memory` `remember` `forget` `list_learning_events` | 快速 | 设置 → Tibi 记忆（每条带来源） |

说明：
- 导入时固定的那部分（总结、短语、长难句）由"导入文章"一次跑完并缓存到 `ai_results`；"讲解"只处理你临时问的问题。
- Tibi 主对话通过 `run_skill(skill, task)` 运行技能：pi-durable 为它创建一个由当前任务拥有的子对话，跑完把结果交回；界面上显示为收起的过程卡"Tibi 正在…"，中途可以展开看步骤或取消。
- 用户看到的始终是 Tibi 一个角色；想控制的用户可以在设置里逐项配置技能。

---

## 5. 技能的定义格式：SKILL.md

内置技能和用户 / 社区自定义的技能用同一种格式：一个目录，里面一份 `SKILL.md`，可以带参考资料。格式遵循 [Agent Skills 规范](https://agentskills.io/specification)（与 pi、Claude Code 通用，便于社区分享），Tibi 需要的额外字段放在 `metadata` 里：

```markdown
---
name: scout
description: 按用户的水平、兴趣和正在学的词找适合阅读的英文文章，并说明推荐理由。
allowed-tools: [search_feeds, web_search, fetch_url, estimate_difficulty, list_terms]
metadata:
  title: 找文章            # 界面上显示的动词
  model: fast             # fast / deep，对应设置里的两档模型
  write: ask              # 覆盖全局权限模式（只能收紧）
  schedule: "0 8 * * *"   # 可选：例行任务默认时间；用户可在设置里改时间或关掉
---

你负责给用户挑文章。优先选生词率 2–5% 的文章……
```

- 早先文档里的 `AGENT.md`（智能体）+ `SKILL.md`（提示词技能）两套格式已合并为这一种（2026-10-29 复审）：一个技能既有指令也有工具子集和模型档，没必要再分两层。
- **加载方式**：Tibi Core 把每份 `SKILL.md` 转成一个 pi-durable 扩展（正文 → `sections`，`allowed-tools` → 工具子集），运行时为每次调用创建或复用一个子对话，用 `configure()` 设定模型、工具和指令。启动时只把技能的名称和说明放进 Tibi 主对话的上下文，运行时才加载全文。
- **用户自定义**：放在 `~/Tibi/skills/<name>/` 下；也可以在设置里新建（填名字、说明、指令、勾选能力、模型档，实时预览生成的 `SKILL.md`）。内置技能的指令可以追加，但不能删掉安全规则。
- 社区可以把技能打成包分享（参照 pi packages）。**技能只能使用能力层的工具，不能执行任意代码**，所以分享是安全的。

---

## 6. 运行机制（映射到 pi-durable）

| Tibi 概念 | pi-durable 实现 |
|---|---|
| 一次对话线程（全局线程、某篇文章的线程） | Conversation；线程与文章的绑定存在我们自己的小表里 |
| 一次技能运行（例如导入一篇文章） | 一个 submission 及其 generation / tool 任务 |
| Tibi 主对话运行一项技能 | `run_skill` 工具创建由当前任务拥有的子对话（pi-durable 的 subagent） |
| 导入流水线中并行的几步（总结、短语、长难句） | 子任务（child tasks），`allSettled` 等待 |
| 任务进度抽屉 / 任务中心 | `harness.watchTaskGraph()` 实时任务树 |
| 关掉应用后继续 | 任务每一步都有检查点；重新打开时 `resume()` |
| 定时运行（每日选文、每晚整理记忆、每周洞察） | 带休眠的任务（sleep until），重启后仍然有效 |
| 学习事件触发（读完一篇 → 出题建议） | Core 内事件总线 → 写入对话或创建任务 |
| 权限与审批 | `beforeTool` 钩子：按权限档放行、拦截，或挂起等待界面确认 |
| 撤销 | 写类能力返回撤销信息，记入审计日志（`afterTool` 钩子） |
| 每项技能的花费 | `pi.usage` 文档按模型、按工具累计 → 设置和任务中心展示 |
| 长对话 | 自动压缩（摘要旧内容，原文仍保留） |

---

## 7. 上下文工程

沿用 [`02-ai-assistant.md` §4](./02-ai-assistant.md#4-上下文工程每轮注入什么) 的七个区块，按 pi-durable 的特点重新安排，目的是**让模型提示缓存命中**（DeepSeek 有缓存折扣）：

| 放在哪里 | 内容 | 变化频率 |
|---|---|---|
| 系统提示词片段（sections，按顺序） | 角色与规则 → 用户身份与核心记忆 → 能力清单（当前技能的工具、已配置的服务、权限档） | 很少变；变了只发送变化的部分 |
| 每轮用户消息的前缀 | 学习状态快照、当前界面上下文（页面、正在读的段落、选中的文本、当前卡片）、召回的记忆 | 每轮都变，所以**不放进系统提示词** |
| 工具 | 只给当前技能需要的；其余延迟加载 | 按技能固定 |

---

## 8. 权限、审批与安全

- 三档权限模式不变（每次都问 / 标词自动其余询问 / 全部自动），由 `beforeTool` 统一执行；技能的 `SKILL.md` 可以收紧，不能放宽。
- 需要确认时，对话里或任务中心出现一张**审批卡**（"Tibi 想把《…》保存到书架" → 允许 / 拒绝 / 修改后允许 / 以后这类都自动允许）。
- 所有写操作进审计日志，词汇类写操作和导入都可撤销。
- **没有任意代码执行**：不注册 bash、文件读写这类工具；pi-durable 的代码模式暂不启用（需要时用 QuickJS 沙箱，只能调用能力层工具）。
- 网页抓取只抓用户给的网址或"找文章"在白名单来源里找到的网址；抓到的内容视为数据，不当作指令（防提示注入）。
- API Key 存系统钥匙串，由 Rust 壳在启动 Core 时传入，不写数据库、不写日志。

---

## 9. 用户能看到什么（交互变化）

> ⚠️ 本节的"@ 点名智能体""委派卡""由 XX 生成""设置 → 智能体"已被 **§13（C1–C5）修订**：用户只看到 Tibi 和它的技能。下表保留作历史记录。

| 位置 | 变化 |
|---|---|
| 首页输入框 | "导入 / 问 Tibi / 找文章"三个模式就是三个智能体入口；也可以输入 `@选文 找一篇讲火山的新闻` 直接点名 |
| 任务进度抽屉 | 现在的步骤清单来自任务图；委派出去的子智能体以缩进的子任务显示，可以展开看它的对话 |
| **任务中心**（新增，左栏或 ⌘K 进入） | 正在运行、排队、定时的智能体任务；可暂停、取消、重试；看每一步用了哪个模型、花了多少钱 |
| 设置 → 模型与 Tibi | 新增"智能体"列表：每个智能体的模型档、附加指令、权限、定时开关、本月花费；"新建智能体" |
| 每个 AI 产出 | 小字标注"由 导入 · DeepSeek 生成 · 查看过程"，点开看这次运行的步骤和工具调用 |
| 离线 / 没配模型 | 智能体按钮置灰并说明原因；能力层功能照常可用 |

原型（已做）：
- **首页**：输入 `@` 弹出智能体列表，选中后输入框上方出现点名标签，模式随之切换；点名伴读 / 复习教练 / 洞察 / 记忆管家时，抽屉里显示"Tibi 委派给 XX"的子智能体步骤；导入与选文的抽屉顶部注明由哪个智能体、用哪档模型在做，结果卡片带"由 XX 生成 · 查看过程"；在对话里说"记住…"时出现审批卡。
- **任务中心**（左栏"任务"，带运行中 + 待确认数徽标）：四项概览（运行中、本周完成、本月花费 / 预算、花得最多的智能体）；等你确认（允许 / 拒绝 / 修改后允许 / 以后这类自动允许，含来自 MCP 的请求）；运行中（当前步骤、子智能体、用时、花费、进度条，可暂停、取消）；定时（开关、立即运行）；最近（完成 / 失败 / 已取消，失败可从断点重试）。点任意任务打开详情：状态、触发方式、模型、用量，嵌套的步骤树（子智能体与并行子任务缩进显示），以及过程（用户消息、模型回复、工具调用与结果）。
- **设置**：模型改为"快速 / 深入"两档，可选用 ChatGPT / Claude 账号登录；新增"智能体"分组（每个智能体的模型档、附加指令、能用的能力、写入权限、定时、本月花费、恢复默认），"新建智能体"表单实时生成 `AGENT.md`；每月预算与单个任务上限。
- **统计页**：洞察卡片注明"由 洞察 生成 · DeepSeek 深入"，可查看过程、重新生成。

---

## 10. 外部 AI 工具（对 A2、A6 的影响）

- **MCP Server（A6）**：不变，并且更自然——就在 Tibi Core 里，暴露能力层。用户在 Codex / Claude Code 里说"把我今天的生词出 10 道题"即可。
- **ChatGPT / Claude 账号登录**：pi-ai 支持用 ChatGPT（Codex）、Claude、GitHub Copilot 账号登录，内置智能体可以直接用用户已有的订阅，不必经 ACP。**需要先核对各家服务条款是否允许第三方应用这样使用**，所以只作为可选项。
- **ACP 客户端（A2）**：价值下降——它原本是为了"用用户已有的订阅"和"接入本地 harness"。建议 v1 先不做 ACP，用户想用 Codex / Claude Code 时走 MCP 反向接入；以后有需要再加。

---

## 11. 风险与验证

| 风险 | 应对 |
|---|---|
| `pi-durable` 标注实验性，API 会变 | 锁定版本；Core 内用一层自己的接口（`TibiKernel`：openConversation / submit / delegate / schedule / watchTasks）隔离；升级前跑我们的集成测试；**退路**：换成稳定的 `pi-agent-core` + 自己做持久化，接口不变 |
| sidecar 体积和启动时间 | 先测 Node SEA 与 Bun 两种打包；Core 随应用启动，界面先显示本地数据 |
| Bun 下 SQLite 驱动兼容性 | pi-durable 的 SQLite 核心支持自定义异步数据库外壳，可接 `bun:sqlite` 或 `better-sqlite3` |
| DeepSeek 的工具调用稳定性 | 每个智能体工具少而精；能力返回结构化结果；关键流水线（导入）用固定步骤 + 模型只做其中的生成环节 |
| 后台任务花费失控 | 月度预算与单次上限；例行任务默认只开最便宜的"整理记忆"；花费按技能在设置页和任务中心可见 |
| 多个内部 agent 让用户困惑 | 用户只看到 Tibi 和它的技能（§13）；进阶用户才去配置 |

**第一步建议做一个技术验证（spike）**，一周内回答：
1. Tibi Core（Node SEA / Bun）+ pi-durable + `bun:sqlite`（或 better-sqlite3）以 `pi_` 前缀与领域表共用 `app.db`，崩溃后能续跑；
2. pi-ai 调 DeepSeek 的工具调用与流式输出；
3. 导入流水线做成 durable 任务（含并行子任务），任务图驱动进度抽屉；
4. `beforeTool` 挂起等待界面审批的做法；
5. Tauri sidecar 打包体积、冷启动时间、Windows / macOS / Linux 三平台可运行。

---

## 12. 决策

| # | 问题 | 结论 | 状态 |
|---|---|---|---|
| **B1** | harness 底座 | `pi-ai` + `pi-durable`，外包一层 `TibiKernel`；`pi-agent-core` 作为退路 | ✅ 已确认（2026-10-29） |
| **B2** | 进程架构 | 新增 Tibi Core sidecar，独占 `app.db`；界面不再直连数据库（改动原 §4 架构与数据访问方式） | ✅ 已确认（2026-10-29） |
| **B3** | 智能体清单 | Tibi（主）+ 导入、选文、伴读、复习教练、洞察、记忆管家 6 个专职智能体 → 复审后统一称为 6 项技能：导入文章、找文章、讲解、出题与批改、学习洞察、整理记忆 | ✅ 已确认（2026-10-29） |
| **B4** | 用户如何接触智能体 | 默认只感知 Tibi；@ 点名、任务中心、设置里的智能体配置面向进阶用户 | ✅ 已确认（2026-10-29） | → 已被 C1–C5 细化：界面统一为"Tibi 的技能"，不出现智能体概念
| **B5** | 自定义智能体 | 支持 `AGENT.md` + 技能 → 复审后合并为一种 `SKILL.md`（Agent Skills 格式）；只能用能力层工具，不能执行代码 | ✅ 已确认（2026-10-29） |
| **B6** | ACP 客户端（调整 A2） | v1 不做；外部 AI 工具走 MCP 反向接入；pi-ai 账号登录作为可选项（先核对条款） | ✅ 已确认（2026-10-29） |
| **B7** | 定时任务 | 支持（每日选文、每晚整理记忆、每周洞察），默认只开"整理记忆" | ✅ 已确认（2026-10-29） |
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

**内部仍是多智能体（本文 §3–§8 不变），用户只看到 Tibi 一个角色和它会做的事。**

| 位置 | 现在 | 改为 |
|---|---|---|
| 用户可见的概念 | 智能体、子智能体、委派 | 不出现这些词；Tibi 的能力叫**技能**，用动词命名：导入文章、找文章、讲解、出题、批改、写学习洞察、整理记忆 |
| 首页输入框 | 三个模式 + `@` 点名 7 个智能体 | 保留三个模式（导入 / 问 Tibi / 找文章）；去掉 `@`；问 Tibi 时由 Tibi 自动判断该用哪项技能；输入 `/` 可选动作（导入、找文章、出题、写周报…），列表是动词不是角色 |
| 告诉用户能做什么 | @ 列表 | 输入框下的建议胶囊随场景变化；占位文字轮换示例；第一次使用时一张"Tibi 能帮你做什么"的卡片 |
| 处理过程 | "Lexi 委派给 伴读 · 子智能体 · DeepSeek 快速" | "Tibi 正在讲解这句话"，下面是步骤，默认收起，点开才看工具调用 |
| 来源标注 | "由 导入 生成 · DeepSeek 快速" | "Tibi 生成 · 查看过程"；模型、用时、花费放进"查看过程"里 |
| 审批卡 | "记忆管家想记住…" | "Tibi 想记住…"（用到的技能写在灰字里） |
| 任务中心 | 按智能体显示头像和名字 | 统一 Tibi 头像，标题用动作（导入《…》、找文章、整理记忆）；筛选用技能；"花得最多"改成按技能 |
| 设置 | "智能体"分组，可新建智能体 | 改名"Tibi 的技能"（默认收起）：每项技能的模型档、附加指令、写入权限；定时改叫**例行任务**（每天早上找 3 篇文章、每晚整理记忆、每周写学习周报）；"新建技能"保留给进阶用户 |
| 主动推荐例行任务 | 设置里手动开 | 用户连续几次手动找文章后，Tibi 在自然断点问一句"要不要每天早上帮你找 3 篇？"（原型：同一次使用里第 2 次找完文章后，在结果下方出现建议卡：每天早上推荐 / 以后再说 / 不用了；"不用了"后不再问） |

**保留不变**：Tibi 的人设与动画状态、能力层、权限与审批、任务中心本身、预算、MCP。技能文件统一为 `SKILL.md`（§5）。

### 13.4 决策

| # | 问题 | 结论 | 状态 |
|---|---|---|---|
| **C1** | 用户界面不再出现"智能体 / 子智能体 / 委派"，改称 Tibi 的"技能" | 是 | ✅ 已确认（2026-10-29） |
| **C2** | 去掉 `@` 点名，改为 `/` 动作列表 + 自动判断 | 是 | ✅ 已确认（2026-10-29） |
| **C3** | 来源标注、审批卡、任务中心统一用 Tibi 的名字和头像，技能名作为灰字补充 | 是 | ✅ 已确认（2026-10-29） |
| **C4** | 设置"智能体"改为"Tibi 的技能"，定时改叫"例行任务" | 是 | ✅ 已确认（2026-10-29） |
| **C5** | 过程信息默认收起，模型 / 花费只在"查看过程"和任务中心里出现 | 是 | ✅ 已确认（2026-10-29） |

原型（已改）：首页 `/` 动作列表、自动判断技能、收起的过程卡、"Tibi · 技能 · 查看过程"、首次使用卡片；任务中心统一 Tibi 头像、按技能显示、"例行任务"；设置"Tibi 的技能"+"例行任务"+"新建技能"；统计页洞察来源；⌘K 搜索的设置项。

## 参考

- 用户可见层调研（§13）：[Ghostreader 文档](https://docs.readwise.io/reader/guides/ghostreader/overview)、[Global Ghostreader](https://docs.readwise.io/reader/guides/ghostreader/global)、[Duolingo Max](https://blog.duolingo.com/duolingo-max)、["So many different Copilots — confusing, unproductive"（Microsoft 社区）](https://techcommunity.microsoft.com/discussions/microsoft365copilot/so-many-different-copilots---confusing-unproductive/4426480)、[Notion Personal Agent 评测](https://eesel.ai/blog/notion-personal-agent)、[Why Johnny Can't Use Agents（arXiv 2509.14528）](https://arxiv.org/html/2509.14528v1)

- pi 源码与文档：[earendil-works/pi（原 badlogic/pi-mono）](https://github.com/badlogic/pi-mono)；npm 包 `@earendil-works/pi-ai`、`pi-agent-core`、`pi-durable`、`pi-coding-agent`（1.4.0）的 README 与 `docs/`（sdk、extensions、skills、mcp、rpc、how-pi-works）
- 作者对设计取舍的说明：[What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- [pi-agent-core README](https://cdn.jsdelivr.net/npm/@mariozechner/pi-agent-core/README.md)、[pi-ai README](https://cdn.jsdelivr.net/npm/@mariozechner/pi-ai/README.md)
- pi 的 ACP 适配器（社区）：[svkozak/pi-acp 及其分支](https://github.com/DxTa/pi-acp)
- [Agent Skills 规范](https://agentskills.io/specification)
