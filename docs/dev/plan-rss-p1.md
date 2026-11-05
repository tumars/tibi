# 实施计划：订阅 P1「能用」（2026-11-04）

设计见 [11-rss-reader.md](../design/11-rss-reader.md)。§9 已全部拍板：侧栏单独一项；`feed_items` 全量同步已读状态（P2 做）；保留 5 个内置源作首次种子、可删；保留期 60 天 / 每源 300 条；自动刷新默认开。

## 0. 范围

**做**：订阅和条目入库、定时刷新（桌面）、条件请求、加订阅时自动发现、桌面侧栏「订阅」页（浏览 / 读 / 稍后读 / 不感兴趣 / 已读）、源管理、`search_feeds` 改查库、`feeds` 表进同步。

**不做（P2 / P3）**：对你的生词率和在学的词、"适合我"筛选、首页卡片、`feed_item` 导入来源和源全文兜底、OPML、`feed_items` 同步、手机端、找源和顺手订阅。

**两处跟设计稿不同的简化**：
- "读"和"稍后读"直接走现有的 `{ type: 'url' }` 导入。导入成功后按链接回填 `feed_items.document_id`，界面和 agent 用同一条路，`import_document` 的参数和 `chosenUrl` 校验都不用动。`feed_item` 来源留到 P2 做源全文兜底时再加。
- `feeds` 表 P1 就进同步：订阅列表原来在 `settings.feeds` 里，本来就会同步；搬出来不进同步的话，多设备用户的订阅列表会丢。

## 1. 步骤

### 1. Platform：条件请求

- [platform.ts](../../packages/core/src/platform.ts)：`fetchUrl` 的 `opts` 加 `headers?: Record<string, string>`（GET 也能带）；`FetchedPage` 加 `headers?: { etag?: string; last_modified?: string }`；再加一个可选的 `htmlToMarkdown?(html, baseUrl): string`，Core 自己不碰 DOM。
- [core-node/platform.ts](../../packages/core-node/src/platform.ts)：合并请求头，读响应头；304 不读 body。`htmlToMarkdown` 用 linkedom 调 [web/html.ts](../../packages/core/src/web/html.ts)。
- [mobile/local/runtime.ts](../../apps/desktop/src/mobile/local/runtime.ts)：同样两处改动，P1 不用但保持接口一致；`htmlToMarkdown` 用 `domParser`。
- `fakePlatform` 和测试 helpers 补上这些字段。

### 2. 解析器

- `packages/core` 加依赖 `fast-xml-parser`（纯 JS，R11 不受影响）。
- 新建 `domain/feeds/parse.ts`：`parseFeed(body, contentType, feedUrl) → { title, site_url, ttl_minutes?, items: { guid, url, title, author?, published_at?, excerpt, content_html? }[] }`。
  - 支持 RSS 2.0、RSS 1.0（RDF）、Atom、JSON Feed；
  - 去重键：`guid` → Atom `id` → 链接；
  - 全文优先级：`content:encoded` > Atom `content` > 较长的 `description`；
  - 相对链接按 `xml:base` 或源地址补全；`<ttl>` / `sy:updatePeriod` 换算成分钟。
- `discoverFeeds(html, pageUrl)`：从 `<link rel="alternate">` 里找 rss / atom / json 订阅地址（不用 DOM，正则或 fast-xml-parser 的 HTML 宽松模式都行）。
- 旧的 `parseFeed` 删掉；[feeds.test.ts](../../packages/core/test/documents/feeds.test.ts) 迁到 `test/feeds/parse.test.ts`。fixtures 覆盖：HNRSS（链接是外站、`comments` 是 HN）、Quanta（WordPress、`content:encoded`）、Go Blog（Atom）、Rust Blog（Atom + `xml:base`）、JSON Feed、CDATA 套实体、没有 guid 的条目。

### 3. 迁移 0007

`packages/core/sql/0007_feeds.sql`：

