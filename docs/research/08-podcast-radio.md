# 08 调研：电台（播客与广播）听读与 AI 理解产品

> 2026-11-24。状态：**已完成，核心方向已确认**（对应设计方案见 [`design/17-podcast-radio.md`](../design/17-podcast-radio.md)）。
>
> 目的：调研市面上「电台/播客订阅 + 听读同步 + AI 理解 + 语言学习」代表产品与关键技术生态（Podcast 协议、ASR 方案、直播流目录），提炼 Tibi 的差异化定位与设计原则。

---

## 1. 赛道背景与“电台”的两类形态

“电台”在音频产品中涵盖两种不同形态，二者在语言学习与 AI 理解上的适用性差异显著：

| 形态 | 代表节目 / 协议 | 特点 | 听读与精学价值 |
|---|---|---|---|
| **点播电台 / 播客（Podcast）** | BBC 6 Minute English、NPR Planet Money、The Daily、Syntax.fm、Economist；标准 RSS 2.0（`<enclosure>`）+ Podcasting 2.0（`<podcast:transcript>` / `<podcast:chapters>`） | 有完整单集与固定音频边界，可定位、可重复、可持久化 | **极高**：可做精准句级时间戳同步、导听章节、盲听/精听、生词着色与原声 FSRS 复习闭环 |
| **直播流电台（Live Radio）** | BBC World Service Live、NPR Live、CNN Radio；Icecast / HLS / MP3 实时流（可通过开源 [Radio-Browser API](https://www.radio-browser.info/) 发现） | 无固定起点与终点，实时流式播放 | **中（偏泛听）**：难以预解析全文和估测生词率；核心学习价值在于“随时磨耳朵 + 实时字幕 + 截取精彩片段（Snip）转精读” |

**结论**：P1–P2 聚焦**播客电台（点播 RSS）**打通“订阅 → 听读 → 精读理解 → 原声复习”闭环；直播流电台放在 P3 作为泛听与截段拓展。

---

## 2. 市面代表产品调研（四大阵营）

资料于 2026-11-24 基于公开产品文档、评测及行业资料整理。

### 2.1 阵营 A：AI 播客知识管理型

| 产品 | 定位与核心流程 | 值得借鉴 | 不足 / Tibi 的机会 |
|---|---|---|---|
| **Snipd** | 移动端伴随式 AI 播客播放器。听到好内容三击耳机触发 **Snip**，自动截取音频、逐字稿与 AI 摘要 | ① 实时说话人逐字稿 + 章节摘要；② 听前摘要帮助决定是否花时间听；③ 极低摩擦的“听中捕获”交互 | 面向知识摘录（同步 Notion/Readwise），无外语查词、词状态着色与 SRS 复习；订阅费高 |
| **Podwise** | 桌面/研究型 AI 播客知识库。导入单集后生成结构化大纲、Q&A、金句、思维导图（XMind）、全文检索与多语言对照翻译；App 2.0 补齐 CarPlay/锁屏 Moment 捕捉 | ① 解决长播客（1–3h）信息筛选成本；② 多语言对照阅读对非母语听众极友好；③ 结构化导读（摘要/要点/时间轴） | 偏向“以读代听”，缺少盲听、单句循环、词形还原等语言精听训练；重云端额度收费 |
| **Readwise Reader** | 稍后阅读 + 播客统一工作台。可从 Overcast / Apple Podcasts 分享单集，转成带逐字稿的文档统一阅读高亮，并用 Ghostreader AI 提问 | ① **Feed / Library 两分法**（Tibi `11-rss-reader` 已采用）；② 把播客单集抽象为与文章同构的“可阅读文档” | 非语言学习工具，无词频分级与复习系统 |

### 2.2 阵营 B：语言学习 × 音视频/播客 AI 听读型

| 产品 | 定位与核心流程 | 值得借鉴 | 不足 / Tibi 的机会 |
|---|---|---|---|
| **Miraa（米拉）** | 近年现象级 AI 双语字幕与跟读 App。支持任意播客、YouTube 与本地音视频，AI 生成双语字幕，主打 **Echo Method（听 → 理解 → 模仿 → 对比）** | ① 针对口语/俚语/长难句的 AI 逐句精讲；② 单句循环、语速控制与影子跟读录音对比体验极佳 | 偏单次精听工具，缺少长期 RSS 订阅管理、词族级已知词库与 FSRS 复习闭环；云端按时长计费 |
| **LingQ** | 沉浸式听说读老牌平台。支持导入外部播客并用 Whisper 转写、分句与翻译，阅读器按未知/学习中/已知着色，点词建卡 | ① 音频 + 逐字稿 + 生词追踪的完整链路；② 兴趣驱动的真实语料输入 | UI 较陈旧、强云端订阅制；AI 能力是后加的，缺乏连贯对话伴学 |
| **PlayLingo / Readuet / Langua** | 新一代垂直 AI 播客学外语 App。内置播客搜索，AI 生成句级同步字幕、点词翻译、语法拆解与闪卡 | ① 提炼出**三遍听读法**（对照听 → 词句复盘 → 盲听磨耳朵）；② 开箱即搜全球播客降低订阅门槛 | 强依赖云端托管转写（成本高、闭源订阅），数据不在用户本地 |

### 2.3 阵营 C：中文垂直英语听力老牌产品

| 产品 | 定位与核心流程 | 值得借鉴 | 不足 / Tibi 的机会 |
|---|---|---|---|
| **每日英语听力（欧路）/ 轻听英语** | 国内用户最熟悉的精听软件。海量人工校对双语语料（新闻、教材、影视、演讲） | ① **精听交互标杆**：盲听遮字幕、单句循环、AB 复读、变速不变调、听写填词、线控；② 极契合中文母语者精听习惯 | 内容偏平台封闭语料库，自由订阅全球技术/商业/文化播客体验弱；AI 属于外挂式查词/翻译，体验割裂 |

### 2.4 阵营 D：原生与大众播客平台

| 产品 | 定位与核心流程 | 值得借鉴 | 不足 / Tibi 的机会 |
|---|---|---|---|
| **Apple Podcasts** | 系统自带播客平台，已提供多语种**免费自动同步逐字稿**，逐行高亮且可点击跳转 | 流畅自然的“音频 + 滚动歌词式逐字稿”基础体验 | 无点词翻译、无双语对照、无生词本与 AI 理解 |
| **Pocket Casts** | 老牌跨平台播客客户端。支持 Podcasting 2.0 官方逐字稿，并推出 Beta 版 *"Ask about this episode"* 单集问答 | 对开放 RSS 与 Podcasting 2.0 规范支持扎实 | 非语言学习产品，无词汇学习体系 |
| **小宇宙** | 国内中文播客社区标杆 | 时间戳笔记、单集分段与精彩瞬间定位大幅降低长音频复盘门槛 | 偏泛娱乐中文社区，无外语精听与 AI 精学闭环 |

---

## 3. 综合能力对比矩阵

| 产品 | 自由订阅 RSS / 搜播客 | 逐字稿来源 | 听读同步 & 精听控制 | 词库 / SRS 闭环 | AI 深度理解 | 数据主权 & 商业模式 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Snipd** | 强 | 云端 ASR + 说话人 | 中（侧重一键 Snip） | 无 | 章节摘要 / Snip / AI DJ | 云端 · 订阅制 |
| **Podwise** | 强 | 云端 ASR + 双语 | 中（偏以读代听） | 无（导往 PKM） | 摘要 / 脑图 / Q&A / 跨集 | 云端 · 订阅+额度 |
| **Miraa** | 弱（偏单集导入） | 云端 AI 转写 | **极强**（跟读对比） | 弱 | 句级精讲 / 俚语解析 | 云端 · 按时长收费 |
| **每日英语听力** | 弱（平台库为主） | 官方人工校对为主 | **极强**（盲听/听写） | 中（传统背词） | 较浅 | 云端 · VIP 会员 |
| **LingQ** | 中（手动导入） | 云端 Whisper | 中 | 强（着色+SRS） | 较浅 | 云端 · 订阅制 |
| **Apple Podcasts** | 强 | 系统免费生成 | 中（逐行高亮跳转） | 无 | 无 | 免费封闭生态 |
| **Tibi（规划）** | **强（复用 RSS + 搜索）** | **分层：官方字幕 > 云端 BYOK > 本地离线 ASR** | **强（三态听读 + 盲听 + 原声听写）** | **极强（ECDICT + 原声 FSRS-7）** | **原生（导听/章节/口语精讲/追问/理解题）** | **本地优先 · 开源 BYOK / 商店点数** |

---

## 4. 关键技术生态调研

### 4.1 播客发现与开放协议

- **RSS 2.0 `<enclosure>`**：播客音频分发基石，携带音频直链 `url`、文件大小 `length` 和 MIME 类型（`audio/mpeg`、`audio/mp4` 等）。
- **Podcasting 2.0 命名空间（`xmlns:podcast`）**：
  - `<podcast:transcript>`：创作者在 RSS 中直接声明带时间戳的逐字稿地址（WebVTT `.vtt` / `.srt` / JSON / 纯文本）及语言属性。越来越多优质英文播客（NPR、Syntax、Changelog 等）已原生提供，**零成本、秒级获取、准确率远高于通用 ASR**。
  - `<podcast:chapters>`：标准 JSON 章节文件（标题、起始时间、章节配图）。
- **播客搜索目录**：
  - **iTunes Search API**（`https://itunes.apple.com/search?media=podcast&term=...`）：免费、免 API Key、无需自建代理，返回节目名、作者、封面与 `feedUrl`；同时支持按 Apple Podcasts ID 反查 RSS 地址（`lookup?id=...`）。最适合 Tibi 无服务器架构在 P1 直接集成。
  - **Podcast Index API**：开源、完整索引 Podcasting 2.0 标签（含是否带 `<podcast:transcript>`），但需要鉴权 Key，适合作为后期或可选增强。

### 4.2 语音转文字（ASR）方案对比

| 引擎 / 方案 | 部署形态 | 速度 / 延迟 | 英文准确度与时间戳 | 成本与隐私 | Tibi 适配判断 |
|---|---|---|---|---|---|
| **Podcasting 2.0 `<podcast:transcript>`** | 协议直取（零推理） | 秒级 | 极高（多为官方校对）+ 句级时间戳 | **免费** | **P1 最优先（Tier 0）** |
| **Groq Whisper API**（`whisper-large-v3-turbo`） | 云端 BYOK（OpenAI 兼容接口） | 极快（LPU 推理，1h 音频数秒完成） | 优秀 + `verbose_json` 句/词级时间戳 | 极低（约 $0.02–$0.04 / 音频小时） | **P1 云端首选（Tier 2）** |
| **OpenAI Audio Transcriptions** | 云端 BYOK | 快 | 优秀 + 时间戳 | 中（约 $0.18–$0.36 / 音频小时） | **P1 云端兼容（Tier 2）** |
| **Deepgram Nova-3** | 云端 BYOK | 极快（支持流式与批处理） | 工业级 + **原生说话人分离** + 精确词级时间戳 | 中（约 $0.26–$0.46 / 音频小时） | **P1/P2 可选高阶云端** |
| **macOS SpeechAnalyzer** | 本地系统框架（Apple Silicon ANE） | 极快、零安装包体积 | 优秀 + 原生词/段级时间戳 | **免费 · 100% 本地** | **P2 macOS 首选（Tier 1）** |
| **NVIDIA Parakeet TDT v2/v3**（CoreML / `sherpa-onnx`） | 本地离线（按需下载 ~0.6–0.9 GB） | M 系列实测 **35x–117x 实时** | 英文 WER ~1.9%–2.4%，非自回归极速 | **免费 · 100% 本地** | **P2 Apple Silicon 强力方案（Tier 1）** |
| **whisper.cpp / whisper-rs**（`large-v3-turbo` 量化） | 跨平台本地离线（Metal / CPU） | M 系列实测 **11x–14x 实时** | 多语种通用性极强（WER ~1.7%–3.8%） | **免费 · 100% 本地** | **跨平台原生候选（需 C++/cmake 构建）** |
| **Whisper ONNX (`onnx-community/whisper-*.en` q8)** | WebView Worker（复用 Kokoro 已随包的 `onnxruntime-web` WASM） | M 系列实测 `base.en` q8 **~5–20x 实时**，零新增安装包体积 | 英文优秀 + 原生段级时间戳 + 静音边界分窗 | **免费 · 100% 本地** | **P2 桌面/Web 零门槛首选（Tier 1，已落地）** |
| **硅基流动（SiliconFlow `FunAudioLLM/SenseVoiceSmall`）** | 国内一站式云端 BYOK（同 Key 兼顾 DeepSeek LLM） | 快（国内直连，免代理） | 英文准确，仅返回纯 `text`（需 MP3 帧时长分块 + 句级插值） | **转写免费 · 支付宝/微信充值 LLM** | **国内一站式降门槛首选（Tier 2，已落地）** |

### 4.3 国内一站式平台与本地 Whisper ONNX 实测（2026-11-25 补充）

1. **国内一站式 LLM + ASR 实测**：
   - **硅基流动（`https://api.siliconflow.cn/v1`）**同时提供满血版 DeepSeek（`deepseek-ai/DeepSeek-V3.2`、`deepseek-ai/DeepSeek-R1`）与免费 `/v1/audio/transcriptions`（`FunAudioLLM/SenseVoiceSmall`，单次上限 50 MB / 1 小时），国内直连且支持微信/支付宝，官方邀请链接格式为 `https://cloud.siliconflow.cn/i/<邀请码>`。
   - **协议实测差异**：硅基流动 `/v1/audio/transcriptions` 文档仅定义 `file` + `model`，响应体为扁平 `{"text": "..."}`，不含 `segments` 时间戳且模型可能输出 `<|en|><|Speech|>` 等控制标签。因此客户端在 `siliconflow_asr` 协议下剥离控制标签，对 MP3 按约 45 秒帧边界分块并发转写以取得精确时间锚点，再按自然句字符比例插值句级 `[start_ms, end_ms]`。
2. **本地离线 Whisper ONNX + 魔搭国内镜像实测**：
   - 经实际 HTTP 探针校验，`onnx-community/whisper-tiny.en`（q8 约 41 MB）、`onnx-community/whisper-base.en`（q8 约 77 MB，体积小于 Kokoro 的 92 MB）与 `onnx-community/whisper-small.en`（q8 约 249 MB）在 **ModelScope (`https://modelscope.cn/models/onnx-community/...`)** 与 **Hugging Face** 均全文件 `200 OK` 可达。
   - 复用随包已有的 `onnxruntime-web`（与 Kokoro 共享同一份 21 MB `.wasm`，**0 额外安装包增量**），通过浏览器原生 `AudioContext.decodeAudioData` 解码 MP3/M4A/WAV/OGG/AAC（无需捆绑 `ffmpeg` 或 C++ 工具链，兼容 Mac App Store 沙盒与 Linux/Windows/Web 跨平台 CI）。实测 `whisper-base.en` q8 离线转写 13s 英文语音精准输出句级时间戳。

---

## 5. 提炼给 Tibi 的六条核心洞察

1. **“盲听 → 对照精听 → 复盘巩固”优于纯字幕阅读**：界面应把一键切换「听读 / 盲听（模糊遮罩）/ 双语」作为一等公民，避免退化成纯文本阅读。
2. **用 AI 导听化解长音频选择成本**：单集导入后后台自动生成中文导听摘要、章节时间轴、听前关键生词与口语表达，让学习者在听前 30 秒就有全局框架。
3. **口语语料需要专属 AI 视角**：播客包含多说话人轮换、口语缩略、俚语习语与文化背景，AI 分析与对话上下文必须针对对话体特化（带说话人与时间戳窗口）。
4. **分层获取逐字稿 + 绝不自动全量转写**：新单集只在用户主动点“听读”时才按「官方字幕 → 云端 BYOK ASR（P1）→ 本地离线 ASR（P2）」分层处理，避免算力与费用失控。
5. **“原声语境复习卡 & 原声听写”是差异化王牌**：把 `sentences` 的 `[start_ms, end_ms]` 接到 Tibi 现有 FSRS-7 复习与听写练习中，复习时直接听播客原声原句而非机械 TTS。
6. **无打断听读体验**：听读中点词查释义应自动暂停、关闭词卡自动微回退续播；切去生词本或词典时音频通过底部迷你播放器持续播放。

---

## 参考来源

- [Snipd](https://www.snipd.com/)、[Podwise](https://podwise.ai/)、[Readwise Reader Podcast Transcripts](https://readwise.io/reader)
- [Miraa App](https://miraa.app/)、[LingQ](https://www.lingq.com/)、[PlayLingo](https://playlingo.app/)、[Pocket Casts Transcripts](https://pocketcasts.com/)
- [Podcasting 2.0 Namespace Spec (`<podcast:transcript>` / `<podcast:chapters>`)](https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md)
- [Apple iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/)、[The Podcast Index](https://podcastindex.org/)、[Radio-Browser API](https://www.radio-browser.info/)
- 本地与云端 ASR 生态：[whisper.cpp](https://github.com/ggml-org/whisper.cpp)、[WhisperKit](https://github.com/argmaxinc/WhisperKit)、[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)、[Groq Speech-to-Text](https://console.groq.com/docs/speech-to-text)、[Deepgram Nova-3](https://deepgram.com/)
