# 19 · 电台发现与低门槛订阅方案（阶段 1 & 2）

> 状态：**阶段 1 & 2 已实现并通过验证** · 2026-11-26  
> 关联：[`17-podcast-radio.md`](17-podcast-radio.md)、[`14-distribution-admin.md`](14-distribution-admin.md)、[`02-ai-assistant.md`](02-ai-assistant.md)、[`06-interface.md`](06-interface.md)、[`PRIVACY.md`](../../PRIVACY.md)

---

## 1. 问题与目标

当前电台（`apps/desktop/src/pages/Radio.tsx`）仅默认保留 2 档 BBC 源（`0011_prune_builtin_feeds.sql`），添加入口藏在「+ 添加电台」弹窗的空白搜索框里，且必须先盲订才能看到单集内容。对不熟悉英文播客和 RSS 的用户，冷启动门槛过高。

**目标**：在不违背 R12（零业务服务器）和隐私克制原则的前提下，让用户进入电台即可直接浏览精选节目与实时榜单、先预览甚至直接试听单集，再决定订阅；同时打通兴趣画像、AI 找电台与 OPML 迁移。

**边界约束**：
- **零数据库迁移**：不改 SQLite 表结构，目录缓存走 `settings` 本机键（`radio.*` 已在 `packages/core/src/sync/spec.ts` 排除同步），榜单与预览走 Core 内存缓存。
- **按需联网、离线可用**：安装包内嵌精选快照保证断网秒开；远端目录与榜单仅在用户主动打开「发现电台」时请求，不在应用启动时静默拉取。
- **网络统一走 Core**：所有外部请求经 `@tibi/core` 的 `ctx.platform.fetchUrl` 发起（桌面走 sidecar、Web 经 `/api/proxy`、手机走壳 HTTP），复用 T8 SSRF 校验，**无需放宽 Tauri CSP 或 `capabilities/default.json`**。

---

## 2. 阶段 1：发现广场（静态精选目录 + Apple 实时分类榜）

### 2.1 静态精选目录（`radio-catalog.json`）

针对中文母语英语学习者，补齐公开榜单缺失的「难度、口音、单集时长、中文说明、官方字幕」维度：

- **双层来源**：
  1. **内置兜底快照**：`packages/core/src/domain/feeds/catalog.default.json`（随构建打入 `@tibi/core`，遵循 R11 不读文件系统），首批收录 30–40 档经探活验证的英文播客。
  2. **远端静态更新**：`https://dl.ferecord.com/radio-catalog.json`，复用现有腾讯云 COS 发布链路（扩展 `tools/publish-cos.mjs` 支持 `catalog` 模式，同 T39 `notice.json`）。
- **拉取与容错**：
  - 用户打开「发现电台」时调 `podcasts.catalog`：若本地缓存 `radio.catalog.cache` 未超过 **24 小时**直接返回；过期则携带 `ETag` 拉取远端（超时 8s），失败或字段校验不通过时整份丢弃并静默回退至缓存/内置快照。
  - **全渠道一致**：官网版、Web 版与 Mac App Store 版均在用户主动打开「发现电台」时按需拉取远端 `radio-catalog.json`（不随应用启动静默轮询）；离线或拉取失败均静默回退内置快照。
- **数据结构**：

```ts
export type RadioSceneId = 'intensive' | 'spoken' | 'tech' | 'news_biz' | 'science_story';

export interface CatalogPodcast {
  id: string;
  title: string;
  author: string;
  feed_url: string;
  artwork_url: string;
  scene: RadioSceneId;           // 5 个互斥场景：精听 / 口语 / 科技 AI / 新闻商业 / 科普故事
  level: 'A2' | 'B1' | 'B2' | 'C1';
  accent: 'US' | 'UK' | 'AU' | 'intl';
  avg_minutes: number;
  has_transcript: boolean;       // 是否提供 Podcasting 2.0 <podcast:transcript>
  summary_zh: string;            // 一句话中文推荐语（≤ 50 字）
  summary_en: string;
}

export interface RadioCatalog {
  version: 1;
  updated_at: string;            // YYYY-MM-DD
  podcasts: CatalogPodcast[];
}
```

