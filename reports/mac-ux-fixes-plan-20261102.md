# Tibi Mac UX 核查与优化方案

## 元信息与验证边界

| 项目 | 内容 |
|---|---|
| 日期 | 2026-11-02，Asia/Shanghai |
| 会话 / 任务名 | Tibi Mac UX 核查与优化方案 |
| 当前会话 ID | Codex `01a19c3d-dfe4-7242-afdf-be6107d85730`（任务名：Tibi Mac UX 核查与优化方案）。Claude Code 曾尝试 session `9791103f-239e-49c4-becd-c44a2e979fcf`，因 OAuth 过期失败 |
| Git HEAD | `5c60b8e07093088e04c06b5d22b5700a875a7b72`，本次通过 `git rev-parse HEAD` 确认；未重新核验远端同步状态 |
| 核查工具 | Codex，使用本地源码检索、带行号读取、Python JSON 检查、lsof / curl 只读检查 |
| 工具变更原因 | **原计划 Claude Code，实际 Codex 兜底**。据任务提供的环境背景，本机 `claude` CLI 报 `Failed to authenticate: OAuth session expired and could not be refreshed`。本次未再次调用 Claude 或尝试修改认证 |
| 输入 | `reports/mac-ux-review-20261102.md`、`reports/mac-ux-review-20261102-assets/core-probe.json`（资源目录仅发现此 JSON） |
| 修改范围 | 仅新增本方案；未修改业务代码、数据库、配置或原报告，无验证改动需要还原；未 commit / push |
| 初始工作区 | `reports/`、`research_notes/` 已为未跟踪目录，保留原有内容 |

结论：原报告的 21 个编号中，**真 10、部分属实 6、假 2、无法复现 3**。这里“真”可由明确代码路径确认，不等于已经实机点按；“无法复现”用于缺少用户观察或视觉实测的体验断言，不等于问题不存在。以下行号均对应本次 HEAD。

本次重新读取历史探针，确认数组有 24 条记录、全部含 `result`、没有顶层 `error`。没有重跑导入、答题或练习写入。探针有三次 `practice.start`（spell / dictation / produce），**没有 `practice.grade`、`practice.finish`，也没有 confusable 出题**；不能用“24/24”证明造句评分、全部练习模式或 GUI 可用。原报告已说明 GUI 受限，本次亦不宣称完成实机视觉验收。

## 核查总表：逐条结论与证据

路径简写：`D/` = `apps/desktop/src/`；`R/` = `apps/desktop/src-tauri/`；`C/` = `packages/core/src/`。探针字段用“method + params”筛选记录，避免依赖数组下标。

