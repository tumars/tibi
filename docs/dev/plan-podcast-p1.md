# 实施计划：电台 P1「能听能读」（2026-11-24）

设计见 [17-podcast-radio.md](../design/17-podcast-radio.md)，调研见 [08-podcast-radio.md](../research/08-podcast-radio.md)，决策见 [DECISIONS.md](../DECISIONS.md) T42。

## 0. 范围与已确认约束

- **导航入口**：桌面侧栏新增一级「电台」（`/radio`、`/radio/manage`），放在「订阅」下方，定制双色调 `NavRadioIcon`，轻圆点未读提示。
- **内容范围**：P1 专注**播客电台（点播 RSS）** + 本地音频导入（`.mp3` / `.m4a` / `.wav` / `.ogg`）+ 手动 `.vtt`/`.srt` 字幕兜底。直播流放 P3。
- **逐字稿 / ASR**：Tier 0 Podcasting 2.0 `<podcast:transcript>`（VTT / SRT / JSON / TXT）优先；Tier 2 云端 BYOK ASR（`providers.kind = 'asr'`：Groq Whisper / OpenAI Audio Transcriptions / Deepgram Nova-3）；无字幕且未配置 ASR 时可先纯听，事后可一键 AI 转写或导入字幕。
- **播放与缓存**：有官方字幕时**流式播放 + 后台静默缓存**到 `media/podcasts/<doc_id>.<ext>`（默认 2 GB LRU 上限，仅清音频不删文档）；需云端 ASR 时先下载再转写（单集最大 300 MB，超 20 MB 纯 JS MP3 帧切分并发转写并拼接时间偏移）。
- **不做（P2 / P3）**：本地离线 ASR（SpeechAnalyzer / Parakeet / whisper.cpp）、原声语境 FSRS 复习卡与听写切片、听后理解题与复述批改、直播流电台、影子跟读录音对比。

## 1. 实现步骤

### Step 1：数据库迁移与同步规格（`@tibi/core`）
1. 新增 `packages/core/sql/0010_podcasts.sql`：
   - `feeds` 新增 `kind`（默认 `'article'`）、`artwork_url`、`language`、`description`，建索引 `feeds_kind(kind, deleted_at)`；
   - `feed_items` 新增 `audio_url`、`audio_mime`、`audio_bytes`、`duration_ms`、`transcript_url`、`transcript_type`、`chapters_url`、`artwork_url`、`season`、`episode`；
   - `documents` 新增 `media_url`、`media_path`、`duration_ms`、`playback_ms`（默认 `0`）、`transcript_source`；
   - `sentences` 新增 `start_ms`、`end_ms`、`speaker`，建部分索引 `sentences_time(section_id, start_ms) WHERE start_ms IS NOT NULL`；
   - 种入经过实测连通的精选内置英文播客（固定 ID：`builtin-pod-6min` BBC 6 Minute English、`builtin-pod-tews` BBC The English We Speak、`builtin-pod-voa` VOA Learning English、`builtin-pod-darknet` Darknet Diaries [含官方 `<podcast:transcript>`]、`builtin-pod-corecursive` CoRecursive）。
2. 运行 `pnpm --filter @tibi/core gen` 生成 `migrations.gen.ts`。
3. 更新 `packages/core/src/sync/spec.ts`：`documents.exclude` 增加 `'media_path'`，`settings.localGlobs` 增加 `'radio.*'`。
4. 更新 `packages/core/src/types.ts` 与 `rpc/define.ts`：`Kind` 扩展 `'episode'`，`Provider['kind']` 扩展 `'asr'`，`AiTask` 扩展 `'chapters' | 'pre_vocab' | 'spoken_expressions'`，`DocumentSummary` / `Document` / `Sentence` / `FeedView` / `FeedItemView` 补齐音频与时间戳字段。

### Step 2：Podcast RSS 解析、字幕自然句规整与播客搜索（`@tibi/core`）
1. 扩展 `packages/core/src/domain/feeds/parse.ts`：
   - 识别 `<enclosure type="audio/..." url="..." length="..." />`（以及 `itunes:*`），判定 `kind: 'podcast'`；
   - 解析 `itunes:image`、`itunes:duration`（`HH:MM:SS` / `MM:SS` / 秒）、`podcast:transcript`（优先级 `text/vtt` > `application/srt` > `application/json` > `text/plain`，英文优先）、`podcast:chapters`、`itunes:season` / `itunes:episode`、`language`、`description`。
