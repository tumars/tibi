# AI 助手（Agent Harness）设计 v0.1（讨论稿）

> 状态：**决策已确认**（见 §9），细节随实现迭代。
> **2026-10-29 更新**：harness 底座改用 pi（`pi-ai` + `pi-durable`），助手扩展为"Tibi + 6 个专职智能体"，运行在 Tibi Core 进程里；v1 不做 ACP（A2 调整）。架构、智能体清单与定义格式以 [`05-agent-architecture.md`](./05-agent-architecture.md) 为准；本文继续负责上下文、记忆、工具清单、权限与交互。§2、§3 中关于 ACP / Codex app-server 的内容保留作背景，不在 v1 范围。
> 背景：Tibi 是 AI 工具，使用过程中常驻一个 AI 助手。它不只是"问答框"，而是具备 harness 常见能力的学习伙伴：知道**你是谁**、知道**自己能做什么**、记得**你的学习历史**，并能**调用应用能力**（查词、标词、出题、推荐文章）。
> 模型来源不限于 OpenAI 兼容接口（DeepSeek 默认），也可以用 ChatGPT / Claude 账号登录；反过来，用户本地的 Codex、Claude Code 等可以通过 MCP 使用 Tibi 的能力。

---

## 1. 设计目标

1. **常驻、懂上下文**：任何界面都能唤起；自动知道你正在读哪篇文章、选中了哪句话、在复习哪张卡。
2. **有身份认知**：知道用户的水平、目标、兴趣、偏好；知道自己当前可用的能力（配置了哪些模型/TTS、有哪些工具）。
3. **有记忆**：跨会话记住学习历史与对用户的观察，并且**记忆对用户透明、可编辑、可删除**。
4. **能行动**：通过工具读写学习数据（在用户授权范围内）。
5. **模型可替换**：换模型、换档位不影响"身份 + 记忆 + 工具"；外部 AI 工具经 MCP 使用的也是同一套能力。

---

## 2. 总体架构（2026-10-29 更新）

核心思想：**把"学习能力"做成标准化的工具层（并以 MCP 协议对外暴露），模型只是可替换的"大脑"；Tibi 的每项技能是一份 `SKILL.md`，运行时各自一个子对话。**

```
┌────────────────────────────── Tibi Core ──────────────────────────────┐
│  入口：首页大输入框 / ⌘K"问 Tibi" / 阅读器、生词本、复习页的 Tibi 面板 / 例行任务 / MCP │
│        │                                                                │
│        ▼                                                                │
│  Tibi 主对话（pi-durable Conversation）                                   │
│   · 系统提示词片段：角色与规则 → 用户身份与核心记忆 → 能力清单              │
│   · 每轮前缀：学习状态快照 · 当前界面上下文 · 召回的记忆                     │
│   · 自动判断该用哪项技能 → 运行技能（子对话，带自己的指令与工具子集）         │
│        │ 工具调用（beforeTool 权限闸门 → 审批卡 / 自动；afterTool 审计与撤销）  │
│        ▼                                                                │
│  能力层：lookup_word · get_document · mark_term · create_quiz · remember … │
│   同一份定义 → 技能可用的工具 / MCP Server（给 Codex、Claude Code 等）/ 界面直接调用 │
│        │                                                                │
│        ▼                                                                │
│  领域服务 + app.db（领域表 + pi_ 前缀的对话 / 任务表）/ dict.db             │
└───────────────────────────────────────────────────────────────────────┘
   模型：pi-ai → DeepSeek（默认）/ 任意 OpenAI 兼容接口 / ChatGPT、Claude 账号登录（可选）
```

