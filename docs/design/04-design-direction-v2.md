# 设计方向 v2：安静的 AI 工作台

> 状态：**已采用（2026-10-29）**。现行规范见 [`03-visual-language.md`](./03-visual-language.md)；本文保留调研与论证。
> 原型：[首页](../prototypes/home.html) · [阅读器](../prototypes/reader.html) · [生词本](../prototypes/words.html)
> 反馈来源（2026-10-29）："整体配色和交互风格不够现代化"，参考 YouMind、Manus、Grok 等工具。

## 1. 调研

| 产品 | 视觉 | 交互 | 可借鉴 |
|---|---|---|---|
| **YouMind** | 受 Notion 启发的极简白底；用户特别称赞的"俏皮的手绘涂鸦线条" | 以 Board（项目）组织；Ask（快问）/ Agent（多步任务）双模式；多模型选择（含"自动选择最佳模型"）；AI 产出直接变成可编辑文档 | 手绘涂鸦插画作为品牌记忆点；Ask / Agent 双模式；产出即文档 |
| **Manus** | 中性、低装饰；对话居中 | 首页就是一个大输入框 + 建议任务；执行时右侧显示 Agent 的"电脑"实时画面与**任务进度清单**，可回放、可中途改指令 | **把 AI 正在做的事可视化**（步骤清单 + 实时日志），用在"导入文章"这类多步任务上 |
| **Grok** | 深色优先、近乎黑白；大圆角输入框；模型选择做成 Fast / Expert / Heavy 的滑块（类 Apple Liquid Glass） | 输入框为中心；模式切换轻量 | 大输入框作为首页主角；把"模型选择"做成用户听得懂的档位（快 / 深入） |
| 行业趋势 | — | **AI 离开聊天框**：AI 嵌在内容里（行内建议、浮动工具条），聊天只是入口之一；生成式 UI；可解释（标出来源、置信度） | 词卡改为贴着单词出现的浮层；右栏不再常驻 |

## 2. v1 为什么显得不够现代

- **材质感过重**：纸纹、米色桌面、深靛蓝大色块，偏"拟物 / 文艺"，而现代 AI 工具多是中性底 + 一个强调色。
- **三栏常驻**：左导航、中内容、右 AI 面板始终占满，信息密度高、主次不清；现代工具让 AI 面板"需要时才出现"。
- **衬线体用在界面上**：界面文字也用 Charter，读起来像书而不像软件。
- **AI 存在感弱**：AI 藏在右栏标签页里，首页没有一个"可以直接跟它说"的入口。

## 3. 方向：安静的 AI 工作台

**一句话**：中性、干净的工作台，**一个大输入框**是首页主角；AI 在内容旁边就地出现，执行多步任务时把过程展示出来；手绘涂鸦插画带来温度。

### 3.1 视觉

| 项 | v1（纸与墨） | v2 提案 |
|---|---|---|
| 底色 | 米色桌面 + 带纹理纸面 | 浅灰底 `#f7f7f6` + 白色主区（圆角 16px、细线描边、无纹理、无投影） |
| 左栏 | 深靛蓝色块 | 与底色同色，图标 + 文字，可折叠成 64px 图标栏 |
| 强调色 | 蓝黑墨水 | 一种更明亮的"电光蓝" `#3b5bfd`，只用于主按钮、焦点、AI 标识 |
| 界面字体 | Charter + 普惠体（全衬线） | **Geist + 普惠体**（界面全部无衬线） |
| 正文字体 | Charter | 仍用 Charter（只在文章正文、书名中使用） |
| 圆角 | 6–12px | 输入框 24px，卡片 16px，按钮全圆角 |
| 插画 | 无 | 手绘涂鸦风格：文章封面、空状态、成就（概念稿用 rough.js 程序化生成占位） |
| 深色 | 暖黑 | 中性黑 `#0b0b0c` + `#141416` 主区 |
| 生词标注 | 荧光笔色带 | **保留**：页面中性后，荧光笔成了唯一的色彩，更醒目 |

### 3.2 交互

1. **首页 = 大输入框**："今天想读点什么？"一个输入框同时承担三件事，用模式切换：
   - **导入**：粘贴网址 / 文字，或拖入 PDF、EPUB、图片；
   - **问 Tibi**：直接提问；
   - **找文章**：让 Tibi 按你的水平和兴趣推荐。
   输入框下方是建议任务（继续阅读、复习到期的词、推荐一篇 10 分钟的新闻…）。
