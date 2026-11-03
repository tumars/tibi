# Tibi Mac 桌面版 UX 走查报告

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-02（Asia/Shanghai） |
| Git | `5c60b8e`（`国内源换成自己的域名 dl.ferecord.com`，已与 `origin/main` 同步） |
| 执行 | **Codex CLI**（`codex exec --approve-for-me`，模型配置为用户本机 Codex）主责启动与探针；协调方在 Computer Use / 锁屏导致无法实机点按后，汇总 Codex 结论并完成报告落盘 |
| 启动 | **成功**：`pnpm dev` / `apps/desktop/src-tauri/target/debug/tibi` 可起；sidecar `tibi-core` 连本机库；Vite 在 `[::1]:1420`（仅 IPv6） |
| GUI 实测 | **受限**：Computer Use 拒批临时包 `TibiUXReview`（`app.tibi.uxreview20261102`）；浏览器窗口 `cgWindowNotFound`；本机 `screencapture` 无法取屏（疑锁屏/无显示会话）。**不以「已完成实机点按」宣称** |
| 可验证路径 | 独立临时库 **core-probe**（见 `reports/mac-ux-review-20261102-assets/core-probe.json`）：示例导入 → 词典 → 加词 → 复习答题 → 练习出题 → 统计 → CSV 导出，共 24 步均 `ok` |
| 体验/核查时长 | 约 30–40 分钟（含启动、失败的 GUI 通道、离线探针、代码/设置/更新/语音静态走查） |
| 勿提交 | 本任务未要求 commit/push；报告与探针产物在 `reports/`（未跟踪或保持本地） |

## 1. 总评

Tibi Mac 桌面壳（Tauri debug）**能冷启动并跑通本地优先主闭环的后端能力**：读示例、查词典、进生词本、复习排期、练习出题、统计与导出都可用，产品骨架与「读英文顺便学」的定位清晰。当前最大短板不在「能不能跑」，而在：

1. **语境与释义被压扁**（技术文里的 `compiler` 变成「编辑者」），伤害学习可信度；  
2. **无模型时的练习体验会记成 0 分**，像惩罚新用户；  
3. **设置里称呼输入的受控状态写错字段**，改称呼时输入框会「打不动」；  
4. **更新/国内源叙事与实现不一致**（文案只提 GitHub，仓库 README 推 dl.ferecord.com，正式包是否注入国内 endpoint 取决于 CI 变量）；  
5. **Mac 原生感仍欠账**（`transparent: false`、未见侧栏 vibrancy；调研 E2 已决策但未落地），侧栏信息架构偏满（词典 / 生词本 / 运行记录与首页能力重叠）。

在 GUI 实点受限前提下，下列问题按「代码 + 探针复现」或「设计/代码推断」分级标注证据级别，避免把读代码说成点过。

## 2. 走查路径与覆盖

| 路径 | 覆盖方式 | 结果摘要 |
|---|---|---|
| 冷启动 / Tauri debug | 进程与日志 | `target/debug/tibi` + core stdio 正常；另起自定义 bundle id 的测试包因 CU 权限失败 |
| Onboarding | 代码 | 三步侧栏进度 vs 内部 step 1/2/3/4（词汇测试 step=2 不在进度条）易混淆 |
| 导航（首页/书架/生词/词典/复习/统计/运行记录） | 代码 + Shell.tsx | 七项侧栏；词典与生词、首页导入与书架入口有重叠感 |
| 阅读闭环 | 探针 + Reader 代码 | 示例 `how-a-compiler-sees-your-code` 导入成功；进度保存失败被静默吞掉 |
| 查词 / 生词本 | 探针 | `dict.entry` / `terms.add` / `terms.export` 成功；释义截断问题复现 |
| 复习 | 探针 | `review.start/next/answer` 两道题正确推进 |
| 练习（听写/拼写/易混/造句） | 探针出题 + Practice.tsx | `practice.start` 成功；造句无模型时 UI 写 `accuracy: 0` 再进 `practice.finish` |
| 设置 / 模型 / 语音 / 更新 | 代码 | VoiceItems 路径完整；UpdateItems 文案仅 GitHub；称呼字段 bug |
| 语音播放（句级跟随等） | 未实点 | 仅代码：引擎切换、Kokoro 下载、语速档位存在 |
| 下载/更新源 | 代码 + workflow | README 推国内 DMG；应用内检查更新默认 GitHub；release 可注入 CN mirror |

