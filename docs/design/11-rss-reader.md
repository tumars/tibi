# 11 · 订阅（RSS 阅读器）总体方案

> 状态：已确认（2026-11-04），P1 计划见 [plan-rss-p1.md](../dev/plan-rss-p1.md)。
> 相关：[00 §找文章的实现](00-concept-design.md)、[05 找文章技能](05-agent-architecture.md)、[06 feeds.* / search_feeds](06-interface.md)、[08 同步](08-sync.md)。

## 1. 现状

Tibi 已经有一个"文章来源"层，但它只是"找文章"技能的**候选池**，不是阅读器：

| 方面 | 现在 | 位置 |
|---|---|---|
| 订阅列表 | 存在 `settings.feeds`（JSON：`custom[]` + `disabled[]`），外加 5 个写死的内置源 | [feeds.ts:12](../../packages/core/src/domain/documents/feeds.ts) |
| 条目 | **不入库**，每次 `search_feeds` 现抓，内存里缓存 1 小时；每源最多 30 条，只留 30 天内 | `searchFeeds` |
| 解析 | 正则解析 RSS 2.0 / Atom，取标题、链接、摘要、时间；没有 guid，`content:encoded` 只在没有 description 时才用 | `parseFeed` |
| 抓取 | 走 `platform.fetchUrl`（桌面有 SSRF 检查、手动跟重定向），没有条件请求（ETag / Last-Modified） | [core-node/platform.ts:78](../../packages/core-node/src/platform.ts) |
| 排序 | 兴趣词命中 + 新近程度；文本级别用摘要按词频粗估 | `searchFeeds` |
| 界面 | 只在 设置 → 高级 → 找文章 里加 / 删 / 开关源 | [SkillItems.tsx:79](../../apps/desktop/src/settings/SkillItems.tsx) |
| 使用方 | `scout`（找文章）、`coach`（完成页找短文）；`tibi` 有 `list_feeds` / `manage_feed` | skills |

缺的正是一个阅读器该有的：条目持久化、已读 / 未读、定时刷新、浏览列表、站点地址自动发现、OPML。

## 2. 定位：订阅是书架的"进货口"（界面上是侧栏单独一项，见 §5.1）

不做一个通用 RSS 阅读器（NetNewsWire、Reeder 已经很好），而是做 **"会自动来新文章的候选池 + 学英语视角的筛选"**。参考 Readwise Reader 的 Feed / Library 两分法：

- **订阅（Feed）**：源源不断地来，大部分不读，快速扫、挑、丢。条目**不进 `documents`**，不跑分段、标注、AI 总结——否则书架会被淹，模型费用也会失控。
- **书架（Library）**：用户决定要读的才进来。点"读"或"稍后读"时走现有的 URL 导入流水线，变成正常文档。

Tibi 和普通阅读器的区别在每个条目上多了几项**本地算、不花钱**的信息：

- 文本级别（A2–C2，按词频，已有）
- **对你的生词率**：摘要 / 正文里有多少词不在你已掌握的范围
- **含几个你在学的词**（`terms` 里 learning 状态的词）
- 预计阅读时长（有正文时按实际字数，否则按估计）

这些也正是"找文章"排序要用的信号，两边共用一套打分（§6）。

## 3. 数据模型（迁移 0007）

### 3.1 `feeds`

```sql
CREATE TABLE feeds (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,                 -- 订阅地址（规范化后）
  site_url TEXT,                     -- 网站首页
  title TEXT NOT NULL,
  title_custom INTEGER NOT NULL DEFAULT 0,   -- 用户改过名就不再被源里的标题覆盖
  builtin INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  folder TEXT,                       -- 可选分组（科技 / 科普 …），先只做一层
  -- 以下是抓取状态，设备本地，不同步
  etag TEXT, last_modified TEXT,
  last_fetched_at INTEGER, last_ok_at INTEGER,
  error TEXT, error_count INTEGER NOT NULL DEFAULT 0,
  next_fetch_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE UNIQUE INDEX feeds_url ON feeds(url) WHERE deleted_at IS NULL;
```

迁移时把 `settings.feeds` 里的 `custom` 搬进来，`BUILTIN_FEEDS` 作为 `builtin = 1` 的行种进去，`disabled` 变成 `enabled = 0`，然后删掉这个设置键。内置源以后改成"首次启动种子"，用户可以删（删了不再种回来）。

### 3.2 `feed_items`

