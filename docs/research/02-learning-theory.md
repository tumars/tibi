# 调研 02：学习理论与产品映射

> 原则：每一条理论都要能落到一个具体的产品机制上，否则不写进设计。

## 1. 可理解输入假说（Krashen, Input Hypothesis, i+1）

- **观点**：语言习得主要来自理解"略高于当前水平（i+1）"的输入；兴趣和低焦虑（情感过滤假说）很重要。
- **产品映射**：
  - 用户自选感兴趣的文章 → 天然的高动机、低焦虑。
  - 导入后计算**文章难度（对该用户而言的生词率）**，在书架上标注"适合 / 稍难 / 很难"。
  - 对"很难"的文章提供辅助模式：段落大意、长难句拆解，而不是整篇翻译。

## 2. 词汇覆盖率阈值（Paul Nation, Hu & Nation 2000; Laufer）

- **观点**：读懂一篇文章大约需要认识 **95%**（常引的最低线，[Language Teacher 37.4](https://jalt-publications.org/sites/default/files/pdf-article/37.4tlt_art1.pdf)）到 **98%**（来自 66 名学生的回归，并非直接测出，[来源](https://ulb-dok.uibk.ac.at/ulbtirolfodok/content/titleinfo/9760724/full.pdf)）的词。两篇均未能打开原文，98% 的出处由检索摘要印证。这是经验带，不是精确阈值。约 98% 覆盖率对应大约 8,000–9,000 词族（读小说/报刊）。
- **产品映射**：
  - **难度指标 = 1 − 对该用户的已知词覆盖率**，经验带：≥98% 舒适 / 95–98% 学习区 / <95% 过难。不说哪一段"最佳"，上线后可按个人数据调。
  - **词汇量估算**：先按自评给初始估算，读完第一篇时提议做一次快速词汇量测试校准（按词频分层抽样，类似 testyourvocab；可跳过，见 00 §3.9），作为自动标注的依据。
  - 词频分层数据来自 ECDICT 的 BNC/COCA 词频字段。

## 3. 注意假说（Schmidt, Noticing Hypothesis）与附带词汇习得

- **观点**：只有被"注意到"的语言形式才可能被习得。附带习得（阅读中自然学会）有效，但一个词通常要多次在语境中遇见。遇见次数和学会之间是中等相关（元分析 r = .34，Uchihara, Webb & Yanagisawa 2019，[来源](https://zendy.io/title/10.1111/lang.12343)；未能打开原文，据检索摘要），没有公认的固定次数。
- **产品映射**：
  - **词状态着色**：让生词、学习中的词在文中"被注意到"。
  - 统计每个词**在用户所有文章中的遇见次数**，在词卡上显示"你已在 5 篇文章中遇到过它"。
  - 学习建议可推荐"含有你正在学的词的文章段落"，人为增加复现。

## 4. 投入量假说（Laufer & Hulstijn, Involvement Load Hypothesis）

- **观点**：任务中的需要（need）、搜索（search）、评估（evaluation）越多，词汇记忆越牢。只看释义 < 查词典选义项 < 用该词造句。
- **产品映射**：
  - 点词时先给**语境释义**（AI 判断在本句中的义项），而不是罗列全部义项。这样读得更顺，但也省掉了"评估"这一环，不应说成提高投入量：元分析里评估是贡献最大的成分（Yanagisawa & Webb 2021，[来源](https://zendy.io/title/10.1111/lang.12444)；未能打开原文，据检索摘要）。所以投入量靠后面的复习题补，查词时只是允许展开全部义项。
  - 复习卡片类型递进：识别 → 语境填空 → 拼写 → **造句（AI 批改）**。

## 5. 间隔重复与提取练习（Ebbinghaus 遗忘曲线；Testing Effect）

- **观点**：在即将遗忘时复习效率最高（间隔效应）；主动回忆（测试）比重复阅读更能巩固记忆（提取练习效应）。
- **算法选择**：**FSRS**（Free Spaced Repetition Scheduler）
  - 基于 DSR 记忆模型（Difficulty 难度、Stability 稳定性、Retrievability 可提取性）。
  - 在开源基准上显著优于 SM-2（Anki 旧算法）；Anki 23.10 起内置；可按用户历史数据优化参数。
  - 用户可设"期望记忆保持率"（默认 0.9），系统据此排期。
  - 有成熟的 TypeScript 实现 `ts-fsrs`（MIT）。
- **产品映射**：
  - 每日复习队列 = 到期卡片 + 新卡片（每日新词上限可设）。
  - 评分四档：Again / Hard / Good / Easy。
  - 复习界面以**原文语境句**为核心（见下）。

## 6. 词块 / 词汇法（Michael Lewis, The Lexical Approach）

- **观点**：语言由大量预制词块（collocations, phrasal verbs, idioms）组成，掌握词块比掌握孤立单词更能提升流利度。
- **产品映射**：
  - 生词本**同时支持单词和短语**；阅读器中支持**选中多个词标记为短语**，之后在所有文章里自动识别并高亮这个短语。
  - 导入时 AI 抽取文章中值得学习的**搭配与短语**，作为"建议标记"。

## 7. 语音编码（语音回路）

- **观点**：读音不确定的词可能更难记。听和读都是言语通道，所以边听边读不算 Paivio 所说的双重编码（言语 + 图像），这里不以它为依据。
- **产品映射**：
  - 每个词卡都有发音；文章支持朗读并**逐句/逐词高亮**跟随。
  - 复习卡片含"听音辨词"类型。
  - （后期）跟读 / 影子跟读（shadowing）：录音对比。

## 8. 动机与习惯（自我决定理论、习惯回路）

- **观点**：自主性（自己选内容）、胜任感（看到进步）、轻量每日目标有助于长期坚持。
- **产品映射**：
  - 统计面板：已知词数量增长曲线、阅读字数、连续天数（streak），**避免过度游戏化**。
  - 每日任务：「复习 N 张卡片 + 读 1 篇文章」，完成即可。

## 小结：理论 → 核心机制

| 机制 | 理论依据 |
|---|---|
| 自选文章 + 难度标注 | 可理解输入、覆盖率阈值 |
| 词状态着色 + 翻页标记已知 | 注意假说、低成本维护已知词库 |
| 词汇量测试 + 自动预标注 | 覆盖率、个性化 i+1 |
| 语境释义 + 遇见次数 | 附带习得（语境释义本身降低投入量，见 §4） |
| 单词 + 短语双轨 | 词汇法 |
| FSRS 语境卡片复习 | 间隔重复、提取练习 |
| 发音 / 朗读跟随 | 语音编码 |
| 轻量统计与每日目标 | 动机理论 |

## 参考

- Krashen, S. (1982). *Principles and Practice in Second Language Acquisition.*
- Hu, M. & Nation, P. (2000). Unknown vocabulary density and reading comprehension.
- Laufer, B. & Hulstijn, J. (2001). Incidental vocabulary acquisition in a second language: the construct of task-induced involvement.
- Schmidt, R. (1990). The role of consciousness in second language learning.
- Lewis, M. (1993). *The Lexical Approach.*
- Uchihara, T., Webb, S. & Yanagisawa, A. (2019). The effects of repetition on incidental vocabulary learning. *Language Learning*. [来源](https://zendy.io/title/10.1111/lang.12343)
- Yanagisawa, A. & Webb, S. (2021). Involvement Load Hypothesis 元分析. *Language Learning*. [来源](https://zendy.io/title/10.1111/lang.12444)
- Ye, J. et al. FSRS 算法及基准：[open-spaced-repetition](https://github.com/open-spaced-repetition)