**证据级别图例**：`[探针]` 已在临时库复现 · `[代码]` 源码确认 · `[推断]` 设计/样式/未实点 GUI

## 3. 问题清单（按严重度）

### P1 — 高

#### P1-1 技术语境下释义被压成错误常识 · 不好用 / 体验差 · `[探针]`
- **现象**：示例文 *How a Compiler Sees Your Code* 中加词 `compiler` 后，词典全文含 `n. 编辑者\n[计] 编译程序`，但生词 `meaning`/`short_gloss` 与 CSV 导出只剩「编辑者」。复习/导出都带着错义。  
- **位置**：`packages/core/src/domain/terms/views.ts` 的 `firstLine` / `shortGloss`；`terms` 写入与 `terms.export` 的 `meaning \|\| short_gloss`。  
- **建议**：按体裁或句子选义（优先含 `[计]` / computer science 的义项）；`short_gloss` 可拼「首义；领域义」；导出默认带完整 translation 或「主义 + 领域」。阅读器词卡若有 AI 语境义，应写回 `context_meaning` 并在复习优先展示。

#### P1-2 未连模型时造句练习记 0 分 · 不好用 / 体验差 · `[代码]`
- **现象**：`Practice.tsx` 在 `!modelOk` 时 `setChecked({ accuracy: 0, … })`，用户点「下一题/看结果」仍把 0 分写入 `practice.finish`，总准确率被拉低；文案虽说「先不批改」，数字却是惩罚。  
- **位置**：`apps/desktop/src/review/Practice.tsx`（造句分支）。  
- **建议**：无模型时禁止提交该题进结果，或 `accuracy: null` 并在汇总中排除；开始页已有提示，题内应直接引导「去连接」且不进入 finish 统计。

#### P1-3 设置「Tibi 怎么称呼你」输入像打不动 · 不好用 · `[代码]`
- **现象**：受控 `value` 优先读 `assistant_prefs.nickname`，`onChange` 却只改 `display_name`；打字时 `nickname` 不变 → 输入框不更新，直到 blur 才 patch 两边。  
- **位置**：`apps/desktop/src/pages/Settings.tsx` 约 L94。  
- **建议**：`onChange` 同步更新 `display_name` 与 `assistant_prefs.nickname`（或单一字段源）；与 Onboarding 的 `nickname` 写入路径对齐。

#### P1-4 阅读进度保存失败完全静默 · 体验差 · `[代码]`
- **现象**：`saveProgress` 对 `sections.progress` 使用 `.catch(() => undefined)`，磁盘/Core 异常时用户以为「读到哪儿都会记住」。  
- **位置**：`apps/desktop/src/pages/Reader.tsx` L78。  
- **建议**：节流上报失败累计 N 次后 toast 一次；开发模式可打日志；关键节点（离开阅读器/切章）改为 await 并明示失败。

#### P1-5 更新前文案承诺备份，失败只写日志 · 体验差 · `[代码]`
- **现象**：设置写「安装前会备份数据」；`update.rs` 在 `system.backup` 返回 error 时仅 `log::warn`，仍继续停 Core 并安装。  
- **位置**：`UpdateItems.tsx` 文案；`apps/desktop/src-tauri/src/update.rs`。  
- **建议**：失败时弹确认「备份失败，仍要更新吗？」；或阻断安装并给出导出入口。Core 坏了要更新的逃生通道可保留，但必须知情同意。

### P2 — 中

