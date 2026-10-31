# 04 调研：mac 原生感与精致度，以及吉祥物素材

> 2026-10-30。起因：原型从截图看"不够 mac 原生、不够精致"，另希望用吉祥物的图片与动画给项目增加趣味。本文给出诊断、可用的库与工具、建议的决策（E1–E8 界面、F1–F5 吉祥物），决策进 `00-concept-design.md` 第 7 节。对照原型：[`prototypes/native-mac.html`](../prototypes/native-mac.html)。

## 1. 为什么现在看着像"网页"而不像 mac 应用

把现在的原型和 Things 3、Craft、Bear 2、Reeder、Apple 自己的备忘录放在一起看，差别不在配色，而在下面七处。每一处都有对应的实现手段（§2）。

| 部位 | 现在 | mac 应用的做法 | 影响 |
|---|---|---|---|
| 窗口与标题栏 | 没有系统标题栏；整块灰底里放一张 16px 圆角白卡（Linear / Notion 式网页布局） | 红绿灯嵌在侧栏左上，侧栏一直延伸到窗口顶部；内容区平铺，与侧栏之间只有一条发丝线 | 最大的一处。"白卡放在灰底上"是网页应用的标志性布局 |
| 侧栏材质 | 实心灰 | 半透明毛玻璃（NSVisualEffectView 的 sidebar 材质），透出桌面壁纸；macOS 26 起是 Liquid Glass | 用户一眼就能分辨"原生"与否的地方 |
| 字体与字号 | Geist + 阿里巴巴普惠体，正文 14px | 系统字体（SF Pro + 苹方），正文 13px、辅助 11px；SF 在小字号下自动切换 Text / Display 光学尺寸 | 系统字体让文字和菜单栏、系统对话框是同一种"声音" |
| 控件 | 胶囊按钮、大圆角、实心墨色主按钮、32px 高 | 24–28px 高、5–6px 圆角、极淡的描边 + 半像素投影，主按钮是系统强调色渐变 | 胶囊和大圆角读起来是移动端 / 网页 |
| 选中与强调 | 品牌蓝浅底 + 蓝字 | 侧栏选中行是实心强调色 + 白字（窗口失焦变灰）；强调色跟随用户在系统设置里的选择 | 用户选了紫色强调色，应用也该变紫 |
| 分割线 | 1px，7% 黑 | 0.5px 发丝线（视网膜屏下真是半像素） | 1px 线在视网膜屏上显得粗 |
| 菜单、右键、对话框 | HTML 画的 | 原生菜单栏、原生右键菜单、原生文件对话框与通知 | 一旦菜单是网页画的，整个应用的"原生感"就破了 |

### 1.1 对照页的意外发现（2026-10-30）

用户看了对照页后反馈："现在的方案"那一栏比真实原型舒服、也更精致。查下来，对照页里的"现在的方案"和真实原型差在五处，都与 mac 原生无关，是密度与克制的问题：

| 差异 | 对照页 | 真实原型 |
|---|---|---|
| 字体 | 没有加载 Geist / 普惠体，实际回落到系统字体（SF Pro + 苹方） | 拉丁字母用普惠体的西文字形，字重偏软 |
| 页标题 | 顶栏里出现一次 | 顶栏面包屑"书架" + 正文大标题"书架"，出现两次 |
| 卡片 | 元信息、标题、摘录、进度条四样 | 再加彩色难度点、标签胶囊、两条进度条，七样 |
| 标签行 | 7 个无计数的小标签 | 13 个带计数的胶囊，两行 |
| 侧栏 | 32px 行、选中浅蓝底、计数灰字 | 36px 行、选中白卡描边、蓝色实心徽标、搜索框带边框卡片 |

结论：**先做"精修层"，再谈原生化**。精修层只改密度与克制，不依赖 Tauri，所有页面都能用，先做成可切换的层给用户看，用户确认后当天并入默认样式（`v2.css` 直接改原规则，开关已删）：系统字体优先、页标题只出现一次、卡片去掉标签与彩色点、标签不带计数、圆角三档（6 / 8 / 12）、侧栏徽标改为灰字、选中态改浅蓝底。E1–E8 里的窗口、vibrancy、原生菜单仍然是下一步。

