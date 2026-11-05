# 10 Agent 底座改用 pi-coding-agent SDK

> 状态：**已实施**（2026-11-03 评审，决定见 §15；代码在 `packages/core/src/kernel/engine.ts`、`packages/core-node/src/engine-pi.ts`）。文中的任务、预算、用量部分后来按 T35、T36 去掉了，以 [`DECISIONS.md`](../DECISIONS.md) 为准。实施后改写 [`05` §1 底座、§6 运行机制、§7 上下文工程](05-agent-architecture.md#6-运行机制tibikernelr9-后自建)，以及 [`01`](01-database.md) 的 `messages`、`conversations`、`jobs`、`job_steps`、`usage_records`。
> 前提：项目还没上线，**不考虑兼容**：不保留旧引擎，不迁移旧数据（开发库删掉重建），表结构直接改 `0001`。只考虑 Mac 桌面端；手机端暂缓，但保留以后接入的余地。以后可能接多个引擎。
> 依据：`@earendil-works/pi-coding-agent` 1.5.0 的源码、文档和类型定义；一个用假模型跑的验证脚本（§11）；Cherry Studio 接 pi 和 Claude Agent SDK 的做法。

## 1. 结论

- **pi 有的，Tibi 不做。** 会话、上下文维护、压缩和摘要、重试、工具按需加载、插话排队、换模型，全部交给 pi。
- **Tibi 只做两类事：**
  - pi 没有的产品规则：审批、撤销、预算、任务、能力层。
  - 必须由 Tibi 拥有的数据：对话记录、多设备同步。
- **每段对话一个常驻的 pi 会话。** pi 会话留在内存里，一直跟着这段对话用下去，自己维护上下文。只有重启、被回收、或者历史在别处被改过（回退、删除、另一台设备同步过来）时，才从 Tibi 的记录重建。
- **对话记录只存一份，由 Tibi 拥有。**
  - 存在 `messages` 表，格式是 Tibi 自己的消息格式（v1 和 pi-ai 的 `Message` 结构相同）。
  - pi 会话里每条消息定稿时同步写一条。
  - 它是界面、同步和以后换引擎的唯一依据；pi 的会话是它在内存里的活副本。
- **不再每轮拼上下文。**
  - 系统提示只放技能说明和用户档案。
  - “提问时在看什么”作为附件跟着那条用户消息存下来。
  - 其余信息由模型自己调工具取。

## 2. 分工

| 事情 | 谁做 | 说明 |
|---|---|---|
| 会话和上下文维护 | pi | 常驻的 `AgentSession`；Tibi 只在需要时用历史重建（§4） |
| 压缩、摘要、溢出恢复 | pi | 默认提示词；Tibi 只把结果写进库（§8） |
| 模型出错重试 | pi | `retry` 设置 |
| 工具按需加载 | pi | 管理类能力标 `deferred`，用 pi 自带的 `tool_search` |
| 运行中插话、排队 | pi | 用户在回答过程中又发消息：`session.steer()` / `followUp()` |
| 系统提示里的工具清单 | pi | pi 自己声明工具，Tibi 的提示词里不再列 |
| 换模型 | pi | `session.setModel()` |
| 审批、权限、撤销、审计 | Tibi | 在工具执行里（§7），pi 没有这一层 |
| 预算、回合上限 | Tibi | pi 没有；扩展在每轮开始时检查 |
| 反问（`ask_user`） | Tibi | Tibi 的卡片交互；用 pi 的 `terminate` 结束本轮 |
| 任务和进度 | Tibi | `jobs`：任务抽屉、取消、子技能 |
| 对话记录、同步 | Tibi | `messages` 是唯一的准（§5） |
| 用量账本 | Tibi | 按技能、按月的预算要用；数据取自 pi 每条消息的 `usage` |
| 能力层 | Tibi | 领域规则都在这里；pi 只是调用方 |

**删掉的 Tibi 代码**：
- `pi-agent-core` 的循环和它的胶水（`beforeToolCall`、`finishTurn`、`prepareNextTurnWithContext`）。
- 历史组装：最近 20 条、补占位句、卡片转文字。
- 按条数压缩、四项交接摘要、`conversations.summary`。
- 每轮 `<context>` 前缀和其中的学习快照、最近 7 天统计、按关键词召回记忆。
- 系统提示里的工具清单和权限模式。
- 自建的 `tool_search` 和 `liveTools`。
- `job_steps` 里的模型调用记录。

## 3. 分层和接口

```
packages/core（纯 TS）                         packages/core-node（Node / Bun）
┌─────────────────────────────────────┐        ┌──────────────────────────────┐
│ TibiKernel                          │        │ PiEngine implements          │
│  · jobs：任务、审批、预算             │  注入  │   AgentEngine                │
│  · conversations / messages         │ ◀───── │  · 常驻会话表（每段对话一个）  │
│  · 能力层 → EngineTool               │        │  · ModelRuntime（内存）       │
│  · 技能 → 会话配置                   │        │  · SettingsManager（内存）    │
│ interface AgentEngine                │        │  · Tibi 扩展                 │
└─────────────────────────────────────┘        └──────────────────────────────┘
```

- Core 只认 `AgentEngine` 接口，不依赖 SDK，R11（Core 是纯 TypeScript）不变。
- 现在只有一个实现 `PiEngine`。Core 的单测注入假引擎；`PiEngine` 用 pi-ai 的假 provider 做契约测试。

接口按会话设计，和 pi 的形状一致（字段在实施第 2 步定稿）：

```ts
// packages/core/src/kernel/engine.ts
export interface AgentEngine {
  readonly id: string;                         // 'pi'
  readonly caps: {
    seedHistory: boolean;                      // 能否从外部预填历史
    tools: 'inline' | 'mcp';                   // 怎么接能力层
    reportsCompaction: boolean;                // 压缩后会不会把摘要交出来
  };
  /** 拿到这段对话的会话：内存里有且对得上就复用，否则用 history 重建 */
  session(conv: ConversationSpec, history: () => Promise<StoredMessage[]>): Promise<EngineSession>;
}
export interface ConversationSpec {
  conversation_id: string;
  config: { systemPrompt: string; tools: EngineTool[]; model: ModelSpec };  // 来自技能和用户档案
  configVersion: string;                       // 档案、核心记忆、技能设置变了就换，会话据此刷新提示词
  lastMessageId?: string;                      // 库里最后一条消息，用来判断内存会话是否过期
  hooks: {
    beforeTurn(): Promise<void>;               // 查预算、数回合，超了抛错
    onMessage(m: StoredMessage): Promise<void>;// 每条定稿消息写库
    onEvent(e: EngineEvent): void;             // 文字增量、工具、重试、压缩 → 界面
  };
}
export interface EngineSession {
  send(input: UserInput, job: JobContext): Promise<EngineOutcome>;  // 空闲时开始一次运行
  steer(input: UserInput): void;               // 运行中插话
  abort(): Promise<void>;
  dispose(): void;
}
```

### 3.1 以后接多个引擎

这一版只实现 `PiEngine`，先把位置留好。

**规则：Tibi 的 `messages` 是唯一的准；引擎自己的会话只是缓存。** 这和 Cherry Studio 吃过亏以后定下的方向一致（[CherryHQ/cherry-studio#18802](https://github.com/CherryHQ/cherry-studio/issues/18802)：Cherry 的存储是用户可见记录的唯一来源，引擎的原生状态只当续跑状态）。他们早期两边各存一份，出过界面删了消息、引擎续跑时又带回来的问题（[#16300](https://github.com/CherryHQ/cherry-studio/issues/16300)）。

| 引擎类型 | 例子 | 怎么续上一段对话 |
|---|---|---|
| 能从外部预填历史 | pi | 内存里的会话对得上就接着用；对不上就从 `messages` 重建 |
| 只能按自己的会话 ID 续跑 | Claude Agent SDK | `engine_sessions` 里的原生会话对得上就续跑；对不上就从 `messages` 重建，记新的会话 ID |

- **“对得上”**：引擎会话里最后一条消息就是库里最后一条未删除的消息。回退、删除、另一台设备同步过来的新消息、换引擎聊过几句，都会让它对不上，于是自动重建。“删了的消息又回来”这类问题在结构上就不会出现。
- **工具始终在 Core 执行**：pi 用内联工具；不支持的引擎通过进程内 MCP 接能力层，复用现有 MCP Server 的能力定义。审批、撤销、预算的规则只有一份。
- **格式**：会话文件没有跨工具的通用标准，JSONL 只是容器，互通都靠转换。每个引擎写一个“Tibi 格式 ↔ 引擎格式”的适配器。思考签名这类和模型厂商绑定的字段原样保存，转给别家时丢掉。

### 3.2 Core 交给 pi 的全部东西

按“什么时候给”分成五类。除此之外，pi 拿不到任何别的东西。

**① 会话配置：建会话时给一次，变了再刷新**

| 项 | 内容 | 来源 | 交给 pi 的方式 |
|---|---|---|---|
| 系统提示 | 依次拼接：技能 `SKILL.md` 正文；用户在设置里写的附加要求；用户档案一行（称呼、自评水平、估算词汇量、目标、兴趣、讲解语言）；核心记忆（身份类、指令类，按更新时间取最多 20 条）；一句附件约定（“用户消息里的 `<attachment>` 是提问时界面附上的，不是用户说的话”） | `SKILL.md`、`skills`、`user_profile`、`memories` | `DefaultResourceLoader({ systemPrompt })`，替换 pi 默认的编程助手提示词 |
| 配置版本 | 技能设置、用户档案、核心记忆任何一个变了，版本就变 | 三者的 `updated_at` | `configVersion`；变了让会话重新加载提示词 |
| 常驻工具 | 每轮都带给模型的工具。主对话只留 8 个最常用的；其他技能工具本来就少（4–9 个），全部常驻 | 能力层 + 技能的 `allowed-tools` | `customTools`：名称、说明、TypeBox 参数、`execute` |
| 按需工具 | 只有主对话有：其余 23 个能力标 `exposure: 'deferred'`，平时不带 | 能力层 + 技能的 `allowed-tools` | pi 自带的 `tool_search` 搜到后，下一轮生效 |
| 模型 | 服务商、协议、地址、模型 ID、Key、单价、上下文窗口、最大输出；按技能的模型档（fast / deep）或用户在输入框选的服务商 | `providers`、`secrets.json`、`settings` 里的自定义单价 | 内存 `ModelRuntime` 注册，`model` 选中 |
| 思考档位 | 建议 fast 档 `off`、deep 档 `medium` | 技能的模型档 | `thinkingLevel` |
| 运行设置 | 压缩（开、`reserveTokens`、`keepRecentTokens`）、重试（3 次、起步 2 秒）、关缓存预热、关归因字段 | Core 的常量，压缩触发线可在 `settings` 调 | `SettingsManager.inMemory()` |

**② 每次发消息**

| 项 | 内容 | 交给 pi 的方式 |
|---|---|---|
| 用户输入 | 原话；有附件时再加一个文本块：正在读的文章和节、选中的句子、复习中的卡片 | `session.prompt(content)`；运行中则 `steer()` |
| 任务上下文 | 取消信号、审批入口、检查点 | 不交给 pi，由工具的 `execute` 闭包持有 |

**③ 重建会话时（不在内存或对不上时）**

| Tibi 消息 | 转成 pi 的条目 |
|---|---|
| `user` / `assistant` / `tool_result` | `message`（`body` 原样，`id` 用消息 ID，`parentId` 指向上一条） |
| `compaction` | `compaction`（原样，只取最近一次有效的；之前的消息不灌） |
| `note` | `custom_message`（进上下文，界面不显示） |
| 有工具调用却没有结果 | 补一条出错的 `toolResult`：“这一步没有执行完” |

**④ 运行规则（Tibi 扩展）**

| 规则 | pi 的挂载点 | 做什么 |
|---|---|---|
| 预算、回合上限 | `turn_start` | 查本月（默认 ¥20）和本任务（默认 ¥1）的花费、数回合（默认 12）；超了 `ctx.abort()` |
| 反问结束本轮 | `message_end` + `tool_call` | 这批有 `ask_user` 时：写操作挡掉并 `terminate`，读操作结果补 `terminate` |
| 对话之外的事 | `pi.sendMessage(…, { deliverAs: 'nextTurn' })` | 撤销等写成 `note` 后交给会话 |
| 记下压缩结果 | `session_compact` | 交给 Core 写一条 `compaction` 消息 |
| 工具结果限长 | 工具适配层 | 返回给模型的文字截到 16K 字符 |

**⑤ Core 从 pi 收什么**

| pi 的事件 | Core 做什么 |
|---|---|
| `message_update`（文字增量） | 推 `chat.delta` |
| `tool_execution_start` / `end` | 推 `chat.tool`（卡片由 Core 在 `execute` 里生成，推 `chat.block`） |
| `message_end`（助手消息、工具结果） | 写 `messages`；助手消息的 `usage` 写 `usage_records`，推 `usage.updated` |
| `session_compact` | 写 `compaction` 消息和它的用量 |
| `auto_retry_start` / `end` | 推 `chat.tool`：“模型忙，正在重试” |
| `compaction_start` / `end` | 推 `chat.tool`：“整理前面的对话” |
| `agent_settled` | 这次运行结束：任务记完成或中断 |

**不给 pi 的**：
- 文件系统：`cwd` 和 `agentDir` 是空目录，不开 read / bash / edit / write。
- pi 自己的技能、提示模板、主题、上下文文件、MCP 服务器。
- 持久化的 Key、遥测和归因字段。

#### 各技能交给 pi 的工具

“读过网页”指结果带外部文本，调用后任务被标记为不可信，之后的写入都要审批。

| 技能 | 常驻工具 | 按需工具 |
|---|---|---|
| `tibi` 问 Tibi | `get_context` `lookup_word` `get_document` `search_memory` `add_to_wordbook` `ask_user` `run_skill` `import_document` | 原来常驻的 13 个：`compare_words` `list_documents` `search_documents` `get_term` `list_terms` `get_term_contexts` `mark_term` `get_review_stats` `remember` `create_quiz` `get_config` `set_config` `open_settings`；**新增** `get_learning_stats`（原来每轮塞进前缀的“最近 7 天”改由它取）；管理类 9 个：`update_memory` `forget` `remove_terms` `update_document` `delete_documents` `list_feeds` `manage_feed` `configure_skill` `create_backup` |
| `scout` 找文章 | `get_context` `search_feeds` `web_search` `fetch_url` `estimate_difficulty` `list_terms` `list_documents` `ask_user` | — |
| `tutor` 讲解 | `get_context` `get_document` `lookup_word` `compare_words` `get_term_contexts` `set_context_meaning` `create_quiz` `mark_term` | — |
| `coach` 出题与批改 | `get_context` `get_term` `get_term_contexts` `grade_answer` `record_review` `pick_distractors` `create_quiz` `search_feeds` `save_document` | — |
| `archivist` 整理记忆 | `search_memory` `remember` `forget` `list_learning_events` | — |
| `insight` 学习洞察 | `get_context` `get_stats_series` `get_learning_stats` `get_review_stats` `list_terms` | — |

`tool_search` 不再是 Tibi 的能力，由 pi 提供。

#### 为什么用工具，不用 skill + CLI

另一种常见做法是：不给模型定义工具，只给 bash，再加一个 `tibi` 命令行和几份 `SKILL.md`。Claude Code、OpenClaw 和 pi 的作者都推崇这种做法。我们调研后不采用，原因有四个：

- **安全**：Tibi 能碰用户的私人数据，会读网页这类不可信内容，又能联网。再给 bash，就凑齐了 Simon Willison 说的“致命三要素”：网页里藏的一段话有机会在用户的 Mac 上执行任意命令。面向普通用户的同类产品（Anthropic Cowork）是把命令放进虚拟机里跑的，对一个学英语的桌面应用来说太重。
- **审批和撤销没法按命令做**：权限、读过网页后收紧、审计、撤销都按“哪个能力、什么参数”来判断。shell 能用 `;`、`|`、`$(…)` 把命令拼在一起，管不住。
- **界面**：审批卡要写成人话（“Tibi 想把 affect 加入生词本”），词卡、题目、反问卡片都依赖结构化的工具结果。
- **控制流**：`ask_user` 要结束本轮，`run_skill` 要建子任务，它们必须是工具。

但这种做法里的一点值得学：**渐进加载**，用到时才把说明放进上下文。所以：

- 主对话常驻的工具压到 8 个，其余标 `deferred`，由 pi 的 `tool_search` 按需加载。
- 技能正文写清楚“做什么事用哪几个工具”，模型照着去搜，相当于把 `SKILL.md` 当成工具的使用手册。
- 以后想让 Claude Code、Codex 的用户在自己的环境里调 Tibi，可以出一个 `tibi` 命令行加一份 `SKILL.md`，背后转发给运行中的 Core，审批照旧。这和现有的 MCP Server 是同一层的另一个入口，现在不做。

#### 清点时发现的问题

- **`SKILL.md` 里写了不存在的工具**：`tutor` 的 `speak` 和 `coach` 的 `save_ai_result` 都没有注册为能力，现在会被悄悄过滤掉。要么实现，要么从 `allowed-tools` 删掉。建议加一个测试：`allowed-tools` 里的名字必须都已注册。
- **`ask_user` 的网址校验依赖 `job_steps`**：它从本任务 `kind = tool` 的步骤输出里找网址（[ask.ts:33](../../packages/core/src/kernel/ask.ts)）。新方案里读类工具不再记 `job_steps`，`web_search`、`search_feeds` 的结果就查不到了。改成查本任务的 `tool_result` 消息。
- **pi 会不会往系统提示里加东西**：pi 的系统消息分节（序言、工具、`cwd` 等）。要确认传入 `systemPrompt` 后，pi 不再加编程助手的序言和 `cwd` 这类节。列入实施第 1 步的验证。

## 4. 会话生命周期

| 时机 | 做什么 |
|---|---|
| 打开对话后第一次发消息 | 内存里没有会话：从 `messages` 读历史，转成 pi 的会话条目，`SessionManager.inMemory()` 建会话 |
| 之后每次发消息 | 复用内存里的会话，`session.prompt()`。pi 自己带着全部上下文 |
| 回答过程中用户又发了一句 | `session.steer()`：插在当前这批工具调用之后；记在同一个任务里 |
| 档案、核心记忆、技能设置变了 | `configVersion` 变了，发消息前让会话重新加载系统提示。pi 只给模型发变化的部分 |
| 用户在输入框换模型 | `session.setModel()` |
| 回退、删除消息，或同步来了新消息 | 库里最后一条和会话对不上：丢掉内存会话，下次发消息时重建 |
| 闲置 | 15 分钟没用、或常驻超过 8 个会话时，按最久未用回收（`dispose()`）。下次用时重建 |
| 应用重启 | 内存会话都没了，按需重建 |

重建只读本地库，不调模型，很便宜。所以常驻只是省事和保住提示缓存，不是正确性的依赖。

## 5. 对话记录

### 5.1 表结构（直接改 `0001`）

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,                 -- UUIDv7；也用作 pi 会话里的条目 ID
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  job_id TEXT,                         -- 哪次运行产生的；界面按它合成回答气泡
  role TEXT NOT NULL,                  -- user / assistant / tool_result / compaction / note
  engine TEXT,                         -- 哪个引擎产生的（pi …）；用户消息和 note 为空
  body TEXT NOT NULL,                  -- JSON：Tibi 消息格式 v1（和 pi-ai 的 Message 同构）；compaction 原样存 pi 的压缩结果（§5.3）
  ui TEXT NOT NULL DEFAULT '{}',       -- JSON：只给界面的东西（卡片、撤销回执、步骤说明、附件的结构化信息）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX messages_conv ON messages(conversation_id, created_at);
```

| role | 是什么 | 在 pi 会话里 |
|---|---|---|
| `user` | 用户的话，加上提问时的附件（§6） | 用户消息 |
| `assistant` | 模型的回答或工具调用 | 助手消息 |
| `tool_result` | 一次工具调用的结果 | 工具结果 |
| `compaction` | pi 压缩后交出的摘要 | 压缩条目 |
| `note` | 发生在对话之外、模型该知道的事，比如“用户撤销了：把 affect 加入生词本” | `custom_message`，进上下文，界面不显示成气泡 |

其他表的改动：

- **`conversations`**：去掉 `summary`。
- **`jobs`**：`status` 加一个 `interrupted`（对话中途崩溃，见 §10）。中断和出错的原因记在 `error`，不写进消息。
- **`job_steps`**：只记流水线步骤和写类工具调用（检查点、防重复写），模型调用不再记。
- **`usage_records`**：加 `message_id`；`cost` 改名 `cost_cny`。
- **`settings`**：新键 `agent.max_turns`，回合上限，默认 12。
- **新表 `engine_sessions`**：别的引擎的原生会话缓存（§3.1），只在本机，不同步。`PiEngine` 不用它，先建表留位置。

```sql
CREATE TABLE engine_sessions (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  engine TEXT NOT NULL,                -- claude-sdk …
  native_id TEXT,                      -- 引擎自己的会话 ID
  state TEXT,                          -- JSON：续跑需要的其他状态（文件路径等）
  through_message_id TEXT NOT NULL,    -- 这份原生状态对应到哪条消息为止；对不上就重建
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, engine)
);
```

### 5.2 读写

- **用户发消息**：Core 先写一条 `user` 消息（原话加附件），再交给会话。pi 回报的这条用户消息不再重复写。
- **pi 产生的消息**：订阅 `message_end`，助手消息和工具结果定稿一条写一条；订阅 `session_compact`，写一条 `compaction`。
- **对话之外的事**：撤销、在卡片上做了选择等，Core 写一条 `note`。会话在内存里的话，同时用 `pi.sendMessage(…, { deliverAs: 'nextTurn' })` 交给它，下一轮模型就能看到。
- **重建**：按时间把消息串成一条链（`parentId` 指向上一条）。`compaction` 转成压缩条目，`note` 转成 `custom_message`。有工具调用却没有对应结果的（上次中途崩溃），补一条出错的结果“这一步没有执行完”。
- **界面**：按 `job_id` 把一次运行的几条消息合成一个回答气泡。中断状态从 `jobs` 读。
- **工具结果限长**：能力适配层把返回给模型的文字截到 16K 字符，写库和给模型的是同一份。

### 5.3 压缩记录怎么存、什么时候作废

pi 压缩时只看两样东西：会话条目本身，以及每条助手消息里模型报回的 token 用量。助手消息原样存了 `usage`，所以重建后 pi 估算上下文大小、判断何时压缩，和常驻时一样准。

- **原样存**：`compaction` 消息的 `body` 存 pi 压缩条目的全部字段，包括摘要、`firstKeptEntryId`、`tokensBefore`、`usage`、`details`，以及压缩那一刻的提示词和工具清单（`systemMessage`）。不能只挑几个字段存，否则重建后，下次压缩在旧摘要上更新（`previousSummary`）会缺信息。
- **重建只取最近一次压缩之后的部分**：交给 pi 的是最近一次压缩记录，加上从它的 `firstKeptEntryId` 开始的消息。更早的消息 pi 本来也不会再给模型，不用灌进会话。
- **作废规则**：摘要里已经写进了它覆盖的那些消息，这些消息变了，摘要也就不对了。
  - **删除**：删掉或回退的消息落在某次压缩覆盖的范围里（早于它的 `firstKeptEntryId`），就同时删掉那条压缩记录和它之后的压缩记录。否则删掉的内容还留在摘要里，下一轮又回到模型那儿。
  - **同步**：从另一台设备合并进来的消息落在这个范围里，同样作废，因为这条摘要没见过它们。
  - 作废后会话从原文重建，pi 在需要时再压一次，多花一次摘要的钱。两台设备同时聊同一段对话的情况很少，平时碰不到。

## 6. 上下文：给模型什么

pi 维护会话，Tibi 不再每轮拼前缀。上下文按“多久变一次”分到三个地方：

| 放在哪 | 内容 | 怎么给 |
|---|---|---|
| 系统提示 | 技能说明（`SKILL.md` 正文 + 用户的附加要求）、用户档案（称呼、水平、词汇量、目标、兴趣、讲解语言）、核心记忆（身份类、指令类） | 交给 pi 的资源加载器；变了就让会话重新加载，pi 只发差异 |
| 用户消息的附件 | 提问那一刻在看什么：当前文章和读到的位置、选中的句子、复习中的卡片 | 作为这条用户消息的第二个文本块存下来，模型看得到，界面只显示原话和一个小标签 |
| 工具 | 今天的学习数据、最近的学习记录、相关记忆、文章内容、词条 | 模型需要时自己调：`get_context`、`get_learning_stats`、`search_memory`、`get_document` 等 |

为什么这样分：

- **附件跟着消息存下来**，历史就自己说得清楚：“解释这句”指的是哪一句，下一轮、重建以后、换引擎以后都还在。原来的前缀不进历史，模型看到前几轮的“这句”不知道指什么。
- **学习统计和记忆召回改成工具**，不用每轮都塞，也不会每轮都让提示缓存失效。模型自己挑检索词，也绕开了按空格切词时中文召回不到的问题。
- **系统提示里不再列工具和权限模式**：工具由 pi 声明；权限在工具执行时检查，模型不用知道。
- **技能说明里加一句**：用户提到“这篇”“这句”“这张卡”而附件里没有时，先调 `get_context`。

附件示例（`body` 里的用户消息）：

```json
{ "role": "user", "content": [
  { "type": "text", "text": "这句为什么用 affect？" },
  { "type": "text", "text": "<attachment>正在读《Why Cities Are Getting Hotter》第 2 节；选中：\"Heat can affect sleep and health.\"</attachment>" }
] }
```

## 7. 工具、审批和反问

- **能力转工具**：
  - 能力层输出 SDK 的 `ToolDefinition`。`execute(toolCallId, params, signal, …)` 里照旧：查重放 → `job.step()`（只对写操作）→ `authorize()` → 执行 → 卡片和撤销回执放进这条工具结果的 `ui`。
  - 参数 schema 统一改用 `typebox` 1.x（pi 1.5 用的），去掉 `@sinclair/typebox` 0.34。
- **审批留在 `execute` 里**：
  - 改参数后重新校验、按 `params_hash` 沿用重启前的决定、同一任务的审批排队，都在 `authorize()` 里。
  - pi 的 `tool_call` 事件改了参数不再校验，所以不挪过去。
- **反问**：
  - `ask_user` 的结果带 `terminate: true`。
  - pi 的规则是同一批工具结果全部 terminate 才结束，所以扩展在 `message_end` 记下这批有没有 `ask_user`。有的话，写操作在 `tool_call` 返回 `{ block: true, terminate: true }`；读操作照常执行，结果补上 `terminate: true`。
  - 用户的回答就是下一条用户消息，会话接着用。
- **按需加载**：管理类能力注册时标 `exposure: 'deferred'`，会话里启用 pi 自带的 `tool_search`（`createToolSearchExtension()`）。
- **只开 Tibi 的工具**：`noTools: 'builtin'`，pi 自带的 read / bash / edit / write 一个都不开。

## 8. 压缩、重试、刹车

- **压缩**：
  - 设置 `compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }`，即 pi 的默认值，按模型的上下文窗口触发。DeepSeek 的窗口是 128K。一轮里工具返回大段内容时也会触发。
  - 摘要用 pi 默认的提示词，Tibi 不插手。摘要分几节：目标、约束和偏好、进展（已完成 / 进行中 / 卡住）、关键决定、下一步、关键上下文。末尾的文件列表在 Tibi 里是空的。
  - 学英语要长期记住的东西另有结构化存储：生词在 `terms`，复习对错在 `review_logs`，观察和偏好在 `memories`。摘要只负责让模型接上当前这段话。
  - 以后发现摘要漏了要紧的东西，再在 `session_before_compact` 里换成自己的提示词。验证脚本已证明可行（§11 第 8 项）。
  - 扩展在 `session_compact` 时把压缩结果交给 Core，写一条 `compaction` 消息（原样存，见 §5.3），用量记进 `usage_records`。
  - 触发线可以调：按默认值，DeepSeek（128K 窗口）要到约 112K token 才压，每轮请求都很长。只能靠缓存折扣省钱。想更早压，就把 `reserveTokens` 调大，比如 64K，这样约 64K 就压。这是费用上的取舍，不影响压缩能力，实施第 6 步用真实对话再定。
- **重试**：`retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000 }`。上下文溢出不走重试，交给压缩。`auto_retry_start` 转成界面提示“模型忙，正在重试”。
- **刹车**：扩展在 `turn_start` 时调 `beforeTurn()`，查本月和本任务的预算、数回合。超预算或超过 `agent.max_turns` 就 `ctx.abort()`，任务记 `interrupted` 并写明原因。

## 9. 模型、设置和隔离

- **ModelRuntime**：
  - 按 provider 配置缓存，参数为 `modelsPath: null`、`allowModelNetwork: false`、`refreshOnCreate: false`。
  - 凭据用自己实现的内存版 `CredentialStore`；Key 经 `Platform.getSecret()` 向壳要，只留内存。
  - DeepSeek 用 pi 内置的 provider；其他 OpenAI 兼容服务用 `registerProvider(id, { baseUrl, api: 'openai-completions', models })`。
- **设置**：`SettingsManager.inMemory()`。
  - `cacheWarming: 'off'`：缓存预热会额外发付费请求。
  - `enableInstallTelemetry: false`：不往请求里加 pi 的归因字段。
  - 再加上 §8 的压缩和重试设置。
- **资源加载器**：`DefaultResourceLoader`，`agentDir` 和 `cwd` 指向应用数据目录下的一个空文件夹。关掉技能、模板、主题、上下文文件的发现，系统提示用 Core 给的，`extensionFactories` 放 Tibi 扩展和 `tool_search`。之所以用它，是因为内联扩展只能经它加载。
- **Tibi 的技能不用 pi 的技能机制**：pi 的技能靠模型用 `read` 工具读 `SKILL.md`，Tibi 不开文件工具。Tibi 的技能决定的是“一段对话的配置”：提示词、工具子集、模型档，在建会话时一次给定。
- **环境**：sidecar 启动时设 `PI_OFFLINE=1`。pi 读内置 provider 时还会看 `DEEPSEEK_API_KEY` 这类环境变量，开发模式下要留意。

## 10. 崩溃和续跑

| 情况 | 处理 |
|---|---|
| 对话中途崩溃 | 已定稿的消息都在库里。重开后这次运行标记为 `interrupted`，回答下面显示“中断了 · 继续”。点继续就发一条新消息，会话从库里重建 |
| 等审批时崩溃 | 同上。审批卡显示已失效，继续后模型会重新发起，再审批一次 |
| 后台技能中途崩溃（比如整理记忆） | 重开后整次重跑；写操作靠 `job.step()` 和幂等键不会重复写 |
| 导入流水线中途崩溃 | 不变，从最后完成的步骤接着跑 |

对话不自动续跑：一轮通常只有几秒到几十秒，让用户决定要不要继续，比自动重新调模型更符合预期，也省钱。

## 11. 验证结果

验证脚本在 scratchpad，没有入库，实施第 1 步会改成 `core-node` 的契约测试。脚本用 pi-ai 的假 provider，不联网、不花钱，HOME 指向临时目录。

| # | 假设 | 结果 | 做法 |
|---|---|---|---|
| 1 | 只开 Tibi 的工具 | ✅ | `noTools: 'builtin'` + `customTools` |
| 2 | 工具执行时拿得到调用 ID 和取消信号 | ✅ | `execute(toolCallId, params, signal, …)` |
| 3 | 写操作执行前能异步挂起，等审批结果 | ✅ | `tool_call` 返回 `{ block, reason }`，可以 await 任意久 |
| 4 | 用库里的消息预填会话，模型看得到 | ✅ | `SessionManager.inMemory(cwd, {}, entries)` |
| 5 | 每条助手消息带用量 | ✅ | `message_end` 的 `message.usage` |
| 6 | `ask_user` 能结束本轮 | ✅ | 工具结果带 `terminate: true` |
| 7 | 运行中每条新消息都能拿到 | ✅ | 脚本里是从会话记录镜像出来的；本方案改用 `message_end`，事件计数显示工具结果也会触发，契约测试要钉住 |
| 8 | 需要时能把压缩摘要换成自己的（本版不用，留作后手） | ✅ | `session_before_compact` 返回 `{ compaction: { summary, … } }` |
| 9 | 429 自动重试 | ✅ | `retry` 设置；`auto_retry_*` 事件 |
| 10 | 不往 `~/.pi` 写东西 | ✅ | 设置、资源、会话全部用内存版或空目录 |
| — | 同一个会话连续 `prompt()` 多轮 | ✅ | 脚本里同一个会话跑了 3 轮 |
| — | 用 Tibi 现有的 esbuild 配置打成单文件，脱离 `node_modules` 运行 | ✅ | 上面各项在打包后全部通过；包大小 14.7 MB（现在的 `tibi-core.js` 是 8.4 MB） |

**实施第 1 步要先补验证的：**

- `message_end` 对工具结果的触发，以及定稿消息的完整字段。
- 运行中 `steer()` 的行为，以及插话如何记进同一个任务。
- 改了系统提示后，会话重新加载的方式（资源加载器 `reload()` 还是重建会话），以及对提示缓存的影响。
- `pi.sendMessage(…, { deliverAs: 'nextTurn' })` 写 `note` 的效果。
- pi 自带的 `tool_search` 在没有 MCP 的情况下能否配合 `deferred` 能力使用。
- 内存版 `CredentialStore` 的写法，确认不写 `auth.json`。
- 用真实的 DeepSeek 走一遍。
- DeepSeek 返回“上下文超长”时，pi 能否认出来并先压缩再重试。溢出恢复靠 pi-ai 识别各家的报错文本。
- 传入 `systemPrompt` 后，实际发给模型的系统消息里还有没有 pi 自己加的节（编程助手序言、`cwd`、日期等）。
- 主对话改成 8 个常驻工具后，每轮的工具定义少了多少 token；常见请求里，模型能不能用 `tool_search` 搜到要的按需工具。
- 从库里重建后，压缩是否和常驻时一样触发、`previousSummary` 是否接得上。
- Bun 单文件的体积和冷启动时间（本机没装 bun）。

## 12. 依赖和体积

| 项 | 改动 |
|---|---|
| `pi-ai`、`pi-agent-core` | 1.4.0 → 1.5.0。三个包同步发版，必须一起升；Core 仍直接依赖 `pi-ai`（类型、一次性调用） |
| `pi-coding-agent` | 新增 1.5.0，只装在 `core-node`，锁死版本 |
| `@sinclair/typebox` | 换成 `typebox` 1.x |
| Core 的 JS 包 | 约 8.4 MB → 约 15 MB |

- 增加的体积主要来自：SDK 本身约 2.5 MB、`jiti` 1.7 MB、`highlight.js` 1.4 MB、`pi-tui` 0.7 MB。后三个 Tibi 用不到，以后可以试着只从子路径导入。
- SDK 没有原生 `.node` 模块。图片处理和 codemode 用的 wasm 不在 Tibi 的路径上，打包后的验证没加载它们。

## 13. 风险

| 风险 | 应对 |
|---|---|
| SDK 发版很快（10 月 15 日以来已发 1.3、1.4、1.5），API 会变 | 锁死版本；契约测试覆盖本方案用到的每个接口，升级必须先过。依赖面只有 `PiEngine` |
| SDK 是为编程设计的，默认值不合适 | 全部显式传入；契约测试检查只有 Tibi 的工具在、不写 `~/.pi`、不发预热请求 |
| 常驻会话和库不一致 | 每次发消息前比对最后一条消息 ID，对不上就重建；重建只读本地库，很便宜 |
| 工具历史进上下文，单轮费用变高 | 工具结果限长 16K 字符；pi 按 token 压缩；每轮查预算；DeepSeek 的缓存折扣能抵一部分 |
| 模型不主动调工具取上下文 | 技能说明里写清楚什么时候调 `get_context`；附件已覆盖最常见的“这句”“这篇” |
| 模型搜不到按需工具，或多绕一轮才搜到 | 主对话的技能正文按事情列出要用的工具名；用真实请求测命中率，常被搜的工具挪回常驻 |
| 以后做手机端 | Core 只认 `AgentEngine` 接口，手机端另写一个基于 `pi-agent-core` 的实现 |

## 14. 实施步骤

| 步 | 内容 | 完成标准 |
|---|---|---|
| 1 | pi 三个包升到 1.5.0、`typebox` 换成 1.x；验证脚本改成 `core-node` 的契约测试，补齐 §11 列的验证 | 现有测试全过；契约测试进 CI |
| 2 | Core：定义 `AgentEngine`；改 `0001`；`runSkill()` 改成“拿会话 → send”；删掉 §2 列的旧代码；按 §3.2 修 `allowed-tools`（删掉或实现 `speak`、`save_ai_result`，`tibi` 加 `get_learning_stats`），并分出常驻和按需；改写 `tibi` 的 `SKILL.md`，按事情列出要用的工具；`ask_user` 的网址校验改查 `tool_result` 消息 | Core 单测用假引擎全过；`allowed-tools` 的名字都已注册 |
| 3 | `core-node`：实现 `PiEngine`（常驻会话表、重建、模型、设置、资源加载器、扩展、事件映射） | 契约测试覆盖：多轮、插话、审批、反问、压缩、重试、预算、回合上限、过期重建 |
| 4 | 界面：回答按 `job_id` 合成气泡；附件标签；中断状态读 `jobs`；“继续”；运行中可以继续输入 | 对话、卡片、撤销、回退、审批卡在桌面端走通 |
| 5 | 同步：更新 `sync/spec.ts`（`messages` 字段变了、新增 `note`，`conversations.summary` 去掉） | 两台设备的同步测试通过 |
| 6 | 打 Mac sidecar，量体积和冷启动；用 DeepSeek 实际对话 | 结果记进 05 §3 |

开发库需要删掉重建。粗估 2–3 周，界面改动和契约测试占一半。

## 15. 已确定的决定

已在 2026-11-03 的评审中确定。剩下的只有实施时要验证的事（§11）。

**架构**
1. pi 有的，Tibi 不做（§2）。SDK 只出现在 `core-node` 的 `PiEngine` 里，Core 只认 `AgentEngine` 接口。
2. 每段对话一个常驻的 pi 会话：闲置 15 分钟或超过 8 个时回收，用时从库里重建（§4）。
3. 多引擎先留位置：这一版只实现 `PiEngine`，`engine_sessions` 先建表不用，接口带上 `caps`（§3.1）。

**数据**

4. `messages` 是唯一的对话记录，用 Tibi 自己的消息格式（v1 和 pi-ai 的 `Message` 同构）（§5）。
5. 直接改 `0001`，开发库删掉重建，不写迁移。
6. 压缩记录原样存；它覆盖范围里的消息被删除、回退或同步进新消息时，作废那次压缩（§5.3）。

**上下文**

7. 去掉每轮 `<context>` 前缀：提问时在看什么作为附件存进用户消息；统计、记忆等由模型调工具取（§6）。
8. 压缩和摘要用 pi 默认的，Tibi 只把结果写进库（§8）。

**工具**

9. 用能力层，不开 bash，不用 skill + CLI；`tibi` 命令行留作以后给开发者的入口（§3.2）。
10. 主对话常驻 8 个工具，其余 23 个按需加载；其他技能的工具全部常驻（§3.2）。
11. 审批留在工具执行里，不挪到 pi 的 `tool_call` 事件（§7）。

**默认值（实施时可以按实测调）**

12. 对话中途崩溃不自动续跑，显示“中断了 · 继续”（§10）。
13. 回合上限 12 轮；工具结果截到 16K 字符。
14. 思考档位：fast 档 `off`，deep 档 `medium`。
15. 压缩触发线先用 pi 的默认值（DeepSeek 约 112K token），用真实对话量过费用后再定（§8）。

## 16. 实施记录（2026-11-03）

第 1–4 步已完成，代码在 `packages/core/src/kernel/engine.ts`（接口）和 `packages/core-node/src/engine-pi.ts`（`PiEngine`）。和上面设计有出入或补充的地方：

- **系统提示**：pi 默认会加编码助手的开场、规则和 `<cwd>`。扩展的 `before_agent_start` 直接返回 `{systemPrompt}`，模型只看到 Tibi 拼的提示。
- **按需工具**：`tool_search` 注册后默认不激活，建会话后用 `setActiveToolsByName` 打开。pi 并行跑两个 `tool_search` 时后一个会覆盖前一个的激活结果，所以技能正文要求“一次查询里写全要的工具名”。这只靠提示约束，真实模型下要观察。
- **反问结束本轮**：同一批工具里只认第一个 `ask_user`，其余的 `ask_user`、写入工具和未知工具在 `tool_call` 里拦掉；`ask_user` 成功后，下一个 `turn_start` 直接 abort，结果算 done。`ask_user` 失败（比如网址校验不过）不结束。
- **压缩时机**：pi 在发送前检查阈值，超了先压缩再发，可能产生两段摘要（历史 + 本轮前缀）。库里都存成 `compaction` 行。
- **`job_steps`**：记录流水线步骤和全部 Tibi 能力层的工具调用，不记模型步骤；pi 自带的 `tool_search` 不经过能力层，不写 `job_steps`（界面过程里能看到）。
- **note（撤销、卡片操作）**：会话空闲时直接追加进 pi 会话，排在下一句用户的话之前，和库里的顺序一致。不用 pi 的 `nextTurn`：它会把消息排在用户的话后面，模型最后看到的是系统说明而不是用户的问题。运行中来的 note 等这一轮结束再追加，之后从库里重建。
- **崩溃**：启动时把仍在跑的对话任务标成 `interrupted`，界面显示“继续”。后台任务照旧续跑。
- **插话**：任务在跑时，`chat.send` 写入用户行，然后调 `engine.steer`；等审批时不能插话，界面把消息排队。
- **同步**：`sync/spec.ts` 按表同步，不用改；`engine_sessions` 只在本机用，不同步。
- **过程可见**：`PiEngine` 转发 pi-ai 的 `thinking_delta` 和 `auto_retry_end`（引擎事件 `thinking_delta`、`retry_end`）。思考内容原样在 assistant 消息的 `thinking` 块里，历史投影成 `Message.thinking`；每步工具的参数摘要、结果摘要、出错原因、用时存在 tool_result 行的 `ui.step`。
- **记忆**：`remember`、`update_memory`、`forget` 带 `autoApprove`：技能调用时不审批（读过网页也不问），回执可撤销；MCP 等外部调用仍按 `confirm` 审批。`remember` 改为主对话常驻工具。

还没验证：用 DeepSeek 实际对话（第 6 步），Bun 单文件的体积和冷启动，两台设备的同步测试（第 5 步）。
