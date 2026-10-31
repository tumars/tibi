# 调研 03：技术选型

> 每一项给出候选、推荐与理由。标注 ⭐ 的为当时的推荐方案；现行决定见 [`DECISIONS.md`](../DECISIONS.md)。

## 1. 应用形态 / 运行框架

需求约束：数据（SQLite 文件）存在本地；未来开源，希望普通用户能"下载即用"。

| 方案 | 优点 | 缺点 |
|---|---|---|
| ⭐ **Tauri 2**（Rust 壳 + 系统 WebView + Web 前端） | 安装包小（几 MB）、内存低；可访问本地文件；Tauri 2 还支持 iOS/Android（手机端作为独立的壳，见 00 §3.13、D8） | 需要少量 Rust；各平台 WebView 渲染有细微差异（Linux WebKitGTK 最弱）；WebView 中跑本地 TTS 模型受限于 WebGPU 支持度 |
| Electron | 生态最成熟，Chromium 一致性好，Node 直接用 better-sqlite3 | 包体 ~100MB+、内存高 |
| 本地 Web 服务 + 浏览器（类似 Lute） | 实现最简单 | 用户需装运行时/Docker，体验差 |
| 纯 PWA（浏览器 + SQLite WASM + OPFS） | 零安装 | 数据在浏览器沙箱里，不是用户可见的 `.db` 文件；导入文件、跨域抓网页受限 |

**结论（2026-10-29 已确认）**：Tauri 2。前端用 React + TypeScript + Vite。核心业务逻辑尽量写在 TS 侧，Rust 侧只做"系统能力"（窗口、托盘、文件对话框、密钥存储、守护 Core），不碰业务数据（见 06 §7），降低贡献门槛。

## 2. UI 组件库

| 方案 | 特点 |
|---|---|
| ⭐ **shadcn/ui**（Radix UI + Tailwind CSS） | 当前 React 生态最流行的组件方案；代码复制进项目、可完全定制；视觉简洁现代、暗色模式完善；非常适合打造"阅读器"这种需要精细排版的产品 |
| Mantine | 组件全、开箱即用、文档好；定制性略弱于 shadcn |
| Ant Design / Arco Design | 中后台风格，偏"管理系统"，不适合沉浸式阅读 |
| HeroUI（原 NextUI） | 视觉漂亮，动效好；组件数量少于前两者 |

**推荐**：shadcn/ui + Tailwind CSS，配合：
- 图标：`lucide-react`
- 动效：`motion`（原 Framer Motion）
- 图表（统计页）：`recharts`（shadcn 的 Chart 组件即基于它）；原型里是手写 SVG，正式版按 03 §5 的图表规范用 recharts 实现
- 字体与视觉风格：见 [视觉语言](../design/03-visual-language.md)（界面系统字体、阅读正文 Charter / Charis SIL、代码 JetBrains Mono；普惠体只做回落，随包分发前需核对许可）
- shadcn/ui 的默认风格与 v2「安静的 AI 工作台」接近，按 `v2.css` 的 token 调整颜色、圆角即可

## 3. 内容导入与识别

| 输入 | 方案 |
|---|---|
| 纯文本 | 直接处理 |
| 网址 | Core 抓取 HTML（规避 CORS，能力 `fetch_url`）→ ⭐ **Defuddle**（Obsidian Web Clipper 使用，对 Readability 的改进版）或 Mozilla Readability 提取正文 → 转 Markdown |
| PDF | `pdf.js` 提取文本层；无文本层（扫描件）走 OCR |
| EPUB | `epub.js` / 直接解压解析 XHTML |
| DOCX | `mammoth.js` → HTML/Markdown |
| 图片 / 扫描 PDF | 见下方 OCR |

### OCR 方案

**注意：调研时 DeepSeek 官方 API 不支持图片输入（现行模型 deepseek-v4-flash / deepseek-v4-pro 是否支持未核实）。** DeepSeek 开源了 DeepSeek-OCR / DeepSeek-OCR-2 模型，但官方没有直接的 OCR API，只能通过第三方托管平台（SiliconFlow、Novita 等）或本地部署调用。因此 OCR 需要独立设计：