| ID | 结论 | 源码 / 探针证据 | 判定说明 |
|---|---|---|---|
| P1-1 技术词释义错误 | 真 | `C/domain/terms/views.ts:80,86–94`；`C/domain/terms/service.ts:35,99`；`C/domain/review/queue.ts:62,79–80`；`C/domain/terms/io.ts:27–41`。探针 `dict.entry(text=compiler).result.dict.translation` 含 `[计] 编译程序`，`review.start.result.steps` 的 compiler 项 `hint=编辑者`，`terms.export.result.text` 同样为编辑者 | 词典有正确领域义，首行 / 短义却进入复习与导出。注意 API 返回的 `meaning` 可是词典回退值，不代表完整释义已存入 terms.meaning；导出直接读数据库并回退 short_gloss |
| P1-2 无模型造句记 0 分 | 真 | `D/review/Practice.tsx:68,78–80,89–98`；`C/domain/review/methods.ts:148–159` | 未批改被编码为 0，下一题最终写 practice_logs 并平均。影响本轮练习成绩；**未证实降低复习 retention，实际不写 cards / review_logs** |
| P1-3 称呼输入受控错误 | 真 | `D/pages/Settings.tsx:94`；`D/pages/Onboarding.tsx:49`；`C/domain/profile/methods.ts:11,19,30`；探针 `profile.update.result` 同时有 nickname=UX体验、display_name 为空 | nickname 存在时 value 始终优先读它，onChange 仅改 display_name，受控值回退。不是“等 blur 就会修好”：blur 也可能读到已经回退的 DOM 值 |
| P1-4 进度失败静默 | 真 | `D/pages/Reader.tsx:67–88`；`D/lib/util.ts:47–49` | sections.progress 的 rejection 被吞掉；无保存失败提示或专门状态。能确认异常路径，不能由此声称用户已实际丢失进度 |
| P1-5 备份失败仍更新 | 真 | `D/settings/UpdateItems.tsx:31`；`R/src/update.rs:48–59` | system.backup 返回 error 时只 warn，随后 stop/install；与“安装前会备份”承诺不符。spawn_blocking join 失败有 `?` 会返回错误，并非所有失败均被吞 |
| P2-1 更新源叙事不一致 | 真 | `D/settings/UpdateItems.tsx:33,41`；`R/tauri.conf.json:62–64`；`.github/workflows/release.yml:137–151`；`.github/workflows/mirror-cn.yml:3,29`；`README.md:40` | 固定 GitHub 文案与条件注入的国内源不匹配。构建逻辑确有镜像优先，不能据源码判定已发安装包只有 GitHub；CI 变量及具体产物未查 |
| P2-2 仅监听 IPv6 | 部分属实 | `apps/desktop/vite.config.ts:6,13–17`；本次 lsof：node PID 3266 监听 `[::1]:1420` | 当前监听记录支持 IPv6 单地址；Vite 配置为 `host: host || false`，并非硬编码 IPv6。本次受限执行环境中 IPv4 与 IPv6 curl 均失败，未重现原报告“IPv6 HTTP 成功”的完整对照；core-probe 不含网络监听证据 |
| P2-3 Onboarding 步骤错位 | 假 | `D/pages/Onboarding.tsx:14–15,31–34,65–87` | 主流程 1→3→4，已有模型时 1→4；2 是独立词汇校准入口。`!single` 才显示三步条，重测时不显示。内部编号不连续不是用户进度错位 |
| P2-4 侧栏词典 / 生词冗余 | 无法复现 | `D/components/Shell.tsx:11–18,28,54`；`docs/DECISIONS.md:164`（T29） | 七项属实，但词典面向任意查词、生词本面向个人词表；入口重叠不足以证明用户混淆，没有新手任务测试。运行记录徽标还承担待审批提醒 |
| P2-5 首页意图负担 | 部分属实 | `D/pages/Home.tsx:148–171` | placeholder 确实同时讲导入、提问、命令；但已有输入后意图提示、动作芯片、示例捷径。可精简文案，尚无证据必须把统一输入拆成多模式 |
| P2-6 short_gloss 截断过激 | 真 | `C/domain/terms/views.ts:91–94`；`C/domain/review/queue.ts:62`；`C/domain/review/methods.ts:127–130`；`C/domain/terms/io.ts:36` | 首行→去词性→按逗号/分号切→最多 8 字。行间短义本是有意设计，问题在短义被复用于题目及导出；与 P1-1 是同一修复主题 |
| P2-7 更新备份阶段不可见 | 真 | `R/src/update.rs:35–53`；`D/lib/update.ts:22–25`；`D/settings/UpdateItems.tsx:8,24–32` | 事件只有下载字节，UI 安装态仍写“正在下载”；备份和安装阶段没有单独状态。与 P1-5 合并处理 |
| P2-8 无系统语音死胡同 | 部分属实 | `D/settings/VoiceItems.tsx:17–43`；`D/lib/tts.ts:21–23` | 空列表文案缺乏就近操作，但同屏已有 Kokoro 下载按钮及下载函数，**不是死胡同**。列表只筛 en-US/GB，且依赖异步 voiceschanged；空列表不严格等价“没有任何英文语音” |
| P2-9 开发命令泄漏 | 真 | `D/pages/Home.tsx:218–226`；对照 `D/pages/Library.tsx:85` | 错误位于首页书架区域，不是 Library 页；当没有 shelf 且 connected/status 均不可用时显示 pnpm 命令，没有 DEV 条件。不是所有断连都走这条分支 |
| P3-1 vibrancy 未落地 | 部分属实 | `R/Cargo.toml:46`；`R/src/lib.rs:313–316`；`R/tauri.conf.json:22`；`D/styles.css:25,34–38,65`；`docs/research/04-mac-native-and-mascot.md:80` | **已依赖并调用 Sidebar vibrancy**，报告漏查。窗口 transparent=false、body 不透明，透明展示链路仍有缺口；调用错误也被忽略。实际毛玻璃可见程度须在 Mac 验证 |
| P3-2 13.5px 偏网页 | 无法复现 | `D/styles.css:25,51,335`；`docs/research/04-mac-native-and-mascot.md:81`；`docs/design/03-visual-language.md:230` | 数值属实，但正是已确认的 E3 保留值。无截图、阅读任务或缩放验证，不足以判定可读性缺陷或推翻现有字号 |
| P3-3 高亮噪音 | 部分属实 | `D/pages/Reader.tsx:26,172`；`D/styles.css:228–238` | 默认 all、五档底纹属实；但已有仅生词和纯净阅读模式，且 s1–s4 主要是同色透明度梯度，不是五种独立彩色。噪音强度仍需实测 |
| P3-4 吉祥物开关分散 | 部分属实 | `D/store/ui.ts:33–35`；`D/styles.css:788–790`；`D/review/Practice.tsx:87`；`D/pages/Onboarding.tsx:63–64`；`docs/design/03-visual-language.md:167` | 练习 .pstk 已被统一 CSS 隐藏，不能只看 JSX 就说开关失效。Onboarding 的 .fx/.obsay 未纳入该规则；当前设计明确首页/空态/完成页，没有明确要求引导页全隐藏。“名称负面”属偏好 |
| P3-5 运行记录过重 | 无法复现 | `D/pages/Tasks.tsx:13–14,33,78,126`；`D/components/Shell.tsx:28,54` | 任务树、诊断和快捷键属实，但按需进入，不直接等于主路径负担；还提供审批功能。需与 P2-4 一起验证入口发现率，不应直接藏到高级设置 |
| P3-6 浏览器不能更新话术 | 真 | `D/settings/UpdateItems.tsx:16,21` | 只有 toast，无下载入口。属于 Web / 开发壳低优先级文案问题，不是 Mac updater 能力失效 |
| P3-7 HashRouter 不美观 | 假 | `D/main.tsx:3,9–11`；`docs/DECISIONS.md:148`；`R/src/lib.rs:187–188` | HashRouter 属明确 T14 决策，原生窗口无地址栏，不构成所述 Mac 可见视觉缺陷。系统 tibi:// 深链另有处理，不应为 URL 美观更换路由 |

