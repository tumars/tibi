# 06 调研：口碑好的 iOS 英语学习与阅读产品，对手机版的参考

> 2026-10-31。目的：手机版（D8，`prototypes/mobile.html`）从"桌面的缩小版"改成"像 iOS 应用"。调研对象分四类：阅读学语言（LingQ、Kindle、Readwise Reader）、背词（墨墨、不背单词、扇贝、AnkiMobile）、习惯养成（多邻国的小组件），开源项目（Readest、LangReader、LWT）。结论落成决策 J1–J8（J9 是之后补的首页对话入口，见 §5），已在手机版原型里实现，写进 `00-concept-design.md` §3.13 与 `DECISIONS.md`。

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
| **J2** | "今天"只放一张"继续读"大卡、一张复习卡、输入框（带系统粘贴按钮）、两条建议、一行今日进度；书架列表移到"书架"标签 | R13（继续阅读权重不够）；去重复 |
| **J3** | 导入有三条路：Safari 分享扩展（只发网址，进书架前不抓取，与 R4 一致）、"书架"右上角"+"（粘贴、从"文件"选、拍书页）、首页输入框；粘贴用系统粘贴控件，不弹剪贴板权限提示 | Readwise Reader；R4 |
| **J4** | 阅读器向下滚动时收起顶栏和工具栏，向上滚动或轻点正文空白处再出现；"读完了"挪到文末，"把剩下的生词标为已知"必须带撤销，不做"翻页即标已知" | 苹果图书、Readest；LingQ 的教训 |
| **J5** | 底部面板两档：词卡默认半屏，上拉全屏看遇到过的句子和复习数据；点开生词即进"见过"并建卡，面板里给"其实认识"（R5） | iOS sheet detents；R5 |
| **J6** | 复习按桌面端 G1–G8 做：题目在上，选项、"继续"、评分全在下半屏；左上角关闭等于"稍后继续"；不做滑动评分；答对轻震、答错两下震动 | AnkiMobile 的滑动问题；G1–G8 |
| **J7** | 主屏小组件（小：待复习数 + 连续天数 + 狐狸；中：继续读 + 进度）与锁屏小组件（今日分钟圆环、复习数）；狐狸只有"平静 / 开心"两种状态，不做惊慌；不用实时活动 | 多邻国小组件；苹果对实时活动的规定 |
| **J8** | 每日提醒只有一条，时间可选（关闭 / 早 / 中 / 晚），内容是当天待复习数，不写催促的话 | 文案规则（03 §9） |
| **J9** | 首页去掉顶栏；标签栏最左边的圆形狐狸就是"今天"；输入条常驻在标签栏上方，对话接在首页卡片下面（见 §5） | 支付宝 AI 版、蚂蚁财富；用户反馈 |

## 4. 实现要点（M7）

- **Tauri 2 的 iOS 能力**：Readest 已证明阅读器可行。分享扩展有社区插件 `tauri-plugin-mobile-sharetarget`：在 Xcode 里加一个 Share Extension 和 App Group，扩展把网址交给 Tauri 的深链插件，正好接上 R4 的 `tibi://import?url=…`。小组件没有现成插件，需要原生 WidgetKit 扩展读 App Group 里的一份快照（待复习数、连续天数、继续读的文章）。
- **系统控件**：粘贴用 UIPasteControl；震动用 UIImpactFeedbackGenerator；底部面板高度对应 sheet 的 medium / large 两档。这些在网页原型里只能模拟。
- **数据**：小组件快照由主应用在每次复习、阅读后写入，不单独开接口；R11（手机端 Core 与同步）仍待决定。

## 5. 首页的对话入口（J9）

用户反馈：首页的顶栏（logo + 名字 + 深浅色）没有用；输入框夹在卡片和建议中间，不显眼。给了两个参照：

- **A. 收进左下角**（支付宝 2026 年 6 月的 AI 版"阿宝"）：底栏左边多一个圆形头像，点它或横滑进入单独的对话页；首页本身不变。适合首页是几十个服务入口的应用，AI 只是其中一种用法。
- **B. 对话和首页合在一起**（蚂蚁财富）：底栏最左边的圆形吉祥物就是首页；首页是几张卡片，底部常驻输入条，问的东西直接在这一页回答。适合"问"本身就是主要用法的应用。

