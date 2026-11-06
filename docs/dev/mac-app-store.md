# Mac App Store 发布准备

## 当前状态（2026-11-06）

未上传 App Store Connect，未提交审核，未发布。

- 独立工作目录 `/Users/zhanghui/Documents/github/tibi-appstore`，分支 `codex/mac-app-store`，基于 `aaf9b34`，没有包含原工作区尚未提交的 Web 版等修改。
- 本机可用代码签名身份只有 `Developer ID Application: hui zhang (8XT8SVL7H6)`；商店证书和描述文件尚未准备。
- 原生浏览器控制两次超时；备用 Kimi WebBridge daemon 已启动，但返回 `no extension connected`。等待用户连接浏览器扩展，尚未读取 Apple 后台状态。
- 屏幕截图确认当前为“ChatGPT is Using Your Mac / Press any key or click to unlock”锁定画面；已请用户恢复桌面，界面操作仍不可用。
- 设计边界及未完成项见 [商店分发设计](../design/13-mac-app-store.md)。

## 已验证

- 从现有发行版复制 Bun Core 到独立测试 App，使用 `app.tibi.sandboxprobe` 标识和 Developer ID 签名，启用 App Sandbox、JIT、网络权限。
- 实际调用 `system.status`、`search.query`（compiler）、`system.backup` 成功；数据库和备份位于测试容器中。
- 尝试在 Documents 下创建另一个测试数据库返回 `EPERM`，说明沙盒限制确实生效；未修改现有学习数据。
- 完整旧发行 App 的复制件使用 `app.tibi.sandboxfull` 标识，主程序和继承沙盒的 Core 均启动，但日志出现 `sandbox_extension_issue_file_to_process failed`，词典路径回退到了开发目录。已停止该测试的两个进程；完整应用验证未通过。
- 桌面 TypeScript 类型检查、1111 条文案完整性检查通过。
- 商店配置完整生产构建通过（约 260 MiB）；商店 feature 的 `cargo clippy --all-targets -- -D warnings` 通过，更新/公告相关 11 项测试通过。
- 新构建已复制到 `/Users/zhanghui/Applications/Tibi App Store Preview.app`，使用 Developer ID 进行本地沙盒测试签名（不是商店签名），Core 使用独立继承权限，`codesign --verify --deep --strict` 通过。
- 新构建的主程序与 Core 均持续存活，Core 参数正确指向 `~/Library/Containers/app.tibi/Data/Library/Application Support/app.tibi/app.db` 以及新包内 `Contents/Resources/dict.db`，未再观察到旧复制件的资源路径回退。但未能操作界面，不能据此认定完整功能通过。
- 终端读取该容器中的 `mcp.token` 被系统拒绝，未尝试绕过权限；MCP 集成尚未验证。
- 官网默认 feature 的 Rust 严格检查也通过。测试结束已停止本次启动的预览主程序及 Core，保留预览 App 供恢复桌面后继续验证。

## 本地构建（尚不能直接提交商店）

准备同版本的 Bun sidecar、OCR 资源与词典后：

```sh
pnpm --filter @tibi/desktop tauri build \
  --features app-store \
  --config src-tauri/tauri.appstore.conf.json \
  --bundles app \
  --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}' \
  -- --no-default-features
```

注意 Tauri CLI 的 `--no-default-features` 必须放在 `--` 之后，传给 Cargo。
Tauri CLI 会根据配置增删 `Cargo.toml` 中直接声明的 `macos-private-api` dependency feature；不能把它放入 Cargo feature 转发，因为 Tauri 的 manifest 校验只检查直接声明。商店构建后该 feature 被移除，回到官网构建需先运行官网的 Tauri build/dev 使其恢复（或恢复该行），再直接运行 Cargo 检查。商店 release 的实际 Tauri feature 列表已检查，未包含 `macos-private-api`。
这里的 ad-hoc 签名只用于构建检查，不能上传商店。当前本地构建测试复用了已安装 0.1.0 的 Core/OCR/词典；正式候选包必须从最终源码重新构建 Core。

最终签名须先为嵌套 Core 使用 `Entitlements.appstore-core.plist`，再为主 App 使用商店 entitlements（加入与描述文件一致的 App ID / Team ID），嵌入 `embedded.provisionprofile`，校验后用 Mac Installer Distribution 证书通过 `productbuild` 制作 `.pkg`。上传前必须完成完整沙盒功能测试。