> 原 v0.1 的"AgentBackend 接口 + ACP 客户端 + Codex app-server"方案已由 B6 取消（v1 不接入本地 harness，外部 AI 工具改为通过 MCP 使用 Tibi），相关调研保留在 [`03-tech-survey.md` §8](../research/03-tech-survey.md#8-agent-harness-接入与记忆)。

---

## 3. 模型与运行时

- **模型调用**：`pi-ai`。两档模型（快速 / 深入）在设置里各指向一个 provider + 模型；每项技能声明默认用哪一档，首页输入框的档位只覆盖这一次。
- **运行时**：`pi-durable`。对话、工具调用、任务都先写入存储再显示；崩溃后续跑；技能运行是由当前任务拥有的子对话。详见 [`05-agent-architecture.md` §6](./05-agent-architecture.md#6-运行机制映射到-pi-durable)。
- **导入流水线等批量任务**走同一套运行时，但固定用"快速"档（A1）。
- **离线 / 未配置模型**：能力层照常可用，技能跳过并在界面标出"可稍后补做"。

## 4. 上下文工程（每轮注入什么）

每次对话请求，Context Builder 组装以下内容（按优先级与 token 预算裁剪）：

| 区块 | 内容 | 来源 | 大小 |
|---|---|---|---|
| **① 角色与规则** | 助手人设（藏狐 Tibi：英语学习伙伴，淡定、幽默、鼓励为主）、回答风格、教学原则（引导而非直接给答案、用 i+1 的英文） | 内置 prompt + 用户自定义指令 | 固定 |
| **② 用户身份（核心记忆）** | 姓名/称呼、水平、估算词汇量、目标、兴趣领域、偏好（释义语言、讲解详细度） | `user_profile` + 核心记忆 | 小，常驻 |
| **③ 能力清单** | 当前技能可用的工具、已配置的服务（是否有视觉模型、TTS 引擎）、权限模式 | 运行时生成 | 小，常驻 |
| **④ 学习状态快照** | 已知词数、学习中词数、今日复习完成情况、最近读过的 3 篇文章、当前薄弱词 Top N | 数据库实时聚合 | 小，常驻 |
| **⑤ 当前界面上下文** | 所在页面；正在读的文章标题+段落；选中的文本；当前词卡/复习卡 | UI 状态 | 视情况 |
| **⑥ 召回记忆** | 与本轮问题相关的记忆条目、历史学习日志摘要 | 记忆检索 | 预算内 |
| **⑦ 会话历史** | 当前会话消息（过长时由 pi-durable 自动压缩） | pi-durable 对话 | 预算内 |

> 原则：**结构化学习数据不复制成"记忆文本"**——词汇状态、复习记录等以数据库为唯一事实来源，通过快照（④）和工具实时查询；"记忆"只存数据库表达不了的东西（观察、偏好、事件摘要）。

---

## 5. 记忆系统

参考 Letta（分层记忆：核心常驻 / 可检索归档）与 Mem0（user 维度的 add/search、记忆整合）的设计，按认知科学的分类：

| 记忆类型 | 存什么 | 例子 | 写入方式 | 读取方式 |
|---|---|---|---|---|
| **身份/画像**（核心，常驻） | 稳定的用户事实与偏好 | "目标是雅思 7 分"、"喜欢读科幻小说和 Rust 技术文档"、"希望释义用中文" | 引导流程、设置页、agent 调用 `remember`（需确认） | 每轮注入 |
| **语义记忆**（观察） | agent 对用户学习特点的观察 | "经常混淆 affect / effect"、"对虚拟语气掌握薄弱"、"读新闻时生词集中在政治类" | agent 调用 `remember`；定期整合任务自动提炼 | 检索召回 |
| **情景记忆**（事件） | 学习事件与会话的摘要 | "10/28 读完《Dune》第 3 章，标记 14 个生词，就 X 句问了语法" | 会话结束/每日自动生成学习日志 | 检索召回 + 按时间查询 |
| **程序性记忆**（指令） | 用户对助手行为的要求 | "跟我用英文对话"、"解释时少用语法术语" | 用户显式设置或对话中确认 | 注入 ① |

### 5.1 记忆生命周期

```
对话 / 学习事件 ──► 原始日志（pi-durable 对话记录、learning_events）
                          │  会话结束 / 每日一次（后台，低优先级，用便宜模型）
                          ▼
                    整合（Consolidation）：
                    · 生成情景摘要（学习日志）
                    · 提炼新的语义观察；与已有记忆去重、合并、更新置信度
                    · 过期/被推翻的记忆标记失效
                          ▼
                     memories 表（带来源、置信度、时间）
```

### 5.2 检索

- v1：SQLite **FTS5 关键词检索 + 时间衰减 + 类型过滤**，足够应对单用户、千级记忆规模。
- 后续：可选嵌入向量（`sqlite-vec` 扩展 + 本地/远程 embedding 模型）做语义检索。

### 5.3 用户控制（必须）

- 设置中有 **「Tibi 记忆」** 分组：查看、编辑、删除每条记忆；看到每条记忆的来源（哪次对话、哪篇文章）。
- 可一键暂停记忆、清空记忆。
- agent 写入身份类记忆时在对话中提示"我记住了：…"，可撤销。

---

## 6. 工具（Learning Tools）

一份定义（名称、描述、TypeBox 参数、权限级别、是否可撤销），技能直接用，MCP Server 对外暴露。

| 分类 | 工具 | 权限 |
|---|---|---|
| 上下文 | `get_context`（当前界面上下文 + 学习快照，供经 MCP 接入的外部 AI 工具使用） | 读 |
| 词典 | `lookup_word`（本地词典 + 词形 + 词频/考试标签）、`compare_words` | 读 |
| 文章 | `list_documents`、`get_document`（按章节/段落取正文）、`search_documents` | 读 |
| 文章 | `import_document`（文本/网址） | 写·需确认 |
| 词汇 | `get_term`、`list_terms`（按状态/薄弱度筛选）、`get_term_contexts` | 读 |
| 词汇 | `mark_term`（设状态）、`add_to_wordbook`、`add_phrase` | 写·可设自动 |
| 复习 | `get_review_stats`、`create_quiz`（生成临时练习，不影响 FSRS 排期） | 读 |
| 统计 | `get_learning_stats`（按日/周） | 读 |
| 记忆 | `search_memory`、`remember`、`forget` | remember/forget 需确认 |
| 音频 | `speak`（朗读文本） | 读 |
| 技能 | `run_skill`（Tibi 主对话运行一项技能，内部创建子对话）、`tool_search`（按需加载不常用的工具） | 读 |

> 导入、找文章所需的能力（`fetch_url`、`extract_pdf`、`ocr_image`、`segment_document`、`annotate_terms`、`estimate_difficulty`、`save_document`、`search_feeds`、`web_search`）见 05 §4.2。每项技能只拿自己那组工具。
>
> 每个工具的参数、返回值与权限级别见 [06 接口定义 §5](06-interface.md#5-能力层技能工具--mcp-工具--界面直接调用)；06 里另补了 `save_ai_result`（模型产出入缓存）、`set_context_meaning`（语境释义写回）、`record_review`（对话里完成的练习记入 FSRS）、`list_learning_events`、`tag_document`，MCP 专有的 `tibi_task_status` 与写工具的 `pending_approval` 返回约定见 06 §6。

**权限模式**（设置中选择，类似编程 harness 的审批模式）：
- **谨慎**：所有写操作需确认。
- **默认**：词汇标记类写操作自动执行（可撤销），导入/记忆写入需确认。
- **放手**：全部自动（仍保留操作日志与撤销）。

工具调用的完整过程由 pi-durable 记录（任务中心可查看）；写操作另记 `agent_audit` 审计表，支持撤销。需要确认时出现审批卡：允许 / 拒绝 / 修改后允许 / 以后这类都自动允许。

---

## 7. 交互形态

| 入口 | 说明 |
|---|---|
| **首页大输入框** | 导入 / 问 Tibi / 找文章三个模式；输入 `/` 选技能；问 Tibi 时自动判断用哪项技能；发送后主区切换为独立对话页（D9） |
| **⌘K 搜索** | 最后一行永远是"问 Tibi：…"，`⌘↵` 直接发送（取代早期方案里的 ⌘J 浮层） |
| **Tibi 面板** | 阅读器右侧抽屉的「Tibi」页签（附带正在读的文章与选中内容）；生词本、复习页为右侧抽屉 |
| **内联动作** | 选中文本 → "问 Tibi"、"解析这句"；词卡 → "更多解释"、"和 XX 有什么区别" |
| **复习页** | 未显示答案时只给提示；显示后可问"为什么是这个意思""再给两个例句" |
| **轻度主动**（A5） | 只在自然断点：读完一篇 → 提议几道理解题；复习结束 → 完成页；连续几次手动找文章 → 建议开启例行任务。**不弹窗、不打断阅读** |

会话组织：按"线程"保存，可关联到某篇文章（在该文章中打开 Tibi 时自动续上该文章的线程），也有不绑定文章的全局线程（`thread_links`）。

---

## 8. 技能（SKILL.md）

Tibi 的每项能力扩展都是一个技能目录，里面一份 `SKILL.md`，格式遵循 [Agent Skills 规范](https://agentskills.io/specification)（与 pi、Claude Code 等通用），Tibi 需要的额外字段放在 `metadata` 里：

```markdown
---
name: scout
description: 按用户的水平、兴趣和正在学的词找适合阅读的英文文章，并说明推荐理由。
allowed-tools: [search_feeds, web_search, fetch_url, estimate_difficulty, list_terms]
metadata:
  title: 找文章            # 界面上显示的动词
  model: fast             # fast / deep
  write: ask              # 覆盖全局权限模式（只能收紧）
  schedule: "0 8 * * *"   # 可选：例行任务默认时间，用户可改可关
---

你负责给用户挑文章。优先选生词率 2–5% 的文章……
```

- **内置技能**：导入文章、找文章、讲解、出题与批改、学习洞察、整理记忆，随应用分发，用户可追加指令、换模型档，不能删安全规则。
- **自定义技能**：设置里"新建技能"生成到 `~/Tibi/skills/<name>/SKILL.md`，也可以手写或从社区安装；只能使用能力层的工具，不能执行任意代码。
- **运行方式**：Tibi Core 把每份 `SKILL.md` 转成一个 pi-durable 扩展（正文 → 提示词片段，`allowed-tools` → 工具子集），每次运行创建或复用一个子对话。详见 05 §5–§6。
- 导入流水线中的 AI 任务（总结、短语抽取、学习建议）就是"导入文章"技能的一部分。

---

## 9. 决策

| # | 问题 | 结论 | 状态 |
|---|---|---|---|
| **A1** | 默认后端是内置 Agent（DeepSeek），外部 harness 作为"高级"选项？ | 是。导入流水线等批量任务固定走内置后端（成本、速度可控）；对话助手可切换 | ✅ 已确认（2026-10-29） |
| **A2** | 外部 harness 首批支持范围？ | ~~只做 ACP 客户端~~ → **v1 不做 ACP**：外部 AI 工具通过 MCP 使用 Tibi；想用已有订阅可选 ChatGPT / Claude 账号登录（pi-ai），见 05 §10 | ✅ 已调整（2026-10-29，B6） |
| **A3** | 默认权限模式？ | "默认"档：标词自动、导入与记忆需确认 | ✅ 已确认（2026-10-29） |
| **A4** | 记忆检索 v1 是否引入向量？ | 不引入，FSRS 之外先用 FTS5，留接口 | ✅ 已确认（2026-10-29） |
| **A5** | 助手主动性的边界？ | 只在"自然断点"（读完一篇、打开应用、复习结束）轻提示 | ✅ 已确认（2026-10-29） |
| **A6** | 是否提供反向 MCP Server（在 Codex/Claude Code 里用 Tibi）？ | 做，成本低、开发者用户喜欢 | ✅ 已确认（2026-10-29） |
| **A7** | 助手人设是否可自定义（名字、语气、对话语言）？ | 可自定义名字与对话语言，默认中英混合；默认名字 **Tibi**——助手就是吉祥物藏狐（2026-10-29） | ✅ 已确认（2026-10-29） |

## 参考

- [Agent Client Protocol (Zed)](https://zed.dev/acp)、[ACP Registry](https://zed.dev/blog/acp-registry)、[ACP vs MCP](https://mcp.directory/blog/agent-client-protocol-vs-mcp-2026)
- [Unlocking the Codex harness (OpenAI)](https://openai.com/index/unlocking-the-codex-harness)、[Codex app-server 文档](https://developers.openai.com/pt-BR/docs/app-server)、[Codex app-server JSON-RPC 集成实践](https://codex.danielvaughan.com/2026/03/28/codex-app-server-json-rpc-protocol/)
- [Mem0：构建长期记忆 agent](https://mem0.ai/blog/how-to-create-ai-agents-with-long-term-memory)、[Agent 记忆：情景/语义/程序性](https://dev.to/dublecc/how-ai-agent-memory-works-in-2026-context-episodic-semantic-and-procedural-l3f)
