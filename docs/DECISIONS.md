# 现在定了什么

> 单页索引：每条一句话，细节看真相源。历史经过见 [`CHANGELOG.md`](CHANGELOG.md)。

## 术语

| 词 | 意思 |
|---|---|
| **Tibi** | 用户面对的唯一角色：产品、吉祥物藏狐、AI 助手同名 |
| **技能** | 内部的词：Tibi 会做的事里由模型驱动的那几项，每项一份 `SKILL.md`，运行时一个子对话。界面上统一叫"Tibi 能做的事"（R14），不叫"智能体" |
| **能力** | 确定性的代码单元，同一份定义供技能、MCP、界面调用。**能力 = 工具**：对模型和 MCP 说"工具"时指的就是它 |
| **一轮回答** | 一句用户消息加上 Tibi 为它说的话和调的工具，就是对话里的一段消息（`turn_id`）。没有单独的"任务"（T35） |
| **pi** | 开源 harness，`pi-ai` 接模型，`pi-agent-core` 跑 agent 循环；对话由我们自己的 `TibiKernel` 存（R9，T35 调整）。内部依赖，界面不出现 |

## 产品与范围

| # | 决定 | 真相源 |
|---|---|---|
| P1 | Tauri 2 桌面应用 | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| P2 | shadcn/ui + Tailwind | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| P3 | MIT；项目名 Tibi（提比；2026-11-01 由「缇比」改，好打） | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| D6 | v1 单用户 | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| D8 | 桌面最小 960px；手机端是独立的壳，排在 M7 | [00 §3.13](design/00-concept-design.md#313-手机端d8) |
| J1–J10 | 手机端（2026-10-31 按 iOS 调研改版）：标签栏"今天 / 书架 / 复习 / 我"、阅读器全屏不占标签、去掉浮动按钮；J9 首页去掉顶栏，左下角狐狸即"今天"，输入条常驻、对话接在首页卡片下面；J10 外观照 iOS 原生应用（系统色、无描边卡片、胶囊按钮、实心选中图标、设置式列表）；Safari 分享扩展导入；阅读器滚动收起工具栏、读完卡片带撤销；词卡两档高度；复习操作全在下半屏、不做滑动评分；主屏与锁屏小组件（狐狸不做惊慌）；每日一条提醒 | [00 §3.13](design/00-concept-design.md#313-手机端d8)、[research/06](research/06-ios-apps.md) |
| — | 首发人群：读英文技术文档和博客的程序员 | [00 §1](design/00-concept-design.md#1-产品定位) |
| R1 | M1 成功标准：预标注改动 ≤ 15%、7 天内自己导入 ≥ 40%、次日复习 ≥ 30%；本地统计 + 5–10 人访谈，一键导出脱敏汇总，不做上报 | [00 §6](design/00-concept-design.md#m1-成功标准) |
| R2 | 版本规划 M0–M7：M1 最小闭环含词汇测试、预标注、语境释义、简版 FSRS、剪藏、统计导出 | [00 §6](design/00-concept-design.md#里程碑) |
| R3 | 引导三步：认识一下、连接模型、读第一篇（2026-11-01 调整：连模型提前，可"先不连"；没连时每次打开先问一次）；示例带预生成 AI 结果；测试在读完第一篇时提议 | [00 §3.9](design/00-concept-design.md#39-首次启动引导onboarding) |
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
| D9 | 首页发送后进独立对话页；右侧抽屉只给阅读器、生词本~~、运行记录~~（运行记录 2026-11-04 去掉，T35） | [00 §3.5](design/00-concept-design.md#35-首页与书架home--library) |
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
| — | 失败路径：~~预算预留~~（T36 去掉）、稍后补做、幂等 | [06 §1](design/06-interface.md#1-约定) |

## 视觉与吉祥物

| # | 决定 | 真相源 |
|---|---|---|
| V1–V3 | 采用 v2"安静的 AI 工作台"，强调色靛蓝 `#3d52e0`（原电光蓝，2026-10-31 收一档），词卡浮层 | [04 §5](design/04-design-direction-v2.md#5-决策2026-10-29) |
| — | 字体、色板、圆角 8 / 10 / 16（2026-11-02 由 6 / 8 / 12 加大）；主按钮靛蓝带 2px 厚度，童趣方向第一步 | [03](design/03-visual-language.md) |
| F1–F4 | 插画软 3D + 设定图参考；3D 只做三处；Rive 留给有设计师时 | [research/04 §4.4](research/04-mac-native-and-mascot.md#44-建议的决策f-组吉祥物) |
| F5 | SVG 与插画不同框，按位置分用 | [03 §7.2](design/03-visual-language.md#72-插画与封面) |
| — | 配色只在一处定义 | [03 §7.1](design/03-visual-language.md#71-吉祥物藏狐-tibi提比) |
| — | 素材清单、提示词、出图流程 | [07](design/07-mascot-assets.md) |

## 2026-10-31 评审确认（R6–R17 及其他）

按评审推荐确认。细节以真相源为准。

| # | 决定 | 真相源 |
|---|---|---|
| R6 | 计分复习只有识别、选义、语境填空三种；听写、拼写、造句移到不计分的练习（练习四种：听写原句、拼写、易混词辨析、造句），M3 起 | [00 §3.3](design/00-concept-design.md#33-生词本与每日练习vocabulary--review) |
| R7 | 阅读中再次遇见只作弱信号，不更新 FSRS | [00 §3.3](design/00-concept-design.md#33-生词本与每日练习vocabulary--review)、[01 §3](design/01-database.md#3-词条已知词库核心) |
| R8 | 词汇测试 7 组，4k–10k 拆成三组加密，每组 2 个伪词，读完首篇修正一次；已知词曲线拆成实测 / 估算 | [00 §3.9](design/00-concept-design.md#39-首次启动引导onboarding)、[01 daily_stats](design/01-database.md#daily_stats每日汇总便于统计页快速查询) |
| R9 | 不用 `pi-durable`：`pi-ai` + `pi-agent-core`，对话、消息自建表（`TibiKernel`）。~~任务、步骤检查点、用量~~ 2026-11-04 去掉，见 T35；M0 验证改为一到两周 | [05 §1、§6、§11](design/05-agent-architecture.md#6-运行机制tibikernelr9-后自建)、[01 §7](design/01-database.md#7-技能tibi-的能力扩展) |
| R10 | 导入是固定流水线，不是模型驱动的技能；AI 只做其中的生成步骤，离线先完成本地部分；用户触发免审批。技能剩 5 项 | [05 §4.3](design/05-agent-architecture.md#43-技能清单) |
| R11 | 主键 UUIDv7，可同步的表带 `updated_at` 与墓碑，`review_logs` / `learning_events` 只追加；Core 写成不依赖 Node 的 TS 包 | [01 约定、§9](design/01-database.md#9-约束与迁移) |
| — | 手机可以单独用：手机自带 Core、自己的库和 API Key，电脑不开机也能导入、问 Tibi、复习；两端靠同步合并 | [00 §3.13](design/00-concept-design.md#313-手机端d8) |
| S1–S7 | 同步（2026-10-31 第一版）：iCloud Drive / WebDAV 共享文件夹 + 变更文件，每台设备只写自己的文件夹；按字段比较 HLC 后改的赢，自动推断不覆盖用户亲手改的；复习卡片按记录重算；原始文件默认同步可关；同步默认关；**暂不做端到端加密**；局域网直连以后再做；M7 实现，M1 只遵守 08 §9 | [08](design/08-sync.md) |
| — | 对话：电脑一次一页、手机一天一页，同一个数据模型（`conversations.kind`）；同步后互相可见（"10 月 31 日 · 手机"） | [00 §3.5、§3.13](design/00-concept-design.md#313-手机端d8)、[01 conversations](design/01-database.md#conversations对话) |
| R12 | 纯开源 + 自带 Key，不做托管、不收费、不经手用户数据 | [00 §1](design/00-concept-design.md#1-产品定位) |
| R13 | 电脑首页去掉模式切换，按内容判断（网址或长段英文 → 导入，含"推荐 / 找"→ 找文章，其余问 Tibi，`/` 可手动指定）；继续读升为最上面的主卡 | [00 §3.5](design/00-concept-design.md#35-首页与书架home--library) |
| R14 | 界面统一叫"Tibi 能做的事"，"技能"只在查看过程与设置 → 高级里出现；实现词不上界面 | [00 §3.10](design/00-concept-design.md#310-tibi-与技能) |
| R15 | 设置里的能做的事、花费上限、MCP 收进"高级"（2026-11-03 起不折叠，直接展开）；模型 2026-11-01 提为单独一级；生词本左栏 4 个视图：全部 / 今天到期 / 难词 / 不在复习里 | [00 §3.7、§3.3](design/00-concept-design.md#37-设置settings) |
| R16 | 打开文章直接回到上次位置，给"回到开头"；不再弹 8 秒提示 | [00 §3.2](design/00-concept-design.md#32-沉浸式阅读面板reader核心界面) |
| R17 | 统计空状态改用专属插画 `empty-stats`（已加进 07 清单，待出图，出图前仍用 SVG）；首页 `#empty` 保留 | [03 §7.2](design/03-visual-language.md#72-插画与封面) |
| E1–E8 | E1、E2、E5、E7、E8 采用；E4 不采用（继续用品牌靛蓝）；E3、E6 采用做法但数值不改（13.5px、6 / 8 / 12、控件 30px） | [research/04 §3](research/04-mac-native-and-mascot.md#3-建议的决策e-组界面)、[03 §10](design/03-visual-language.md#10-待讨论) |
| — | 账号登录不做：ChatGPT 条款未核实，从 M5 拿掉；只用 API Key | [05 §10](design/05-agent-architecture.md#10-外部-ai-工具对-a2a6-的影响) |
| — | 正式版不打包普惠体，各平台用系统中文字体 | [03 §2](design/03-visual-language.md#2-字体) |
| — | 排期跟随 ts-fsrs 6 默认的 FSRS-7（多一个短期稳定度、按小数天） | [01 §4](design/01-database.md#4-复习fsrs) |
| — | ~~预算默认每月 ¥20、单个任务 ¥1~~（2026-11-04 去掉，见 T36） | [05 §8](design/05-agent-architecture.md#8-权限审批与安全) |
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
| T17 | （T35 后作废：没有步骤检查点）任务取消立即生效：步骤函数不看 abort signal 时，`job.step` 也不再等它跑完，直接以取消结束（这一步的结果丢弃、不写检查点） | 原来取消要等当前步骤自然结束，测试里会卡 5 秒 |
| T18 | M1 的模型调用只有一种：`completeOnce`（内核里的一次性调用，不在对话里、不走技能；2026-11-04 起不查预算、不记用量），经 `Ctx.ai.complete` 给领域方法用。语境释义（`terms.context_meaning`）和测试连接（`providers.test`）都走它；语境释义按固定提示写、句子当不可信材料放在分隔符里，输出清洗成一行 ≤40 字再缓存 | M1 语境释义；M2 起换成讲解技能 |
| T19 | 剪藏插件点按钮时用 `tabs.update(当前标签页, tibi://import?url=…)` 打开深链（浏览器弹"要打开 Tibi 吗"，页面不离开），不弹自己的面板。桌面端在 Windows / Linux 加 `tauri-plugin-single-instance`（deep-link 特性），第二个进程带来的深链转给已开的窗口；macOS 由系统直接交给运行中的应用 | R4 剪藏插件 |
| T20 | 导入后的 AI 分析不走模型驱动的技能，而是三次固定提示的快速档调用（completeOnce，JSON 输出，宽松解析，正文放在分隔符里当不可信材料）；导入之后在后台另做，导入不等它，状态记在 `documents.ai_status`（2026-11-04 起不再是任务，见 T35）。补做总结完成时界面不弹通知 | R10：导入是固定流水线；先读后分析 |
| T21 | 文件抽取放在 core-node（Platform.extractFile）：EPUB 用 fflate 解压 + linkedom 读 OPF / 目录，PDF 用 pdfjs-dist 4（legacy 构建，先把 worker 模块挂到 `globalThis.pdfjsWorker`，单文件 sidecar 里才找得到），DOCX 用 mammoth；都转成 Markdown 交给 Core 切分。sidecar 打包的 banner 里 `createRequire` 改名，避免和 pdfjs 冲突。书导入只标前两章（LAZY_EAGER = 2），其余在 sections.get 时补标 | M4 多格式 |
| T22 | OCR 用 tesseract.js 5（Platform.ocr，在 Core 进程的 worker_threads 里跑）：语言包按需下载到 `tessdata/`；扫描版 PDF 用 pdfjs 的 operator list 取每页最大的图，自己编成 PNG；分段按"比这页最小行间空白大 1.7 倍"。打包时 worker 单独打成 `tesseract-worker.cjs`，和 tesseract.js-core 的 wasm 一起放进安装包 `resources/ocr/`，壳用 `TIBI_RESOURCE_DIR` 告诉 Core | D4 |
| T23 | 朗读在 WebView 里做（lib/tts）：系统语音用 speechSynthesis；Kokoro 用 kokoro-js（transformers.js + onnxruntime-web 的 wasm，q8 量化模型优先从魔搭下载，失败退回 Hugging Face），动态 import 单独成块，不选就不加载。onnxruntime 的脚本和 wasm（约 21.6 MB）随安装包走，不从 jsdelivr 加载，`script-src` 不放行远程脚本。CSP 因此加了 `'wasm-unsafe-eval'`、huggingface、modelscope 的 connect-src（jsdelivr 留给手机端 OCR 语言包）、connect-src `'self'`、`worker-src blob:` | M4 朗读 |
| T24 | MCP 令牌不放钥匙串，放在 app 数据目录的 `mcp.token`（0600）：代理 `tibi-core --mcp` 是外部工具启动的独立进程，读不到 Tibi 进程经壳拿的钥匙串；本地 socket 也只有本用户能连。真正的开关和写工具白名单在 Core 里判，令牌只防同机其他用户 | 06 §6 |
| T25 | 界面语言（M6）：源码直接写中文、用 `tl('中文原文', { 变量 })` 包起来，中文原文就是键；英文在 `apps/desktop/src/locales/en.json`，缺的条目显示中文；CI 用 `i18n:check` 保证没有漏翻。语言在启动时定下来（默认中文；目标用户是中文母语者，不跟随系统语言），切换后重新载入界面，所以模块顶层常量也能用 `tl`。Core 产生的文字（任务标题、步骤名、错误、AI 内容）暂不翻译；"Tibi 讲解用的语言"是另一个设置（`assistant_prefs.language`），写进系统提示 | 00 §3.7 |
| T26 | 出安装包（M6）：GitHub Actions 打 tag 出四个目标（macOS Apple 芯片 / Intel、Windows x64、Linux x64）的草稿 Release；sidecar 在各自平台用 Bun `--compile` 打；词典只生成一次并缓存，经 `tauri build --config src-tauri/tauri.bundle.conf.json` 合并进资源（主配置不写，开发时没有词典也能编译）；配了 Apple 证书密钥就签名公证，否则出未签名包 | dev README §4 |
| T27 | 同步的改动捕获用 SQLite 触发器（开启同步时按当前表结构生成、启动时重建），不在每个写方法里记：写入散在各领域方法里，触发器不会漏；应用别的设备的改动时用 `sync_state.capture = 0` 关掉记录。一条 put 共用一个 HLC，推送时按改动时间分配。熟练度按来源优先（用户 > 自动）再比时钟 | 08 §13 |
| T28 | 手机上 Core 跑在 WebView 里（R11 落地）：同一份 `@tibi/core`，SQLite 由壳里的 rusqlite 提供（`local_db.rs`：db_open / db_exec / db_run / db_all，每个库一条连接、串行，所以跨调用的事务成立），JS 端 `InvokeDriver`；网页、模型 API、WebDAV 走 http 插件（全局 fetch 换成它，不受 CORS 限制）；网页正文用 DOMParser + 同一份 Readability 逻辑（`web/html.ts`，桌面传 linkedom）；词典 `SqliteDict` 和文件抽取（`web/extract.ts`：EPUB / PDF / Word，pdfjs、mammoth 由运行时注入）移进 core；手机上文件由壳的 `read_file` 读原始字节，图片用浏览器版 tesseract。桌面加 `--features mobile-preview` 走同一条路，用来预览和在没有 Xcode / NDK 的机器上（含 CI）检查能编译 | 00 §3.13、dev README §7 |
| T10 | 复习用 ts-fsrs 6.0 的 `DefaultScheduler`（FSRS-7 默认），卡片字段按库的命名映射到表（`stability_fast` ← `stabilityFast`、`learning_steps` ← `learningStep`） | 01 §4 |
| T29 | 词典页只用本地数据，不接在线词典（补充数据见 T31），也暂不打包 Tatoeba 例句库。例句取自用户自己读过的文章（FTS）。中文反查用 `LIKE` 加部分索引 `stardict(frq) WHERE frq > 0`（约 0.5 MB），不够再扫全表，不建中文全文索引 | 在线词典违背"只有主动用到的功能才联网"；Tatoeba 例句（CC BY 2.0 FR）要署名，可能要细到每句的作者，以后单做。实测 77 万词条：单字母前缀约 50 ms，全表 `LIKE` 不到 80 ms |
| T30 | 词形还原：词典收了这个词头、又没说它是变形（`lemma_map` 里没有）时，规则不再改写；人工的 `IRREGULAR` 表不受影响。已导入文章里存的旧原形不回填，重新导入才更新 | 2 万个常用词里 419 个被规则改错（interest → inter、matter → mat、summer → sum），修后只剩 `IRREGULAR` 里的 7 个 |
| T31 | 桌面端软件更新：官方 updater 插件 + GitHub Releases 的 `latest.json`，更新包用独立的 Ed25519 密钥签名（公钥在 `tauri.conf.json`，私钥只在仓库密钥 `TAURI_SIGNING_PRIVATE_KEY`）。只经壳的 `update_check` / `update_install` 命令，不把插件开放给 WebView。Release 不再标预发布。自动检查默认关（2026-11-04 起默认开，见 T39），只提醒不自动装；安装前备份，再停 Core；备份失败要用户确认才继续 | 没有服务器，也守住"只有用到的功能才联网"。`/releases/latest/` 会跳过预发布；Windows 上 Core 占着可执行文件，安装器换不掉。国内源（对象存储，发布后同步，先于 GitHub）只存文件，签名校验不变；GitHub 在中国大陆不稳定，公共代理又不可控 |
| T32 | 词典补充数据写进同一个 `dict.db`：词光 Word Atlas（固定提交）给例句、搭配、词族、辨析、CEFR，Open English WordNet 2025 给英文义项和同义词；词条末尾写明来源，词光标"AI 生成，未逐条审校"。只进词典页，不进词卡和复习 | ECDICT 没有例句和近义词。两者都是 CC BY 4.0，分发只需署名（设置"致谢"、README、词条末尾）。词光只收 7,298 个雅思词且未审校，所以和 WordNet 并列显示、不混在一起。`dict.db` 从 91 MB 涨到 119 MB |
| T33 | 反问（`ask_user`）是普通工具，原地等用户回答，回答作为工具结果交回模型，同一轮里接着做；内核不替模型执行选项上的动作。选项可带文章链接（必须来自本任务的工具结果或输入），用户选中的网址这一轮导入不再审批。对话里起的后台任务（导入）结束时，Core 在那段对话里开一轮 `<task-notification>`，由 Tibi 告诉用户结果。等待只在进程里，重启后这一轮记成中断（2026-11-03 改，原做法是问完结束这一轮、点选项由内核直接导入） | 原做法下动作在模型之外执行，导入失败（网页 403）对话里没有任何反应，卡片还写着"已导入"。照 Claude Code 的分工：Tibi 只提供工具，问、做、汇报都在 agent 循环里。代价是重启会丢掉还没答的问题，后台任务结束要多调一次模型。详见 [05 §8](design/05-agent-architecture.md#8-权限审批与安全) |
| T34 | Tibi 改配置只走白名单（`set_config`）和领域能力，不开放 SQL 和通用 `settings.set`。新增权限级别 `always`：每次都问，读过不可信内容的任务直接拒绝。API Key、服务商、权限模式、`mcp.*`、`perm.auto.*` 不开放，只给去设置页的卡片；这组能力不对 MCP 开放 | `settings` 里存着权限规则，通用写入等于能给自己提权；改服务商地址会把 API Key 发到别处；业务规则在方法里，写库会绕过。详见 [05 §8](design/05-agent-architecture.md#8-权限审批与安全) |
| T35 | 去掉"任务"，只留会话（2026-11-04）：一轮回答就是对话里的一段消息，`messages.turn_id` = 这一轮第一句用户消息的 id；技能、结果（done / error / cancel）、是否读过不可信内容记在那句的 `ui.turn`。进行中的回答、审批、反问只在内存里（`kernel/turns.ts`），重启后没答完的那一轮记成中断、由用户点重试，不续跑、不存检查点。子技能（`run_skill`）在同一轮里跑，共用停止信号、审批和不可信标记。导入、总结、翻译、重新分析是后台函数：导入有 `import_id`，事件 `import.progress` / `import.done`，其余状态写在文章上。外部工具（MCP）的写调用直接执行，要确认时等用户在 Tibi 里点（最多 5 分钟）。删 `jobs`、`job_steps` 表和 `tasks.*`、运行记录页；审批改为 `approvals.list` / `approvals.decide` | 一轮回答本来就是对话的一部分，另一张任务表把同一件事记了两遍；检查点续跑对阅读应用不值得它的复杂度。代价：崩溃时跑到一半的回答要用户重试；对话里起的导入超过 3 分钟没完成就不再回头告诉 Tibi。详见 [dev/plan-no-tasks-no-cost](dev/plan-no-tasks-no-cost.md) |
| T36 | Tibi 不算钱（2026-11-04）：删 `usage_records`、预算（`budget.*`）、自定义单价（`provider.price.*`）、`budget_exceeded`、`usage.updated`，界面上的花费都去掉。花了多少去服务商后台看；兜底只剩 `agent.max_turns` | 换算汇率和单价不准，预算拦截还要给每次模型调用记账；用户的 Key 在服务商那里本来就有账单和限额 |
| T37 | 对话里起的导入，进度和结果显示在对话的导入卡上（`import_document` 先放卡片，跟着导入事件更新），不弹全局提示；跳到应用里别处统一用 `tibi://` 深链（导入卡的「开始阅读」、`show_link` 跳转卡、`open_settings`、系统打开的链接走同一份白名单），界面按平台换成路由。用户自己在消息里发来的网址导入不再审批 | 导入是对话里发生的事，结果该留在对话里、重开还在，toast 一闪就没了。按钮由能力生成、白名单解析，模型只能指向已有页面和书架里有的文章。详见 [05 §8](design/05-agent-architecture.md#8-权限审批与安全) |
| T38 | 订阅（RSS 阅读器）P1（2026-11-04）：订阅和条目入库（`feeds`、`feed_items`，迁移 0007 把 `settings.feeds` 搬过来）；条目不进书架，点"读 / 稍后读"走普通网址导入，成功后按链接回填。侧栏单独一项「订阅」；桌面每 30 分钟刷新到点的源（默认开，本机设置），带 ETag / Last-Modified，失败按 2ⁿ 退避；保留 60 天 / 每源 300 条；`feeds` 表进同步，`feed_items` P2 再同步；`search_feeds` 改查本地库。从订阅里点"读"用同一个阅读器打开但不进书架（`documents.shelved = 0`，迁移 0008），点「稍后读」或「加入书架」才进 | [11](design/11-rss-reader.md)、[plan-rss-p1](dev/plan-rss-p1.md) |
| T39 | 公告与默认联网（2026-11-04）：自动检查更新改为默认开（改了 T31 的"默认关"），不再守"只有用到的功能才联网"。公告是仓库根目录的静态 `notice.json`（`{ notices: [{ id, message, platforms?, below?, until?, url?, label? }] }`，`message` / `label` 可写 `{ zh, en }`，`url` 只能是 https:// 或 tibi://），推到 main 后 `notice-cn.yml` 传到国内源；客户端先查 dl.ferecord.com、再查 raw.githubusercontent.com，用 http 插件取（不受 CORS 限制，桌面只放行这两个地址）。哪条显示在本机判断：一般的每条一次，写了 `below` 的只给更旧的版本、每天一次，升级后自动消失；有一条写错整个文件不用，CI 的 `test/notice.test.ts` 先校验仓库里的文件。电脑跟着自动检查更新的开关，手机每天查一次 | 没有服务器也能发公告、催升级，改文件不用发版。手机没有应用内更新（T31 只做桌面），催升级只能靠公告。判断放在本机，取公告的请求里不带版本和平台 |
| T40 | Web 版（2026-11-05）：走手机端那条路（T28），换成浏览器壳。SQLite 用官方 sqlite-wasm + OPFS（`opfs-sahpool`）跑在 Worker 里，命令名和手机壳一样，照用 `InvokeDriver`；同一时间只开一个标签页（Web Locks）。词典用构建时生成的精简版 `dict-lite`（有词频 / 星级 / 考试标签的词和它们的原形），第一次用时下载进 OPFS。插图写在 OPFS 的 `assets/`，Service Worker 读给 `<img>`。跨域请求先直连，被 CORS 拦了再经站内 EdgeOne 边缘函数 `/api/proxy`（只认本站页面、只去公网、不存不记）；抓网页和 RSS 一律走中转。密钥存 IndexedDB。宽屏用桌面界面，窄屏用手机壳。发布在 `app.tibi.ferecord.com`（EdgeOne Makers 直接上传项目，GitHub Actions 部署） | [12](design/12-web.md)。不装软件也能试；手机运行时已经把 Core 和壳分开了，Web 只是第三个壳。代价：Web 版不再是"没有服务器"，多了一个不存东西的中转；Key 在浏览器里比钥匙串弱；浏览器可能清掉数据 |

## 待决定

| 事项 | 为什么还开着 | 出处 |
|---|---|---|
| 商标与域名 | 只做过公开检索（2026-10-31）：挪威国家图书馆有一款无障碍阅读应用叫 **Tibi**（Tibi Library）；纽约时装品牌 **TIBI** 是知名商标（服装类）；`tibi.app` 在域名交易平台挂售，`tibi.ai` 已被注册。软件类（第 9、41、42 类）是否有冲突需要查商标库（中国、美国、欧盟），要你决定查哪些地区、是否考虑备选名或加后缀 | [overview 第 11 节](design/overview.html#decisions) |
| 接口细节 | `chat.send` 的 context、长章节分页、MCP 资源、事件通道（M0 / M1 实现时定） | [06 §8](design/06-interface.md#8-待定) |
| 数据细节 | `sections` 修订、`excerpt`、`learning_events` 是否派生（M1 实现时定） | [01 待定事项](design/01-database.md#待定事项) |
| 视觉细节 | 手机横屏、深色对比度 | [03 §10](design/03-visual-language.md#10-待讨论) |