另外两点"精致度"问题与 mac 无关，但一起改：

- **圆角和间距没有统一的尺度**：现在 6 / 8 / 12 / 16 / 99px 都有。mac 应用只用三档：控件 6px、面板 10px、窗口 11px。
- **层级靠底色区分**：灰底 + 白卡 + 浅灰 sunken 三层。原生做法是内容区一种白，层级靠发丝线和留白。

## 2. 可用的库与工具

### 2.1 窗口与材质（Tauri 2）

| 做什么 | 用什么 | 说明 |
|---|---|---|
| 隐藏标题栏、保留红绿灯 | Tauri 内置：`"titleBarStyle": "Overlay"`, `"hiddenTitle": true` | 网页延伸到标题栏下方；红绿灯位置用 Rust 侧的 `traffic_light_position`（2025-03 合入），配置文件里暂不能写 |
| 侧栏毛玻璃 | [`window-vibrancy`](https://github.com/tauri-apps/window-vibrancy)（Tauri 官方 crate）`NSVisualEffectMaterial::Sidebar` | 需要网页 `html, body { background: transparent }`、窗口 `transparent: true`、`macOSPrivateApi: true`；只给侧栏区域透明，内容区自己画不透明白 |
| macOS 26 Liquid Glass | 同一 crate 的 `apply_liquid_glass`（26+），或 [`tauri-plugin-liquid-glass`](https://github.com/hkandala/tauri-plugin-liquid-glass) | 用的是私有 API `NSGlassEffectView`，上架 App Store 有风险；CSS 做不出真折射（它折射的是网页下面的内容）。v1 先用 vibrancy，Liquid Glass 作为 26+ 的可选开关 |
| 红绿灯内缩、Windows 吸附菜单 | [`tauri-plugin-decorum`](https://crates.io/crates/tauri-plugin-decorum) | 顺手解决 Windows 的 snap overlay；如果只做 mac，用内置的就够 |
| 跟随系统强调色、自动 vibrancy | [`tauri-plugin-window-integration`](https://github.com/NickvisionApps/tauri-plugin-window-integration) | 把强调色传给网页；也可以在 WebKit 里直接用 `-apple-system-control-accent`（非标准）或 CSS `AccentColor` |
| 原生菜单与右键 | Tauri 2 Menu API（`Menu`, `Menu.popup`） | 菜单栏（文件 / 编辑 / 视图 / 阅读 / Tibi / 窗口 / 帮助）、右键菜单、Dock 菜单全部原生 |
| 文件对话框、通知、窗口状态 | `tauri-plugin-dialog`、`tauri-plugin-notification`、`tauri-plugin-window-state` | 官方插件 |

### 2.2 组件库

没有一个"mac 皮肤"的 React 组件库值得用：`react-desktop` 停在 High Sierra 时代；21st.dev 上的"macOS components"是零散片段。可行的路线是 **无样式组件 + 自己的 token**：

| 方案 | 评价 |
|---|---|
| ⭐ shadcn/ui（Radix 原语 + Tailwind，代码复制进仓库） | 生态最大、交互可及性（焦点、键盘、ARIA）现成；默认样式是"网页风"，要用我们自己的 mac token 全部重写一遍变量；因为代码在自己仓库里，重写没有阻力 |
| Base UI（MUI 团队，Radix 原作者，无样式） | 比 Radix 新、API 更一致；1.0 在 2025 发布；生态比 shadcn 小 |
| Ariakit / Headless UI | 可用，但社区小于前两者 |
| Blueprint | 为数据密集桌面应用设计，但视觉是它自己的，和 mac 不搭 |

结论：**shadcn/ui + 自己的 mac token**（圆角、字号、控件高度、发丝线、强调色变量），组件只借交互。

### 2.3 字体与图标

- 字体栈：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", sans-serif`；Windows 回落 `"Segoe UI", "Microsoft YaHei"`。阿里巴巴普惠体不再随 mac 版分发（Windows / Linux 上可选打包，中文回落仍然不错）。阅读正文继续 Charter。
- 图标：SF Symbols 只允许在 Apple 平台上的应用使用，而且在 WebView 里没有直接可用的方式；**Lucide**（现在用的）线宽 1.5–1.75、16px，和 SF Symbols 的 regular 字重视觉接近，继续用。
- 文字渲染：`-webkit-font-smoothing: antialiased`，`font-feature-settings: "tnum"` 用在数字列。

### 2.4 参考应用

Things 3（侧栏 vibrancy、极少的线）、Craft（白内容区 + 毛玻璃侧栏 + 轻投影卡片）、Bear 2（三栏、发丝线）、Reeder 5（阅读应用的工具栏）、Apple 备忘录 / 提醒事项（源列表选中态、强调色跟随）、Raycast（键盘优先、28px 行高）、Linear（我们现在最像的——这是网页应用的精致，不是 mac 的精致）。

## 3. 建议的决策（E 组：界面）

| 编号 | 决策 | 建议 |
|---|---|---|
| **E1** | 窗口：`titleBarStyle: Overlay` + 红绿灯嵌在侧栏，去掉"灰底 + 白卡"布局，内容区平铺、与侧栏之间一条发丝线 | 采用 |
| **E2** | 侧栏用 `window-vibrancy` 的 Sidebar 材质；内容区不透明；macOS 26 的 Liquid Glass 作为可选开关，默认关 | 采用 |
| **E3** | 字体改系统字体栈，正文 13px、辅助 11px、标题 15 / 20px；普惠体只在 Windows / Linux 打包 | ✅ 部分采用（2026-10-31）：系统字体栈采用；字号保持 13.5px；普惠体任何平台都不打包（03 §2） |
| **E4** | 选中、焦点、默认按钮改用**系统强调色**（跟随用户设置）；Tibi 的电光蓝保留给 AI 标识 ✦、进度与品牌；狐狸橙不变 | ❌ 不采用（2026-10-31）：强调色已收为品牌靛蓝 `#3d52e0`，手机版也用它；跟随系统色会让品牌色和选中色两种蓝并存 |
| **E5** | 菜单栏、右键菜单、文件对话框、通知全部原生（Tauri Menu / 插件）；原型里 HTML 画的菜单只用于演示 | 采用 |
| **E6** | 组件：shadcn/ui（Radix）只借交互，样式全部换成自己的 mac token；圆角三档 6 / 10 / 11px；控件高度 24 / 28px；线 0.5px | ✅ 部分采用（2026-10-31）："只借交互、样式用自己的 token"采用；数值保持 6 / 8 / 12、控件 30px（已并入的精修层） |
| **E7** | 滚动条：mac 上用 WKWebView 自带的覆盖式滚动条，去掉 OverlayScrollbars；Windows 保留 | 采用 |
| **E8** | Windows 版：同一套 token，窗口用 decorum 的吸附菜单，Mica 材质可选 | 采用，排在 M6 |

执行方式：03 视觉语言改到 v3（`03-visual-language.md` 第 1、2、4、5 节），`v2.css` 的 token 加一层 `platform-mac` 覆盖，原型页先只改书架一页看效果（已做：`native-mac.html`），确认后再推到其他页。

## 4. 吉祥物：素材与动画怎么做

### 4.1 现状与目标

现在 Tibi（藏狐）只有一种形态：`v2-fox.js` 的扁平 SVG，7 个状态，在首页、复习完成页、空状态出现（调研时的现状，已被 [07 §5](../design/07-mascot-assets.md#5-落地到原型) 修订）。想加的"趣味"分三层，各自用不同的做法：

| 层 | 用在哪 | 做法 |
|---|---|---|
| **插画**（静态图） | 首页 hero（早 / 午 / 夜三版）、四个空状态、复习完成与连续学习里程碑、首次使用引导、出错 / 离线页、对话里的贴纸反应、关于页（使用位置已被 [07 §5](../design/07-mascot-assets.md#5-落地到原型) 修订） | 图像模型生成（gpt-image），一张"角色设定图"做参照，保证每张都是同一只狐狸 |
| **在应用里动的小狐狸** | 首页标题上方、输入框倾听、Tibi 思考、审批惊讶 | 保留 SVG + CSS（已有）；以后有设计师时换 Rive（状态名不变） |
| **3D** | 首次使用"认识一下"的可转动狐狸、关于页、macOS 26 的分层应用图标、宣传图 | 角色设定图 → Meshy / Tripo 图生 3D → GLB → `<model-viewer>`；只在这几处用，不进常驻界面 |

### 4.2 工具评估

| 工具 | 适合 | 不适合 | 结论 |
|---|---|---|---|
| **gpt-image（ChatGPT / Codex 内的图像生成）** | 成套插画：给角色设定图做参照，多张之间一致性好；可指定透明背景 | 动画 | ⭐ 插画主力。Codex CLI 需开 `image_generation` 特性（`codex features enable image_generation`，登录 ChatGPT 账号，模型 gpt-image-1.5；社区报告 0.137 起稳定）；Codex App 自带"Generate Images"技能；也可直接调 Images API（`/v1/images/edits` 带参考图） |
| **Rive** | 交互式吉祥物：骨骼 + 状态机，代码只发输入（`isThinking`）；运行时约 80 KB | 不能从图片自动生成，要人工拆层、绑骨 | 有设计师时的升级路线（03 §7.1 已定），设定图可以直接当拆层素材 |
| **Lottie** | 一次性播放的小动画（庆祝、加载） | 交互弱、文件大、需要 After Effects | 不用；庆祝动画用 CSS + SVG 粒子即可 |
| **Spline** | 网页 3D 场景编辑 | 免费导出带水印；运行时大；状态机弱 | 不用 |
| **Meshy 6 / Tripo 3.1（图生 3D）** | 从一张正面设定图出带贴图的 GLB，20–90 秒；Meshy 有"卡通角色"模式 | 细节会偏；要二次修（Blender） | ⭐ 3D 的入口；成功率看设定图是否干净（纯色背景、正面、无遮挡） |
| **`<model-viewer>`（Google，Web Component）** | 加载 GLB、自动转台、触控旋转，约 300 KB | 常驻界面太重 | 只在引导页与关于页用，懒加载 |
| **three.js + glTF 动画** | 完全自定义 | 开发量大 | 不用 |
| **Icon Composer（Apple）** | macOS 26 分层图标（玻璃质感由系统渲染） | — | 应用图标用它：底层深靛蓝（2026-10-31 由电光蓝调深，同 logo）、上层狐狸正脸 |

### 4.3 风格决定：插画用"软 3D"，应用内小狐狸保持扁平

多邻国的做法是应用内扁平、营销与节日画面用 3D 渲染的 Duo，两者靠同一张设定图保持同一个角色。建议 Tibi 也这样：

- **插画风格**："软 3D / 粘土玩偶渲染"（圆润、柔和的全局光、轻微的毛绒质感、浅色干净背景），比扁平插画更"精致"，也和 macOS 26 的玻璃质感更搭。
- **一致性方法**：先生成一张**角色设定图**（正面 / 四分之三侧 / 侧面 + 表情条），之后每张图都把它作为参考图（ChatGPT 里附图；API 用 `images/edits`）。设定图定稿后存 `docs/design/mascot/ref-sheet.png`，所有提示词都引用它。
- **颜色**：见 [03 §7.1](../design/03-visual-language.md#71-吉祥物藏狐-tibi缇比)。

### 4.4 建议的决策（F 组：吉祥物）

| 编号 | 决策 | 建议 |
|---|---|---|
| **F1** | 插画走"角色设定图 + gpt-image 参考生成"，风格软 3D；应用内动的小狐狸保持 SVG，两者同一角色 | 采用 |
| **F2** | 素材清单与提示词固定在 [`design/07-mascot-assets.md`](../design/07-mascot-assets.md)，脚本 [`tools/gen-mascot.py`](../../tools/gen-mascot.py) 批量出图；每张图的提示词可追溯 | 采用 |
| **F3** | 3D 只做三处：引导页转台、关于页、macOS 26 分层图标；用 Meshy / Tripo 从设定图生成，`<model-viewer>` 懒加载 | 采用，排在 M5 后 |
| **F4** | Rive 升级保持 03 §7.1 的结论（有设计师时），设定图即拆层素材 | 维持 |
| **F5** | SVG 与插画不同框：同一位置只放一只，按位置分用，规则见 [03 §7.2](../design/03-visual-language.md#72-插画与封面) | 采用 |

### 4.5 怎么用你电脑上的 Codex / ChatGPT

> 调研时的记录。实际出图流程见 [07 §1.1](../design/07-mascot-assets.md#11-怎么出图)。

这个会话跑在云端容器里，连不到你的电脑；要让我直接驱动 Codex 出图，需要在 Claude 桌面应用的 Settings → Claude Code → Remote Control 里把 `tibi` 文件夹加进去（或在该目录运行 `claude remote-control`），之后我可以在新会话里接上。在那之前，有两条路都不需要我：

1. **ChatGPT**：把 `07-mascot-assets.md` §2 的"角色设定图"提示词贴进去，生成后下载为 `docs/design/mascot/ref-sheet.png`；再逐张贴 §3 的提示词并附上设定图。
2. **Codex**：在 `tibi` 目录运行 `codex features enable image_generation` 后，让它按 `07-mascot-assets.md` 出图；或设 `OPENAI_API_KEY` 后运行 `python3 tools/gen-mascot.py --all`（用 Images API，自动带参考图）。

## 参考

- Tauri 2 窗口配置：titleBarStyle / hiddenTitle（[v2.tauri.app](https://v2.tauri.app/reference/javascript/api/namespacewindow/)）；红绿灯位置 PR [tauri#12366](https://github.com/tauri-apps/tauri/pull/12366)
- [window-vibrancy](https://github.com/tauri-apps/window-vibrancy)（含 `apply_liquid_glass`）、[tauri-plugin-liquid-glass](https://github.com/hkandala/tauri-plugin-liquid-glass)、[liquid-glass-tauri-demo（原理研究）](https://github.com/HaoRangQi/liquid-glass-tauri-demo)
- [tauri-plugin-decorum](https://crates.io/crates/tauri-plugin-decorum)、[tauri-plugin-window-integration](https://github.com/NickvisionApps/tauri-plugin-window-integration)、[tauri-plugin-mac-rounded-corners](https://www.npmjs.com/package/@cloudworxx/tauri-plugin-mac-rounded-corners)
- 系统强调色：Jim Nielsen [User-Controlled, System-Level Preferences](https://blog.jim-nielsen.com/2020/user-controlled-system-level-aesthetic-preferences/)；Stefan Judis [CSS system colors](https://www.stefanjudis.com/blog/css-defines-color-values-that-follow-system-preferences)
- 组件库综述：[uibakery](https://uibakery.io/blog/ui-component-libraries-for-react)、[uilora](https://www.uilora.com/blog/uilora/10-best-react-ui-component-libraries-in-2026-ranked-by-a-frontend-team)；[react-desktop](https://github.com/gabrielbull/react-desktop)（已过时）
- Codex 图像生成：[openai/codex#8758](https://github.com/openai/codex/issues/8758)、[Codex CLI image workflows](https://codex.danielvaughan.com/2026/03/28/codex-cli-image-workflows/)、[codex-imagegen-cli](https://github.com/jdmnk/codex-imagegen-cli)
- 动画工具：[Rive vs Lottie 2026](https://www.rivemasterclass.com/blog/rive-vs-lottie)、[Spline vs Rive](https://www.uxblueprints.com/compare/spline-vs-rive)、[LottieFiles 工具综述](https://lottiefiles.com/blog/design-guides-and-tips/best-motion-design-tools-ranked-by-use-case)、[用 Rive 做交互吉祥物](https://dev.to/uianimation/engineering-interactive-mascots-with-rives-state-machine-and-runtime-architecture-4e2h)
- 图生 3D：[Meshy 卡通角色生成](https://www.meshy.ai/3d-tools/cartoon-character-generator)、[Meshy 6 vs Tripo 3.1](https://okmiku.com/blog/ai-3d-model-generator-meshy-tripo-meta-sam-2026)、[Tripo image-to-3d](https://fal.ai/models/tripo3d/tripo/v2.5/image-to-3d)
