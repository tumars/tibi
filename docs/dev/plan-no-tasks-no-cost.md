# 改造计划：去掉"任务"和费用计算（2026-11-04）

推翻 R9 里"任务、步骤检查点、用量自建表"的部分，以及预算（¥20 / 月、¥1 / 任务）。对话、消息仍由 TibiKernel 自建。

## 1. 费用与预算：全部去掉

花了多少钱去服务商后台看。Tibi 不换算、不记账、不拦截。

- 删 `kernel/usage.ts`：`recordUsage`、`checkBudget`、`monthSpent`、`skillMonthCost`、`USD_CNY`。
- 删 `usage_records` 表、`budget.*` 和 `provider.price.*` 设置；错误码 `budget_exceeded`、事件 `usage.updated` 一起删。
- 删界面上的花费：设置 → 高级的预算两项、技能列表的"本月 ¥"、系统状态里的 budget、找文章搜索的计费。
- 兜底只剩 `agent.max_turns`（一轮回答最多几次模型调用）。

## 2. 任务层：去掉，只留会话

**一轮回答**：一句用户消息，加上 Tibi 为它说的话和调的工具。它就是对话里的一段消息，不是另一张表。

- `messages.job_id` 改名 `turn_id`，值是这一轮第一句用户消息的 id；回答中补充的话也带同一个 `turn_id`。
- 这一轮用的技能、结果（进行中 / 完成 / 出错 / 已停止）、是否读过不可信内容，记在第一句用户消息的 `ui` 里。
- 进行中的回答只在内存里（`kernel/turns.ts`）：停止、等审批、等反问的回答都在进程里等。
- 应用重启时，还记着"进行中"的那一轮改成"中断"，界面显示"重试"。不续跑、不存步骤检查点。
- 删 `jobs`、`job_steps` 表和 `tasks.*` 方法；"任务"页、手机"我的"里的任务列表一起删。

各处怎么接替：

| 以前 | 以后 |
|---|---|
| `chat.send` 建一个任务 | 写下用户消息，在内存里开一轮回答，`submission_id` 就是 `turn_id` |
| `tasks.retry` / `tasks.cancel` | `chat.retry` / `chat.cancel`（按 `turn_id`） |
| `tasks.approve` | `approvals.decide`；审批只在内存里，重启后那一轮算中断 |
| 子技能（`run_skill`）是子任务 | 在同一轮里直接跑：共用停止信号、审批、不可信标记；嵌套仍只允许一层 |
| `skills.runNow`（整理记忆按钮） | 建一段 `kind = 'skill'` 的对话，在里面跑一轮 |
| 导入是任务 | `documents.import` 立即返回 `import_id`，在后台跑；进度走 `import.progress`，结束走 `import.done` |
| 总结、翻译、重新分析是任务 | 直接在后台跑，状态写在文章上（`documents.ai_status`）和 `data.changed`；启动时卡在 running 的改回 deferred，按原来的"补做"逻辑再做 |
| 对话里起的导入结束后通知对话 | 当前代码里没有这条（工作区里这部分改动被回退了）：`import_document` 在对话里最多等 3 分钟，没完成就告诉模型"还在导入"，结果由书架上的提示告诉用户 |
| MCP 写调用是任务，先返回 pending 再轮询 | 直接调用；要确认时等用户在 Tibi 里点（最多 5 分钟，超时算拒绝）；删 `tibi_task_status` |
| 任务页里的审批 | 不在对话里的审批（MCP 来的）显示在桌面端右下角；手机没有 MCP，"我的"里的运行记录直接去掉 |

## 3. 步骤

1. 删费用和预算（Core、界面、测试）。
2. 新增 `turns.ts`，`agent.ts`、`capabilities.ts`、`ask.ts` 改用它；对话历史按 `turn_id` 合成。
3. 导入、分析、翻译、重新分析改成后台函数 + 事件。
4. MCP、`skills.runNow`、审批改到新接口。
5. 迁移 0005：删 `usage_records`、`jobs`、`job_steps`，`messages.job_id` 改名，清掉预算和价格设置。
6. 界面：删任务页和花费，导入进度、审批、重试改用新接口。
7. 更新 DECISIONS.md，测试和类型检查全过。

## 4. 实现情况（2026-11-04）

- 已完成：上面 1、2 的全部内容；迁移 0005 把旧数据里任务的结果搬到消息上；DECISIONS.md 记为 T35、T36。
- 设计文档 05（agent 架构）、06（接口）、01（数据库）里关于任务、预算、用量的段落还是旧的，以 DECISIONS.md 的 T35、T36 为准，之后再改。