- **离线探活脚本**：新增 `tools/verify-radio-catalog.mjs`，在发布前逐条校验 `feed_url` 可达、`parseFeed` 正常、最近 180 天内有更新、`artwork_url` 可达，并自动检测 `<podcast:transcript>` 回填 `has_transcript`，避免死链（实测部分老 RSS 地址已失效）。

### 2.2 Apple 实时分类榜单（`podcasts.charts`）

免 API Key、无后端即可浏览全球热门英文播客，仅需 **2 次 HTTP 请求**：

1. 拉取分类榜单：`GET https://itunes.apple.com/{country}/rss/toppodcasts/limit={limit}/genre={genreId}/json`（`country: 'us' | 'gb'`，默认 `limit = 25`）。
2. 批量换取 `feedUrl`：提取 `entry[].id.attributes['im:id']` 拼成逗号列表，一次请求 `GET https://itunes.apple.com/lookup?id=id1,id2,...&entity=podcast`，补齐 `feed_url`、`artwork_url`、`episode_count`、`genre`。

**分类白名单与清洗**：

| 键 | 标签 | Apple `genreId` | 清洗规则 |
|---|---|---|---|
| `language` | 英语学习 | `1498` | 过滤非英语目标语节目（标题/作者命中 `spanish / french / german / japanese / korean / italian / portuguese / mandarin / arabic / russian / dutch / swedish / hindi` 等词） |
| `tech` | 科技 | `1318` | 剔除无有效 `feedUrl` 或未过 `checkUrlShape` 的条目 |
| `science` | 科学 | `1533` | 同上 |
| `business` | 商业 | `1321` | 同上 |
| `news` | 新闻 | `1489` | 同上 |
| `history` | 历史 | `1487` | 同上 |

- 进程内存按 `(country, genre)` 缓存 **6 小时**，支持传 `force: true` 手动刷新。

### 2.3 「发现电台」交互架构

把发现从弹窗提到 `/radio` 一级视图，保留左栏上下文，订阅后左栏实时出现新电台：

- **左栏入口**：在 `全部电台`、`已保存` 下方新增 **`发现电台`**（URL 走 `/radio?view=discover`，不跳离电台框架）；底部按钮收敛为 `链接导入` 与 `管理电台`。
- **冷启动轻引导**：当用户已订阅电台 ≤ 2 个且在 `全部电台` 时，列表顶部展示一行可关闭引导条（「去发现电台按难度和题材挑选更多节目 →」，关闭状态记 `localStorage`）；0 订阅空态主按钮直接切到 `发现电台`。
- **发现视图布局**：
  - **顶栏**：常驻搜索框（复用 `podcasts.search`，输入即搜全球播客，清空回到广场）+ 右侧 `链接 / OPML 导入` 按钮。
  - **分段 Tab**：**`英语精选`**（默认） | **`热门榜单`**。
  - **英语精选**：场景胶囊（全部 / 精听 / 口语 / 科技 AI / 新闻商业 / 科普故事）+ 轻量筛选（`全部难度 / A2–B1 / B2 / C1`、`仅看官方字幕`）；2–3 列卡片展示封面、标题、难度/口音/时长徽标、中文简介，底部操作为 `预览`（阶段 2）与 `订阅 / 已订阅`。
  - **热门榜单**：分类胶囊（6 类）+ 地区切换（美区 / 英区）；展示排名、封面、标题、作者、集数与 `订阅 / 已订阅`。

---

## 3. 阶段 2：先预览再订阅、兴趣联动、AI 找电台与 OPML

### 3.1 单集预览与免订阅试听

解决用户“不敢盲订”的核心顾虑，让用户像试读文章一样先试听某一期：

