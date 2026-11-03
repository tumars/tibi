# 先补对话可靠性，再借学习型交互

有，而且最值得做的第一件事不是"借鉴"，是修复：tibi 的对话页在中断和离开时会丢内容，这是 Cherry Studio、Claude Code、WorkBuddy 的文档都明确覆盖、而 tibi 尚未解决的基本功。代码显示，停止或出错时已生成的回答不入库（`KERNEL/agent.ts:135-142`），离开再回来会丢掉进行中的回答和审批卡（`UI/lib/useChat.ts:49,68-71`），失败的工具也显示 ✓（`UI/lib/useChat.ts:68`）。修完这些，再落地设计文档已决定但没实现的折叠过程卡、自动压缩和"修改后允许"。真正值得新借的模式只有六类：消息操作行、排队发送、写入回执加撤销、选中回答文字即查词、填入而不发送的下一步建议、"先让学习者写"的产出卡。多模型并排、分支画布、权限模式矩阵、计划模式、右侧产物面板、定时任务和 `@` 都不该借，其中一部分直接违反 tibi 已写明的决策。tibi 的护城河也很清楚：确定性学习卡片、污染（taint）审批和学习者状态注入，这些竞品并未做得更好，应当保留。证据有明确边界：五款产品均未上手实测，全部来自文档、发布记录和论坛；tibi 的问题来自读代码，均未在运行中复现；用户反馈几乎都来自开发者，没有任何英语学习者的数据。

**读法说明。** 路径缩写：`UI/` = `apps/desktop/src/`，`KERNEL/` = `packages/core/src/kernel/`，`DOMAIN/` = `packages/core/src/domain/`，`DOC00/05` = `docs/design/00-concept-design.md`、`05-agent-architecture.md`。行号对应 2026-11-02 的未提交工作区，提交后会漂移。**【推断】** 是从代码或资料推出、未经运行验证的结论，**【假设】** 是未经用户测试的设计判断；未加标注的代码事实中，`ChatThread.tsx`、`useChat.ts`、`agent.ts:70-197` 以及 `replay`、`quiz_done` 的引用关系经撰写本报告时再次核对，其余来自调研笔记的代码审计。

## 竞品的共识是"可恢复"，tibi 的缺陷恰好集中在这里

