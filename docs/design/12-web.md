# 12 · Web 版

> 状态：已确认（2026-11-05，用户："可以，按推荐做"）。P0 代码完成（2026-11-06），本地浏览器里验证过；同日第一次部署到 EdgeOne Makers（§7），域名 DNS 已加。
> 相关：[00 §3.13 手机端](00-concept-design.md)、[06 接口](06-interface.md)、[08 同步](08-sync.md)、DECISIONS T28（手机上 Core 跑在 WebView 里）、T40（本文）。

## 1. 目标

在浏览器里打开就能用 Tibi：不装软件，读文章、查词、复习、和 Tibi 对话。发布在 `app.tibi.ferecord.com`，官网首页加入口。

不做的：MCP Server、托盘、软件更新、剪藏插件、深链、iCloud / 本地文件夹同步、系统钥匙串。这些都要原生壳。

## 2. 思路：手机端的那条路，换一个壳

手机上 Core 已经跑在 WebView 里（T28）：同一份 `@tibi/core`，SQLite、文件、密钥、跨域请求由壳提供。Web 版就是把这个"壳"换成浏览器自己的能力：

| 能力 | 手机（Tauri） | Web |
|---|---|---|
| SQLite | 壳里的 rusqlite，`db_open / db_exec / db_run / db_all` | Worker 里的官方 sqlite-wasm + OPFS（`opfs-sahpool` VFS），**命令名和参数一样**，JS 端照用 `InvokeDriver` |
| 词典 | 随包的 `dict.db`（119 MB） | 精简词典 `dict-lite`（§4），第一次用时下载进 OPFS |
| 书里的插图 | 壳的 `asset_write / asset_list / asset_remove`，asset 协议显示 | 同名命令在 Worker 里写 OPFS 的 `assets/`；Service Worker 把 `/__assets/<key>/<name>` 读出来给 `<img>` |
| 跨域请求 | http 插件（不受 CORS 限制） | 能直连的直连；不行的经站内中转 `/api/proxy`（§5） |
| 文件 | 系统文件选择，壳读字节 | `<input type=file>`，字节留在内存，登记成 `mem:<id>/<文件名>` |
| 密钥 | 系统钥匙串 | IndexedDB（§6） |
| 同步 | iCloud、WebDAV | WebDAV（经中转） |
| 备份 | `VACUUM INTO` 到 `backups/` | P1：导出成文件下载 |

所以运行时只有一份（`apps/desktop/src/mobile/local/runtime.ts` 里的 `startLocalCore`），手机和 Web 各给一个壳对象。界面也不另写：宽屏用桌面界面，窄屏（≤ 760px）用手机壳。

## 3. 存储

- `app.db`、`dict-*.db` 都在 OPFS 的 SAH 池里，只有 Worker 能读写；`opfs-sahpool` 不需要 COOP / COEP 响应头。
- **同一时间只能一个标签页**：SAH 池独占文件。入口先用 Web Locks 拿 `tibi-core` 锁，拿不到就显示"已经在另一个标签页打开了"。
- 启动时调用 `navigator.storage.persist()`，减少浏览器清理存储的机会。Safari 对长期不访问的站点仍可能清掉，界面上提醒开同步。
- 浏览器不支持 OPFS（如 Firefox 隐私窗口）时退回内存库，提示关掉页面数据就没了。
- 浏览器要求：Chrome / Edge 102+、Safari 16.4+、Firefox 113+（`DecompressionStream`、OPFS 同步句柄）。

## 4. 精简词典

完整 `dict.db` 119 MB，不能让网页用户整包下载。构建时从它生成 `dict-lite`：

- `stardict` 只留有词频（`frq` / `bnc`）、柯林斯星级、牛津 3000、考试标签的词，外加 `lemma_map` 指向的原形；
- `lemma_map`、`word_atlas` 全留；WordNet 只留这些词的义项；
- 压成 gzip，文件名带内容哈希，`dict/manifest.json` 写当前文件名。

2026-11-06 实测：74,708 词，35.2 MB，gzip 后 15.7 MB（完整版 77 万词、119 MB）。

Worker 启动时取 manifest（不走缓存），本地没有这个版本就下载、解压、导入 SAH 池，删掉旧版。下载完之前，查词的请求等着；下载失败时词典当作空的（查词返回没有），下次启动再试。

脚本：`apps/desktop/scripts/web-dict.mjs`。

## 5. 中转 `/api/proxy`

浏览器不能直接抓别的网站、RSS，部分模型服务商和坚果云也不给 CORS。站内放一个 EdgeOne 边缘函数做中转：

```
GET|POST|PUT|DELETE|PROPFIND|MKCOL|MOVE|COPY|HEAD  /api/proxy?url=<目标地址>
```