2. 新建 `packages/core/src/domain/text/transcript.ts`：
   - 纯 TS 解析 WebVTT、SRT、Podcast JSON 字幕与纯文本；
   - 自然句合并算法：将碎片 cue 按句末标点、说话人切换与 > 1.5s 静音间隔合并为完整自然句，取首 cue `start_ms` 与末 cue `end_ms` 并保留 `speaker`。
3. 扩展 `packages/core/src/domain/feeds/`（`repo.ts`、`refresh.ts`、`methods.ts`）：
   - `feeds.list` / `feeds.items` / `feeds.status` / `feeds.mark` / `feeds.add` 支持 `kind?: 'article' | 'podcast'` 筛选与独立未读计数（`feeds.status` 同时返回 `unread` [文章] 与 `radio_unread` [电台]）；
   - `feeds.items` 支持 `has_transcript?: boolean` 筛选；
   - `feeds.discover` 支持识别 Apple Podcasts 链接（`podcasts.apple.com/.../id<num>` → 调 iTunes Lookup API 取 `feedUrl`）；
   - 新增 `podcasts.search { q, limit? }` 调用 iTunes Search API 搜播客；
   - 播客刷新单源超时调至 20s（适配 1 MB+ 播客 XML）。

### Step 3：音频导入流水线、媒体缓存与云端 BYOK ASR（`@tibi/core` + `@tibi/core-node`）
1. 扩展 `packages/core/src/platform.ts`：新增 `downloadMedia`、`transcribeAudio`、`mediaCacheInfo`、`pruneMediaCache`、`clearMediaCache`、`resolveMediaUrl`（本地缓存路径或资产映射）。
2. 新建 `packages/core-node/src/media.ts`：
   - `downloadMedia`：复用 `checkUrl` SSRF 校验，支持重定向、300 MB 上限、进度回调与原子写入 `media/podcasts/<key>.<ext>`；
   - LRU 缓存统计与清理（默认 2 GB 配额）；
   - 纯 JS **MP3 帧切分器**（`splitMp3BySize`）：当音频 > 20 MB 时按 MPEG 帧头精确切分并计算每段累计时长偏移，免捆绑 `ffmpeg`；
   - 云端 BYOK ASR 客户端：支持 **Groq Whisper**（`openai/v1/audio/transcriptions` + `verbose_json`）、**OpenAI Audio Transcriptions**、**Deepgram Nova-3**（`v1/listen?utterances=true&diarize=true&punctuate=true&smart_format=true`），统一产出 `TimedSegment[]`。
3. 扩展 `packages/core/src/domain/documents/`（`pipeline.ts`、`repo.ts`、`methods.ts`、`sections.ts`、`analyze.ts`）：
   - `documents.import` 新增 `source`: `{ type: 'podcast_item', id }` 与 `{ type: 'audio', path, transcript_path? }`；
   - 官方字幕路径：抓 VTT/SRT → 规整入库 → 立即 `import.done` → 后台静默调用 `downloadMedia` 缓存并回写 `documents.media_path`；
   - 无官方字幕路径：若有默认 ASR Provider → 下载并转写；无 ASR → 允许纯听入库（`transcript_source = 'none'`，写入 Show Notes 简介），提供 `documents.transcribe { id, transcript_path? }` 事后补跑转写或导入 `.vtt`/`.srt`；
   - `documents.update` 支持静默更新 `playback_ms`（不写撤销栈，不弹提示）；
   - `analyze.ts` 对 `kind === 'episode'` 使用播客专用 AI 任务：导听 `summary` + `advice`、`chapters`（带 `start_ms`）、`pre_vocab`、`spoken_expressions`（带 `start_ms`）；
   - `terms.context_meaning` 对 `episode` 补充口语语境提示；`agent.ts` 的 `attachmentFor` 在 `episode` 下注入当前时间戳与前后对话上下文；`devfake.ts` 同步适配假模型返回。
