# macOS 顶部菜单栏快捷查词与伴随面板

> 状态：**已实现**（2026-11-24）。

## 1. 背景与目标

此前桌面端托盘图标仅挂着「打开 Tibi / 退出」两项菜单，且 `window_set_tray_mode` 未接入前端设置，导致用户关闭主窗口后无法常驻顶栏。对经常在 Safari、PDF、编辑器里读英文的 macOS 用户而言，在顶部菜单栏提供「随手查词、随时加入生词本、顺手剪藏网址、看一眼今日进度」能显著缩短阅读学习闭环。

设计边界：
- **本地优先、离线极速**：查词全部复用本地 `dict.db`（`dict.suggest` / `dict.entry`），毫秒级响应，不联网。
- **零打扰、按需出现**：遵循 [视觉语言 v2](03-visual-language.md) 的「安静的 AI 工作台」风格，不弹窗打断、不主动改写剪贴板或自动消耗 AI 额度。
- **双渠道一致兼容**：不使用私有窗口 API，也不依赖 macOS 辅助功能权限，官网版（`direct-distribution`）与 Mac App Store 沙盒版（`app-store`）表现一致。

## 2. 交互与功能方案

### 2.1 左键快捷面板 vs 右键原生菜单
- **左键点击顶栏图标**（或按全局快捷键）：在图标正下方弹出 `392 × 520` 快捷查词面板（独立 WebView 入口 `tray.html`，启动时预热隐藏，首次点击零延迟显示）。
  - 失焦自动收起；点击「固定在最前（Pin）」后常驻最前且可拖动，便于对照外部英文文档连续查词。
  - 配置 `NSWindowCollectionBehavior`（`CanJoinAllSpaces | FullScreenAuxiliary | Stationary | IgnoresCycle`）与 `NSStatusWindowLevel`，可在全屏应用和任意桌面空间上方直接浮现，不强制切换 Space。
  - 使用 260ms 失焦防抖，避免面板展开时再次点击顶栏图标出现「收起后瞬间重开」的闪烁。
- **右键点击顶栏图标**：弹出原生 macOS 菜单，提供快速查词、打开 Tibi、开始复习（动态显示到期张数）、词典、生词本、导入文章、设置、退出 Tibi，并随界面中/英文切换自动同步文案与 tooltip。

### 2.2 快捷面板能力
1. **极速离线查词**：输入英文单词、词形变形（`went → go`）、短语或中文反查（`苹果 → apple`），边输边联想并同步展示当前词条——音标、系统/AI 朗读、CEFR/柯林斯/考试标签、释义、辨析、词典例句、**「在你读过的文章里」原句跳转**，以及一键展开词形/搭配/近义词。
2. **生词本直连**：未收录词一键加入生词本（`⌘S`，支持撤销）；已收录词直接显示并可点击调整 6 档熟练度，与主窗口通过 Core `data.changed` 事件实时同步。
3. **智能输入与剪贴板建议**：
   - 打开面板且输入框为空时，经公开 AppKit `NSPasteboard` 读取剪贴板，仅在内容为干净的英文词/短语或 `http(s)://` 网址时显示轻提示条（过滤多行、代码/token 与长文本），点击一键查词或导入。
   - 输入/粘贴网址 → 直接导入书架并跟踪进度，完成后一键在主窗口开始阅读；粘贴长段英文 → 可导入书架或让 Tibi 讲解；其他句子/提问或按 `⌘↵` → 直接带入主窗口问 Tibi。
4. **今日学习概览（空态）**：紧凑三格展示待复习数、今日阅读进度、连续天数，下方显示正在读的文章（一键续读）与和词典页互通的「最近查过」胶囊。

### 2.3 常驻与全局快捷键设置
- 在「设置 → 通用」接入：
  - **关闭窗口时留在菜单栏**（macOS 默认开启，同步至 `window_set_tray_mode`；隐藏后点击 Dock 图标通过 `RunEvent::Reopen` 自动唤回主窗口；`⌘Q` 或托盘退出经 `RunEvent::Exit` 安全停止 Core）。
  - **快速查词快捷键**（macOS 专属，基于 Carbon `HIToolbox` `RegisterEventHotKey`，公开 API、沙盒免授权；默认 `⌥⇧D`，支持切换 `⌃⌥D` / `⌃⌥T` / `⌥Space` / `⌘⇧L` 或关闭）。

## 3. 架构要点

| 模块 | 文件 | 职责 |
|---|---|---|
| Rust 托盘与弹窗 | `apps/desktop/src-tauri/src/tray.rs` | 托盘图标与右键菜单、弹窗定位算法（多屏/Retina/边角裁剪）、AppKit 公开外观配置、剪贴板读取、主题与待复习数同步 |
| macOS 全局快捷键 | `apps/desktop/src-tauri/src/hotkey.rs` | 主线程注册/注销 Carbon HotKey，触发时切换快捷面板 |
| 权限边界 | `apps/desktop/src-tauri/capabilities/tray.json` | `"tray"` 窗口最小权限集 |
| 快捷面板前端 | `apps/desktop/tray.html`、`src/tray/TrayApp.tsx`、`src/tray/classify.ts` | 独立多页入口、查词/导入/问 Tibi 交互、状态同步 |
| 设置与主窗口联动 | `src/settings/TrayItems.tsx`、`src/App.tsx`、`src/lib/macNative.ts` | 菜单栏常驻/快捷键配置、跨窗口主题与路由跳转 |