## 误判、过激措辞与证据不足

1. **驳回 P2-3 / P3-7**：前者漏看独立入口的 `!single` 分支，后者将内部路由实现当成原生窗口视觉问题。
2. **纠正 P3-1 / P3-4**：分别漏查 Rust vibrancy 调用与全局隐藏 `.pstk` 的 CSS。修复应补齐已有实现，不重建一套。
3. **弱化 P2-8 的“死胡同”**：Kokoro 已可下载；真正可改善的是发现性、语音异步加载态及空态文案准确性。
4. **P2-4 / P3-5 / P3-2 先验证**：不要仅因导航有七项、字号有小数、诊断页有任务树，就安排破坏现有工作流的重构。尤其不能让待审批任务失去可发现入口。
5. **P1-1 不应直接上“按 tech 选 [计]”规则**：体裁不保证每个词都用技术义，且已有 `setContextMeaning` / `contextMeaning`（`C/domain/terms/service.ts:198–217`）。先保全完整词典信息并复用句子语境缓存，比新增领域硬编码更可靠。
6. **P1-2 影响需限定**：确认写错练习日志；不是 FSRS 错误，也不能由现有探针推出全局学习统计被污染。
7. **P2-2 不是正式 Mac 用户缺陷**：监听地址受环境影响，Vite 的 host 是单值，原建议“同时填两个地址”不能直接实现。不要为开发脚本的 IPv4 假设改成暴露所有网卡。
8. **原报告重复项合并估算**：P1-1/P2-6、P1-5/P2-7、P2-4/P3-5 分别作为一个主题，21 个条目不等于 21 个独立工程任务。

## 确认问题的优化方案（建议实施顺序）

工作量口径：S ≤ 1 人日；M 约 2–3 人日；L ≥ 4 人日。包含实现、针对性验证和文档同步，不含等待签名发布或用户研究的日历时间。以下是待实施方案，不表示本次已修复。

### A. 修复称呼输入（P1-3；优先 P1；S）

- **改哪**：`D/pages/Settings.tsx` 的称呼 input。
- **怎么改**：onChange 在一次 setProfile 中同时更新 display_name 与 assistant_prefs.nickname，保留现有 language/permission；blur 使用最终输入值持久化。沿用现有数据结构，不做跨应用字段迁移。可与 Onboarding 对齐 20 字限制。
- **验收**：已有 nickname、只有 display_name、空昵称三种资料均能逐字编辑、删除和中文输入；失焦并重新进入设置后仍为新值；语言和权限不被覆盖。
- **设计同步**：`docs/design/00-concept-design.md` 设置称呼部分说明展示字段与保存行为，避免两处定义分叉。

