# 06 调研：口碑好的 iOS 英语学习与阅读产品，对手机版的参考

> 2026-10-31。目的：手机版（D8，`prototypes/mobile.html`）从"桌面的缩小版"改成"像 iOS 应用"。调研对象分四类：阅读学语言（LingQ、Kindle、Readwise Reader）、背词（墨墨、不背单词、扇贝、AnkiMobile）、习惯养成（多邻国的小组件），开源项目（Readest、LangReader、LWT）。结论落成决策 J1–J8，已在手机版原型里实现，写进 `00-concept-design.md` §3.13 与 `DECISIONS.md`。

## 1. 各家值得学的一点

| 产品 | 值得学的 | 不学的 |
|---|---|---|
| **LingQ**（阅读学语言里最常被拿来比较的，iOS 有 App） | 生词蓝色、学习中黄色、已知不标，和我们一致；点词出卡片，数字档位改熟练度，打勾直接标已知 | 默认"翻页即把剩下的蓝词标为已知"，用户反映误标且撤销困难，社区建议关掉 |
| **LangReader**（开源，模仿 LingQ 的 iPhone 网页版） | 同样"翻页标已知"，但每次都给**撤销**按钮 | — |
| **Kindle** | 生词上方显示简短释义（Word Wise），查过的词进生词表再出卡片（Vocabulary Builder） | 这些功能主要在 Kindle 硬件上，iOS 应用支持不完整 |
| **Readwise Reader** | 从 Safari 分享进来就收进书库；阅读时工具栏让位给正文；AI（Ghostreader）问答就在阅读器里 | 功能很多，第三方评测认为偏"重度用户" |
| **Readest**（开源电子书阅读器，**Tauri 2 写的**，iOS 4.5 星左右） | 证明 Tauri 2 的 iOS 阅读器能做好：查词、整页翻译、生词上方提示（Word Lens）、跨端同步进度；可导入 MDict / StarDict 词典 | AGPL 许可，不能直接拿代码 |
| **墨墨 / 扇贝 / 不背单词** | 评测共识：复习算法与数据可视化是墨墨的长处；不背单词的"真实语境例句"最受好评 | 界面信息多、免费额度限制，评测普遍认为"枯燥"或"上手要适应" |
| **AnkiMobile** | 允许把显示答案和评分绑到轻点或滑动上，方便单手 | 论坛反映滑动只有一半时候被识别，还要从屏幕边缘开始滑；四个评分按钮单手难点 |
| **多邻国小组件** | 小组件只放一件事：今天做了没有，加连续天数；吉祥物随状态变表情；锁屏也有一个小版本 | 用"惊慌的吉祥物"制造愧疚感；2026 年 1 月还因在灵动岛放广告被批评，苹果规定实时活动不能放推广 |

苹果 iOS 26 的设计变化也有关：标签栏变成悬浮的胶囊、滚动时收窄；底部面板默认半屏，往上拉变全屏（sheet detents）。

## 2. 对照现在的手机版

| 问题 | 原因 |
|---|---|
| 复习还是"显示答案 + 自评四档"，按钮在屏幕中部 | 桌面端 G1–G8（系统评分、选义、重练）没有同步到手机；四个评分按钮单手难点，AnkiMobile 的用户也在抱怨 |
| "阅读"占了一个标签，首页又有"继续阅读"和"书架"两组重复列表 | 苹果图书的做法是标签栏放书库，读书时全屏打开 |
| 右下角浮动的 Tibi 按钮压住列表 | 输入框、阅读器工具栏、词卡里已经有 Tibi 入口 |
| 阅读器的顶栏和工具栏一直显示，"读完了"放在工具栏里 | iOS 阅读器（苹果图书、Readwise、Readest）都让工具栏随滚动收起 |
| 只能在应用里粘贴网址 | 手机上最自然的导入是在 Safari 里点"分享"（对应桌面的剪藏插件 R4） |
| 没有小组件和提醒 | 复习这件事每天要被想起来，小组件是最不打扰的提醒 |
| 字体还是 Geist + 普惠体 | 桌面端已改为系统字体（精修层），手机端没跟上 |

## 3. 决策（J 组：手机端）

