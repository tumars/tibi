# 现在定了什么

> 单页索引：每条一句话，细节看真相源。历史经过见 [`CHANGELOG.md`](CHANGELOG.md)。

## 术语

| 词 | 意思 |
|---|---|
| **Tibi** | 用户面对的唯一角色：产品、吉祥物藏狐、AI 助手同名 |
| **技能** | 内部的词：Tibi 会做的事里由模型驱动的那几项，每项一份 `SKILL.md`，运行时一个子对话。界面上统一叫"Tibi 能做的事"（R14），不叫"智能体" |
| **能力** | 确定性的代码单元，同一份定义供技能、MCP、界面调用。**能力 = 工具**：对模型和 MCP 说"工具"时指的就是它 |
| **任务** | 一次运行及其步骤，在任务中心可见 |
| **pi** | 开源 harness，`pi-ai` 接模型，`pi-agent-core` 跑 agent 循环；对话与任务由我们自己的 `TibiKernel` 存（R9）。内部依赖，界面不出现 |

## 产品与范围

| # | 决定 | 真相源 |
|---|---|---|
| P1 | Tauri 2 桌面应用 | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| P2 | shadcn/ui + Tailwind | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| P3 | MIT；项目名 Tibi（缇比） | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| D6 | v1 单用户 | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| D8 | 桌面最小 960px；手机端是独立的壳，排在 M7 | [00 §3.13](design/00-concept-design.md#313-手机端d8) |
| J1–J10 | 手机端（2026-10-31 按 iOS 调研改版）：标签栏"今天 / 书架 / 复习 / 我"、阅读器全屏不占标签、去掉浮动按钮；J9 首页去掉顶栏，左下角狐狸即"今天"，输入条常驻、对话接在首页卡片下面；J10 外观照 iOS 原生应用（系统色、无描边卡片、胶囊按钮、实心选中图标、设置式列表）；Safari 分享扩展导入；阅读器滚动收起工具栏、读完卡片带撤销；词卡两档高度；复习操作全在下半屏、不做滑动评分；主屏与锁屏小组件（狐狸不做惊慌）；每日一条提醒 | [00 §3.13](design/00-concept-design.md#313-手机端d8)、[research/06](research/06-ios-apps.md) |
| — | 首发人群：读英文技术文档和博客的程序员 | [00 §1](design/00-concept-design.md#1-产品定位) |
| R1 | M1 成功标准：预标注改动 ≤ 15%、7 天内自己导入 ≥ 40%、次日复习 ≥ 30%；本地统计 + 5–10 人访谈，一键导出脱敏汇总，不做上报 | [00 §6](design/00-concept-design.md#m1-成功标准) |
| R2 | 版本规划 M0–M7：M1 最小闭环含词汇测试、预标注、语境释义、简版 FSRS、剪藏、统计导出 | [00 §6](design/00-concept-design.md#里程碑) |
| R3 | 引导两步：认识一下、读第一篇；示例带预生成 AI 结果；测试在读完第一篇时提议，连模型到第一次用 AI 时才要求 | [00 §3.9](design/00-concept-design.md#39-首次启动引导onboarding) |
| R4 | M1 做轻量剪藏插件：只"发送到 Tibi"，经深链传 URL，确认后才抓取 | [00 §3.1](design/00-concept-design.md#31-文章导入import) |

### 已砍

2026-10-31 随 R2 砍掉，已从规格里拿掉。

| 项 | 说明 | 真相源 |
|---|---|---|
| 跟打练习 | 练习只留听写原句、易混词辨析 | [00 §3.3](design/00-concept-design.md#33-生词本与每日练习vocabulary--review) |
| 自定义技能（原 B5） | 用户不能新建或安装；内置技能仍用 `SKILL.md`，这是内部实现 | [05 §5](design/05-agent-architecture.md#5-技能的定义格式skillmd) |
| 例行任务（原 B7） | 没有定时运行；找文章、整理记忆改为手动触发 | [05 §12](design/05-agent-architecture.md#12-决策) |

## 阅读与书架

| # | 决定 | 真相源 |
|---|---|---|
| D1 | "可能不认识"用第三种轻量状态，一键确认；中间带 N 到 N+3000（取原型现值） | [00 §3.1](design/00-concept-design.md#31-文章导入import) |
| D2 | 六档熟练度 + 忽略，界面不显示数字；另有 97 标为已知（R5） | [00 §3.2](design/00-concept-design.md#32-沉浸式阅读面板reader核心界面) |
| D4 | OCR 默认本地 Tesseract，可选视觉模型 | [research/03 §3](research/03-tech-survey.md#3-内容导入与识别) |
| D5 | 释义语言可设，默认中文语境释义 + 可展开英英 | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| D7 | 译文开关默认关，另有句级按需翻译 | [00 §3.2](design/00-concept-design.md#32-沉浸式阅读面板reader核心界面) |
| D9 | 首页发送后进独立对话页；右侧抽屉只给阅读器、生词本、任务中心 | [00 §3.5](design/00-concept-design.md#35-首页与书架home--library) |
| D10 | 书架三维度：形态、类型、标签 | [00 §3.1](design/00-concept-design.md#31-文章导入import) |
| R5 | 新增 97 标为已知（不建卡、计入已知词、不等于掌握）；批量只把 status = 0 设为 97，不动待确认词；点开生词自动进"见过"并建卡，受每日新卡上限约束 | [00 §3.2](design/00-concept-design.md#32-沉浸式阅读面板reader核心界面) |
| D11 | 生词本按智能视图组织，词族合并，词条不单独打标签 | [00 §3.3](design/00-concept-design.md#33-生词本与每日练习vocabulary--review)、[01 §3](design/01-database.md#3-词条已知词库核心) |

## 复习

| # | 决定 | 真相源 |
|---|---|---|
| D3 | 一词一卡，题型随熟练度递进；R6 后计分复习只有识别、选义、填空，M1 只有选义、填空 | [00 §3.3](design/00-concept-design.md#33-生词本与每日练习vocabulary--review) |
| G1–G8 | 系统评分、选义、首次作答算数、初见、主动提示、可续、完成页、不计分练习（无跟打，排在后续） | [research/05 §3](research/05-word-atlas-review.md#3-建议g-组复习) |

## AI 与技能

| # | 决定 | 真相源 |
|---|---|---|
| A1 | 默认 DeepSeek；模型名是配置项，默认跟随 pi-ai 目录（`deepseek-flash` / `deepseek-v4-pro`，T6） | [00 §3.7](design/00-concept-design.md#37-设置settings) |
| A2、B6 | v1 不做 ACP；外部工具走 MCP；不做账号登录 | [05 §10](design/05-agent-architecture.md#10-外部-ai-工具对-a2a6-的影响) |
| A3 | 三档权限，默认标词自动、其余询问 | [02 §6](design/02-ai-assistant.md#6-工具learning-tools) |
| A4 | 记忆检索 v1 用 FTS5，不用向量 | [02 §5.2](design/02-ai-assistant.md#52-检索) |
| A5 | 只在自然断点轻提示 | [02 §7](design/02-ai-assistant.md#7-交互形态) |
| A6 | 提供 MCP Server；`tibi mcp` 只做代理，默认只读白名单 | [06 §6](design/06-interface.md#6-mcp-server) |
| A7 | Tibi 名字固定；称呼与对话语言可改 | [02 §9](design/02-ai-assistant.md#9-决策) |
| B1 | harness 用 `pi-ai` + `pi-agent-core`，对话与任务由 `TibiKernel` 自建（R9 调整） | [05 §12](design/05-agent-architecture.md#12-决策) |
| B2 | Tibi Core 独占 `app.db`，单实例 | [05 §3](design/05-agent-architecture.md#3-进程架构) |
| B3 | 5 项内置技能 + 导入流水线（R10），技能内部格式 `SKILL.md`，只能用能力层 | [05 §4.3](design/05-agent-architecture.md#43-技能清单)、[§5](design/05-agent-architecture.md#5-技能的定义格式skillmd) |
| B5 | 已砍：自定义技能（见"已砍"） | [05 §12](design/05-agent-architecture.md#12-决策) |
| B7 | 已砍：定时任务（见"已砍"） | [05 §12](design/05-agent-architecture.md#12-决策) |
| B8 | 先做技术验证 | [05 §11](design/05-agent-architecture.md#11-风险与验证) |
| C1–C5 | 用户只见一个 Tibi；`/` 代替 @；过程默认收起 | [05 §13](design/05-agent-architecture.md#13-用户可见层一个-tibi多项技能2026-10-29-已确认) |
| — | 不提供账号登录：Claude 订阅登录被 Anthropic 条款禁止，ChatGPT 条款未核实；Anthropic API Key 可用 | [05 §10](design/05-agent-architecture.md#10-外部-ai-工具对-a2a6-的影响) |

## 数据、接口与安全

| # | 决定 | 真相源 |
|---|---|---|
| — | 表结构、删除语义、索引、迁移 | [01](design/01-database.md)、[01 §9](design/01-database.md#9-约束与迁移) |
| — | 接口只改 `_src/build_interface.py`，06 与总览页同源生成 | [06](design/06-interface.md) |
| — | 安全规则：不可信内容、入口校验、CSP、密钥 | [05 §8](design/05-agent-architecture.md#8-权限审批与安全) |
| — | 失败路径：预算预留、稍后补做、幂等 | [06 §1](design/06-interface.md#1-约定) |

## 视觉与吉祥物

| # | 决定 | 真相源 |
|---|---|---|
| V1–V3 | 采用 v2"安静的 AI 工作台"，强调色靛蓝 `#3d52e0`（原电光蓝，2026-10-31 收一档），词卡浮层 | [04 §5](design/04-design-direction-v2.md#5-决策2026-10-29) |
| — | 字体、色板、圆角 6 / 8 / 12 | [03](design/03-visual-language.md) |
| F1–F4 | 插画软 3D + 设定图参考；3D 只做三处；Rive 留给有设计师时 | [research/04 §4.4](research/04-mac-native-and-mascot.md#44-建议的决策f-组吉祥物) |
| F5 | SVG 与插画不同框，按位置分用 | [03 §7.2](design/03-visual-language.md#72-插画与封面) |
| — | 配色只在一处定义 | [03 §7.1](design/03-visual-language.md#71-吉祥物藏狐-tibi缇比) |
| — | 素材清单、提示词、出图流程 | [07](design/07-mascot-assets.md) |

## 2026-10-31 评审确认（R6–R17 及其他）

按评审推荐确认。细节以真相源为准。

| # | 决定 | 真相源 |
|---|---|---|
| R6 | 计分复习只有识别、选义、语境填空三种；听写、拼写、造句移到不计分的练习（练习四种：听写原句、拼写、易混词辨析、造句），M3 起 | [00 §3.3](design/00-concept-design.md#33-生词本与每日练习vocabulary--review) |
| R7 | 阅读中再次遇见只作弱信号，不更新 FSRS | [00 §3.3](design/00-concept-design.md#33-生词本与每日练习vocabulary--review)、[01 §3](design/01-database.md#3-词条已知词库核心) |
| R8 | 词汇测试 7 组，4k–10k 拆成三组加密，每组 2 个伪词，读完首篇修正一次；已知词曲线拆成实测 / 估算 | [00 §3.9](design/00-concept-design.md#39-首次启动引导onboarding)、[01 daily_stats](design/01-database.md#daily_stats每日汇总便于统计页快速查询) |
| R9 | 不用 `pi-durable`：`pi-ai` + `pi-agent-core`，对话、消息、任务、步骤检查点、用量自建表（`TibiKernel`）；M0 验证改为一到两周 | [05 §1、§6、§11](design/05-agent-architecture.md#6-运行机制tibikernelr9-后自建)、[01 §7](design/01-database.md#7-技能tibi-的能力扩展) |
| R10 | 导入是固定流水线，不是模型驱动的技能；AI 只做其中的生成步骤，离线先完成本地部分；用户触发免审批。技能剩 5 项 | [05 §4.3](design/05-agent-architecture.md#43-技能清单) |
| R11 | 主键 UUIDv7，可同步的表带 `updated_at` 与墓碑，`review_logs` / `learning_events` 只追加；Core 写成不依赖 Node 的 TS 包 | [01 约定、§9](design/01-database.md#9-约束与迁移) |
| — | 手机可以单独用：手机自带 Core、自己的库和 API Key，电脑不开机也能导入、问 Tibi、复习；两端靠同步合并 | [00 §3.13](design/00-concept-design.md#313-手机端d8) |
| S1–S7 | 同步（2026-10-31 第一版）：iCloud Drive / WebDAV 共享文件夹 + 变更文件，每台设备只写自己的文件夹；按字段比较 HLC 后改的赢，自动推断不覆盖用户亲手改的；复习卡片按记录重算；原始文件默认同步可关；同步默认关；**暂不做端到端加密**；局域网直连以后再做；M7 实现，M1 只遵守 08 §9 | [08](design/08-sync.md) |
| — | 对话：电脑一次一页、手机一天一页，同一个数据模型（`conversations.kind`）；同步后互相可见（"10 月 31 日 · 手机"） | [00 §3.5、§3.13](design/00-concept-design.md#313-手机端d8)、[01 conversations](design/01-database.md#conversations对话) |
| R12 | 纯开源 + 自带 Key，不做托管、不收费、不经手用户数据 | [00 §1](design/00-concept-design.md#1-产品定位) |
| R13 | 电脑首页去掉模式切换，按内容判断（网址或长段英文 → 导入，含"推荐 / 找"→ 找文章，其余问 Tibi，`/` 可手动指定）；继续读升为最上面的主卡 | [00 §3.5](design/00-concept-design.md#35-首页与书架home--library) |
| R14 | 界面统一叫"Tibi 能做的事"，"技能"只在查看过程与设置 → 高级里出现；实现词不上界面 | [00 §3.10](design/00-concept-design.md#310-tibi-与技能) |
| R15 | 设置里的模型、能做的事、花费上限、MCP 收进"高级"（默认折叠）；生词本左栏 4 个视图：全部 / 今天到期 / 难词 / 不在复习里 | [00 §3.7、§3.3](design/00-concept-design.md#37-设置settings) |
| R16 | 打开文章直接回到上次位置，给"回到开头"；不再弹 8 秒提示 | [00 §3.2](design/00-concept-design.md#32-沉浸式阅读面板reader核心界面) |
| R17 | 统计空状态改用专属插画 `empty-stats`（已加进 07 清单，待出图，出图前仍用 SVG）；首页 `#empty` 保留 | [03 §7.2](design/03-visual-language.md#72-插画与封面) |
| E1–E8 | E1、E2、E5、E7、E8 采用；E4 不采用（继续用品牌靛蓝）；E3、E6 采用做法但数值不改（13.5px、6 / 8 / 12、控件 30px） | [research/04 §3](research/04-mac-native-and-mascot.md#3-建议的决策e-组界面)、[03 §10](design/03-visual-language.md#10-待讨论) |
| — | 账号登录不做：ChatGPT 条款未核实，从 M5 拿掉；只用 API Key | [05 §10](design/05-agent-architecture.md#10-外部-ai-工具对-a2a6-的影响) |
| — | 正式版不打包普惠体，各平台用系统中文字体 | [03 §2](design/03-visual-language.md#2-字体) |
| — | 排期跟随 ts-fsrs 6 默认的 FSRS-7（多一个短期稳定度、按小数天） | [01 §4](design/01-database.md#4-复习fsrs) |
| — | 预算默认每月 ¥20、单个任务 ¥1 | [05 §8](design/05-agent-architecture.md#8-权限审批与安全) |
| — | Anki 导出放进 M3，和完整生词本一起做 | [00 §6](design/00-concept-design.md#里程碑) |

## M0 技术决定（T 组）

2026-10-31 开工时定，细节见 [`docs/dev/README.md`](dev/README.md)。

| # | 决定 | 原因 |
|---|---|---|
| T1 | pnpm 工作区：`packages/core`（纯 TS 业务逻辑，不依赖 Node 专有 API）、`packages/core-node`（Node 运行时与 sidecar）、`apps/desktop`（Tauri 2 + React） | R11：同一份 Core 以后放进手机 |
| T2 | 不用 Drizzle：Core 经 `Driver` 接口（exec / run / all / get，全异步）访问 SQLite；表结构以 `packages/core/sql/NNNN_*.sql` 为唯一真相源，查询手写 SQL | 避免 30 张表的重复定义；换驱动（better-sqlite3 / 手机 SQLite / 内存）不碰业务代码 |
| T3 | 事务串行化：`Database.transaction()` 用一把互斥锁 + `BEGIN IMMEDIATE`，事务体可以是 async | Core 是唯一写入者（B2），串行最简单也最稳 |
| T4 | 迁移只向前，版本记 `PRAGMA user_version`；SQL 由运行时读入再交给 Core | 01 §9 |
| T5 | 传输：stdio 每行一条 JSON-RPC；事件帧 `method: 'event'`；Core 向壳取密钥用反向请求 `secret.get`（id 以 `h-` 开头）；开发时另有同协议的 WebSocket 桥（`pnpm core:dev`），界面可在浏览器里开发。回答了 06 §8 "事件是否改 WebSocket"：M0 不改，桥只用于开发 | 05 §8 密钥不进 Core 的持久化；开发不必每次编译 Rust |
| T6 | 默认模型名跟随 pi-ai 的目录：DeepSeek 目录里是 `deepseek-flash`（V4.1 Flash）与 `deepseek-v4-pro`，没有文档原来写的 `deepseek-v4-flash` | 模型名本来就是配置项（A1），以库的目录为准，少一处手写 |
| T7 | HTML → Markdown 自己写了一个小转换器（标题、段落、列表、引用、代码块、行内代码、强调），不引入 turndown；正文抽取用 Readability + linkedom | 只需要 01 §2 约定的那几种结构；少一个依赖 |
| T8 | 网址校验在 core-node：只收 http(s)，DNS 解析后拒绝回环 / 内网 / 链路本地地址，重定向每跳重查（05 §8） | — |
| T9 | 词典 `dict.db` 由 `pnpm ecdict` 从 ECDICT 生成，不进仓库；Core 经 `Dict` 接口查词、还原、取词频，没有词典时退化为规则还原 | 01 §8 |
| T11 | sidecar 用 Bun `--compile` 打单文件（SQLite 走内置 `bun:sqlite`），不用 Node SEA；迁移 SQL 由 `scripts/build-sql.mjs` 内嵌进 Core | 实测 Linux：Bun 105 MB / 114 ms，SEA 119 MB 且原生模块要另放；单文件省掉分发 `.node` 的麻烦 |
| T12 | 事务嵌套按调用链判断：事务体拿到专门的事务句柄，只有在它上面再开事务才复用；外层句柄上的事务一律排队（修正 T3 的实现：原来用全局计数，并发的两个流程会被误当成嵌套而绕过互斥） | 导入流水线并行写步骤时撞了唯一索引 |
| T13 | ECDICT 入库：只是变形页、自己没有词频的词头（makes → 0:make）不映射到自己；词形有多个候选原形时，Core 按词频挑最常见的（was → be，left → leave）。CSV 里字面的 `\n` 入库时还原成换行 | 带完整词典后 is、makes、languages 被当成生词 |
| T14 | 桌面界面用 HashRouter（Tauri 下没有服务端路由）；开发时 `?mock=1` 用内存假数据，不依赖 Core | — |
| T15 | 复习：`review.answer` 不推进游标，看完评分行后调 `review.next`；每日新卡上限按"今天首次作答的新卡数"计；`review.start` 在一个事务里查找或新建会话（界面重复调用时续上同一轮） | 实现中定下 |
| T16 | 内置示例的正文与预生成结果放在 `packages/core/samples/<id>/`（`article.md` + `ai.json`），构建成 `samples.gen.ts` 内嵌进 Core（R11：Core 不读文件系统）。导入走同一条流水线，最后一步把总结、建议、短语、长难句写成文档级 `ai_results`，语境释义按句写（`task = context_meanings`，键是 lemma），`model = 'bundled'`、`provider_id` 为空；示例不标 deferred | M1 内置示例 |
| T17 | 任务取消立即生效：步骤函数不看 abort signal 时，`job.step` 也不再等它跑完，直接以取消结束（这一步的结果丢弃、不写检查点） | 原来取消要等当前步骤自然结束，测试里会卡 5 秒 |
| T18 | M1 的模型调用只有一种：`completeOnce`（内核里的一次性调用，不建任务、不走技能，照样查预算、记 usage_records），经 `Ctx.ai.complete` 给领域方法用。语境释义（`terms.context_meaning`）和测试连接（`providers.test`）都走它；语境释义按固定提示写、句子当不可信材料放在分隔符里，输出清洗成一行 ≤40 字再缓存 | M1 语境释义；M2 起换成讲解技能 |
| T19 | 剪藏插件点按钮时用 `tabs.update(当前标签页, tibi://import?url=…)` 打开深链（浏览器弹"要打开 Tibi 吗"，页面不离开），不弹自己的面板。桌面端在 Windows / Linux 加 `tauri-plugin-single-instance`（deep-link 特性），第二个进程带来的深链转给已开的窗口；macOS 由系统直接交给运行中的应用 | R4 剪藏插件 |
| T20 | 导入后的 AI 分析不走模型驱动的技能，而是三次固定提示的快速档调用（completeOnce，JSON 输出，宽松解析，正文放在分隔符里当不可信材料）；作为独立的 `analyze` 任务排在导入之后，导入任务不等它。后台自动任务（trigger = auto）完成时界面不弹通知 | R10：导入是固定流水线；先读后分析 |
| T21 | 文件抽取放在 core-node（Platform.extractFile）：EPUB 用 fflate 解压 + linkedom 读 OPF / 目录，PDF 用 pdfjs-dist 4（legacy 构建，先把 worker 模块挂到 `globalThis.pdfjsWorker`，单文件 sidecar 里才找得到），DOCX 用 mammoth；都转成 Markdown 交给 Core 切分。sidecar 打包的 banner 里 `createRequire` 改名，避免和 pdfjs 冲突。书导入只标前两章（LAZY_EAGER = 2），其余在 sections.get 时补标 | M4 多格式 |
| T22 | OCR 用 tesseract.js 5（Platform.ocr，在 Core 进程的 worker_threads 里跑）：语言包按需下载到 `tessdata/`；扫描版 PDF 用 pdfjs 的 operator list 取每页最大的图，自己编成 PNG；分段按"比这页最小行间空白大 1.7 倍"。打包时 worker 单独打成 `tesseract-worker.cjs`，和 tesseract.js-core 的 wasm 一起放进安装包 `resources/ocr/`，壳用 `TIBI_RESOURCE_DIR` 告诉 Core | D4 |
| T10 | 复习用 ts-fsrs 6.0 的 `DefaultScheduler`（FSRS-7 默认），卡片字段按库的命名映射到表（`stability_fast` ← `stabilityFast`、`learning_steps` ← `learningStep`） | 01 §4 |

## 待决定

| 事项 | 为什么还开着 | 出处 |
|---|---|---|
| 商标与域名 | 只做过公开检索（2026-10-31）：挪威国家图书馆有一款无障碍阅读应用叫 **Tibi**（Tibi Library）；纽约时装品牌 **TIBI** 是知名商标（服装类）；`tibi.app` 在域名交易平台挂售，`tibi.ai` 已被注册。软件类（第 9、41、42 类）是否有冲突需要查商标库（中国、美国、欧盟），要你决定查哪些地区、是否考虑备选名或加后缀 | [overview 第 11 节](design/overview.html#decisions) |
| 接口细节 | `chat.send` 的 context、长章节分页、MCP 资源、事件通道（M0 / M1 实现时定） | [06 §8](design/06-interface.md#8-待定) |
| 数据细节 | `sections` 修订、`excerpt`、`learning_events` 是否派生（M1 实现时定） | [01 待定事项](design/01-database.md#待定事项) |
| 视觉细节 | 手机横屏、深色对比度 | [03 §10](design/03-visual-language.md#10-待讨论) |