### B. 未批改的造句不进入成绩（P1-2；优先 P1；S）

- **改哪**：`D/review/Practice.tsx` 的 check / next 与造句开始入口。
- **怎么改**：最小方案是不生成 checked 分数：无模型提示连接并保留当前输入，不能推进到 next/finish；开始页也明确模型前置条件。批改请求失败同样保留题目，不构造 0 分。无需立即把协议全改成 nullable。
- **验收**：无模型开始、作答途中模型不可用、批改失败三条路径均不追加结果、不调用 practice.finish；正常批改返回的真实 0 分仍允许记录；其他模式保持可用。
- **边界**：如以后明确需要“跳过”，须同时修改 `C/domain/review/methods.ts:148–158` 的参数与空结果处理；当前服务端空 results 仍会写 0 分，所以不能简单过滤后提交空数组。
- **设计同步**：概念设计练习部分明确“未批改不计成绩”，与“练习不影响复习排期”区分。

### C. 恢复释义完整性与语境优先级（P1-1 + P2-6；优先 P1；M）

- **改哪**：`C/domain/terms/views.ts` 的 toTerm；`C/domain/terms/io.ts` 的 exportTerms；`C/domain/review/queue.ts` 的 makeStep；`C/domain/review/methods.ts` 的 practice.start；复用 `C/domain/terms/service.ts` 的 contextMeaning。
- **怎么改**：short_gloss 继续仅服务行间短注；词条详情的默认 meaning 保留完整词典 translation。对于带句子的复习，优先该句的 meaning_in_context / 已缓存语境义，再回退用户释义、完整词典义，最后才是短义；题干、正确选项、答后释义采用一致来源。无可靠语境时展示多义，不能把“编辑者”当技术句唯一正确释义。导出保留用户自定义 meaning，否则使用完整词典 translation；选取语境时与导出的例句对应。不要把某句释义全局覆盖到词条。
- **旧数据**：导出现在绕过 toTerm，必须独立修复。现有用户释义与手写短义不批量覆盖；默认回退可在读取时修复，不先做大规模数据库迁移。若发现历史自动写入的错误 meaning，先核对来源再另列迁移。
- **验收**：compiler 技术句有缓存时提示编译义；无缓存时仍保留 `[计] 编译程序`，不会唯一指向“编辑者”；非技术语境不强行选编译义；CSV/Anki 正确保留多行并转义；用户自定义 meaning 保留；超过 8 字和多词性词的详情不被截断；行间注释不因完整释义撑坏行高。
- **设计同步**：在概念设计的词卡/复习/导出部分与词义数据契约中写清来源优先级；不另造 context_meaning 数据列，复用已有 term_contexts.meaning_in_context 与 ai_results。

### D. 更新备份失败可恢复、阶段可见（P1-5 + P2-7；优先 P1；M）

- **改哪**：`R/src/update.rs:update_install`、`D/lib/update.ts:installUpdate`、`D/settings/UpdateItems.tsx`。
- **怎么改**：先采用最小可靠策略：备份返回错误即返回结构化 backup_failed，保持 Core 运行，不安装；UI 给重试及手动下载安装说明。保留“Core 坏了仍可修复”的外部安装途径，而非默认绕过备份。安装事件增加 downloading / backing_up / installing，UI 用阶段文案替代停在下载 100%。
- **重试细节**：当前 Pending 用 take() 消费；失败后允许重新 check 获取版本再重试，不能只把按钮改为“重试”却复用已空 Pending。不要简单在 error 分支之后照旧执行 core.stop。
- **验收**：模拟备份 RPC error、超时、join 失败时均不调用 stop/install；明确显示失败，取消后仍可使用应用。成功时依序下载→备份→安装；下载无总长度也可显示阶段；重新检查后能重试。验证安装失败仍尝试恢复 Core 的已有路径。
- **设计同步**：更新 `docs/DECISIONS.md` T31 与 `docs/design/00-concept-design.md:351`，明确备份失败策略。若后续确需应用内“仍要安装”，另加显式确认与一次性授权，不能静默放行。

### E. 阅读进度保存可感知（P1-4；优先 P1；M）

