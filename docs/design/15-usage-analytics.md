# Tibi 使用统计

## 目标

用同一套事件回答三个问题：有多少安装和浏览器在用 Tibi，使用集中在哪个端，导入、阅读、查词、复习和电台各有多少人用。数据来自主动开启统计的安装和浏览器，不能据此估算全量用户、注册人数或跨设备唯一人数。

## 接入与同意

- 继续使用 Mixpanel 官方浏览器 SDK 2.86.0 的 core loader 和现有 US 项目 4084746。网页和 Tauri 从各自应用包按需加载 SDK，走同一个采集域名 `https://api-js.mixpanel.com`。
- 首次引导提供可选开关。电脑和宽屏 Web 随时可在「设置 → 数据」调整，手机 App 和窄屏 Web 可在「我」调整。开关默认关闭，继续引导与使用功能独立于开关。
- 已有用户沿用当前安装或浏览器的 `tibi.analytics.v1` 决定。开启时 SDK 在本地生成随机标识，后续启动沿用。撤回立即停止新采集、清理待发队列与标识，并同步至同源窗口。重新同意使用新标识。已经发出的事件仍依 Mixpanel 的数据保留设置处理。
- DNT 或 GPC 启用时暂停上报。选择与标识保存在当前 WebView 或浏览器存储，与学习数据的同步、备份各自独立。Mixpanel 会看到连接 IP 和常规请求头。IP 地理解析关闭，事件代理字段设为固定值 `Tibi`，避免报表保留实际浏览器或 WebView 的 User-Agent。见 [Mixpanel 采集端默认属性](https://docs.mixpanel.com/docs/data-structure/property-reference/default-properties#event-properties)。
- 正式 Web 域名及 Tauri 正式构建标记 `production`。本机 Vite 服务和使用开发模式前端的隔离 Tauri 验收包需显式使用 `?analytics-test=1` 才发送 `development` 事件。普通开发环境和 Web 预览域名关闭上报。

## 事件表

| 事件 | 触发点 | 计数边界 |
| --- | --- | --- |
| `app_opened` | 主界面首次进入前台，或后台至少 30 分钟后回到前台 | 托盘独立查词计入查词；同一次前台停留只记一次 |
| `import_succeeded` | 主界面收到成功且新建文档的 `import.done` | 包含首次导入内置示例；一个导入完成事件记一次 |
| `reader_opened` | 阅读器加载当前文档的正文 | 一次阅读器访问记一次；切章、进度保存和内容刷新沿用这次访问 |
| `word_lookup_used` | 词卡或词典展示词条、词本记录或已有的语境释义 | `lookup_surface` 取 `reader`、`dictionary` 或 `tray`；词典允许计算输入联想主动展示的首条结果，查看状态、建议列表及词条后台刷新不计 |
| `review_answered` | Core 成功接受一次复习作答 | 包含同一轮内的重练与「再练错词」，失败或重复提交由 Core 拒绝 |
| `review_completed` | 用户推进最后一步，Core 确认结束一轮 | 由实际复习界面上报，启动时恢复旧队列的游标修复不计 |
| `podcast_played` | 电台播放器收到当前单集首次 `playing` | 每次将一集装入播放器后首次实际播放记一次；暂停后继续、缓冲恢复和句间循环沿用这次播放 |

公共属性为 `product=tibi`、`site=app`、`platform`（`desktop`、`mobile`、`web`）、`environment`、界面 `locale`、`app_version` 和 `schema_version=2`。窄屏 Web 仍为 `web`。事件属性限于表中的枚举，及 Mixpanel 所需的 token、随机标识、时间、去重标识和 SDK 版本字段。时间在功能事件发生时记录，漏斗按该时间排序。学习内容、业务标识、URL、设备详情和密钥留在原有功能的数据处理路径。

## 看板

在 [Tibi · 使用统计](https://mixpanel.com/project/4084746/view/4581503/app/boards#id=11672898) 查看过去 30 天，用 `product=tibi`、`site=app`、`environment=production` 限定数据。官网访问可在 [ferecord 网站与产品分析](https://mixpanel.com/project/4084746/view/4581503/app/boards#id=11657077) 查看。切换版本后，用 `schema_version=2` 查看新口径，尤其是启动和查词。

| 要回答的问题 | 报表配置 |
| --- | --- |
| App 与 Web 有多少活跃使用 | 日活报表按 `platform` 拆分，对全部使用事件按日取 Uniques。需要周活时在 Insights 的用户唯一计数里选择 WAU |
| 哪些功能常用 | 功能使用次数按事件名和 `platform` 拆分，覆盖导入、阅读、查词、复习作答、复习完成和播放。需要功能覆盖安装数时将计算改为 Uniques |
| 用户能否开始阅读并查词 | `app_opened → reader_opened → word_lookup_used`，起点限定正式应用事件，第三步限定 `lookup_surface=reader`，窗口 1 天 |
| 用户会不会回来 | 以 `app_opened` 为起点，观察同一安装或浏览器再次 `app_opened` 的留存曲线，按日查看第 1 天和第 7 天 |

## 设计走查

1. **事件触发。** Tauri 把 Core 事件广播给主窗口和托盘。启动由主入口负责，导入由主界面监听，托盘只把查词成功信号交给主窗口。阅读按当前正文就绪计，复习从 Core 的实际完成结果计，电台从媒体播放成功计。
2. **数据最小化。** SDK 的功能标志、自动事件、营销属性、地理解析、远程设置、回放和用户画像均关闭或未接入。发送白名单在进入离线队列前应用，发送时再次检查同意。SDK 恢复旧队列时会跳过发送钩子，升级首次清理旧队列以应用新边界。
3. **验收。** 使用真实 SDK 拦截采集请求，检查默认关闭、平台分类、事件边界、payload 白名单、短时离线、撤回与重新同意。在 Mixpanel 用开发事件验证接收和筛选。Web、原生构建、实际发布分别记录。

## 2026-11-26 验收记录

- Node 22 下全仓类型检查通过，测试 426 项通过、1 项跳过。中英文键检查通过。正式 Web 包、macOS 主界面和 Tauri 移动预览包构建通过。移动构建还修复了深链命令的 `State` 导入范围。
- Chromium 走通宽屏首次引导、导入示例、阅读、词卡、词典、复习完成、音频播放与撤回。Chromium 和 WebKit 均验证窄屏的同意、导入、阅读与撤回，并通过真实 SDK 的旧队列清理、同源撤回、标识轮换和离线重载补发检查。
- 用正式 Web 产物在隔离浏览器验证官方 HTTPS 域名标记为 `production`，预览域名即使带验收参数也关闭统计。请求在浏览器内拦截。
- Mixpanel 接收了覆盖七种事件的开发样例，返回 HTTP 200 和 `status=1`。在事件页确认 macOS 主窗口的 `desktop` 启动、导入、阅读和词典查词，也确认 Tauri 移动预览的 `mobile` 启动、导入和阅读。两边的事件代理字段均为 `Tibi`，验收后已撤回统计同意。
- macOS 的独立临时签名包中，Bun sidecar 单独调用 RPC 通过，由 Tauri 启动时退出。功能验收随后使用同一套源码生成的 Node Core。托盘查词做了事件路由代码核对，未单独确认线上接收。
- 看板四份报表已创建并验证配置，过去 30 天的正式筛选当前为空。v2 处于本地实现与验收阶段，手机客户端实机、正式 Web 部署和原生发布留待对应发行验证。既有 v1 接入与 Web 发布记录见 [ferecord 统计设计](https://github.com/tumars/ferecord/blob/main/docs/analytics-design.md)。
