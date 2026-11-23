# Tibi 托管模型与应用内额度

设计草案 · 2026-11-21

Mac App Store 版由 Tibi 付费调用模型，用户通过 Apple 消耗型内购获取 Tibi AI 点数。先用 DeepSeek Flash 直连验证，腾讯云部署网关。生产模型取决于供应商对终端用户内容的处理条件。首版用一个模型和一档点数包，覆盖语境释义、问答、翻译、总结、批改和学习洞察。阅读、导入、离线查词、生词本和复习继续本地可用。账号只用于云端 AI 和余额，官网版继续沿用现有模型设置。 [本次 App Review 审核记录](https://appstoreconnect.apple.com/apps/6831512333/distribution/reviewsubmissions/details/484ee6f1-fc40-4660-8899-ce7dea336245) · [原产品设计](00-concept-design.md)

## 个人开发者可用的服务

| 路径 | 个人账户与费用 | Tibi 上线判断 |
| --- | --- | --- |
| DeepSeek 开放平台直连 | 第 2.2 条列出个人和企业认证。第 6 章规定预充值、按量扣费，充值后可按平台流程申请发票。 | 第 1.1 条明确允许集成到下游应用、向终端用户提供服务。Tibi 服务端持有密钥。公开协议未单列 App Store 内购这一收费方式，生产前确认个人主体、收费模式和支持地区。 [开放平台协议](https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html) |
| 腾讯云 Lighthouse 部署网关，模型走 DeepSeek | 腾讯云支持个人实名认证。Lighthouse 提供计算、磁盘和带宽。 | 可作为托管底座，模型许可和数据规则按实际调用的 DeepSeek 服务。可评估复用现有实例，先核对地域、可用资源和交易账本隔离。 [个人实名认证](https://cloud.tencent.com/document/product/378/10495) · [Lighthouse](https://cloud.tencent.com/product/lighthouse) |
| 腾讯云 TokenHub 在线推理按量 API | 通用开通文档要求腾讯云账号和实名，控制台可按模型启用后付费。具体个人账号、模型和地区的可开通状态待验证。 | 条款对二次封装、中转和向第三方提供服务能力设限，同时允许符合产品规则及腾讯云书面要求的自有应用集成。上线前留存针对个人主体、付费学习应用、模型和地区的书面答复。 [开通指南](https://cloud.tencent.com/document/product/1823/130058) · [TokenHub 条款](https://cloud.tencent.com/document/product/301/129852) |
| 腾讯云 Token Plan 个人包月 | 面向个人的交互式 AI 工具订阅。 | 明确禁止用作自定义应用后端及非交互式批量调用。 [个人套餐规范](https://cloud.tencent.com/document/product/1823/130060) |

**DeepSeek 先验证，生产前确认不训练条款。** 11 月 11 日生效的 DeepSeek 开放平台隐私政策第七章说明，除另有书面约定外，API 输入和输出经加密、去标识化处理后可能用于训练和改进。中国大陆运营所收集和产生的个人信息按该政策存储在中国大陆，政策没有公布统一的 API 内容固定留存期。先用合成或获授权的公开材料跑通功能。付费开放前确认输入输出不用于训练、数据处理区域、内容留存和删除支持。 [DeepSeek 开放平台隐私政策](https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-privacy-policy.html)

如果 DeepSeek 个人账号拿不到合适的数据条款，评估 TokenHub 的腾讯自研混元。第 2.17 条承诺腾讯云自身不用输入训练或改进自家模型，输出处理、留存和地区仍需确认。第三方部署模型适用实际供应商的数据规则。原厂直供 DeepSeek 要单独核实接收方和数据用途。用同一组英语文本比较混元和 DeepSeek 的语境释义、翻译、结构化结果、工具调用和首字延迟。 [TokenHub 条款](https://cloud.tencent.com/document/product/301/129852) · [第三方模型说明](https://cloud.tencent.com/document/product/301/136530) · [混元调用指南](https://cloud.tencent.com/document/product/1823/132252)

厂商工单可以沿用同一业务描述。个人开发者运营 Mac 英语阅读应用，用户在应用内购买 Tibi AI 点数，服务端为释义、问答、翻译、总结及批改调用指定模型。请确认该模型能否由个人账号开通并用于这个收费场景、允许的地区、峰值限额、发票、终端用户数据处理地、输入输出留存和训练条款、删除支持及可提供的备案材料。

## 用户流程

1. 用户可以直接阅读、查词和复习。首次主动使用 AI 时，说明接收方、发送字段、用途、区域和训练规则，取得明确许可后才发送。用户撤回即停止新请求，接收方或用途变化时重新征求许可。
2. 云端身份使用通过 Apple 登录，服务端按账户发一次受限试用点数，并设全局试用预算。先让用户翻译一段、查一次语境释义或问一个问题。会扣点的导入分析默认等用户发起。
3. 点数面板显示余额、用量示例、最近消耗和 StoreKit 的当地价格。首版只做一档可重复购买的消耗型商品，购买的点数长期有效。长文显示本次最多用多少点，余额不足时保留选区及任务入口。 [Apple 审核指南 §3.1.1、§5.1](https://developer.apple.com/app-store/review/guidelines/)
4. 同一 Tibi 账号在另一台 Mac 登录后读取服务器余额。文章、阅读历史和学习记录继续留在本地及用户自选的同步路径。设置提供云端账号删除和撤回 AI 授权。删除前提示现有余额和购买支持入口，用户可以继续删除。服务端撤销 Apple 凭证和 Tibi 会话，清理账号数据，隔离留存法定义务、退款和交易去重所需的最小记录。 [Apple 账户删除与令牌撤销](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)

## 购买、推理与结算

**身份。** 给商店版 App ID 和描述文件配置 Sign in with Apple，原生桥接走 AuthenticationServices。服务端校验 Apple 身份令牌、受众及 nonce，按 Apple 用户标识关联 Tibi 账户，只申请登录所需数据。客户端会话凭证存钥匙串，用户换机后用同一 Apple 身份登录来取回余额。签名构建要先验证原生登录及审核访问。 [Apple 登录配置](https://developer.apple.com/documentation/xcode/configuring-sign-in-with-apple)

**购买。** Tauri 的商店原生桥接用 StoreKit 2 加载商品、发起购买、监听交易更新，启动时补交未完成交易。购买时传入当前 Tibi 账号对应的稳定 UUID appAccountToken。服务端用 Apple Server Library 验签，检查 Bundle ID、生产 App Apple ID、环境、商品、数量、账号绑定和撤销状态。按环境及 transactionId 唯一入账，余额更新和流水同事务提交。客户端收到入账或已入账确认后再 finish。待批准、取消和断网分别显示状态，切错账号时指引回到购买账号。重装和跨设备余额以 Tibi 服务端为准。 [StoreKit 交易](https://developer.apple.com/documentation/storekit/transaction) · [Apple Server Library](https://developer.apple.com/documentation/AppStoreServerAPI/simplifying-your-implementation-by-using-the-app-store-server-library)

**模型。** 一项 HTTPS 服务加一个事务账本。低流量试点可用单实例 SQLite WAL、加密异机备份和恢复演练。供应商 Key 只存在服务端。网关兼容 OpenAI Chat Completions，复用现有 resolveModel、kernel.complete 和 PiEngine。商店版 Core 只拿短期 Tibi 凭证。服务端限制模型、输入字节和 token、输出上限、账户并发、速率及全局预算。客户端继续执行本地工具，工具所需的最小上下文才发给模型。商店构建的配置、导入和模型选择只开放托管入口。 [模型解析](../../packages/core/src/kernel/agent.ts) · [一次性调用](../../packages/core/src/kernel/complete.ts) · [PiEngine](../../packages/core-node/src/engine-pi.ts)

**扣点。** 服务端发出请求前预留点数，依据输入估算、输出上限和费率版本计算。一个长文或多轮任务共享一个预留上限，所有分段和工具子请求都用该上限，避免每段或每轮分别取整。按上游的可信用量累加已交付子请求，结束后扣点并释放余量。流式请求开启末尾用量块。取消向上游传播，失败和缺失可信用量的子请求释放预留，已交付子请求照常结算。每个子请求用唯一 ID 去重，已接收的请求重试时查询已有状态。超时回收冻结点数，晚到结果不再次扣点。Tibi 承担失败或中断后无法结算的上游用量，并定期核对 API 账单。 [DeepSeek Chat Completions](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)

**退款。** Apple Server Notifications V2 验签后持久化，按事件及交易幂等更新，补查漏收或乱序通知。每笔购买记录一批点数，按先购先用分配消耗。退款时按 Apple 确认的退款数量或比例撤销对应未用点数，已用部分首版计作退款损失，重复退款走风控。退款被撤销后补发实际收回的数额。退款、扣点和入账需要覆盖并发及退款先于首次入账的情况。Apple 请求消费信息时，取得有效同意后再提交。 [Apple 退款通知](https://developer.apple.com/documentation/storekit/handling-refund-notifications) · [通知类型](https://developer.apple.com/documentation/AppStoreServerNotifications/notificationType) · [消费信息](https://developer.apple.com/documentation/appstoreserverapi/send-consumption-information)

**数据和运营。** 仅在内存处理请求正文。网关日志保留请求 ID、模型、用量、时间和状态，关闭异常上报和代理的正文采集。隔离沙盒与生产交易、密钥和数据库。预算或上游余额异常时暂停新购，保留余额查询与支持入口。上线前明确服务中断或终止时存量点数的继续交付、迁移或退款方式。

## 点数和成本

人民币刊例价，单位为每百万 token。DeepSeek V4.1 Flash 直连与 TokenHub 原厂直供的表列单价相同，实际账单取各自的账户及峰谷规则。 [DeepSeek 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) · [腾讯云模型价格](https://cloud.tencent.com/document/product/1823/130055)

| 模型 | 未命中输入 | 缓存命中输入 | 输出 |
| --- | ---: | ---: | ---: |
| DeepSeek V4.1 Flash，峰时 | ¥2 | ¥0.04 | ¥8 |
| DeepSeek V4.1 Flash，空闲 | ¥1 | ¥0.02 | ¥4 |
| DeepSeek V4 Pro 直连，峰时 | ¥9 | ¥0.30 | ¥27 |
| 腾讯混元 Hy4 flash | ¥0.50 | ¥0.02 | ¥2 |

首版测算按 Flash 峰时和零缓存，输出按输入四倍加权。每 2,500 加权 token 为 1 点，一个任务把已交付的子请求用量合计后向上取整。每点推理成本上限约 ¥0.005，前提是刊例单价不变且没有另收费工具。缓存与峰谷优惠留作运营缓冲。

| 场景 | 输入 / 输出 token 假设 | 点数 | 峰时无缓存成本 |
| --- | ---: | ---: | ---: |
| 即时语境释义 | 1,200 / 150 | 1 | ¥0.0036 |
| 结合文章问答 | 4,000 / 500 | 3 | ¥0.012 |
| 长文翻译 | 18,000 / 3,500 | 13 | ¥0.064 |
| 三轮工具问答，累计 | 30,000 / 3,000 | 17 | ¥0.084 |

**按 ¥12 等值 / 500 点测算。** 一包用完的模型成本最多约 ¥2.50，相当于约 500 次上述短释义、166 次文章问答或 38 次长文翻译。按 30% 和符合 Small Business Program 条件后的 15% 佣金测算，扣佣后为 ¥8.40 / ¥10.20，再扣推理后约剩 ¥5.90 / ¥7.70，用来覆盖试用、退款、运维和税费。税基、分区政策、实收和外汇以实际报表为准。点数包规格和价格待样本验证。 [Apple 付费协议](https://developer.apple.com/support/terms/) · [Small Business Program](https://developer.apple.com/app-store/small-business-program/)

Lighthouse 海外 Linux 2 核 2 GB 入门套餐表列 ¥30/月，中国香港对应套餐表列 ¥38/月。试点按每月 ¥60 固定开销测算，包含假设的备份和监控费用。覆盖固定开销约需每月 11 包或 8 包，分别对应 30% 或 15% 佣金，另计试用、退款、税费和人工。选区前实测网关到 Apple 和模型的连通、时延、限额和数据路径。用 Tibi 样本拿到各功能用量的中位数和 P95，包含长上下文、多轮工具及失败消耗，再确定正式商品和费率。 [Lighthouse 价格](https://cloud.tencent.com/document/product/1207/73452)

## 进入提审的条件

1. 确定生产模型和销售地区。中国大陆商店单独确认 App Store Connect 所需资料、适用 ICP／APP 备案、调用已备案模型的应用或功能登记、生成内容标识及个人主体资格。腾讯云支持符合条件的个人备案，付费 AI 产品的主体资质仍需向属地确认。其他地区核对实际网关、模型处理地及跨境要求。 [Apple 中国大陆发行](https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-compliance-information/) · [腾讯云备案](https://cloud.tencent.com/document/product/243/18908) · [网信办备案与应用登记公告](https://www.cac.gov.cn/2026-09/14/c_1791136833136332.htm)
2. 核验个人 Apple Developer 账号的 Paid Apps Agreement、税务和银行信息状态。根据资格申请 Small Business Program。在 App Store Connect 配置消耗型商品、地区定价、描述和审核截图。首个消耗型内购随新版本提交。更新隐私政策、商店隐私问卷、服务条款和审核备注。 [内购配置](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases/) · [首个内购提交](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase/) · [Apple 个人开发者注册](https://developer.apple.com/help/account/membership/program-enrollment/)
3. 先用 Xcode StoreKit 测试客户端，再用签名的 macOS 商店构建和 Apple Sandbox 验证真实交易验签与入账。覆盖取消、待批准、断网后补交、重复通知、并发扣点、限流、流式中断、退款和撤销、另一台 Mac 登录、拒绝分享、删除账号和离线阅读。在最低支持版本 macOS 13 上验证登录和购买。
4. 审核备注写清示例文章、AI 同意、试用、内购和到账的操作路径，提供可用的审核访问方式并保证审核期间模型可用。说明商店构建由 Tibi 提供模型，额度通过 Apple IAP 交付。 [Apple 审核完整性](https://developer.apple.com/app-store/review/guidelines/#app-completeness)