- **改哪**：`D/pages/Reader.tsx:saveProgress`、切章/离开处理；必要时给 `D/lib/util.ts` 的 throttle 增加 flush/cancel。
- **怎么改**：捕获错误并维护本次阅读的保存失败状态，首次提示、持续失败不刷屏，成功后清除。保留最近一条待保存的章节/句子快照，用户可重试；切章与应用内离开时显式提交末次快照。不能在 React effect cleanup 中仅加 async 就声称已 await，也不保证强制退出能保存。
- **验收**：注入 RPC 失败可见提示，持续滚动不产生 toast 风暴；恢复后保存最新位置；切章写入旧章快照不会串章；快速离开后回到阅读器能恢复最后已确认位置；失败时不显示“已保存”。
- **设计同步**：概念设计阅读进度部分说明已保存/未保存语义与强制退出边界。

### F. 更新来源文案与下载兜底（P2-1 + P3-6；优先 P2，Web 部分 P3；S）

- **改哪**：`D/settings/UpdateItems.tsx`，复用项目已有外链打开方式；发布核对 `.github/workflows/release.yml`。
- **怎么改**：默认写“检查新版本”“每天检查一次”，避免未经确认的来源承诺；检查失败、浏览器模式提供官网/国内下载入口。先不加用户任意 endpoint 编辑器。若要展示“国内源优先”，须从壳返回有效配置而非按 README 猜测。
- **验收**：未注入镜像的包不声称国内优先；注入后的构建配置包含镜像→GitHub 顺序；Web 提供下载操作，桌面调用外部浏览器。失败文案不误称“已是最新”；自动检查仍默认关闭。
- **设计同步**：T31 与安装/更新说明同步；正式包内源列表及回退请求另做发布验证，本次未验证 CI 变量或 CDN 可达性。

### G. 正式用户断连文案（P2-9；优先 P2；S）

- **改哪**：`D/pages/Home.tsx:226`。
- **怎么改**：DEV 保留诊断命令；正式包显示“暂时无法连接，请重试或重启 Tibi”，提供现有 refresh 重试和可复制诊断入口。避免首选“重装”，它不是所有连接失败的合理处理。
- **验收**：正式构建首次无连接时看不到 pnpm/Core 开发步骤；重试成功恢复书架；开发环境仍可看到诊断提示。概念设计补连接异常空态。

### H. 系统语音空态（P2-8；优先 P2；S）

- **改哪**：`D/settings/VoiceItems.tsx`；核对 `D/lib/tts.ts:systemVoices` 的语言筛选。
- **怎么改**：空态改为“暂未检测到可用的美音/英音系统语音”，就近增加“使用 Kokoro（首次下载约 92 MB）”，复用 setE，不新增下载流程、不自动下载。对 voiceschanged 到达前避免绝对判断；是否扩大到其他英语口音单独按产品需求决定。
- **验收**：语音延迟出现时列表更新；空列表仍可操作 Kokoro；失败可重试且不错误持久化为已切换；下载中不重复发起。设置语音说明同步。

### I. 首页输入文案减负（P2-5；优先 P2 验证；S）

- **改哪**：`D/pages/Home.tsx` 的 textarea / cbar。
- **怎么改**：placeholder 简化为主要动作，保留现有动态“导入/问 Tibi”提示；将 `/` 帮助移至聚焦提示或轻量帮助。先不拆分路由、输入状态和后端意图识别。
- **验收**：URL、英文段落、问题、显式 `/` 四种输入仍进入原预期操作；新手能在提交前辨认当前意图。进行小样本任务观察，再决定是否分段控件。同步概念设计首页输入约定。

### J. 补齐 Mac 材质链路（P3-1；优先 P3；M）

- **改哪**：`R/src/lib.rs` 已有 apply_vibrancy、Mac 专属窗口配置、`D/styles.css` 背景层。
- **怎么改**：先在正式 Mac 窗口记录 apply_vibrancy 成败并观察，再补必要的窗口透明与 Mac 限定 body/root 透明，内容区保留不透明底色。保留其他平台当前背景与材质失败回退，不引入 Liquid Glass 新分支。本项不是重新引入 window-vibrancy。
- **验收**：明暗主题、不同桌面背景、侧栏折叠、窗口失焦和系统减少透明度下可读；内容区、弹层及引导页不意外透底；Windows/Linux 保持原行为。回写 research/04 E2 的实际验收状态。

### K. 阅读标注密度（P3-3；优先 P3；S）

