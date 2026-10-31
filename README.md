# Tibi 缇比

> 吉祥物是一只藏狐，它也是你的 AI 学习伙伴。（原暂定名 LexiRead）

> 读你感兴趣的文章，顺便把英语学会。
> 本地优先 · AI 原生 · 开源的英语阅读学习工具。

当前阶段：**概念设计 / 讨论中**，尚无代码。

**[现在定了什么：DECISIONS.md](docs/DECISIONS.md)**（单页列现行决定、术语和待决事项）· [变更流水](docs/CHANGELOG.md)

## 文档

文档即代码：所有设计决策以 `docs/` 为准，代码变更需同步更新相关文档。

### 调研
- [01 英语学习产品与开源项目](docs/research/01-products-and-open-source.md)
- [02 学习理论与产品映射](docs/research/02-learning-theory.md)
- [03 技术选型](docs/research/03-tech-survey.md)
- [04 mac 原生感与吉祥物素材](docs/research/04-mac-native-and-mascot.md)
- [05 词光（Word Atlas）的复习设计与参考](docs/research/05-word-atlas-review.md)

### 设计
- [总体设计方案（可视化一页）](docs/design/overview.html)：架构、数据库、数据结构、接口（含参数与返回值）、技能，供 review
- [00 概念设计](docs/design/00-concept-design.md)
- [01 数据库设计](docs/design/01-database.md)
- [02 AI 助手设计：上下文、记忆、工具、权限、技能文件](docs/design/02-ai-assistant.md)
- [03 视觉语言 v2：安静的 AI 工作台](docs/design/03-visual-language.md)
- [04 设计方向 v2：调研与论证](docs/design/04-design-direction-v2.md)
- [05 技能架构：以 pi 为 harness 底座](docs/design/05-agent-architecture.md)
- [06 接口定义：WebView ↔ Core 方法、事件、能力层与 MCP 工具的参数与返回](docs/design/06-interface.md)（由 `docs/design/_src/build_interface.py` 生成，总览页第 04 / 08 节同源）
- [07 吉祥物素材：清单、规格与提示词](docs/design/07-mascot-assets.md)（出图脚本 `tools/gen-mascot.py`）
- 归档：[v1 视觉语言「纸与墨」](docs/design/archive/03-visual-language-v1.md)

### 原型
- [首页](docs/prototypes/home.html)、[书架](docs/prototypes/library.html)、[阅读器](docs/prototypes/reader.html)、[生词本](docs/prototypes/words.html)、[复习](docs/prototypes/review.html)（含"练习"分段，网址加 `#practice`）、[统计](docs/prototypes/stats.html)、[设置](docs/prototypes/settings.html)、[任务](docs/prototypes/tasks.html)（v2，HTML，浏览器直接打开，页面之间互相链接；共享 `v2.css`、`v2-shell.js`、`v2-search.js`、`v2-agents.js`；任意页面按 ⌘K 打开搜索）
- [首次启动引导](docs/prototypes/onboarding.html)（两步：认识一下、读第一篇；校准词汇量 `#step=2`、连接模型 `#step=3` 按需进入）
- [书架页：现在 vs mac 原生化对照](docs/prototypes/native-mac.html)（调研 [research/04](docs/research/04-mac-native-and-mascot.md)）
- [吉祥物：藏狐](docs/prototypes/mascot.html)（SVG 动画，7 种状态，组件 `v2-fox.js`）
- [手机版](docs/prototypes/mobile.html)（独立的壳：底部标签栏、浮动 Tibi、底部抽屉；D8）
- 空状态：首页 / 书架 / 复习 / 任务 / 统计页左下角的"原型演示"开关，或网址加 `#empty`
- 归档：[v1 原型](docs/prototypes/v1/)

## 协议

[MIT](LICENSE)