```sql
CREATE TABLE feed_items (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feeds(id),
  guid TEXT NOT NULL,                -- guid / Atom id；都没有就用链接
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  published_at INTEGER,
  excerpt TEXT NOT NULL DEFAULT '',  -- 纯文本，≤ 600 字
  content_md TEXT,                   -- 源里带全文（content:encoded / Atom content）时转成 Markdown 存下，≤ 200 KB；不同步
  word_count INTEGER,                -- 有全文时的字数
  est_level TEXT, rare_ratio REAL,   -- 按词频，与用户无关
  state TEXT NOT NULL DEFAULT 'new', -- new / seen / saved / dismissed
  document_id TEXT,                  -- 导入后指向书架里的文档
  seen_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE UNIQUE INDEX feed_items_guid ON feed_items(feed_id, guid);
CREATE INDEX feed_items_list ON feed_items(deleted_at, state, published_at);
```

- **"对你的生词率"和"含在学的词"不存**：它们随生词本变化，列表查询时现算（每页 30 条，只扫摘要 / 全文前 400 词，开销可控；需要时加内存缓存，按 `terms` 的 `data.changed` 失效）。
- **保留期**：`new` / `seen` / `dismissed` 超过 60 天、或每源超过 300 条的旧条目硬删；`saved` 和有 `document_id` 的不删。这是本地派生数据，硬删不违反"不永久删用户数据"的原则（用户数据是书架里的文档）。

### 3.3 同步（08）

- `feeds`：`put`，自然键 `url`，`exclude` 抓取状态那几列。
- `feed_items`：`put`，自然键 `(feed_id, guid)`，`exclude: ['content_md', 'word_count']`（另一台设备自己会抓到）。REFS 里加 `feeds → feed_items.feed_id`，`documents → feed_items.document_id`。这样已读 / 丢弃 / 已导入在多设备间一致。
- 如果担心同步量（每天几十到上百条），备选是只同步 `state != 'new'` 的行；先按全量做，量真大了再收。

## 4. 抓取

### 4.1 刷新调度

- 新增 `feeds.refresh { feed_ids?: string[]; force?: boolean }`：挑 `enabled` 且 `next_fetch_at <= now` 的源，并发 4 个，单源超时 10 秒。
- **桌面**：挂在 [bin.ts](../../packages/core-node/src/bin.ts) 现有节拍旁边，启动后 2 分钟一次、之后每 30 分钟一次（只刷到点的源）。
- **手机**：跟 [runtime.ts](../../apps/desktop/src/mobile/local/runtime.ts) 的同步节拍一样，只在前台跑；打开订阅页时也刷。不做后台抓取。
- **每源间隔**：默认 2 小时；源声明了 `<ttl>` / `sy:updatePeriod` 就取较大值；连续失败按 2ⁿ 退避，最长 1 天，`error_count ≥ 10` 时在管理页标红"这个源可能失效了"。
- 设置里加"自动刷新订阅"开关（默认开），关了就只在打开订阅页 / 手动刷新时抓；同时更新 [PRIVACY.md](../../PRIVACY.md)：订阅会在后台定时联网抓源。

### 4.2 Platform 改动

`fetchUrl` 现在不能带 GET 请求头，也不返回响应头。需要：

- `opts.headers`（GET 也能带）——用来发 `If-None-Match` / `If-Modified-Since`，`accept` 加上 `application/rss+xml, application/atom+xml, application/feed+json, application/xml`；
- `FetchedPage.headers?: { etag?: string; last_modified?: string }`；
- 304 时 `body` 为空，Core 直接跳过解析。

桌面和手机两份实现都要改；SSRF 检查不变。

### 4.3 解析

正则解析器够用但边角多（实体、CDATA 嵌套、`xml:base`、相对链接、`<link>` 多个 rel、命名空间前缀）。建议换成 **[fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)**：纯 JS、不依赖 DOM，桌面 Node 和手机 WebView 都能用，符合 R11。统一产出：

`{ guid, url, title, author, published_at, excerpt, content_html? }`，并支持：

- RSS 2.0 / RSS 1.0（RDF）/ Atom / **JSON Feed**（后者直接 `JSON.parse`）
- `guid` → Atom `id` → 链接，作去重键
- 全文优先级：`content:encoded` > Atom `content` > `description`（较长时）
- 相对链接按 `xml:base` / 源地址补全；HNRSS 这类"链接是评论页"的源，`link` 和 `comments` 分开存

`content_html` 通过 platform 现有的 DOM 解析器跑 [htmlToMarkdown](../../packages/core/src/web/html.ts) 转成 `content_md`（Core 自己不碰 DOM，给 Platform 加一个 `htmlToMarkdown(html, baseUrl)`，或复用 `extractReadable`）。

### 4.4 加订阅：自动发现

用户 / Tibi 给的经常是网站地址而不是 feed 地址。`feeds.discover { url }`：

1. 抓这个地址；是 feed 就直接用；
2. 是 HTML 就找 `<link rel="alternate" type="application/(rss|atom)+xml|application/feed+json">`；
3. 都没有就试 `/feed`、`/rss`、`/feed.xml`、`/rss.xml`、`/atom.xml`、`/index.xml`；
4. 返回候选列表（标题、地址、最近一篇的标题和时间），多个时让用户选。