- **改哪**：`D/pages/Reader.tsx` 的 mode；必要时调整 `D/styles.css` token。
- **怎么改**：先让现有“全部/仅生词/纯净”选择更可发现，并记住用户选择；用同一高生词密度文章比较现有模式，不直接删除五级学习状态或改状态模型。
- **验收**：切换模式后词卡、朗读、复习数据不变；再次进入保留选择；明暗主题均可辨认；经阅读任务观察再决定是否默认仅生词。视觉设计同步默认模式与用户偏好范围。

### L. 明确减少吉祥物的边界（P3-4；优先 P3；S）

- **改哪**：`D/pages/Onboarding.tsx`、`D/styles.css`、设置说明。
- **怎么改**：保留已经生效的 `.pstk` 规则；将引导页是否属于减少范围写入设计。建议减少模式隐藏引导插画但保留功能性的文字状态，不让“连接中/失败”信息随插画消失。先不改名并引入新的生动程度枚举。
- **验收**：开关前后首页、空态、练习/复习完成、重新测词汇量和模型连接页表现一致；重启后保留；Logo、头像遵守原设计豁免。同步 `docs/design/03-visual-language.md:167`。

### M. 开发访问地址说明（P2-2；优先开发 P3；S）

- **改哪**：README 开发说明，必要时 `apps/desktop/vite.config.ts` 与 `R/tauri.conf.json` 的 devUrl 一起核对。
- **怎么改**：首选记录实际打印的 localhost 地址与 IPv6 排障命令；若团队工具必须 IPv4，再统一 `TAURI_DEV_HOST=127.0.0.1`、devUrl、HMR 约定。不要把 server.host 写成数组或直接绑定公网网卡。
- **验收**：在可访问网络的本机终端验证指定地址返回页面，Tauri dev 与 HMR 都能连接；报告区分监听证据与 HTTP 成功。本次 curl 双失败不作为 Vite 服务坏掉的结论。

## 本周建议先做的 Top 5

| 顺序 | 任务 | 工作量 | 最低验收门槛 |
|---|---|---|---|
| 1 | A 称呼输入修复 | S | 有 nickname 时中文连续输入、删除、失焦保存及重进均正确 |
| 2 | B 未批改不记 0 分 | S | 无模型/批改失败不推进、不写练习成绩，真实 0 分仍可记录 |
| 3 | C 释义完整性与语境优先 | M | compiler 技术语境不再唯一指向编辑者，导出保留正确领域义，用户释义不被覆盖 |
| 4 | D 更新备份失败处理与阶段 | M | 备份失败不停止 Core/安装，UI 可理解且能重试，阶段显示正确 |
| 5 | E 阅读进度失败反馈与末次保存 | M | 故障有提示且不刷屏，恢复写最新位置，切章不串写 |

以上约 6–11 人日，属于本周启动顺序，不承诺单人五天全部交付。单人应先完成 A/B，再按学习数据影响推进 C；D 应在下一次向用户开放更新前完成。F/G/H 可在主项等待验收时穿插，不挤占语义正确性修复。

## 附录：对照原报告建议的调整

- 保留称呼、造句、进度、备份的修复方向；将释义完整性纳入 Top 5，不能因“语境选义可能很大”而把当前错误答案长期推后。
- “加 context_meaning”改为复用已有语境存储；“直接 null 分数”改为先阻止未批改进入成绩；“backup 失败确认”首版可采用阻断加手动修复入口，避免为确认流程引入不必要的下载缓存与授权状态。
- 导航合并 P2-4/P3-5 为待验证设计问题：观察查一个新词、管理已收藏词、处理待审批导入三个任务；只有证实迷路或重复切换后才改变入口。任何精简方案必须保留运行中/待审批通知与可到达页面。
- P3-2 保持现有 E3；后续在 Retina、系统缩放与最小窗口下比较字号方案，未获得任务可读性证据不安排全局改字号。
- P2-3 不新增第四步；P3-7 不更换 HashRouter；P2-8 不另建 Kokoro 下载器；P3-1 不重复安装已经存在的 crate。
- 未来实施时按每项同步设计文档和必要的中英文语言资源；本次方案不把待议事项改写为已确认产品决策，也不改原报告以免丢失审计对照。
- 实施后的验证应覆盖针对性的单元/组件分支、临时数据库语义探针及真实 Mac UI。只有更新链路改动才需要隔离的签名更新包安装验证；本次文档核查没有触发真实安装、下载或修改用户数据。