- **只读预览 RPC**：`podcasts.preview { url, limit? }`（默认 `limit = 8`，上限 20）
  - 经 `checkUrlShape` → `fetchUrl` → `parseFeed` 解析，**不写 `feeds` / `feed_items`**；
  - 返回节目简介、封面、官网、语言、当前是否已订阅（含 `feed_id`），以及最近 `limit` 集元数据（`guid`、`title`、`url`、`published_at`、`duration_ms`、`excerpt`、`audio_url`、`has_transcript`、`est_level`）；
  - Core 内存以 LRU（上限 20 个源，TTL 10 分钟）缓存解析结果，供紧接着的试听直接复用。
- **免订阅直接听读**：
  - 扩展 `documents.import` 的 `source`，新增 `{ type: 'podcast_episode', feed_url: string, guid: string }`；
  - Core 从预览缓存（未命中时按 `feed_url` 重拉一次）定位该单集，校验 `audio_url` / `transcript_url` 后**直接复用 `fetchPodcastItem` 的三层逐字稿流水线**（官方字幕 → 云端 ASR → 纯听兜底），导入为 `documents`（`kind = 'episode'`、`source_type = 'podcast'`、`shelved = false`），不污染订阅列表；
  - **事后订阅无缝去重**：用户试听满意后再订阅该电台时，`packages/core/src/domain/feeds/refresh.ts` 的 `saveItems` 已按 `source_uri / media_url` 匹配已有 `documents`，会自动回填 `document_id` 并标为 `seen`，不会产生重复文档。
- **交互**：点击发现广场或搜索结果中的任意节目卡片 → 弹出/侧滑节目详情面板（简介 + 右上角 `订阅电台 / 已订阅` + 最近 8 集列表），每集可直接点 `听读`。

### 3.2 Onboarding 兴趣联动

在「英语精选」的默认 `全部` 视图下，读取 `profile.interests`（`tech / news / lit / academic / blog`），按以下映射将匹配场景的节目自动排前（只调整默认排序，不隐藏其余节目）：

| `profile.interests` | 优先前置场景 |
|---|---|
| `tech` | `tech` |
| `news` | `news_biz` |
| `academic` | `science_story` |
| `lit` / `blog` | `spoken`、`science_story` |

### 3.3 打通 AI 找电台（`scout` 技能）

`packages/core/src/domain/feeds/methods.ts` 已实现 `search_podcasts`、`discover_feeds`、`manage_feed`，只需补齐两个只读能力并接入 `packages/core/skills/scout/SKILL.md`：

- 新增能力：`list_radio_catalog`（按场景/难度/口音/最大时长/是否带字幕筛选精选目录）、`preview_podcast`（抽最近 3–5 集核实实际时长、更新活跃度与文本级别）。
- `scout` 技能扩展 `allowed-tools`：加入 `list_radio_catalog`、`search_podcasts`、`preview_podcast`、`discover_feeds`、`manage_feed`。
- 交互流程（遵循 T33）：用户说“找几个 10 分钟左右的英音科技播客” → 先查 `list_radio_catalog`，不足再调 `search_podcasts` 并用 `preview_podcast` 抽检 → 精选 ≤ 3 档经 `ask_user`（`multi: true`，选项说明难度/口音/时长/字幕情况）确认后调 `manage_feed` 订阅。

### 3.4 OPML 导入与导出

便于从 Apple Podcasts、Pocket Casts、AntennaPod 等老客户端一键迁移，同时开放给电台管理与文章订阅管理：

- `feeds.importOpml { xml: string, kind?: FeedKind, folder?: string }`：
  - 复用 `fast-xml-parser` 解析标准 OPML `<outline xmlUrl="..." title="..." />`，外层容器 `<outline text="...">` 映射为 `folder`；
  - 校验 `checkUrlShape`、跳过已存在 URL，单次上限 100 条，批量写入 `feeds` 后在后台异步刷新，返回 `{ added, skipped, invalid }`。
- `feeds.exportOpml { kind?: FeedKind }`：输出标准 OPML 2.0 XML，前端触发保存/下载。
- 入口：同步开放至 `/radio/manage`、`/feeds/manage` 顶栏以及发现页的「链接 / OPML 导入」弹窗。

---

## 4. 接口与文件变更清单

> 实施时同步更新 `docs/design/_src/build_interface.py` 生成 `06-interface.md`。

