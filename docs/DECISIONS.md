# 现在定了什么

> 单页索引：每条一句话，细节看真相源。历史经过见 [`CHANGELOG.md`](CHANGELOG.md)。

## 术语

| 词 | 意思 |
|---|---|
| **Tibi** | 用户面对的唯一角色：产品、吉祥物藏狐、AI 助手同名 |
| **技能** | Tibi 会做的事，用动词命名；内部每项一份 `SKILL.md`，运行时一个子对话。不叫"智能体" |
| **能力** | 确定性的代码单元，同一份定义供技能、MCP、界面调用。**能力 = 工具**：对模型和 MCP 说"工具"时指的就是它 |
| **任务** | 一次运行及其步骤，在任务中心可见 |
| **pi** | 开源 harness，`pi-ai` 接模型，`pi-durable` 管对话与任务。内部依赖，界面不出现 |

## 产品与范围

| # | 决定 | 真相源 |
|---|---|---|
| P1 | Tauri 2 桌面应用 | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| P2 | shadcn/ui + Tailwind | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| P3 | MIT；项目名 Tibi（缇比） | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| D6 | v1 单用户 | [00 §7](design/00-concept-design.md#7-待讨论决策汇总) |
| D8 | 桌面最小 960px；手机端是独立的壳，排在 M7 | [00 §3.13](design/00-concept-design.md#313-手机端d8) |
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
| D3 | 一词一卡，六种题型随熟练度递进；M1 只有选义、填空，M3 补齐 | [00 §3.3](design/00-concept-design.md#33-生词本与每日练习vocabulary--review) |
| G1–G8 | 系统评分、选义、首次作答算数、初见、主动提示、可续、完成页、不计分练习（无跟打，排在后续） | [research/05 §3](research/05-word-atlas-review.md#3-建议g-组复习) |

## AI 与技能

| # | 决定 | 真相源 |
|---|---|---|
| A1 | 默认 DeepSeek；模型名是配置项，默认 `deepseek-v4-flash` / `deepseek-v4-pro` | [00 §3.7](design/00-concept-design.md#37-设置settings) |
| A2、B6 | v1 不做 ACP；外部工具走 MCP | [05 §10](design/05-agent-architecture.md#10-外部-ai-工具对-a2a6-的影响) |
| A3 | 三档权限，默认标词自动、其余询问 | [02 §6](design/02-ai-assistant.md#6-工具learning-tools) |
| A4 | 记忆检索 v1 用 FTS5，不用向量 | [02 §5.2](design/02-ai-assistant.md#52-检索) |
| A5 | 只在自然断点轻提示 | [02 §7](design/02-ai-assistant.md#7-交互形态) |
| A6 | 提供 MCP Server；`tibi mcp` 只做代理，默认只读白名单 | [06 §6](design/06-interface.md#6-mcp-server) |
| A7 | Tibi 名字固定；称呼与对话语言可改 | [02 §9](design/02-ai-assistant.md#9-决策) |
| B1 | harness 用 `pi-ai` + `pi-durable`，外包 `TibiKernel`（风险见下方待决定） | [05 §12](design/05-agent-architecture.md#12-决策) |
| B2 | Tibi Core 独占 `app.db`，单实例 | [05 §3](design/05-agent-architecture.md#3-进程架构) |
| B3 | 6 项内置技能，内部格式 `SKILL.md`，只能用能力层 | [05 §4.3](design/05-agent-architecture.md#43-技能清单)、[§5](design/05-agent-architecture.md#5-技能的定义格式skillmd) |
| B5 | 已砍：自定义技能（见"已砍"） | [05 §12](design/05-agent-architecture.md#12-决策) |
| B7 | 已砍：定时任务（见"已砍"） | [05 §12](design/05-agent-architecture.md#12-决策) |
| B8 | 先做技术验证 | [05 §11](design/05-agent-architecture.md#11-风险与验证) |
| C1–C5 | 用户只见一个 Tibi；`/` 代替 @；过程默认收起 | [05 §13](design/05-agent-architecture.md#13-用户可见层一个-tibi多项技能2026-10-29-已确认) |
| — | 不提供 Claude 订阅登录（Anthropic 条款禁止第三方使用），Anthropic API Key 可用 | [05 §10](design/05-agent-architecture.md#10-外部-ai-工具对-a2a6-的影响) |

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
| V1–V3 | 采用 v2"安静的 AI 工作台"，强调色电光蓝，词卡浮层 | [04 §5](design/04-design-direction-v2.md#5-决策2026-10-29) |
| — | 字体、色板、圆角 6 / 8 / 12 | [03](design/03-visual-language.md) |
| F1–F4 | 插画软 3D + 设定图参考；3D 只做三处；Rive 留给有设计师时 | [research/04 §4.4](research/04-mac-native-and-mascot.md#44-建议的决策f-组吉祥物) |
| F5 | SVG 与插画不同框，按位置分用 | [03 §7.2](design/03-visual-language.md#72-插画与封面) |
| — | 配色只在一处定义 | [03 §7.1](design/03-visual-language.md#71-吉祥物藏狐-tibi缇比) |
| — | 素材清单、提示词、出图流程 | [07](design/07-mascot-assets.md) |

## 待决定

| 事项 | 为什么还开着 | 出处 |
|---|---|---|
| E1–E8 mac 原生感 | 建议全部采用，未确认 | [research/04 §3](research/04-mac-native-and-mascot.md#3-建议的决策e-组界面) |
| E3（13px）、E6（6 / 10 / 11）的数值 | 与现行 13.5px、6 / 8 / 12 冲突，未重定 | [03 §10](design/03-visual-language.md#10-待讨论) |
| 手机与桌面同步方案 | 局域网 / iCloud 文件夹 / 自建，排在 M7 | [00 §3.13](design/00-concept-design.md#313-手机端d8) |
| 普惠体许可 | 若随软件分发，需核对 3.0 版许可 | [03 §2](design/03-visual-language.md#2-字体) |
| 商标与域名 | 还没核查 | [overview 第 11 节](design/overview.html#decisions) |
| ChatGPT 账号登录的条款 | 未核实是否允许第三方应用使用 | [05 §10](design/05-agent-architecture.md#10-外部-ai-工具对-a2a6-的影响) |
| Anki 导出时机 | 00 §3.3 已列入生词本导出，§6 排在"后续" | [00 §6](design/00-concept-design.md#6-版本规划建议) |
| pi-durable 的风险结论 | 选型未改，事实已记 | [05 §11](design/05-agent-architecture.md#11-风险与验证) |
| FSRS 算法版本 | ts-fsrs 6.0 默认已是 FSRS-7，文档按 FSRS-6 写 | [00 §3.3](design/00-concept-design.md#33-生词本与每日练习vocabulary--review) |
| 预算的默认值 | 规则已定，数值没定 | [05 §8](design/05-agent-architecture.md#8-权限审批与安全) |
| 接口细节 | `chat.send` 的 context、长章节分页、MCP 资源、事件通道 | [06 §8](design/06-interface.md#8-待定) |
| 数据细节 | `sections` 修订、`excerpt`、`learning_events` 是否派生 | [01 待定事项](design/01-database.md#待定事项) |
| 视觉细节 | 手机壳深色与横屏、深色对比度 | [03 §10](design/03-visual-language.md#10-待讨论) |

### 产品决策（2026-10-31 评审提出，未确认）

按影响排序。"推荐"是评审意见，确认前现行方案不变。R1–R5 已确认，移到上面的现行决定。

| # | 问题 | 推荐 | 依据 |
|---|---|---|---|
| R6 | 一词一卡混用题型，识别和拼写难度悬殊，会污染 FSRS 的稳定度 | FSRS 只排识别和语境回忆，拼写、听写移到不计分练习（M1 只有选义、填空，不受影响，决定 M3 怎么补题型） | [00 §3.3](design/00-concept-design.md#33-生词本与每日练习vocabulary--review) |
| R7 | 阅读中再次遇见不反哺记忆，`encounter_count` 只用于展示 | 未点击通过只作弱信号，不更新 FSRS | [01 §3](design/01-database.md#3-词条已知词库核心) |
| R8 | 词汇测试在 4k–10k 目标区间分辨率低，伪词太少；"已知词"曲线混入推断值 | 加密该区间、提高伪词比例、用首篇修正校准；曲线拆成实测和估算。测试已移出引导（R3），跳过时全靠自评，这条更要紧 | [00 §3.9](design/00-concept-design.md#39-首次启动引导onboarding) |
| R9 | `pi-durable` 仍在快速变化：9 个 1.x 版本，1.4.0 自动迁库且不可回退，还与主库同文件 | 用 `pi-ai` + `pi-agent-core` + 自建 `jobs` 表；若保留，放独立 `agent.db`。先在 M0 验证。例行任务已砍，pi-durable 的定时能力不再需要 | [05 §11](design/05-agent-architecture.md#11-风险与验证) |
| R10 | 导入做成模型驱动的技能，离线路径不清，用户自己点导入还要再审批 | 改成固定流水线 + 可选 AI 补充，用户触发免审批。M1 没有技能层，已是固定流水线；待决的是 M2 起是否还改成技能 | [05 §4.3](design/05-agent-architecture.md#43-技能清单) |
| R11 | 手机端用不了 Tauri sidecar，自增主键也难同步，M7 要重写 Core 并迁主键 | Core 写成无 Node API 的 TS 包；可同步的表现在就用 UUIDv7 + `updated_at` + 墓碑；`review_logs` 只追加 | [00 §3.13](design/00-concept-design.md#313-手机端d8) |
| R12 | 文档没提项目怎么持续 | 明确"纯开源 + 自带 Key"，不做托管 | — |
| R13 | 首页"找文章"有模式、胶囊、卡片、`/` 四个入口，"继续阅读"权重不够 | 去掉模式分段自动判断；继续阅读升为主卡（M1 首页只有导入模式，这条从 M2 起才相关） | 改 [03 §1](design/03-visual-language.md#1-原则) |
| R14 | "技能 / 让 Tibi 做什么 / 能帮你做这些 / 模式"指同一批事；FSRS、ECDICT、`save_document` 直接露给用户 | 统一叫"Tibi 能做的事"，术语收进"查看过程"。2026-10-31 文案梳理已做一部分：删掉"能帮你做这些"卡片，`/` 菜单标题改为"选择要做的事"，统计和设置里不再出现 FSRS；"技能"与"模式"的叫法仍待定 | 原型多页 |
| R15 | 设置 10 节 118 个控件（评审时的数，含已砍的新建技能、例行任务）；生词本筛选 7 层 | 模型、技能、MCP、预算收进"高级"；生词本左栏留 4 个视图（R5 的"标为已知"也要有去处） | `settings.html`、`words.html` |
| R16 | 恢复阅读提示 8 秒就消失，底栏 0% 与"上次 45%"并存 | 自动跳回上次位置，给"回到开头" | `reader.html` |
| R17 | 统计空状态只用 idle，不符合"要切换状态才用 SVG"；SVG 与软 3D 风格差异明显；首页 `#empty` 同页一 SVG 一插画 | 统计空状态改专属插画；问候时睁眼；校准 SVG 配色；首页 `#empty` 保留（分属不同区块） | [03 §7.2](design/03-visual-language.md#72-插画与封面) |