| 编号 | 决定 | 依据 |
|---|---|---|
| **J1** | 标签栏改为"今天 / 书架 / 复习 / 我"，悬浮胶囊样式；阅读器从卡片进入、全屏，不占标签；去掉浮动 Tibi 按钮 | 苹果图书；iOS 26 标签栏 |
| **J2** | "今天"只放一张"继续读"大卡、一张复习卡、输入框（带系统粘贴按钮）、两条建议、两个小数字；书架列表移到"书架"标签 | R13（继续阅读权重不够）；去重复 |
| **J3** | 导入有三条路：Safari 分享扩展（只发网址，进书架前不抓取，与 R4 一致）、"书架"右上角"+"（粘贴、从"文件"选、拍书页）、首页输入框；粘贴用系统粘贴控件，不弹剪贴板权限提示 | Readwise Reader；R4 |
| **J4** | 阅读器向下滚动时收起顶栏和工具栏，向上滚动或轻点正文空白处再出现；"读完了"挪到文末，"把剩下的生词标为已知"必须带撤销，不做"翻页即标已知" | 苹果图书、Readest；LingQ 的教训 |
| **J5** | 底部面板两档：词卡默认半屏，上拉全屏看遇到过的句子和复习数据；点开生词即进"见过"并建卡，面板里给"其实认识"（R5） | iOS sheet detents；R5 |
| **J6** | 复习按桌面端 G1–G8 做：题目在上，选项、"继续"、评分全在下半屏；左上角关闭等于"稍后继续"；不做滑动评分；答对轻震、答错两下震动 | AnkiMobile 的滑动问题；G1–G8 |
| **J7** | 主屏小组件（小：待复习数 + 连续天数 + 狐狸；中：继续读 + 进度）与锁屏小组件（今日分钟圆环、复习数）；狐狸只有"平静 / 开心"两种状态，不做惊慌；不用实时活动 | 多邻国小组件；苹果对实时活动的规定 |
| **J8** | 每日提醒只有一条，时间可选（关闭 / 早 / 中 / 晚），内容是当天待复习数，不写催促的话 | 文案规则（03 §9） |

## 4. 实现要点（M7）

- **Tauri 2 的 iOS 能力**：Readest 已证明阅读器可行。分享扩展有社区插件 `tauri-plugin-mobile-sharetarget`：在 Xcode 里加一个 Share Extension 和 App Group，扩展把网址交给 Tauri 的深链插件，正好接上 R4 的 `tibi://import?url=…`。小组件没有现成插件，需要原生 WidgetKit 扩展读 App Group 里的一份快照（待复习数、连续天数、继续读的文章）。
- **系统控件**：粘贴用 UIPasteControl；震动用 UIImpactFeedbackGenerator；底部面板高度对应 sheet 的 medium / large 两档。这些在网页原型里只能模拟。
- **数据**：小组件快照由主应用在每次复习、阅读后写入，不单独开接口；R11（手机端 Core 与同步）仍待决定。

## 参考

- LingQ：[iOS 使用说明](https://www.lingq.com/en/ios-app-support/)、[设置指南（翻页标已知）](https://lingtuitive.com/blog/ultimate-lingq-settings)、[论坛：误标几百个已知词](https://forum.lingq.com/t/accidently-marked-hundreds-of-words-as-known-this-cant-be-undone/149976)；[LangReader（开源）](https://github.com/stephenedgerton/LangReader)
- 阅读类综述：[ling-app 2026](https://ling-app.com/blog/language-apps-with-reading-materials/)、[Simply Fluent 2026](https://www.simplyfluent.com/blog/best-reading-apps-language-learning-2026/)、[oqou 2026](https://oqou.app/blog/best-apps-learn-language-by-reading)
- Readwise Reader：[2026 年 8 月更新](https://readwise.io/reader/update-aug2026)、[App Store](https://apps.apple.com/us/app/id1567599761?l=en-us)
- Readest：[It's FOSS 介绍](https://news.itsfoss.com/readest-app)、[与 Foliate 对比](https://readest.com/compare/readest-vs-foliate)、[App Store](https://apps.apple.com/app/id6738622779)
- Kindle：[FluentU：用 Kindle 学英语](https://www.fluentu.com/blog/english/learn-english-kindle)、[Vocabulary Builder 用法](https://nerdschalk.com/how-to-enable-and-use-kindle-vocabulary-builder/)
- 背词类：[少数派：6 个背单词 App](https://ios.sspai.com/post/87587)、[知乎：2026 单词软件测评](https://zhuanlan.zhihu.com/p/1996891613671207142)、[人人都是产品经理：四款对比](https://www.woshipm.com/evaluating/4425622.html)
- AnkiMobile：[官方文档：学习工具与手势](https://docs.ankiweb.net/ankimobile/study-tools)、[论坛：滑动只识别一半](https://forums.ankiweb.net/t/swipes-left-right-are-registered-only-half-of-the-time/20381)、[论坛：单手轻点评分](https://forums.ankiweb.net/t/feature-request-tap-anywhere-for-show-answer-left-right-taps-for-again-good/68831)
- 多邻国小组件：[官方博客](https://blog.duolingo.com/widget-feature)；[MacRumors：灵动岛广告](https://www.macrumors.com/2026/01/02/duolingo-dynamic-island-ad/)
- iOS 26：[WWDC25 SwiftUI 新设计](https://developer.apple.com/videos/play/wwdc2025/323/)、[Liquid Glass 面板](https://nilcoalescing.com/blog/PresentingLiquidGlassSheetsInSwiftUI/)
- Tauri 分享扩展：[tauri-plugin-mobile-sharetarget](https://docs.rs/crate/tauri-plugin-mobile-sharetarget/latest)