- 建 `feeds`、`feed_items`，表结构照设计稿 §3；`feeds` 再加一列 `ttl_minutes`。
- 种 5 个内置源（`builtin = 1`）；`settings.feeds.custom` 搬成 `builtin = 0` 的行；`disabled` 里的地址改成 `enabled = 0`；最后删掉 `settings.feeds`。
- 种子只在这次迁移里跑一次，用户删掉内置源后不会再种回来；以后要加新的内置源，再另写迁移。
- 跑 `pnpm --filter @tibi/core gen` 重新生成 `migrations.gen.ts`；[db.test.ts](../../packages/core/test/db.test.ts) 加一条从旧 `settings.feeds` 迁过来的用例。

### 4. 领域：`domain/feeds/`

把订阅从 `domain/documents/feeds.ts` 拆成单独的领域；`web_search` 相关的代码留在原处，文件改名 `documents/websearch.ts`。

- `repo.ts`：订阅的增删改查；`upsertItems(feed_id, items)` 按 `(feed_id, guid)` 写入，**已有的条目只更新标题、摘要、全文，不碰 `state`、`document_id`**；`prune()` 按保留期硬删（`saved` 和有 `document_id` 的不删）。
- `refresh.ts`：`refreshFeeds(ctx, { feed_ids?, force? })`。
  - 挑 `enabled`、没删、并且 `force` 或 `next_fetch_at <= now` 的源；并发 4 个，单源超时 10 秒。整个刷新用 `background('feeds.refresh', …)` 防重入。
  - 发 `If-None-Match` / `If-Modified-Since`：304 只更新 `last_fetched_at`；200 就解析、写入、存新的 etag。
  - 每条新条目：`excerpt` 用 `annotateSentences` 估级别（沿用现在的写法）；有 `content_html` 并且 `platform.htmlToMarkdown` 可用，就转成 `content_md`（≤ 200 KB）并记 `word_count`。
  - 下次抓取时间：`max(120 分钟, ttl)`；失败时 `2^error_count × 30 分钟`，最多 1 天。
  - 有新条目就发 `data.changed { table: 'feed_items' }`；结束时跑一次 `prune()`。
- `discover.ts`：`discover(ctx, url)`。先抓地址：本身是订阅就直接用；是网页就找 `<link>`，找不到再试常见路径。返回 `{ url, title, latest?: { title, published_at } }[]`。

### 5. 方法（界面用）

| 方法 | 说明 |
|---|---|
| `feeds.list` | 订阅列表，带 `unread`（`state = 'new'` 的条数）、`error`、`error_count`、`last_ok_at`、`folder` |
| `feeds.discover` | `{ url }` → 候选列表 |
| `feeds.add` | `{ url, title?, folder? }`；地址必须是 discover 返回的订阅地址；加完马上刷一次这个源 |
| `feeds.update` | `{ id, title?, folder?, enabled? }`；改了名就设 `title_custom = 1` |
| `feeds.remove` | 软删订阅，并硬删它下面没保存、没导入的条目；可撤销（`shared/undo`，撤销后重新刷） |
| `feeds.refresh` | `{ feed_ids?, force? }`，界面上的刷新按钮传 `force` |
| `feeds.items` | `{ feed_id?, folder?, filter: 'unread' \| 'all' \| 'saved', cursor?, limit? }`，按 `published_at` 倒序，带"在书架里"标记 |
| `feeds.mark` | `{ ids?, feed_id?, all?, state: 'seen' \| 'dismissed' \| 'new' }`；`dismissed` 可撤销 |
| `feeds.unread_count` | 侧栏角标用 |

旧的 `feeds.search` 删掉（界面没用到）；旧的 `feeds.update` 换成上面这组。[rpc/methods.ts](../../apps/desktop/src/rpc/methods.ts) 同步补类型。

**导入回填**：[pipeline.ts](../../packages/core/src/domain/documents/pipeline.ts) 的 URL 导入成功（包括 `duplicate`）后，执行 `UPDATE feed_items SET document_id = ?, state = 'saved' WHERE url IN (请求的链接, final_url) AND document_id IS NULL`，并发 `data.changed { table: 'feed_items' }`。

### 6. 能力（agent 用）