`feeds.update { add }` 改为先 discover 再落库。另外支持 **OPML 导入 / 导出**（从别的阅读器搬家用，文件走现有的文件选择 / 白名单）。

## 5. 界面

### 5.1 放在哪

**侧栏单独一项「订阅」**（2026-11-04 确认），放在"书架"下面，图标用 lucide 的 `Rss`，路由 `/feeds`，右侧显示未读数（`state = 'new'` 的条数，超过 99 显示 99+）。订阅是每天都会来看的地方，单独一项比藏在书架里的切换更顺手；侧栏变成 7 项，窄屏只显示图标时仍放得下。

书架和订阅的关系靠两处衔接：订阅里导入过的条目显示"在书架里"，点了直接打开；书架里来自订阅的文档在来源处显示源的名字，点了跳到 `/feeds?feed=<id>`。

### 5.2 订阅页（桌面）

```
┌ 源列表 ─────────┬ 条目列表 ────────────────────────────────────────┐
│ 全部        42  │ [未读] [适合我] [含在学的词]      排序：最适合 ▾  ⟳ │
│ ★ 已保存     3  │ ────────────────────────────────────────────────── │
│ 科技            │ How a GPU schedules warps            Quanta · 2 小时前 │
│   Ars Technica 12│ 摘要两行……                                        │
│   Rust Blog   2 │ B2 · 约 9 分钟 · 生词率 4% · 含 3 个在学的词         │
│ 科普            │                       [读]  [稍后读]  [不感兴趣]     │
│   Quanta      5 │ ────────────────────────────────────────────────── │
│ + 加订阅  管理   │ …                                                  │
└─────────────────┴────────────────────────────────────────────────────┘
```

- **读**：`documents.import { source: { type: 'feed_item', id } }`，条目卡片上就地显示进度，完成后进阅读器；条目 `state = saved`，记 `document_id`。
- **稍后读**：同样导入，但不跳转（进书架，AI 分析照常在后台排）。
- **不感兴趣**：`state = dismissed`，列表里淡出；可撤销（复用 `shared/undo`）。
- 滚动经过的条目自动 `seen`（未读数按 `new` 算）；"全部标为已读"。
- 已导入的条目显示"在书架里"，点了直接打开那篇文档。
- **管理**：加订阅（贴网址 → discover → 选）、OPML 导入导出、改名、分组、开关、删除、看错误。设置 → 高级 → 找文章 里原来的源管理改成一句话加一个"去管理订阅"的链接。

### 5.3 首页

首页加一张 **"订阅里适合你的"** 卡：本地打分取前 3 条（不调模型，打开首页就有），点了直接导入。旁边一个"让 Tibi 挑"按钮走 `scout`，要推荐理由时才花模型的钱。

### 5.4 手机

和桌面一致，底部标签栏单独加一项「订阅」（放在书架后面，带未读角标）；条目列表单列，左滑"不感兴趣"、右滑"稍后读"；源管理放到"我 → 订阅"。

## 6. 和"找文章"结合

### 6.1 共用一套本地打分

把 `searchFeeds` 里的 `rank` 抽成 `fitScore(item, profile)`，订阅页"最适合"排序、首页卡片、`search_feeds` 都用它：

| 信号 | 说明 |
|---|---|
| 级别贴合 | 条目级别和用户最近读完的文章级别差多少（照搬 scout 的规则：别跳太多） |
| 对你的生词率 | 2%–6% 最好，太低没收获、太高读不动 |
| 在学的词 | 每命中一个加分（复习效果的关键） |
| 兴趣词 | `profile.interests` 命中 |
| 新近程度 | 14 天线性衰减 |
| 源的偏好 | 这个源的条目你导入 / 读完得多就加分，丢弃得多就减分（`feed_items.state` 现成就能算） |

模型只在最后挑选和写理由时介入，候选已经被本地打分筛过，token 更少、更稳定。

### 6.2 能力层改动

| 能力 | 改动 |
|---|---|
| `search_feeds` | 改成**查 `feed_items` 库**（不再现抓）；数据旧于 2 小时先触发一次 `feeds.refresh`，失败也照样用库里的。新增参数 `q`（标题 / 摘要关键词）、`feed_ids`、`unread_only`、`level`；返回加 `item_id`、`fit`、`fit_reasons`、`learning_terms`。离线时也能用（只是不刷新） |
| `import_document` | `source` 允许 `{ type: 'feed_item', id }`：先按链接抓网页；网页打不开 / 抓不到正文（付费墙、反爬）而条目带了 ≥ 150 词的 `content_md`，就用源里的全文导入，`source_type` 仍记 `url`、`source_uri` 记原链接 |
| `manage_feed` | 加订阅时走 discover；有多个候选时用 `ask_user` 让用户选。仍是"需确认"、不对 MCP 开放 |
| `discover_feeds`（新） | 读：给网站地址返回可订阅的 feed 候选 |
| `ask_user` 网址校验 | 现在从本轮工具结果里找网址；`feed_item` 来源要把 `item_id` 也算进去 |