| | A 收进左下角 | B 和首页合在一起 |
|---|---|---|
| 一眼看得到吗 | 只看到一个头像，要点进去才有输入框 | 输入条一直在拇指够得到的位置 |
| 从别的标签进入 | 一次点击 | 一次点击（点狐狸回首页），再点一次光标进输入框 |
| 首页内容 | 不受影响 | 卡片在上，对话往下接，要定好"对话留多久" |
| 导入 | 要么另找入口，要么在对话页里粘贴 | 首页输入条本来就兼做导入，不用改 |
| 阅读器、复习 | 都是全屏、没有标签栏，左下角按钮在那里本来就看不到 | 一样；这两处继续用各自的 Tibi 入口（底部面板） |
| 界面元素 | 多一个页面（对话页） | 不多页面 |

**选 B，外形借 A**：左下角的圆形狐狸（两张参考图都把圆形吉祥物放在这里）就是"今天"标签，首页即对话。理由：

1. Tibi 的首页本来就很短（继续读、复习、两个数字），不需要像支付宝那样给 AI 另开一页。
2. 首页输入条要兼做导入，放在首页最自然；单独的对话页还要再放一个导入入口。
3. A 的好处是"任何页面都能一下进对话"，但手机端两个最常用的页面（阅读器、复习）都是全屏、不显示标签栏，左下角按钮在那里本来就看不到；它们已经有跟着当前文章或单词走的 Tibi 入口。
4. 狐狸常驻在标签栏，状态（听、想、开心、睡）就有了固定位置，不用在首页另放一只。

**对话留多久**：当天的对话接在首页卡片下面；第二天首页换新的一页，以前的在"我 › 对话记录"。"今天"这个名字正好对应。

公开资料里没有找到对比这两种入口的可用性研究或 A/B 数据，上面的判断来自产品形态分析。

## 6. 看起来像网页而不像 iOS 应用（J10）

用户反馈手机版"像 web 应用"，参考支小宝、蚂小财。对照后，网页感主要来自这几处：

| 网页感的来源 | 改成 |
|---|---|
| 暖灰底 + 每张卡片一圈细描边 | iOS 系统分组背景 `#f2f2f7`（深色纯黑），白卡片不描边、不加投影，只靠底色区分层次（加过一版软投影，用户反馈有廉价感，已去掉） |
| 主按钮是黑色圆角矩形 | 胶囊按钮：主按钮强调色填充、次按钮系统灰填充、"开始"用浅强调色 |
| 列表行 15px 字、分隔线通到左边缘、图标是灰色线条 | 分组列表：16.5px 字、行高 52px、分隔线从文字起点开始；"我"用设置应用那样的彩色圆角方块图标 |
| 标签栏选中只是换颜色 | 选中换实心图标（SF Symbols 的 fill 变体）+ 强调色 + 一块系统灰 |
| 导航栏按钮是方形浅底 | iOS 26 的圆形玻璃按钮；之后又去掉了各页的页标题（标签栏已说明在哪一页） |
| 首页顶部大字问候 | 去掉问候，只留一行今日进度（像蚂小财顶部的"休市"状态行）；试过顶部浅色渐变，浅色模式下发脏，已去掉 |
| 输入条右边是黑色发送键 | 空着时是"+"（导入），有字时变成强调色发送键（像蚂小财的输入条和 iMessage） |
| 对话气泡是灰色 | 自己的话用强调色气泡，Tibi 的回答用白色气泡 |
| 预览时没有状态栏 | 手机框里模拟状态栏和主屏指示条（只在桌面浏览器预览时显示） |

做法参照苹果 Human Interface Guidelines 的系统颜色、按钮、列表与标签栏规范，以及 WWDC25 的新设计（Liquid Glass）。

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
- 首页对话入口（J9）：[每日经济新闻：支付宝 AI 版体验](https://www.nbd.com.cn/articles/2026-06-16/4428387.html)、[财新：支付宝最大改版](https://www.caixinglobal.com/2026-06-17/ant-revamps-alipay-with-ai-assistant-in-biggest-app-overhaul-102454831.html)、[界面新闻：蚂小财升级](https://www.jiemian.com/article/11689757.html)、[Adaline：聊天不该是默认界面](https://labs.adaline.ai/p/post-chat-interface-ai-products?open=false)、[Lazyweb：多少应用有 AI 助手页](https://www.lazyweb.com/research/what-percent-of-apps-have-an-ai-assistant.md)
- iOS 外观（J10）：[HIG：颜色](https://developer.apple.com/design/human-interface-guidelines/color)、[HIG：按钮](https://developer.apple.com/design/human-interface-guidelines/buttons)、[HIG：列表与表格](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)、[HIG：标签栏](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
- Tauri 分享扩展：[tauri-plugin-mobile-sharetarget](https://docs.rs/crate/tauri-plugin-mobile-sharetarget/latest)