- `search_feeds`：改成查 `feed_items`。
  - 最近一次成功刷新超过 2 小时的源，先 `refreshFeeds`，最多等 8 秒；超时或离线就直接用库里的，返回 `stale: true`。
  - 参数加 `q`（标题 / 摘要 LIKE）、`feed_ids`、`unread_only`；`since` 默认 30 天；排序沿用现在的兴趣词 + 新近程度，P2 再换成 `fitScore`。
  - 返回加 `item_id`；书架里已有的照旧不返回；仍算读过不可信内容。
- `list_feeds`：返回新的列表结构。
- `manage_feed`：
  - `add` 先 discover：只有一个候选就直接加；有多个就返回候选、不加，由模型用 `ask_user` 问。
  - `remove` / `toggle` 改按 `id` 或 `url`。
  - 仍是"需确认"，不对 MCP 开放。
- `coach` 在用 `search_feeds`：确认它只读 `url`、`title`、`excerpt` 这几个字段，兼容。
- [tool-schemas.test.ts](../../packages/core/test/kernel/tool-schemas.test.ts)、[taint.test.ts](../../packages/core/test/kernel/taint.test.ts) 跟着更新。

### 7. 调度（桌面）

- [bin.ts](../../packages/core-node/src/bin.ts)：启动后 2 分钟、之后每 30 分钟各调一次 `feeds.refresh {}`；只刷到点的源，所以频繁调用代价很小。
- 设置 `feeds.auto_refresh`（默认开）：关了以后定时调用直接返回，只有打开订阅页或点刷新时才抓。这个键加进 [spec.ts](../../packages/core/src/sync/spec.ts) 的 `localGlobs`（`feeds.*`），每台设备自己决定。

### 8. 同步

- `TABLES` 加 `{ t: 'feeds', kind: 'put', pk: ['id'], exclude: ['etag', 'last_modified', 'last_fetched_at', 'last_ok_at', 'error', 'error_count', 'next_fetch_at', 'ttl_minutes'], natural: { cols: ['url'], where: 'deleted_at IS NULL' } }`，放在 `documents` 前面。
- `REFS` 加 `feeds: [{ t: 'feed_items', col: 'feed_id' }]`。`feed_items` 本身 P2 才进 `TABLES`。
- [scenarios.test.ts](../../packages/core/test/sync/scenarios.test.ts) 加一条：两台设备各自订了同一个源，合并成一条。

### 9. 桌面界面

- **侧栏**：[Shell.tsx](../../apps/desktop/src/components/Shell.tsx) 在"书架"后面加 `{ to: '/feeds', label: tl('订阅'), icon: Rss, count: 'feedUnread' }`。[store/core.ts](../../apps/desktop/src/store/core.ts) 加 `feedUnread`，收到 `data.changed`（`feed_items` / `feeds`）时刷新；数字超过 99 显示 99+。
- **路由**：[App.tsx](../../apps/desktop/src/App.tsx) 加 `feeds` 和 `feeds/manage`。
- **`pages/Feeds.tsx`**：
  - 左栏：全部、已保存、按 `folder` 分组的源，每个带未读数；底部是"+ 加订阅"和"管理"。
  - 右栏：条目卡片，显示标题、站名、相对时间、两行摘要、级别 · 约 n 分钟；按钮是 读 / 稍后读 / 不感兴趣。已导入的显示"在书架里"，点了打开那篇。
  - 顶部：未读 / 全部 / 已保存三个筛选、刷新按钮（转圈时显示"正在刷新 n 个源"）、"全部标为已读"。
  - 滚过去的条目用 IntersectionObserver 批量标 `seen`，攒 1 秒发一次。
  - "读"：调 `documents.import { source: { type: 'url' } }`，卡片上就地显示进度，`import.done` 后跳到 `/read/:id`；"稍后读"导入但不跳转。
  - 空状态用 `empty-library` 插画，加一句引导去加订阅。