- **只给本站页面用**：要求 `Sec-Fetch-Site: same-origin`，或 `Origin` 就是本站。挡不住命令行直接调，只挡别的网站借用。
- **只去公网**：只认 http(s)；拦 `localhost`、`.local` / `.internal`、IP 字面量里的内网和保留段。GET 手动跟重定向（最多 5 跳），每跳重查；其余方法不跟（带密钥的请求不能被带去别的地址，和桌面的 `post` 一样）。
- **不留东西**：不记日志、不缓存、不改内容。去掉 `cookie`、`origin`、`referer`、`sec-*`、`x-forwarded-*` 再转发；回来时去掉 `set-cookie`，加 `x-tibi-final-url`（重定向后的地址）。响应原样流式转回（模型的流式输出）。
- 请求体上限 1 MB（EdgeOne 的限制），超了 WebDAV 上传会失败。

Web 端的全局 `fetch` 换成"先直连、失败（CORS 被拦）再经中转"，记住哪些站点要中转。抓网页、RSS 一律走中转。

开发时 Vite 用同一份函数挂在 `/api/proxy`（`vite.config.ts` 的插件），不用起 EdgeOne。

**隐私说法要改**：桌面和手机仍然没有服务器；Web 版经过一个不存东西的中转。PRIVACY.md、README 写明。

## 6. 密钥

API Key、WebDAV 密码存在 IndexedDB（`tibi-secrets`），Worker 和页面都能读。比系统钥匙串弱：同一浏览器里的恶意扩展、本站的 XSS 都能拿到。对策是严格的 CSP（只放行自己、模型和词典下载用的地址），设置页写明"Key 存在这个浏览器里"。

## 7. 发布

- 构建：`pnpm --filter @tibi/desktop build:webapp` → `apps/desktop/dist-web/`（`web.html` 改名 `index.html`、`dict/`、`edge-functions/`、`edgeone.json`）。
- 部署：GitHub Actions（`webapp.yml`），推到 main 且改了界面 / Core 时，`edgeone makers deploy dist-web -n tibi-app -t $EDGEONE_API_TOKEN`。项目是"直接上传"类型，和官网（ferecord 仓库，Git 关联）分开。
- 域名 `app.tibi.ferecord.com`：数据按域名隔离，Web 应用和官网分开；以后加响应头、Service Worker 不影响官网。
- 官网 `sites/tibi` 首页加"在浏览器里用"按钮。

**实际配置（2026-11-06）**：Makers 项目 `tibi-app`，ID `makers-c2ct0iyy4guo`，直接上传类型，全球可用（含中国大陆）；第一次部署 `dp10a45q3tek` 是本机 `edgeone login -s china` 后用 CLI 传的。默认域名 `tibi-app-yceesxkq.edgeone.cool`（要控制台给的临时验证参数）。自定义域名 `app.tibi.ferecord.com` 已在控制台加上，CNAME 目标 `app.tibi.ferecord.com.pages.dnsoe5.com`；GoDaddy 已加 `app.tibi` CNAME（TTL 1 小时），权威 DNS 查得到，控制台显示"已生效"。免费证书（自动验证，RSA 2048，到 2027-02-04，到期前 15 天自动续）已部署；强制 HTTPS 已开（301），`http://app.tibi.ferecord.com/` 返回 301 到 https。开发这台机器的网络经过 Cloudflare Gateway，拦了这个新域名，HTTPS 页面没能从本机打开验证，要换网络（如手机流量）看。仓库密钥 `EDGEONE_API_TOKEN` 已存（Makers 控制台的 Token「tibi webapp deploy」，到 2027-11-06），但存的时候剪贴板里可能不是 Token，第一次自动部署失败的话重存。

线上验证（默认域名）：页面、Worker、首次引导正常，词典 manifest 和 16.5 MB 的 `dict-lite-*.db.gz` 返回 200（一年缓存），导入后 OPFS 用了约 38 MB；中转拦内网地址、跟重定向（`http://paulgraham.com` → https）、转 RSS（The Verge）、api.github.com、DeepSeek 都正常。**境外站点不稳**：函数跑在大陆节点上，news.ycombinator.com、bbc.com 回源超时（EdgeOne 自己的 504 页面），github.com 首页 545（"Error return from script"）。要么接受（提示用户换文字粘贴），要么以后把中转单独放一个海外区域的项目。默认域名会被平台注入一段统计脚本，被我们的 CSP 拦掉，控制台里有两条报错，不影响使用。

## 8. 分期

- **P0**：OPFS 数据库、精简词典、Web 平台（导入网址 / 文字 / 文件 / 图片、阅读、查词、复习、对话、朗读）、中转、密钥、单标签页锁、构建和部署。
- **P1**：PWA（manifest、离线缓存静态资源）、备份导出 / 导入、WebDAV 同步的界面打磨、Safari 存储被清的提醒。
- **P2**：Chromium 上用 File System Access API 做"同步文件夹"；按使用情况决定要不要完整词典（HTTP Range 按页读）。

## 9. 风险

- 中转被滥用：只挡浏览器跨站，挡不住脚本。量大了加频率限制（EdgeOne KV）或改成要用户在设置里点"允许"。
- EdgeOne 边缘函数 CPU 200 ms（不含等待）、请求体 1 MB；fetch 超时和响应大小文档没写，长的模型回答要实测。
- 中转在大陆节点上，部分境外网站抓不到（§7 实测）。
- 浏览器清存储会丢数据：P1 做提醒和导出。