| 方案 | 优点 | 缺点 |
|---|---|---|
| ⭐ **Tesseract.js**（本地，默认） | 免费离线，英文印刷体识别准确率高；纯 JS/WASM | 对复杂版面、手写、低质量照片效果一般 |
| ⭐ **多模态大模型（可选）**：Qwen-VL / GPT-4o 类 / DeepSeek-OCR（第三方托管）等 OpenAI 兼容接口 | 版面理解好，能直接输出结构化 Markdown、去掉页眉页脚 | 需要 API Key、有成本 |
| PaddleOCR（本地服务） | 精度高 | 需要 Python 环境，打包困难 |
| 系统 OCR（macOS Vision / Windows.Media.Ocr） | 免费、质量好 | 跨平台不一致，需 Rust 绑定 |

**推荐**：默认本地 Tesseract.js；设置里可配置"视觉模型"（独立于文本模型）用于高质量 OCR。OCR 结果之后可选交给文本 LLM 做"清洗"（合并断行、去除页码、修正明显识别错误）。

## 4. NLP 基础处理（本地、零成本）

| 任务 | 方案 |
|---|---|
| 分句、分词、词形还原（lemmatization） | ⭐ **wink-nlp**（MIT，快，带词形还原）或 `compromise`；配合 ECDICT 的 `exchange` 字段做词形 → 原形映射（如 went → go） |
| 词典、音标、中文释义 | ⭐ **ECDICT**（MIT，打包为只读 SQLite） |
| 难度分级 | ECDICT 的 BNC/COCA 词频、柯林斯星级、牛津 3000、考试标签（CET4/6、IELTS、TOEFL、GRE） |
| 短语识别 | 用户已标记的短语做多词匹配（Aho-Corasick / 前缀树）；新短语由 AI 抽取建议 |
| Markdown 渲染 | `unified` / `remark` 解析为 AST（便于跳过代码块、行内代码、链接再做分词）；代码高亮用 **Shiki** |

**原则**：词级别的判断（是不是生词、什么意思、什么读音）尽量本地完成；AI 只做"文章级"和"语境级"的工作，降低成本和延迟。

## 5. 大模型引擎