- **加订阅弹窗**：输入网址 → `feeds.discover` → 列出候选（含最近一篇的标题），勾选后可以选分组 → `feeds.add`。
- **`feeds/manage`**：每个源一行，可以改名、改分组、开关、删除；显示上次成功时间，出错的标红并显示原因。顶部放"自动刷新订阅"开关。
- **设置**：[SkillItems.tsx](../../apps/desktop/src/settings/SkillItems.tsx) 里的 `FeedItems` 换成一句说明加"去管理订阅"链接；[settings/search.ts](../../apps/desktop/src/settings/search.ts) 加"订阅 / RSS / 自动刷新"的搜索项。
- **文案**：[locales/en.json](../../apps/desktop/src/locales/en.json) 补英文。[mock.ts](../../apps/desktop/src/mock.ts) 补 `feeds.*` 的假数据，用于不连 Core 的界面开发。
- **书架**：来自订阅的文档在 [DocSource.tsx](../../apps/desktop/src/components/DocSource.tsx) 显示源的名字，点了跳到 `/feeds?feed=<id>`。需要 `documents.list` 关联出 `feed_title`；量不大的话可以挪到 P2。

### 10. 技能与文档

- `scout/SKILL.md`：候选优先用 `search_feeds`（现在查本地库，快）；`stale: true` 时照常用，不用跟用户解释。`tibi/SKILL.md`：用户说订阅某网站时，`manage_feed add` 给网站地址就行；有多个候选时用 `ask_user` 问。跑 `gen` 重新生成 `skills.gen.ts`。
- [06-interface.md](../design/06-interface.md)：更新 `feeds.*` 和 `search_feeds` / `manage_feed` 的表格。
- [01-database.md](../design/01-database.md)：加两张表。
- [PRIVACY.md](../../PRIVACY.md)：说明订阅会在后台定时抓取，以及在哪里关。
- `DECISIONS.md`：记下订阅入库、侧栏入口、保留期和同步范围这几条决定。
- `CHANGELOG.md`、[使用指南](../guide/README.md)：补一节"订阅"。

## 2. 顺序与提交

| # | 内容 | 依赖 |
|---|---|---|
| A | 1 Platform + 2 解析器 + 测试 | — |
| B | 3 迁移 + 4 领域 + 5 方法 + 8 同步 + 测试 | A |
| C | 6 能力 + 7 调度 + 10 里的技能部分 | B |
| D | 9 界面 | B（可以先对着 `mock.ts` 做，和 C 并行） |
| E | 10 文档、`pnpm typecheck`、`pnpm test`，用真源跑一遍 | C、D |

一个 PR 里分这 5 个提交。C 和 D 能并行做。

## 3. 实现情况（2026-11-04）

上面 1–10 都已完成，还没提交。和计划不一样的几处：

- 内置源的名字记成 `title_custom = 1`，不被源里的标题（如 "Ars Technica - All content"）覆盖。
- 源里的全文要 ≥ 150 词才收；阅读时长只在 ≥ 400 词时按它算，否则按 1200 词估（Ars Technica 的 content:encoded 只有开头 200 词左右）。
- HNRSS 摘要里的 Article URL / Comments URL / Points 样板去掉了。
- `documents/feeds.ts` 拆成 `domain/feeds/`（订阅）和 `documents/websearch.ts`（网页搜索）；旧的 `feeds.search` 方法删了。
- 已读判断：卡片整张从列表的滚动区上边出去才算，卡片被移走（换筛选、离开页面）不算。

验证：`pnpm test` 全过（56 个文件 / 296 个用例），`pnpm -r typecheck` 全过，`i18n:check` 无缺漏。用开发桥连真实的 5 个内置源跑过：第一次 72 条、第二次强制刷新 3 个源返回 304、没有重复条目；在浏览器里走通了读（导入后进阅读器、条目变成「在书架里」）、不感兴趣和撤销、滚动标已读、从网站首页（jvns.ca）发现并订阅、管理页开关后侧栏未读数跟着变、深色模式。多设备同步：除单测外，起了两个独立的 Core 进程（各自的库），经同一个同步文件夹同步，12 项检查全过——两边各订同一个源合并成一条、同一个 ID；改名、开关、分组、删除都同步过去；刷新不覆盖改过的名字；自动刷新开关不同步。两台真机没有试。

24 小时长跑：2026-11-04 16:10 开始，20 个源（5 个内置 + 15 个常见英文博客 / 新闻），每 30 分钟走一次 `feeds.auto`，每轮检查重复条目、已读 / 丢弃状态有没有被冲掉、304 数和失败的源。3 分钟的试跑没有问题。

