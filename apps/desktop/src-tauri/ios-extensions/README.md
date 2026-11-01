# iOS 扩展：Safari 分享、小组件（M7，00 §3.13 J3、J7）

这两个是 iOS 的扩展 target，要在 Mac 上的 Xcode 里加进 `tauri ios init` 生成的工程（`src-tauri/gen/apple/`）。
**CI 的 `ios` 任务在 macOS runner 上对 iOS 17 SDK 做 `swiftc -typecheck`（2026-10-31 通过），但还没在真机上跑过。** 壳里和它们交换数据的部分（`src/app_group.rs`）有单测，iOS 分支（objc2 调 NSFileManager）在 CI 里 `cargo check --target aarch64-apple-ios` 通过。

## 共享目录

主应用和两个扩展都要加 App Groups 能力，组名 `group.app.tibi`：

- 分享扩展把网址写进 `share-inbox/<毫秒>.json`（`{ url, title, later, at }`）；主应用打开 / 回到前台时由壳的 `share_take_pending` 取走，导入书架（`later` 为真时只进书架不打开）。
- 主应用每次刷新状态时经 `widget_write` 写 `widget.json`（`{ due, streak, todayMinutes, goal, readingTitle, readingProgress }`），小组件每 30 分钟读一次。

## 加 target

`add-targets.py` 把两个扩展加进 `tauri ios init` 生成的 xcodegen 工程（`gen/apple/project.yml`）并重新生成 `.xcodeproj`：
ShareExtension（`app.tibi.share`，分享面板只接受网页）、TibiWidget（`app.tibi.widget`，iOS 17 起）；主应用和两个扩展都加 App Groups（`group.app.tibi`），主应用内嵌两个扩展。可以重复跑。

```bash
cd apps/desktop && pnpm tauri ios init
pip3 install pyyaml && brew install xcodegen
python3 src-tauri/ios-extensions/add-targets.py
```

CI 的 `ios-smoke` 每次都这样生成，在 iPhone 模拟器里检查：两个扩展被系统登记（`pluginkit`）、App Group 里有主应用写的 `widget.json`、放进 `share-inbox/` 的网址在主应用打开后被取走。

真机还要：在 Apple 开发者后台给三个 bundle id 开 App Groups（`group.app.tibi`），主应用另开 iCloud（Documents，容器 `iCloud.app.tibi`，同步用），`tauri.ios.conf.json` 填 `developmentTeam`。然后 Safari 打开文章 → 分享 → Tibi → 导入；回到 Tibi 书架里应该有这篇。主屏长按加 Tibi 小组件。