#### P2-1 应用内更新叙事 vs 国内下载入口不一致 · 冗余 / 体验差 · `[代码]`
- **现象**：UpdateItems 固定「连接 GitHub」「每天连接一次 GitHub」；`tauri.conf.json` 默认 endpoint 为 GitHub `latest.json`；README / 安装区大力推 `dl.ferecord.com`。正式包仅当 CI 设置 `CN_MIRROR_BASE_URL` 才把国内源**插到 endpoints 前面**。用户心智：「官网让我下国内包，App 内又只认 GitHub」。  
- **位置**：`UpdateItems.tsx`；`tauri.conf.json`；`.github/workflows/release.yml` / `mirror-cn.yml`。  
- **建议**：设置里写清「优先国内源，失败再 GitHub」（若已注入）或提供手动源切换；检查更新失败时给国内下载链接；开发包与正式包在关于页标明 updater 实际 endpoints。

#### P2-2 Vite 仅监听 IPv6 `[::1]:1420` · 不好用（开发体验） · `[探针/环境]`
- **现象**：`curl 127.0.0.1:1420` 被拒，`http://[::1]:1420` 才通。本机脚本/代理若默认 IPv4 会误判「没起来」。  
- **建议**：`server.host` 同时绑 `127.0.0.1` 与 `::1`，或在 dev README 标明。

#### P2-3 Onboarding 进度条与真实步骤错位 · 体验差 / 视觉差 · `[代码]`
- **现象**：侧栏只展示 3 步（认识 → 连接模型 → 读第一篇），但内部存在 `step === 2` 词汇测试；从设置「重新测词汇量」进入时进度语义更乱。  
- **位置**：`Onboarding.tsx` `obsteps` vs `step` 状态机。  
- **建议**：进度条反映真实可到达步骤，或词汇测试明确为可选支线并改文案「可选 · 测词汇量」。

#### P2-4 侧栏「词典」与「生词本」对新手冗余 · 冗余 · `[推断/代码]`
- **现象**：七项导航；词典可从词卡/快捷入口到达，侧栏再占一位。首页已有导入+提问，书架又管文库，「运行记录」偏开发者/高级。  
- **建议**：默认侧栏收成：今天 / 书架 / 复习 / 生词；词典进命令面板或词卡；运行记录放设置「高级」或仅任务进行中时露出徽标。

#### P2-5 首页输入框承担导入+提问+/ 命令 · 不好用 · `[推断/代码]`
- **现象**：placeholder 同时讲三种意图；新用户第一印象负担重（虽有 hint，仍密）。  
- **建议**：默认「导入」主按钮 + 次要「问 Tibi」；或分段控件；首次用完示例前弱化 `/` 命令。

#### P2-6 `short_gloss` 截断策略过激 · 体验差 · `[代码]`（与 P1-1 相关）
- **现象**：去词性后按分号切并 `slice(0, 8)`，中文短、但多义/领域义直接丢。  
- **建议**：行内 gloss 可短，词卡/复习/导出用完整首段或多义摘要；8 字硬切对「编译程序」类四字词尚可，对「编辑者」这种「短但错」无效——根因是选行而非长度。

#### P2-7 备份失败与更新进度对用户不可见 · 体验差 · `[代码]`
- **现象**：安装中有下载百分比，无「正在备份」态；备份失败无 UI。  
- **建议**：安装状态机增加 `backing_up`；失败走 P1-5。

#### P2-8 无英文系统语音时的死胡同 · 体验差 · `[代码]`
- **现象**：VoiceItems 在系统引擎且 `voices.length === 0` 时只说「这台电脑没有英文系统语音」，未强推 Kokoro。  
- **建议**：空列表时 CTA「下载 Kokoro（约 92 MB）」一键切引擎。

#### P2-9 开发空书架文案泄漏实现细节 · 体验差 · `[代码]`
- **现象**：Core 未连时 Empty「先运行 pnpm core:dev，再刷新」——正式用户若看到同等态会懵（debug 可接受）。  
- **建议**：按 `import.meta.env.DEV` / 打包态分支文案；正式包引导「重启应用 / 重装」。

### P3 — 低 / 视觉与原生感（多为 `[推断]`）

#### P3-1 侧栏 vibrancy / 透明窗口未落地 · 视觉差 · `[代码/设计]`
- **现象**：`tauri.conf.json` 中 `transparent: false`；调研 E2 已决策采用 `window-vibrancy` Sidebar，与 Linear 式「网页精致」差距仍在文档中自陈。  
- **建议**：按 `docs/research/04` 做 Mac 侧栏材质 + 内容区不透明；红绿灯已 Overlay，继续去掉「灰底白卡」感。