这些产品界面差异很大，但有记录的几家都把用户已投入的内容当作不可丢失的东西（Codex 和 Qoder 的停止后行为未在已读文档中确认）。Cherry Studio 在回答中途失败时保留已流出的内容，并给错误配上诊断和恢复操作（[Cherry 发布记录](https://github.com/CherryHQ/cherry-studio/releases)）；Claude Code 按 Esc 中断时保留已完成的工作（[交互模式文档](https://code.claude.com/docs/en/interactive-mode)）；WorkBuddy 停止后可以补充指令、重发或继续，编辑失败时保留文本（[WorkBuddy 对话文档](https://www.codebuddy.cn/docs/workbuddy/Conversation)）。tibi 的 harness 其实很强，有持久任务、检查点和审计，但这些能力没有传到对话线程里。下表是应该最先处理的问题，排序依据是"丢用户内容 > 信息失真 > 体验毛糙"。

| 序 | 现存问题 | 代码位置 | 修复方向 | 参照 |
|---|---|---|---|---|
| A1 | **停止或出错时回答丢失。** `runSkill` 在 `addMessage` 之前抛错，已成功轮次的文字也一起丢；用户消息留在库里，之后模型会看到连续的用户轮 | `KERNEL/agent.ts:135-142,81-85` | 取消和出错路径也写入已有 blocks，并标记"已停止/未完成"。**【推断】** 正在流的这一轮文字要另行累积，`message_end` 在中止时是否触发取决于未检查的 `pi-agent-core` | [Cherry](https://github.com/CherryHQ/cherry-studio/releases) v2.1.5；[Claude Code](https://code.claude.com/docs/en/interactive-mode) |
| A2 | **发送失败时输入被清空。** `send` 先 `setText('')`，RPC 失败只弹 toast，乐观插入的消息还留在线程里（本次核对新发现） | `UI/components/ChatThread.tsx:36`；`UI/lib/useChat.ts:53,60` | 成功后才清空；失败时撤回乐观消息、恢复文本 | [WorkBuddy](https://www.codebuddy.cn/docs/workbuddy/Conversation)；[Claude Code](https://code.claude.com/docs/en/checkpointing) |
| A3 | **离开再回来丢失运行状态。** 切换对话清空 `live`、`approvals`、`mine`，之后 `task.done` 也被忽略，答案要等下次打开才出现；`DOC00:293` 承诺任务会继续 | `UI/lib/useChat.ts:49,68-71` | `chat.open` 返回进行中的任务和待审批项，重建 `mine`；回到页面时显示"正在继续…" | Claude Code 的 ["Catching up…"](https://code.claude.com/docs/en/changelog)；[Cherry 待批状态](https://docs.cherryai.com.cn/advanced-basic/agent-workspace/permissions-memory-background.md) |
| A4 | **`run_skill` 子任务在线程里不可见。** 不传 `conversation_id`，所以没有流式文字和卡片；子任务的审批也因不在 `mine` 而不显示。**【推断】** `wait` 时父任务可能卡到 5 分钟超时，用户只能靠侧栏角标发现 | `KERNEL/index.ts:72-82`；`UI/lib/useChat.ts:71` | 审批事件按父任务归属；子任务只显示一行状态。这也是 `DOC05:118,154` 已设计的内容 | [Claude Code 子代理](https://code.claude.com/docs/en/sub-agents)：后台权限请求出现在主会话，并显示为[一行状态](https://code.claude.com/docs/en/changelog) |
| A5 | **失败或被拒绝的工具显示 ✓。** 结束事件带 `summary: '出错了'`，UI 只翻转 `done` | `KERNEL/agent.ts:126`；`UI/lib/useChat.ts:68`；`UI/components/ChatThread.tsx:76` | 区分成功、失败、拒绝三态 | Claude Code 专门修过被拦截调用[读起来像已执行](https://code.claude.com/docs/en/changelog)的问题 |
| A6 | **强制滚到底。** 任何状态变化都钉到底部，流式时无法上翻阅读，而学习者恰恰需要停下来读 | `UI/components/ChatThread.tsx:37` | 上翻时暂停跟随，显示"回到底部"；等待决定的卡片仍滚入视野 | [Claude Code](https://code.claude.com/docs/en/fullscreen)；Cherry 为此[反复修复](https://github.com/CherryHQ/cherry-studio/issues/21700)，说明要一次设计好 |
| A7 | **错误没有重试入口，且位置错乱。** `tasks.retry` 已存在但对话页没有按钮；旧错误渲染在所有新消息之下，重开后消失；预算超限没有设置链接 | `KERNEL/methods.ts:92`；`UI/lib/useChat.ts:70`；`UI/components/ChatThread.tsx:72-79` | 错误随 A1 落库并放回原位，附"重试"和对应的设置入口 | [Cherry](https://github.com/CherryHQ/cherry-studio/releases) v2.1.7 |
| A8 | **长对话只加载最新 50 条**，无"加载更多"，游标还可能跳过同毫秒消息 | `KERNEL/methods.ts:22`；`KERNEL/conversations.ts:123-127` | 接上 `chat.history`；游标改用 `id` | WorkBuddy、Qoder 都有[长会话卡顿](https://forum.qoder.com/t/qoder/9303)投诉，渲染性能要一并考虑 |
| A9 | **自定义模型花费恒为 0，预算永不触发**；`complete.ts` 上报的月花费实为单次花费 | `KERNEL/agent.ts:62,159-162`；`KERNEL/complete.ts:37` | 允许填单价，未知时显示"未知"而不是 ¥0 | 费用不透明是 [WorkBuddy](https://post.smzdm.com/p/aggwnmlm/) 和 [Qoder](https://forum.qoder.com/t/qoder/9465) 的最大投诉点 |
| A10 | **手机端可并发发送，后端也不拦截**，并且没有停止按钮 | `UI/mobile/Today.tsx:29-33`；`KERNEL/methods.ts:29-37`；`UI/mobile/ui.tsx:44` | 后端按对话拒绝或排队，手机补停止 | 无需参照 |

有一项需要先验证再定级。`DOC05:157` 声称写操作不会重复，但 `replay` 字段在 `packages/core/src` 里只有声明和赋值，没有任何读取方（本次搜索确认），而检查点名包含 `toolCallId`（`KERNEL/capabilities.ts:94`）。**【推断】** 崩溃恢复重跑时模型会生成新的 ID，匹配不上旧检查点，`record_review`（`replay: 'never'`）可能重复记分，污染 FSRS 排期。这能用 `--fake-model` 写一个集成测试确认，若属实应升到 A1 同级，因为它损坏的是学习数据。

较小的毛糙可以顺手处理：答案里的链接默认直接导入书架，且没有提示（`UI/components/ChatThread.tsx:65-71`），至少要首次提示；词卡撤销按钮超过 10 分钟后只会报错（`UI/components/Widgets.tsx:30-33,41`）；从首页提问每次都创建对话行，未使用的也会累积（`UI/pages/Home.tsx:85`）。

## 三件文档已拍板的事比任何新点子都该先做

tibi 的设计文档已经回答了不少"该不该借"，缺的只是实现，而竞品资料恰好给出了这些设计的落地细节和踩坑记录。这组工作不引入新概念，风险最低。

**折叠过程卡（`DOC00:296`、`DOC05:294`，C5）** 现在只是几行扁平的"Tibi 正在…"，完成后消失（`UI/components/ChatThread.tsx:76`；`UI/lib/useChat.ts:70`），摘要还直接取能力描述（`KERNEL/agent.ts:120`），读起来是"正在把几个词加入生词本（查词典补释义，建复习卡）"，既长又不含具体的词。建议采用 Claude Code 的三级阶梯：摘要行、可展开的步骤、完整记录（[桌面文档](https://code.claude.com/docs/en/desktop)），第三级就是已有的运行记录。两条竞品教训应写进实现要求。第一，折叠行必须保留关键名词：Claude Code 把文件名收成 "Read 3 files" 后遭到开发者反弹，随后部分回退（[LavX News 转述](https://news.lavx.hu/article/anthropic-s-claude-code-update-sparks-developer-backlash-over-hidden-file-actions)），对应到 tibi 就是"查了 affect / effect"而不是"查了 2 个词"。第二，折叠过程，但绝不折叠提问：Codex 用户抱怨智能体的问题脱离了被折叠的上下文（[OpenAI 社区](https://community.openai.com/t/messages-are-hidden-by-default-in-the-ui/1390020)）。页脚同时补上 `DOC00:297` 约定的技能名。

**长对话压缩（`DOC05:162`）** 目前是"最近 20 条消息"（`KERNEL/agent.ts:80`），`ConvRow.summary` 字段闲置（`KERNEL/conversations.ts:7,143-149`）。**【推断】** 这里的主要问题不是上下文溢出，而是长辅导对话突然失忆。Cherry 的交接摘要模板（已确认事实、结论、未决问题、约束）可以改成已查过的词、犯过的错和当前目标（[Cherry 上下文文档](https://docs.cherryai.com.cn/advanced-basic/chat/context-queue.md)）；Claude Code 则说明了压缩后什么必须原样重新注入（[上下文窗口文档](https://code.claude.com/docs/en/context-window)）。Cherry 的文档也承认摘要不保证保留全部细节，所以压缩时在回答里显示一行状态是合理的（[Cherry v2.1.5](https://github.com/CherryHQ/cherry-studio/releases)），但不需要上下文用量表。同一轮顺带把易变上下文从系统提示移到用户消息前缀，兑现 `DOC05:173`。**【推断】** 当前写法（`KERNEL/agent.ts:178-179`）可能降低 DeepSeek 缓存命中，而用户是自己付钱的，这项可以用用量记录里的 `cached_tokens` 直接量化。

**审批卡** 三处都已有设计：`DOC05:181` 的"修改后允许"后端已支持（`KERNEL/jobs.ts:232`），`DOC00:427` 要求写明工具和影响，而卡片正文仍是截断的 JSON（`KERNEL/capabilities.ts:64-65,113-115`）。WorkBuddy 的做法值得照抄：对话框标题写原因，下面写具体对象，拒绝也提供一条后路，比如要求换更安全的做法（[权限文档](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes)）。对 tibi 来说就是"Tibi 想记住：你总把 affect 和 effect 搞混"。同样已有设计的还有占位文字轮换（`DOC05:293`）和导入结果卡（`DOC00:294`），可以排在后面。

## 六类新模式值得借，按学习价值和成本排序

判断标准有三条：符合"一个 Tibi、只暴露动词"，能复用现有能力而非增加概念，并且不额外消耗用户自己的 API 费用。下表 C1 至 C3 依赖 A1、A3，否则重试和排队会建立在不可靠的状态上；工作量是粗略估计。

| 序 | 模式 | tibi 落点 | 借自 | 怎么改造 |
|---|---|---|---|---|
| C1 | **消息操作行**（中）：回答上有复制、朗读、重新回答；用户消息上有编辑重发 | `UI/components/ChatThread.tsx:72-74` 无任何操作；`KERNEL/methods.ts:20-54` 需新增方法；消息是线性存储（`KERNEL/conversations.ts:121-134`） | [WorkBuddy](https://www.codebuddy.cn/docs/workbuddy/Conversation) 的悬停操作与"刷新只对最后一条"；[Qoder](https://docs.qoder.com/qoder/task-management) 的编辑重发；[Claude Code](https://code.claude.com/docs/en/checkpointing) 回退后把原话放回输入框 | 只做线性截断，不做分支。朗读复用 `UI/lib/tts.ts:3`。照 [Qoder](https://docs.qoder.com/qoder/task-management) 明说回退边界："已加入生词本的词不会撤回"。**【假设】**"讲简单点"这类学习动作比通用的"重新生成"更有用，可以先观察使用后再加 |
| C2 | **选中回答文字即查词**（小至中）：浮出查词、加入生词本、问这句 | `UI/components/ChatThread.tsx:65` 只处理链接点击；复用 `lookup_word`、`terms.add`，查词不走模型 | [WorkBuddy 引用](https://www.codebuddy.cn/docs/workbuddy/Conversation)；[Cherry v2.1.8 快速引用](https://github.com/CherryHQ/cherry-studio/releases)；[Cherry #6505](https://github.com/CherryHQ/cherry-studio/issues/6505) 有读外文文章的用户嫌步骤多、要音标 | 这是最贴合 tibi 的一项：Tibi 用英文讲解时，读者会卡在讲解本身。不要学 Cherry 的自动复制，该讨论串里多有剪贴板干扰的 bug。**【假设】** 阅读器已有同类交互（笔记未读该部分），应复用其组件 |
| C3 | **排队发送**（中）：运行中按 Enter 进队列，可见可改可撤回 | `UI/components/ChatThread.tsx:46` 目前静默忽略 | [WorkBuddy](https://www.codebuddy.cn/docs/workbuddy/Conversation) 的可编辑队列；[Claude Code](https://code.claude.com/docs/en/interactive-mode) 灰色排队与 Up 取回 | 只留一种行为，当前回合结束后发送。**不要**学 Codex 的 Steer/Queue 双模式，[官方论坛](https://community.openai.com/t/a-practical-codex-app-steer-workflow-splitting-a-task-into-staged-follow-ups/1377757)已有用户分不清。Claude Code 的头号报告是[排队消息被吞](https://claudeissues.com/issue/20860-bug-sometimes-claude-code-swallows-the-queued-messages)，所以队列要有测试覆盖，并在跳转时保留 |
| C4 | **写入回执加撤销，取代更多审批**（小）："已加入生词本：ubiquitous · 撤销" | 撤销令牌已在工具结果里（`DOMAIN/terms/capabilities.ts:90,96`）但对话不渲染；`DOMAIN/shared/undo.ts:11` 为 10 分钟 | Anthropic 称用户接受 93% 的提示，并以审批疲劳作为推出 auto 模式的理由（[工程博客](https://www.anthropic.com/engineering/claude-code-auto-mode)，未说明测量方式）；[WorkBuddy](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes) 默认在边界内放行 | 这也是在补一个缺口：`default` 模式下 `add_to_wordbook`、`mark_term` 现在静默写入（`KERNEL/capabilities.ts:50-60`），用户完全看不到。保留 `remember` 的确认和污染门控，这两者不能放宽 |
| C5 | **练习结束的下一步，填入不发送**（小）：测验完出现"讲讲错的 X"，点击填入输入框 | 卡片结果只在下一轮以一行文本带给模型（`KERNEL/conversations.ts:138-141`），`UI/components/Widgets.tsx:70` 已有错题摘要 | [WorkBuddy 跟进建议](https://www.codebuddy.cn/docs/workbuddy/Conversation)、[Qoder 推荐卡](https://docs.qoder.com/user-guide/chat/overview)、[Codex Predictions](https://learn.chatgpt.com/docs/features/composer-predictions)都是填入而不发送，已成惯例 | 从卡片结果确定性生成，不调模型，因为用户自付费用。沿用 Claude Code 的[退避规则](https://code.claude.com/docs/en/interactive-mode)，被忽略多次就减少。不自动回复也符合只在自然断点提示的 A5。顺便补上事件：`quiz_done` 只有类型定义和读取，代码中没有写入方（字面量搜索），学习记录缺这一环 |
| C6 | **先让学习者写的产出卡**（大）：给语境和任务，硬停等待，只点评一处 | 新增卡片种类，走 `capability.widget`（`packages/core/src/rpc/define.ts:55-56`）；与 `DOC05:292` 的动词"批改"和"引导而非给答案"的人设（`KERNEL/skills.gen.ts:30`）一致 | Claude Code Learning 风格的 "Learn by Doing"（[文档](https://code.claude.com/docs/en/output-styles)）；选项卡约束 2–4 项加自由输入（[SDK](https://code.claude.com/docs/en/agent-sdk/user-input)）；Codex 的[逐行批注](https://learn.chatgpt.com/docs/code-review?surface=app)可映射为逐处接受改正 | **【假设】** 这是学习效果提升最大的一项，但没有任何来源在学习者身上验证过，Claude Code 文档也说风格只是指令而非保证，所以"先写后评"要由卡片逻辑强制。素材必须来自用户正在读的文章，否则会滑向被明确排除的语法课体系 |

第二梯队的改动都小，但证据或优先级弱一些。**运行中的旁问**（[Claude Code `/btw`](https://code.claude.com/docs/en/interactive-mode)、[Codex `/side`](https://learn.chatgpt.com/docs/reference/slash-commands)）概念上很适合学习，但 **【推断】** C2 已覆盖大部分查词需求，tibi 回合又短，建议等 C2 上线后再评估。**记忆可见性**可以用 Claude Code 的 ["Saved 2 memories"](https://code.claude.com/docs/en/memory) 状态行，并链接到已有的记忆管理（`DOMAIN/memory/index.ts:89-109`），这样记忆召回不再是黑箱。**模型选择持久化**应趁 Composer 未提交时一并考虑：现在只存在组件状态里，重启就回到自动（`UI/components/ChatThread.tsx:31,38`），Qoder 用户正[抱怨过同样的问题](https://forum.qoder.com/t/qoder/9303)。**首页示例**可用 WorkBuddy 的悬停灰字预览，不提交也不进草稿（[创建任务文档](https://www.codebuddy.cn/docs/workbuddy/Create-Task)），替换 `UI/pages/Home.tsx:172-175` 的两个固定胶囊并兑现 `DOC05:293`。**导航与查找**方面，⌘K 目前只搜标题（`DOMAIN/search/methods.ts:53-55`），可扩到消息内容（[Cherry 全局搜索](https://docs.cherryai.com.cn/advanced-basic/workbench/global-search.md)），长对话可加 [WorkBuddy 的提问导航条](https://www.codebuddy.cn/docs/workbuddy/Conversation)。**回访摘要**可参考 Claude Code 的 3 分钟加 3 轮门槛（[文档](https://code.claude.com/docs/en/interactive-mode)），但它要花模型费用，宜放到按需触发。首批读者是程序员（`DOC00:11-13`），`UI/lib/md.tsx:11` 缺代码复制按钮也值得补。语音听写属于低优先级，它不违反"不做跟打"，但 Codex 把[听写和实时语音](https://learn.chatgpt.com/docs/features/voice)分得很清楚，tibi 只应考虑前者。

另有一条贯穿性的约束：输入框默认控件要设硬上限。Cherry 的工具栏曾长到有用户说[又长又乱](https://github.com/CherryHQ/cherry-studio/issues/5528)，v2 才收敛到 [4 个固定工具加一个面板](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat)。tibi 现在只有 `/` 和模型选择，正处在最干净的时候，后续功能应优先进 `/`。同时，决策卡要留在线程内，不能抢输入框焦点：Cherry 曾因审批卡替换输入框而[打断输入法组合](https://github.com/CherryHQ/cherry-studio/issues/18740)。tibi 目前的做法是对的，别改回去。

## 不该借的东西，多数是开发者场景的代价

下表分两类：一类是 tibi 已明确决定不做的，不需要再讨论；另一类没有写进非目标，属于本报告的判断，可以被新证据推翻。

| 不借 | 来源 | 理由 | 性质 |
|---|---|---|---|
| `@` 点名、专家/智能体列表、多智能体团队 | Cherry、[WorkBuddy](https://cloud.tencent.cn/developer/article/2665917)、Qoder | C1/C2（`DOC05:306-307`）；Cherry 的文档还要专门[解释 Assistant 和 Agent 的区别](https://docs.cherryai.com.cn/docs/en-us/cherry-studio/preview/chat) | 明确非目标 |
| 技能市场、用户自建技能、插件 | Cherry、WorkBuddy、Claude Code | `DOC00:25`、B5 | 明确非目标 |
| 定时任务、收件箱、自我唤醒 | [Codex](https://learn.chatgpt.com/docs/automations?surface=app)、[WorkBuddy](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide)、Qoder | `DOC00:25`、B7。笔记里"用定时任务做间隔复习"的联想同样越界 | 明确非目标 |
| 账号、云端接力、IM/微信审批、积分 | WorkBuddy、Qoder、Codex | `DOC00:24,27`；手机范围有意收窄（`DOC00:446`） | 明确非目标 |
| 消息上显示模型、花费、上下文用量 | Cherry、Claude Code、Codex | C5（`DOC05:310`）。费用透明的诉求放到 A9 和运行记录解决 | 明确非目标 |
| 任意代码、HTML 产物预览、远程图片 | Cherry、Codex、Qoder | `DOC05:183,200` | 明确非目标 |
| 课程式目标进度条（如"用过去完成时 5 次"）、结构化学习计划 | [Codex `/goal`](https://learn.chatgpt.com/docs/long-running-work)、Plan 模式 | 滑向语法课体系（`DOC00:21`） | 明确非目标的延伸 |
| 多模型并排 | [Cherry](https://docs.cherryai.com.cn/advanced-basic/chat/model-compare-branches.md) | 费用翻倍，对学习价值低；Cherry 文档自己也提醒注意成本和速度 | 判断 |
| 分支画布 | Cherry、Qoder | 对学习者过重；C1 的线性重试已足够。若验证有"保留原答案对比"的需求，再做同一条消息的版本切换 | 判断 |
| 多档权限模式 | [Cherry 5 档](https://docs.cherryai.com.cn/advanced-basic/agent-workspace/permissions-memory-background.md)、[Claude Code](https://code.claude.com/docs/en/permission-modes) | Cherry 用户[找不到开关](https://github.com/CherryHQ/cherry-studio/issues/22154)；tibi 只写本地库，三档已够 | 判断 |
| 计划模式、Spec 门控 | Claude Code、[Qoder Quest](https://docs.qoder.com/ja/user-guide/quest/spec-driven)（Quest 已[退役](https://docs.qoder.com/release-notes/quest-retirement-notice)） | 解决的是大改动返工，tibi 回合短，没有这种风险 | 判断 |
| 右侧任务监控或产物面板 | WorkBuddy、Qoder、Cherry | 为长时间无人值守设计；tibi 已有运行记录，阅读器面板也另有用途 | 判断 |
| 展示原始思考过程 | Claude Code、Codex | 用户要它是为了监督智能体（[#8477](https://github.com/anthropics/claude-code/issues/8477)），学习者动机不同。"讲解语法选择的理由"可能有教学价值，但应作为回答内容，未经测试 | 判断（可重审） |
| 系统级划词助手 | [Cherry](https://docs.cherryai.com.cn/cherry-studio/preview/selection-assistant.md) | 全局钩子带来大量平台 bug，还要辅助功能权限；tibi 的阅读器才是主场 | 判断 |
| 后台自动提取记忆、屏幕记忆 | [WorkBuddy](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Memory)、[Codex Chronicle](https://www.neowin.net/news/openai-introduces-chronicle-for-codex-a-recall-like-memory-feature-for-developers-on-macos/) | 消耗用户费用且有隐私顾虑；`archivist` 手动触发是现有选择（`KERNEL/skills.gen.ts:115`） | 判断 |
| MCP 客户端 | 五款产品几乎都有 | 没有写入非目标，但会扩大污染面，也与"只暴露动词"相悖；tibi 作为 MCP 服务端已够 | 判断 |
| 输入框拼写检查 | [Claude Code](https://code.claude.com/docs/en/interactive-mode) | 会替学习者抢先发现本该由 Tibi 点评的错误 | 判断（未测试） |

也要为反对意见留位置。用户最先感知到的是消息操作行，先做 C1 看起来更划算，但 tibi 目前既无法保留部分回答，也无法恢复运行中的状态，这时候加"重新回答"只会让这些问题出现得更频繁，所以 A1、A3 必须在前。另一个反方观点是，竞品的折叠和思考展示都引来过强烈反弹，tibi 是否也该多展示一些？这些反弹来自重度开发者，他们要靠细节及早纠偏，学习者的动机不同。这个判断本身未经验证，所以应保留"查看过程"，并尽快找真实学习者测试。

## 证据边界决定了哪些结论可以直接动手

可以直接动手的是 A 组，代码本身就是证据，只需复现确认，`--fake-model` 能离线驱动（`README.md:58`）。需要先小范围验证的是 C2、C5、C6 的学习价值，所有来源都没有学习者数据。竞品资料时效也有差异：Codex 桌面版已于 2026-07-09 并入 ChatGPT 桌面应用（[Every](https://every.to/context-window/the-urge-to-merge-chatgpt-and-codex)），Qoder Quest 已退役，部分 Cherry 和 Claude Code 投诉早于当前版本；多数文档是经摘要工具读取的，具体界面细节不如功能描述可靠。tibi 一侧未读的文件有 `UI/App.tsx`、`UI/pages/Tasks*`、`UI/pages/Reader*`、`docs/design/02-ai-assistant.md` 和 `docs/DECISIONS.md`，其中可能已有全局 Esc 处理、对智能体写入的撤销入口或相关决策，动手前应先查。工作区也未构建、未跑测试。

## Conclusion

这次对比改变了问题的提法：tibi 不缺"agent 产品的功能"，缺的是把已有 harness 的可靠性传到对话线程。持久任务、检查点、撤销令牌、`tasks.retry`、`edit` 决策、`summary` 字段都已存在，只是对话页没有接上，所以这批修复的成本低于"缺这么多功能"给人的印象。建议的顺序是 A 组、三项已拍板设计、C1 至 C5，C6 单独做一次学习者验证。

更深一层的结论是，五款产品的进化方向都在让智能体替用户多做事，而学习产品的价值恰恰在于让用户自己多做一点，所以照搬"更少确认、更多自动"只适用于生词本这类记账式写入，不适用于学习本身。**【假设】** 判断一项借鉴是否成立，可以问一句：它是减少了学习者的管理负担，还是减少了学习者的思考？前者应该借，后者即使在 Codex 上广受好评也不该借。