| 要点 | 方案 |
|---|---|
| 接口抽象 | ⭐ **pi-ai**（2026-10-29 确认，B1）：统一接入 DeepSeek、通义、Kimi、智谱、OpenAI、Ollama 本地等 OpenAI 兼容接口，以及 ChatGPT 账号登录（条款待核实；Claude 订阅登录不做，Anthropic 条款禁止第三方使用，见 05 §10）；TypeBox 校验结构化输出。~~Vercel AI SDK~~ 不再考虑 |
| 默认 | DeepSeek（`deepseek-v4-flash` / `deepseek-v4-pro`，[官方价格页](https://api-docs.deepseek.com/quick_start/pricing)），性价比高，中文解释能力好；模型名是配置项，不写死 |
| 结构化输出 | JSON Mode + TypeBox schema 校验（pi-ai 自带），失败重试 |
| 本地模型 | 支持 Ollama / LM Studio（OpenAI 兼容），满足离线/隐私需求 |
| 密钥存储 | 不明文存 SQLite；用系统钥匙串（Rust `keyring` crate）或 Tauri Stronghold |
| 缓存 | 所有 AI 结果入库（按 文章/句子 + prompt 版本 + 模型 做键），避免重复花钱 |

## 6. 音频

音频需求拆成四类：**单词发音、句子/全文朗读、朗读时文本同步高亮、（后期）用户导入音频/跟读**。

### 6.1 TTS（文本转语音）

| 方案 | 质量 | 离线 | 成本 | 备注 |
|---|---|---|---|---|
| Web Speech API（`speechSynthesis`） | 依赖系统，macOS/Win11 较好，Linux 较差 | ✅ | 免费 | 零依赖兜底方案；有 `boundary` 事件可做逐词高亮 |
| ⭐ **Kokoro-82M**（`kokoro-js` / ONNX） | 很高，开源 TTS 中名列前茅，美/英音多音色 | ✅ | 免费，Apache-2.0 | 模型约 80–300MB（按量化），首次下载；在 WebView 中跑需 WASM/WebGPU，性能需实测；也可在 Rust 侧用 ONNX Runtime 推理 |
| Piper | 中上 | ✅ | 免费，MIT | 更轻快，音质不如 Kokoro |
| Edge TTS（微软在线朗读非官方接口） | 很高 | ❌ | 免费 | 非官方接口，有失效/合规风险，**不建议作为默认** |
| 云端 TTS（OpenAI / Azure / 火山 / 阿里） | 很高 | ❌ | 按量计费 | 作为可选 provider，与 LLM 一样可配置 |

**推荐**：TTS 也做成 provider 抽象。默认 Web Speech API（零成本立即可用），设置中一键下载 Kokoro 作为高质量离线语音，云端 TTS 作为可选。所有合成结果按 `hash(文本+音色+引擎)` 缓存为本地音频文件。

### 6.2 播放与可视化

| 库 | 用途 |
|---|---|
| ⭐ **Howler.js** | 音频播放控制（变速、循环、多音轨），跨平台稳定 |
| ⭐ **wavesurfer.js** | 波形显示、区域选择（逐句循环、跟读对比时需要） |
| 原生 `<audio>` + Web Audio API | 简单场景足够 |

### 6.3 文本同步高亮（朗读跟随）

- Web Speech API：`boundary` 事件给出字符位置 → 逐词高亮。
- Kokoro / 云端 TTS：以**句子为单位合成**，句级高亮即可满足大部分需求；词级可按音节时长近似估算。
- 用户导入音频（后期）：用 **whisper.cpp / faster-whisper** 做转写 + 词级时间戳（forced alignment），实现"有声书/播客 + 原文"同步。

### 6.4 单词发音

- 首选：同一 TTS 引擎合成单词（离线、一致）。
- 可选：真人发音数据（如 Wiktionary 的开源发音音频，CC 协议）作为后期增强。

## 7. 数据层

| 要点 | 方案 |
|---|---|
| 数据库 | SQLite，文件位于用户数据目录（可在设置中查看/迁移/备份） |
| 访问方式 | ⭐ **Tibi Core 进程独占数据库**，内用一层 `Driver` 接口（2026-10-31 开工时把 Drizzle 换掉了，见 DECISIONS T2；桌面接 `better-sqlite3`），pi-durable 的表用 `pi_` 前缀共用同一个连接（2026-10-29 确认，见 05 §3）；~~界面经 `tauri-plugin-sql` + Drizzle sqlite-proxy 直连~~ |
| 词典库 | ECDICT 单独一个只读 `dict.db`，与用户数据 `app.db` 分离（便于升级词典不影响用户数据） |
| 全文搜索 | SQLite FTS5（搜索文章、生词） |
| 备份/迁移 | 导出 `.db` 文件；生词本导出 CSV / Anki |

## 8. Agent Harness 接入与记忆

| 方案 | 说明 | 结论 |
|---|---|---|
| **MCP（Model Context Protocol）** | agent ↔ 工具/数据 的标准协议 | ⭐ 用于把 Tibi 学习能力暴露给外部 harness（TS 官方 SDK `@modelcontextprotocol/sdk`） |
| **ACP（Agent Client Protocol）** | Zed 发起，客户端 ↔ agent 的标准协议，JSON-RPC over stdio；2026 年 Zed 1.0 主推，JetBrains 支持，已有 ACP Registry；Gemini CLI 原生支持，Codex / Claude Code 通过适配器支持 | v1 不做（2026-10-29，B6）：外部 AI 工具改走 MCP；pi-ai 的账号登录可用已有 ChatGPT 订阅（条款待核实） |
| **Codex app-server** | Codex 官方集成协议（JSON-RPC，stdio，WebSocket 实验性）；会话持久化/恢复、审批请求、可生成 TS 类型 | 备选专用通道 |
| `codex exec` / `claude -p` 等非交互 CLI | 一次性调用，输出 JSON 流 | 只适合批量任务，不适合常驻对话，不采用为主路径 |
| 记忆框架：Letta / Mem0 / Zep / LangMem | Letta：核心常驻 + 归档检索的分层记忆，agent 自管记忆；Mem0：add/search API、记忆整合 | 借鉴设计，**不引入依赖**（多为 Python/服务端，且需要向量库）；用 SQLite + FTS5 自实现轻量版 |
| `sqlite-vec` | SQLite 向量检索扩展 | 记忆语义检索的后续选项 |
| **pi**（`@earendil-works/pi-*`，MIT，1.4.0） | `pi-ai` 统一模型接口（含 DeepSeek、任意 OpenAI 兼容接口、账号登录）；`pi-agent-core` 最小 agent 循环；`pi-durable` 持久化 harness（对话、任务、子对话、断点续跑、SQLite 存储，**实验性**）；`pi-coding-agent` 终端编程 agent | ⭐ **已选为 harness 底座**（2026-10-29，B1）：`pi-ai` + `pi-durable`，外包一层 `TibiKernel`；`pi-agent-core` 作退路。详见 [`05-agent-architecture.md`](../design/05-agent-architecture.md) |
| Vercel AI SDK / OpenAI Agents SDK / Mastra / LangGraph.js | 通用 agent 框架 | 不选：缺少本地持久化任务，或体量偏大，见 05 §2 |

## 9. 动效库

| 方案 | 协议 | 特点 | 结论 |
|---|---|---|---|
| ⭐ **Motion**（原 Framer Motion，motion.dev） | MIT | React 一等支持（`motion/react`：布局动画、`AnimatePresence` 进出场、手势）；同时有原生 JS 版本；弹簧物理、错峰（stagger）、滚动驱动；按需引入体积小 | **主选**。UI 微交互、进出场、布局变化（标签圆点、列表重排）都很顺手 |
| GSAP | 2024 年起完全免费（含插件），MIT 类许可 | 时间线编排最强（多步、可倒放、滚动拖拽），SVG/文字拆分插件丰富 | 备选：若以后做"学习报告"这类编排复杂的展示页再引入 |
| Anime.js v4 | MIT | 轻量，v4 加入弹簧；SVG 路径动画强 | 不需要 |
| AutoAnimate（FormKit） | MIT | 一行代码给列表增删加过渡 | 可选：生词本列表的增删 |
| Lottie / dotLottie、Rive | MIT / 运行时开源 | 播放设计师制作的动画文件 | 后期：空状态插画、成就动画 |
| 原生：CSS 过渡、Web Animations API、View Transitions API | — | 零依赖；View Transitions 适合页面级切换（书架 → 阅读器） | 简单过渡用 CSS；页面切换可用 View Transitions（Tauri 的 WebView 需确认支持度） |

结论：**Motion 为主，CSS 处理简单过渡**；动效清单见 [视觉语言 §8](../design/03-visual-language.md#8-动效)。

## 10. 高亮与标注库

阅读器本身需要逐词渲染 `<span>`（点击、状态、行间释义都依赖它），所以"生词/学习中"的基础标注由我们自己的 CSS 完成；库只用于更有表现力的局部效果或用户自由划线。

| 方案 | 协议 / 热度 | 特点 | 适用 |
|---|---|---|---|
| ⭐ **Rough Notation**（rough-stuff/rough-notation） | MIT，约 9.6k stars | 手绘风格的荧光笔、下划线、方框、圈、括号、删除线，带绘制动画，可按顺序编组播放；SVG 覆盖层，支持多行 | 与"纸与墨 / 笔迹"方向最契合：选中词的圈注、短语的手绘下划线、刚标记时的荧光笔动画、读完时的总结强调。注意：标注数量多时有性能开销；字号/行距变化后需重绘 |
| **CSS Custom Highlight API**（原生） | 标准，Chrome 105+ / Safari 17.2+ / Firefox 140+ | 不改 DOM，直接给任意文本范围上样式，性能最好 | 朗读高亮、搜索命中等大量、频繁变化的范围；限制：只能用颜色、背景色、文字装饰等少数属性，做不了"只涂下半部分"的荧光笔效果；需确认各平台 WebView 版本 |
| **web-highlighter**（alienzhou） | MIT，约 1k stars | 选区 → 高亮，并可序列化保存、恢复 | 以后做"自由划线 / 笔记"功能时可用 |
| **Recogito Text Annotator** | BSD-3 | 完整的标注框架（W3C 标注模型、评论、协作），有 React 封装 | 学术批注场景，对本项目偏重 |
| mark.js | MIT | 关键词搜索高亮 | 多年未维护，不推荐 |

结论（2026-10-30 更新）：**全部标注与强调用自研 CSS**。Rough Notation 曾在原型中用于选中 / 短语 / 回顾等强调时刻，试用后认为手绘线条让正文显得乱，已移除；朗读高亮后续可迁移到 CSS Custom Highlight API。

## 11. 其他

| 项 | 方案 |
|---|---|
| 动效 | Motion（见 §9） |
| 强调动效 | CSS 过渡 + 描边动画（Rough Notation 已移除，见 §10） |
| 吉祥物与插画 | 藏狐 Tibi：内联 SVG + CSS 动画（零依赖，见 03 §7）；以后可升级 Rive。~~rough.js 程序化涂鸦封面~~ 已不用 |
| 滚动条 | **OverlayScrollbars**（MIT，KingSora/OverlayScrollbars）：覆盖式、自动隐藏、可主题化，WebView2 / WKWebView / WebKitGTK 表现一致；有 React 封装 `overlayscrollbars-react` |
| 状态管理 | Zustand（UI 状态） + TanStack Query（数据查询缓存） |
| 路由 | TanStack Router 或 React Router |
| 国际化 | i18next（界面先中文，预留英文，利于开源） |
| 测试 | Vitest + Playwright |
| 代码规范 | Biome（lint + format 一体） |
| 包管理 | pnpm |

## 参考来源

- [Tauri vs Electron 2026 对比](https://tech-insider.org/tauri-vs-electron-2026/)、[Tauri SQL 插件](https://stuffbucket.github.io/skills/catalog/tauri-plugins-sql/)
- [Defuddle](https://github.com/kepano/defuddle)
- [kokoro-js](https://www.npmjs.com/package/kokoro-js)、[浏览器 TTS 对比：Kokoro vs Piper vs Kitten](https://offlinetts.pages.dev/blog/browser-tts-showdown-kokoro-piper-kitten/)
- [ts-fsrs](https://open-spaced-repetition.github.io/ts-fsrs)
- [DeepSeek-OCR-2 第三方 API 说明](https://apidog.com/blog/use-deepseek-ocr-2-api)
- [ECDICT](https://github.com/skywind3000/ECDICT)
- [Agent Client Protocol](https://zed.dev/acp)、[ACP Registry](https://zed.dev/blog/acp-registry)
- [Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness)、[Codex app-server](https://www.infoq.com/news/2026/02/opanai-codex-app-server)
- [Mem0 长期记忆](https://mem0.ai/blog/how-to-create-ai-agents-with-long-term-memory)
- [Rough Notation](https://github.com/rough-stuff/rough-notation)、[CSS Custom Highlight API（MDN）](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API)、[web-highlighter](https://github.com/alienzhou/web-highlighter)、[Recogito Text Annotator](https://www.cssscript.com/recogito-text-annotator/)
- [GSAP vs Motion](https://motion.dev/docs/gsap-vs-motion)、[2026 Web 动效工具综述](https://www.youngju.dev/blog/culture/2026-05-16-web-animation-tools-2026-rive-lottie-spline-motion-gsap-mit-anime-js-theatre-deep-dive.en)
