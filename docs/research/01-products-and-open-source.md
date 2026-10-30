# 调研 01：英语学习产品与开源项目

> 目的：搞清楚「通过阅读学语言」这个赛道里，别人做对了什么、没做好什么，我们能借鉴什么、差异化在哪里。

## 1. 商业产品

| 产品 | 核心模式 | 值得借鉴 | 不足 / 我们的机会 |
|---|---|---|---|
| **LingQ** | 导入任意文章/视频字幕 → 阅读器中每个词按「未知(蓝)/学习中(黄 1-4 级)/已知」着色 → 点击建 LingQ → SRS 复习 | ① 词状态着色是整个产品的灵魂，一眼看出文章难度；② 「翻页时把剩下的蓝词全部标为已知」，极低成本积累已知词库；③ 导入即学习，素材自选 | 订阅制、云端；UI 陈旧；复习算法较简单；AI 能力（总结、语境释义）是后加的，体验割裂 |
| **Readlang** | 网页/电子书阅读器，点词翻译，自动生成带原句的闪卡 | 闪卡**自带原文语境句**，复习时做完形填空 | 功能单薄，无词汇量画像 |
| **Language Reactor** | 浏览器插件，Netflix/YouTube 双语字幕 + 点词 | 「沉浸在原生内容」的理念；字幕逐句跳转、循环播放 | 只针对视频；闭源 |
| **Migaku** | 插件 + 卡片，一键从任意网页/视频生成 Anki 风格卡片 | 卡片含原句音频、截图；与 Anki 生态打通 | 学习曲线陡峭；付费 |
| **沉浸式翻译** | 双语对照网页翻译 | 视觉排版优雅，段落级对照不破坏原文结构 | 定位是"翻译"不是"学习"，易形成依赖 |
| **Readwise Reader** | 稿后阅读器（read-it-later），高亮、导出 | **阅读体验标杆**：排版、字体、进度、高亮、键盘操作；网页/PDF/EPUB 统一阅读 | 非语言学习工具 |
| **扇贝阅读 / 扇贝单词** | 分级文章 + 单词本 + 打卡 | 中文用户习惯：分级、打卡、每日任务 | 内容由平台提供，不能自由导入 |
| **墨墨背单词** | 基于记忆算法的背单词（自研 MMRS 算法） | 每日任务量规划、遗忘曲线可视化 | 脱离语境孤立背词 |
| **不背单词** | 用真实语境例句（影视台词）背单词 | **语境记忆**、原声例句 | 例句不是用户自己读过的 |
| **欧路词典** | 词典 + 生词本 + 取词 | 词典数据丰富、支持导入 MDX 词典 | 学习闭环弱 |
| **Duolingo** | 游戏化课程 | 连续打卡（streak）、即时反馈、轻量每日目标 | 课程固定，非兴趣驱动；对中高级学习者效率低 |
| **Anki** | 通用 SRS 卡片 | FSRS 算法、开放卡片格式、生态 | 制卡成本高，UI 不友好 |

### 关键洞察

1. **"词状态着色 + 翻页标记已知"是阅读型学习产品被验证过的核心交互**（LingQ / LWT / Lute / LinguaCafe 都采用）。我们应当沿用，并用 AI 让它"首次打开就基本准确"——这正是你提出的「初次生成时根据个人情况自动标记」。
2. **语境卡片 > 孤立单词卡片**。Readlang、不背单词、Migaku 都证明了"复习时看到当初遇到它的那句话"记忆效果和体验都更好。我们的独特优势：**例句来自用户自己读过、感兴趣的文章**。
3. **阅读体验本身就是产品力**。Readwise Reader 证明好的排版、字体、主题、进度条会显著提高"愿意读下去"的意愿；多数语言学习工具在这方面很弱。
4. **AI 普遍是"后加"的**。现有产品的 AI 多为一个"解释"按钮。我们可以把 AI 嵌进导入流水线（总结、难点、短语、建议）和复习环节（语境释义、例句生成、造句批改），但要控制成本和延迟。

## 2. 开源项目

| 项目 | 技术栈 / 协议 | 说明 | 对我们的价值 |
|---|---|---|---|
| **[Lute v3](https://github.com/LuteOrg/lute-v3)** | Python/Flask，MIT | LWT 的重写版，本地运行、浏览器访问；词状态 1-5 + 已知/忽略；多词术语（短语）识别 | **数据模型参考**：term / term status / parent term（词形归并）/ multi-word term 的设计很成熟 |
| **LinguaCafe** | Laravel(PHP) + Vue，GPL-3.0 | 自托管阅读器，内置词典、生词跟踪、Anki 导出 | 交互参考；GPL 协议，代码不可直接混入 MIT 项目 |
| **LWT (Learning With Texts)** | PHP，公有领域 | 该类产品的鼻祖 | 历史参考 |
| **Anki** | Rust + Python + Svelte，AGPL | SRS 事实标准 | 卡片模型、复习交互；可考虑导出 `.apkg` 兼容 |
| **[open-spaced-repetition / FSRS](https://github.com/open-spaced-repetition)** | 多语言实现，MIT | 现代 SRS 算法（FSRS-5/6），Anki 已内置 | **直接使用** `ts-fsrs`（TypeScript）或 `rs-fsrs`（Rust） |
| **[ECDICT](https://github.com/skywind3000/ECDICT)** | CSV/SQLite，MIT | 三百多万词条英汉词典，含**音标、中文释义、词形变化(exchange)、柯林斯星级、牛津 3000 标记、BNC/COCA 词频、考试标签(zk/gk/cet4/cet6/ky/toefl/ielts/gre)** | **直接使用**作为本地词典 + 难度分级数据源，几乎是为本项目量身定做 |
| **pot-desktop** | Tauri + React，GPL-3.0 | 划词翻译/OCR 桌面工具，插件化接入多家翻译/OCR/TTS 服务 | **架构参考**：Tauri 下的多服务插件化设计 |
| **Saladict 沙拉查词** | 浏览器扩展，MIT | 聚合词典、划词 | 词典聚合 UI 参考 |
| **[Defuddle](https://github.com/kepano/defuddle)** / Mozilla Readability | TS，MIT / Apache-2.0 | 网页正文提取 | **直接使用**，处理"导入网址" |
| **Kokoro-82M / kokoro-js** | Apache-2.0 | 高质量开源 TTS，可在浏览器/本地运行 | **直接使用**作为离线 TTS 方案（见技术调研） |

### 关键洞察

- 开源侧已有"能用"的阅读器（Lute、LinguaCafe），但它们**视觉陈旧、部署门槛高（需 Python/Docker）、没有 AI**。
- 我们的差异化定位：**好看 + 开箱即用（桌面安装包）+ AI 原生 + 本地数据**。
- 协议选择：我们若采用 MIT/Apache-2.0，可直接使用 ECDICT、ts-fsrs、Defuddle、Kokoro；应避免直接复制 GPL/AGPL 项目代码（LinguaCafe、Anki、pot），只借鉴思路。

## 参考来源

- [Lute v3 GitHub](https://github.com/LuteOrg/lute-v3)、[Lute 手册](https://luteorg.github.io/lute-manual/background.html)
- [LinguaCafe 介绍（LinuxLinks）](https://www.linuxlinks.com/linguacafe-language-learners-vocabulary-reading/)
- [Self-hosted LingQ alternatives](https://selfhostyourself.com/alternative-to/lingq)
- [ts-fsrs 文档](https://open-spaced-repetition.github.io/ts-fsrs)
- [Defuddle](https://github.com/kepano/defuddle)
- [kokoro-js (npm)](https://www.npmjs.com/package/kokoro-js)