2. **任务进度可见（借鉴 Manus）**：导入、批量生成等多步任务在右侧弹出"Tibi 正在处理"面板：步骤清单 + 实时日志（抓取了多少词、识别为什么类型、对你的生词率…），完成后给出结果卡片和下一步按钮。
3. **AI 面板按需出现**：右栏不再常驻。问 Tibi、执行任务时滑出；关闭后内容区回到全宽。
4. **阅读器中 AI 就地出现**（后续实现）：点词后词卡以浮层贴着单词出现，而不是固定在右栏；选中句子出现浮动工具条（翻译 / 解析 / 问 Tibi）。
5. **模型档位**：设置与输入框中用"快速 / 深入"代替模型名（底层仍可指定 DeepSeek 等）。
6. **侧栏可折叠**：`⌘\` 折叠 / 展开左栏。

### 3.3 保持不变

产品结构（首页 / 书架 / 生词本 / 复习 / 阅读器）、熟练度六档、荧光笔标注、Motion 动效、OverlayScrollbars、阿里巴巴普惠体。

## 4. 插画与动画：用 ChatGPT 等图像模型生成

当前会话无法直接调用 ChatGPT。分两层处理：

**设计阶段（现在）**：用下面的提示词在 ChatGPT（或其他图像模型）里生成插画，放入 `docs/prototypes/img/` 后替换概念稿里的程序化占位。

统一风格前缀：
> Minimal hand-drawn doodle illustration, single continuous black ink line with loose sketchy strokes, one flat accent color (#3b5bfd) and one soft highlighter color (pale yellow), lots of white space, no text, no gradients, no shadows, square composition, playful but calm.

| 用途 | 提示词（接在前缀后） |
|---|---|
| 首页空书架 | an open empty bookshelf with a small potted plant and a floating speech bubble |
| 导入中 | a paper sheet being scanned by a magnifying glass, little sparkles |
| 读完一篇 | a person sitting on a stack of books, raising a coffee cup, confetti doodles |
| 复习完成 | a calendar page with a big check mark and a small flame for streak |
| 技术文档封面 | curly braces and a tiny gear, abstract |
| 新闻封面 | a folded newspaper with rain clouds and a small city skyline |
| 小说封面 | a quill pen and an open book with a few drifting leaves |

**产品阶段（正式版）**：
- 设置中增加"图像模型"provider（OpenAI 图像模型等，可选）；导入文章后可按文章主题自动生成涂鸦封面（缓存到本地，可关闭）。没配置时使用 rough.js 程序化封面。
- 动画：小型状态动画（导入中、完成、连续打卡）用 **Lottie / dotLottie**（MIT）或 **Rive** 播放设计师制作的文件；界面过渡继续用 Motion。

## 5. 决策（2026-10-29）

| # | 问题 | 结论 |
|---|---|---|
| V1 | 是否采用 v2 方向？ | ✅ 采用 |
| V2 | 强调色 | ✅ 电光蓝 `#3b5bfd`（暗色 `#6f86ff`） |
| V3 | 阅读器词卡改为浮层、右栏按需出现？ | ✅ 已在原型中实现 |
| V4 | 插画 | ✅ 先继续用 rough.js 程序化涂鸦；之后可用 ChatGPT 等生成后替换 → **已被后续决定取代**：见 03 §7.2 |

## 参考

- YouMind：[Product Hunt](https://www.producthunt.com/products/youmind)、[GetApp](https://www.getapp.com/all-software/a/youmind/)、[Fazier](https://fazier.com/launches/youmind-2)
- Manus：[UX Design 评测](https://uxdesign.cc/manus-ai-real-or-hype-404254922290)、[界面拆解](https://www.besthub.dev/articles/unpacking-manus-ai-agent-architecture-prompt-design-and-a-simple-diy-clone-0754f8c44d65)、[Manus 1.6 发布](https://manus.im/blog/manus-max-release)
- Grok：[模型档位滑块](https://www.testingcatalog.com/grok-may-soon-get-model-slider-with-expert-heavy-and-fast-options)、[Lazyweb 界面合集](https://www.lazyweb.com/company/grok)
- 趋势：[AI leaves the chat（GoodBarber）](https://www.goodbarber.com/blog/design-trends-2026-ai-leaves-the-chat-the-design-system-makes-the-rule-a1608/)、[7 Key Design Patterns for AI Interfaces](https://uxplanet.org/7-key-design-patterns-for-ai-interfaces-893ab96988f6)