`search_feeds` 的结果仍算"读过不可信内容"（05 §8 已经列了）。

### 6.3 新的使用流程

1. **找文章 → 顺手订阅**：scout 用 `web_search` 找到的好文章来自某个站，且这个站有 feed、用户还没订阅时，在推荐卡后补一句"要订阅 xxx 吗？以后它的新文章会出现在订阅里"（`ask_user` 的一个选项，确认后 `manage_feed`）。这是把一次性的"找"沉淀成持续的"来"。
2. **"帮我找几个关于 X 的源"**：新增 scout 的一条指令——`web_search` 找博客 / 杂志 → `discover_feeds` 确认有源 → 抽最近几条估级别 → `ask_user` 多选 → `manage_feed` 批量加。新用户冷启动时（onboarding 填了兴趣）也可以提示一次。
3. **订阅 → Tibi 帮挑**：订阅页"让 Tibi 挑"、首页"让 Tibi 挑"、`/找文章` 不带主题时，scout 优先用 `search_feeds`（现在是本地库，快且全）。
4. **复习完成页**："读一篇用到这些词的短文"先在 `feed_items` 里按在学词命中找（本地即可），找不到再让 coach 写——比现在现抓 5 个源命中率高得多。

### 6.4 技能文档要改的地方

- `scout/SKILL.md`：`allowed-tools` 加 `discover_feeds`、`manage_feed`；写清楚"候选优先用订阅库""推荐的站有源且没订阅时问一句要不要订阅"。
- `tibi/SKILL.md`：管理类工具已有 `list_feeds` / `manage_feed`，补一句"用户说订阅某网站时先 discover"。
- 不加定时跑的技能（技能都是手动触发，00 §找文章 的约定不变）；"每日推荐"由本地打分完成，不调模型。

## 7. 分期

| 期 | 内容 | 验收 |
|---|---|---|
| **P1 能用** | 迁移 0007（含旧设置搬家）；fast-xml-parser 解析 + JSON Feed；`fetchUrl` 支持条件请求；`feeds.refresh` + 桌面调度；discover；侧栏「订阅」页（列表、读 / 稍后读 / 不感兴趣、已读）；源管理挪过来；`search_feeds` 改查库 | 订阅 20 个源，24 小时内条目正确去重、304 生效、读一篇进书架 |
| **P2 懂你** | `fitScore` 抽出来共用，生词率 / 在学的词实时算；"适合我 / 含在学的词"筛选；首页卡片；`feed_item` 导入兜底用源全文；OPML；同步；手机端 | 换一批生词后排序跟着变；付费墙文章能用源全文读 |
| **P3 结合** | scout 的"顺手订阅"和"找源"流程；`discover_feeds` 能力；源偏好学习；完成页优先查订阅库；剪藏插件加"订阅这个网站" | 一句"找几个讲天文的英文源"能订上 3 个可用的源 |

## 8. 风险

- **抓取量**：50 个源 × 每 2 小时，条件请求后大部分是 304，流量很小；但第一次全量导入 OPML 时要限并发、分批。
- **源里带全文的版权**：只在用户点了"读"之后才转成书架文档，和"导入网址"一样是个人阅读；不做分享。
- **生词率现算的性能**：列表只算当前页、只看前 400 词；词典查询已有缓存，实测再说。
- **HN 这类聚合源**：链接指向第三方站，正文抓取失败率高，兜底只能显示"打开原网页"。
- **手机不能后台抓**：打开 App 才刷新，首次进订阅页会有几秒"正在刷新"，需要骨架屏。

## 9. 需要拍板的问题

1. ~~**入口**~~：✅ 侧栏单独一项「订阅」，手机底部标签栏同样单独一项（2026-11-04，§5.1）。
2. ~~**同步 `feed_items`**~~：✅ 全量同步已读状态（P2）；`feeds` 表 P1 就进同步，因为订阅列表原来在 `settings` 里本来就同步。
3. ~~**内置源**~~：✅ 保留现在 5 个，作为首次种子，可删。
4. ~~**保留期**~~：✅ 60 天 / 每源 300 条。
5. ~~**自动刷新**~~：✅ 默认开，设备本地设置。

以上 2026-11-04 确认。P1 实施计划见 [plan-rss-p1.md](../dev/plan-rss-p1.md)。