#### P3-2 13.5px UI 字号偏网页工具 · 视觉差 · `[推断]`
- **现象**：全局 `font-size: 13.5px`（决策 E3 保留）；密集设置列表在 Retina 上可读但偏「后台」。  
- **建议**：阅读器保持；设置/侧栏可试 14–15px 分组标题层级。

#### P3-3 生词高亮多色底纹信息噪音 · 视觉差 · `[推断]`
- **现象**：`.w.s0`–`.s4` 多种 underline wash；生词多时页面像标注试卷。  
- **建议**：默认只强调「生词/学习中」两档，其余进筛选或复习才上色。

#### P3-4 吉祥物与文案开关分散 · 冗余 · `[代码]`
- **现象**：「减少吉祥物」在设置；Onboarding / 练习完成仍有狐狸逻辑。开关名偏负面。  
- **建议**：合并为「界面生动程度：生动 / 安静」；安静模式统一去插画与俏皮空状态。

#### P3-5 运行记录对主路径过重 · 冗余 · `[推断]`
- **现象**：完整任务树、键盘 A/R、诊断复制——对英语学习者主路径非必需。  
- **建议**：见 P2-4；保留能力但降级入口。

#### P3-6 检查更新「浏览器模式不能更新」话术生硬 · 体验差 · `[代码]`
- **现象**：web 开发壳直接 toast；可顺便给 Releases / 国内下载链接。  
- **建议**：toast 带操作「打开下载页」。

#### P3-7 HashRouter URL 不美观 · 视觉差（次要） · `[代码]`
- **现象**：Tauri 下 `#/read/...` 属技术约束（决策 T14）；对用户几乎不可见，分享/深链文档需写清。  

## 4. 优先级建议

### 本周可快速改进（小改动、高收益）
1. 修复设置称呼受控字段（P1-3）  
2. 造句无模型不记 0 分（P1-2）  
3. 阅读进度失败至少 toast（P1-4）  
4. 更新备份失败确认框（P1-5）  
5. Update 文案对齐国内源 / 失败给 `dl.ferecord.com`（P2-1）  
6. 无系统语音时引导 Kokoro（P2-8）  
7. Vite 绑定 127.0.0.1（P2-2）

### 需设计或工程较大项
1. **语境选义 / 多义 short_gloss**（P1-1，影响复习质量）  
2. **侧栏信息架构精简**（P2-4 / P3-5）  
3. **Mac vibrancy 原生化**（P3-1，E2）  
4. **首页 composer 意图分流**（P2-5）  
5. **生词高亮视觉层级**（P3-3）

## 5. 启动与失败记录（GUI）

| 步骤 | 结果 |
|---|---|
| `git pull` main | 已最新 `5c60b8e` |
| `pnpm dev` / 已有 vite+tauri | 成功；`tibi` 进程在跑 |
| 自定义 id `app.tibi.uxreview20261102` + `/tmp/TibiUXReview.app` | 进程可起；**Computer Use：was not approved to use TibiUXReview** |
| 浏览器 CU / 截屏 | `cgWindowNotFound` / `could not create image from display` |
| 临时库 core-probe | **24/24 ok**（详见 JSON） |

**结论**：Mac 桌面版**可以启动并支撑完整体验的数据面验证**；本轮**未能完成视觉与原生交互的实机点按验收**。建议在用户解锁桌面并授权 Computer Use 访问正式 `tibi`（`app.tibi`）后，补一轮 20 分钟实机走查（Onboarding 首屏、词卡、朗读句跟随、设置更新按钮）。

## 6. 附录

- 探针：`reports/mac-ux-review-20261102-assets/core-probe.json`  
- Codex 会话：启动走查 `01a19c27-7c28-70b0-a8f5-c351a2f7334f`；写报告续跑 `01a19c33-50be-77e0-9983-c07b6f76259d`（后因流中断/卡住，由协调方据其已确认结论完稿）  
- 问题条目合计：**21**（P1×5 + P2×9 + P3×7）