4. 扩展 `packages/core/src/domain/profile/methods.ts` 与 `rpc/system.ts`：
   - `providers.upsert` / `providers.test` 支持 `kind = 'asr'`（ASR 测试连接校验接口鉴权/连通）；
   - 新增 `system.mediaCache` 与 `system.clearMediaCache`。

### Step 4：桌面端 UI（`@tibi/desktop`）
1. **图标与导航**：`TibiIcons.tsx` 新增双色调 `NavRadioIcon`；`Shell.tsx` 侧栏新增「电台」（`/radio`）与 `radioUnread` 轻圆点；`App.tsx` 注册 `/radio` 与 `/radio/manage`，阅读页支持高亮「电台」；`Library.tsx` 形态筛选增加「电台」与时长/进度展示。
2. **电台页**（`pages/Radio.tsx` + `RadioManage`）：
   - 左栏按分组显示电台（带封面/耳机徽标与未读数），底部「+ 加电台」「管理」；
   - 右栏单集卡片（封面、标题、节目名、时长、发布时间、`⚡ 官方字幕` / `🎙 需转写` 徽标、Show Notes 摘要、`听读` / `加入书架` / `不感兴趣`）；
   - 顶部筛选 `[未读] [全部] [有字幕] [已保存]` + 刷新 + 全部已读 + 「导入本地音频」；
   - 加电台弹窗：双模式「搜播客（iTunes Search）」+「粘贴链接（RSS / Apple Podcasts）」。
3. **全局音频状态与迷你播放器**（`store/audio.ts` + `components/MiniPlayer.tsx`）：
   - 单例 `<audio>` 引擎，支持切页不中断播放、自动本地缓存/流式回退、`MediaSession` 系统媒体键、节流保存 `playback_ms`；
   - 离开当前单集阅读页时底部浮现精致迷你播放器（封面、当前句字幕、播放/暂停、-5s/+5s、一键回到听读页、关闭）。
4. **听读一体化阅读器**（`reader/EpisodePlayer.tsx` + `Reader.tsx` + `Section.tsx` + `SummaryPanel.tsx`）：
   - 逐句高亮滚动居中、点击任意句子跳转播放；
   - **盲听模式（`B`）**：正文柔焦遮罩，`V` 或单击揭晓当前句；
   - 精听工具：`-5s/+5s`、上/下一句、重听本句（`R`）、倍速 `0.6x–2.0x`、单句循环（`L`）、A-B 复读、句间停顿 `0–3s`、章节刻度点；
   - **点词自动暂停 → 关词卡自动回退 0.8s 续播**；
   - `Section.tsx` 渲染发言人标签（`speaker`）与时间戳标记；
   - `SummaryPanel.tsx` 对 `episode` 展示导听摘要、可点击跳转的「章节时间轴」、听前关键词、地道口语表达（点击跳转原声时间点）；
   - 无字幕纯听空态：展示 Show Notes + 一键「AI 转写」/「导入字幕 (.vtt/.srt)」/「配置语音转写服务」。
5. **设置与多语言**：
   - `ModelItems.tsx`：新增「语音转写（ASR）」分组（预设 Groq Whisper / OpenAI Whisper / Deepgram，支持密钥保存与连接测试）；
   - `DataItems.tsx`：新增「电台音频缓存」大小展示与一键清理；
   - `settings/search.ts`、`locales/en.json`、`mock.ts` 同步更新，保证 `i18n:check` 0 缺失 0 多余。

### Step 5：测试、走查与文档同步
1. 单元测试覆盖：Podcast RSS 解析、VTT/SRT/JSON 规整合并、迁移 `0010`、播客导入/纯听/转写流水线、AI 导听分析、MP3 帧切分、同步规格。
2. 全量执行 `pnpm test`、`pnpm typecheck`、`pnpm --filter @tibi/desktop i18n:check`、`pnpm build`。
3. 启动 `pnpm core:dev -- --fake-model` + `pnpm --filter @tibi/desktop web`，实测走查电台页、搜索订阅、导入听读、盲听、点词自动暂停、导听章节、迷你播放器、书架筛选与设置页，修复并优化视觉与交互细节。
4. 更新 `PRIVACY.md`、`docs/design/17-podcast-radio.md`、`docs/design/01-database.md`、`docs/DECISIONS.md`、`docs/CHANGELOG.md`。
