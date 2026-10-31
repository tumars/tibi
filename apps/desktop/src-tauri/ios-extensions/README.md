# iOS 扩展：Safari 分享、小组件（M7，00 §3.13 J3、J7）

这两个是 iOS 的扩展 target，要在 Mac 上的 Xcode 里加进 `tauri ios init` 生成的工程（`src-tauri/gen/apple/`）。
**这里的 Swift 代码是在 Linux 上写的，还没编译验证。** 壳里和它们交换数据的部分（`src/app_group.rs`）已经有单测。

## 共享目录

主应用和两个扩展都要加 App Groups 能力，组名 `group.app.tibi`：

- 分享扩展把网址写进 `share-inbox/<毫秒>.json`（`{ url, title, later, at }`）；主应用打开 / 回到前台时由壳的 `share_take_pending` 取走，导入书架（`later` 为真时只进书架不打开）。
- 主应用每次刷新状态时经 `widget_write` 写 `widget.json`（`{ due, streak, todayMinutes, goal, readingTitle, readingProgress }`），小组件每 30 分钟读一次。

## 加 target

1. Xcode 打开 `gen/apple/tibi.xcodeproj`。
2. File → New → Target → **Share Extension**，名字 `ShareExtension`；删掉生成的 `ShareViewController.swift` 和 storyboard，把这里的 `ShareExtension/ShareViewController.swift` 拖进去；Info.plist 里把 `NSExtensionMainStoryboard` 换成 `NSExtensionPrincipalClass = $(PRODUCT_MODULE_NAME).ShareViewController`，`NSExtensionActivationRule` 设为只接受网页：`NSExtensionActivationSupportsWebURLWithMaxCount = 1`。
3. File → New → Target → **Widget Extension**，名字 `TibiWidget`，不勾 Live Activity / Configuration Intent；用这里的 `TibiWidget/TibiWidget.swift` 替换生成的代码。
4. 主应用、ShareExtension、TibiWidget 三个 target 都加 **App Groups** 能力，勾 `group.app.tibi`；主应用另加 iCloud（Documents，容器 `iCloud.app.tibi`，同步用）。
5. 跑一次：Safari 打开文章 → 分享 → Tibi → 导入；回到 Tibi 书架里应该有这篇。主屏长按加 Tibi 小组件。