结果（2026-11-05 15:48 跑完 48 轮）：20 个源里 danluu.com 和 theatlantic.com 加不上（就是下面说的 Node fetch 连不上），实际跑了 18 个。共抓 219 次，其中 75 次返回 304，新增 163 条，库里最后 352 条。事先标了 22 条已读 / 丢弃 / 稍后读，每轮都检查：重复条目 0，已读被冲掉 0，丢弃的重新冒出来 0。失败 36 次：一轮整台机器断网（所有源一起报域名解析失败），几次单个源超时（HN、Rust Blog、Smashing、WIRED），都在下一次抓取时恢复，最后一轮没有出错的源。304 只占三分之一，因为不少源不支持条件请求，或者两小时内本来就有更新，这符合预期。

发现的环境问题（不是这次改的）：这台机器上 Node 自带的 fetch 连不上 martinfowler.com 和 feeds.bbci.co.uk（10 秒超时），curl 能连上。导入网址也用同一个 fetch，所以这两个站导入网址同样会失败；可能和网络 / 代理有关，没有深查。

后续调整（2026-11-04）：订阅里点"读"不再进书架。加了 `documents.shelved`（迁移 0008）：读的时候照常导入（同一个阅读器、同样的标注和总结），但书架、书架计数、首页都不显示；阅读器顶栏和侧栏显示「订阅」，有「加入书架」（可撤销）；「稍后读」和用别的方式再导入同一篇都会放进书架。`list_documents` 能力仍然看得到这些文章（找文章要参考最近读过的）。

## 4. 验收

- 订阅 20 个源（5 个内置加 15 个常见英文博客 / 杂志），跑 24 小时：
  - 条目不重复，已读、丢弃不会被刷新冲掉；
  - 第二轮起大部分源返回 304（Core 日志里有计数）；
  - 坏掉的源进入退避，管理页能看到原因。
- 给网站首页地址（不是订阅地址）也能订上；同一个站有多个订阅地址时让用户选。
- "读"一篇：进书架，条目显示"在书架里"；再从对话里 `/找文章` 选同一篇，提示已在书架、不重复导入。
- 离线时订阅页能看库里的条目，`search_feeds` 返回 `stale: true`，找文章照常能用。
- 旧版用户升级后，自己加过的源和关掉的内置源都还在。
- 开了同步的两台设备，订阅列表一致。

逐条对照（2026-11-05）：
- 24 小时长跑：第一轮通过，但只有 18 个源（另 2 个本机 Node fetch 连不上，见 §3）。2026-11-05 16:00 起按 20 个源重跑（换掉连不上的两个，先用 Node fetch 逐个试过都能连上；源数不够 20 个脚本直接报错），结果待补。
- 网站首页地址：浏览器里从 jvns.ca 订上了。多个候选让用户选：单测覆盖（"自动发现…多个候选时不直接加"）。
- "读"一篇：后来按要求改成默认不进书架（§3 后续调整）；"稍后读"和"加入书架"会进，浏览器里走过。
- 离线：真的 Core 进程实测 5/5——订上真实的源后，把所有源的地址换成解析不了的域名（断网时就是域名解析失败）、上次成功改到 3 小时前：订阅页照样列出库里的条目，`search_feeds` 返回库里的条目和 `stale: true`，按关键词找也能用，刷新失败给中文原因、条目不丢。实测发现一个问题并修了：原来只有系统报离线或刷新超过 8 秒才标 `stale`，断网时系统常常仍说在线、请求很快就失败，于是不标；现在刷完一个新的源都没有也标（只是个别源坏了不标），补了单测。
- 旧版升级：用订阅功能之前的版本（1c3cee0）建库，在旧版里自己加两个源（一个改了名、一个关掉）、关掉内置的 HN；再用现在的代码打开：两个源都在、名字和开关不变，HN 仍关着，旧的 `settings.feeds` 已清掉，5/5。没有拿真实用户的库试。
- 两台设备同步：两个独立 Core 进程经同步文件夹，12/12。两台真机没有试，这一条要等有两台装了这一版的设备。