| 阶段 | 方法 / 能力 | 类型 | 说明 |
|---|---|---|---|
| 1 | `podcasts.catalog` | RPC | `{ force?: boolean }` → `{ source: 'remote' \| 'cache' \| 'bundled', updated_at, podcasts }` |
| 1 | `podcasts.charts` | RPC | `{ genre, country?: 'us' \| 'gb', limit?: number, force?: boolean }` → `PodcastChartItem[]` |
| 2 | `podcasts.preview` | RPC | `{ url: string, limit?: number }` → `{ feed, subscribed, feed_id?, episodes }` |
| 2 | `documents.import` | RPC 扩展 | `source` 新增 `{ type: 'podcast_episode', feed_url: string, guid: string }` |
| 2 | `feeds.importOpml` / `exportOpml` | RPC | OPML 批量导入与导出 |
| 2 | `list_radio_catalog` / `preview_podcast` | 能力（`perm: 'read'`） | 供 `scout` 技能找播客使用（`mcp: false`） |

主要涉及模块：
- **Core**：`packages/core/src/domain/feeds/{catalog.ts, catalog.default.json, charts.ts, opml.ts, refresh.ts, methods.ts}`、`packages/core/src/domain/documents/{methods.ts, pipeline.ts}`、`packages/core/skills/scout/SKILL.md`
- **Desktop / Web UI**：`apps/desktop/src/pages/Radio.tsx`、`apps/desktop/src/feeds/{RadioDiscoverView.tsx, PodcastPreviewModal.tsx, FeedManageView.tsx}`、`apps/desktop/src/locales/en.json`
- **分发与文档**：`tools/publish-cos.mjs`、`tools/verify-radio-catalog.mjs`、`PRIVACY.md`、`docs/DECISIONS.md`、`docs/CHANGELOG.md`

---

## 5. 隐私与安全边界

- **隐私披露（已同步更新 `PRIVACY.md`）**：
  - 说明打开「发现电台」时按需请求 `dl.ferecord.com/radio-catalog.json`（含 Mac App Store 版）与 `itunes.apple.com` 公开分类榜单，不发送用户画像或学习记录；
  - 预览单集时直接请求对应播客的 RSS 地址。
- **安全**：
  - 远端 `radio-catalog.json` 经严格 schema 校验（仅放行 `https://` URL，字段超长或非法则整份拒收回退内置快照）；
  - 榜单、预览、OPML 中所有 URL 经 T8 `checkUrlShape` 拦私网；
  - 预览简介与单集文本进入 `scout` 对话时按不可信外部材料处理，不执行其中的指令。

---

## 6. 分期验收标准

**阶段 1**：
1. 断网状态下打开 `/radio?view=discover`，秒开 30+ 档「英语精选」卡片，支持场景、难度与官方字幕筛选，一键订阅后左栏实时出现并拉取单集。
2. 联网切换「热门榜单」6 个分类与美/英区，均正常加载并可直接订阅；`语言学习` 榜单中不出现西/法/德等非英语语种节目。
3. 首次进入电台（订阅 ≤ 2）能一眼看到发现引导；`dl.ferecord.com/radio-catalog.json` 返回 500 或坏 JSON 时静默回退内置快照，界面不报错。
4. `tools/verify-radio-catalog.mjs` 校验内置精选目录全部通过（0 死链）。

**阶段 2**：
1. 在发现广场或搜索结果中点击任意未订阅播客，可预览最近 8 集并直接点「听读」进入听读器；此时左栏不新增订阅；事后订阅该电台，已试听单集自动关联不重复导入。
2. Onboarding 勾选的兴趣能正确影响「英语精选」默认排序。
3. 在首页对 Tibi 说“推荐几个 10 分钟左右的英语播客”，`scout` 能给出带时长与理由的勾选卡片并一键订阅。
4. 在 `/radio/manage` 与 `/feeds/manage` 导入 20+ 源的 OPML 文件正确识别分组、去重并后台拉取；导出的 OPML 可被标准客户端重新导入。
