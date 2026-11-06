# Mac App Store 发布准备

## 当前状态（2026-11-06）

**0.1.0 (2) 已于 2026-11-06 17:19（Asia/Singapore）成功提交 App Review，尚未审核通过或上架。** 页面返回 `1 Item Submitted`，提示审核可能需要最多 48 小时。已设置审核通过后自动发布。

审核记录：[App Review](https://appstoreconnect.apple.com/apps/6831512333/distribution/reviewsubmissions/details/484ee6f1-fc40-4660-8899-ce7dea336245)，提交 ID `484ee6f1-fc40-4660-8899-ce7dea336245`。免费、148 个非欧盟地区；正式包为 `~/Documents/releases/tibi-app-store-0.1.0/Tibi-0.1.0-2.pkg`。

- 独立工作目录 `/Users/zhanghui/Documents/github/tibi-appstore`，分支 `codex/mac-app-store`，基于 `aaf9b34`，没有包含原工作区尚未提交的 Web 版等修改。
- 商店 Application / Installer 证书及描述文件已准备，本机签名可用。
- 浏览器与桌面控制已恢复，已完成修正版上传、构建关联及最终审核提交。
- 设计边界及未完成项见 [商店分发设计](../design/13-mac-app-store.md)。

## 已验证

修正版于 17:12 由 Transporter 交付，App Store Connect 显示处理 `Complete`。加密合规选择“除 Apple 操作系统外使用标准加密算法”（Bun 标准 TLS），法国发行选择 No（首发排除欧盟），保存后构建显示 `Ready to Submit`。版本关联 0.1.0 (2) 后通过 Add for Review 完整性检查，再执行 Submit for Review，确认提交成功。

AI 数据分享确认由用户在真实原生弹窗中协助验证：同意后连接保存；新地址 `http://127.0.0.1:18995/v1` 选择取消后未保存，连接仍为上次同意的 `18994` 地址。测试没有 Key、没有调用第三方模型。沙盒内保留无 Key 的 `Local consent test` 连接，仅属本地验证数据，不随安装包分发。真实模型调用、WebDAV 服务端同步、OCR 和完整恢复流程仍未在本轮覆盖。

Apple 于 2026-11-06 16:28（Asia/Singapore）邮件返回 **ITMS-91109**：`Contents/embedded.provisionprofile` 带 `com.apple.quarantine`。Transporter“已交付”不代表构建处理成功。从已交付原件解包，将 CFBundleVersion 提升到 2，移除产物中该属性、重新签名并打包，保存为 `~/Documents/releases/tibi-app-store-0.1.0/Tibi-0.1.0-2.pkg`。再次解包确认无 quarantine，并通过深度严格签名检查；不是从截图构建取包。

两张真实截图（2560×1600）已上传，刷新后仍显示 2 张。审核联系人、电话、邮箱和英文 Notes 已用原生界面保存并刷新核验；无需登录、审核后自动发布设置保持。用户确认后隐私声明已发布。

2026-11-06 16:27（Asia/Singapore）：从本分支源码重建 Bun Core 和桌面壳，分别使用商店 Application / Installer 证书签名，`codesign --verify --deep --strict` 与 `pkgutil --check-signature` 通过。Transporter 已成功交付 **0.1.0 (1)**，Apple ID `6831512333`，此时后台仍在处理，尚未提交审核。交付包保存在 `~/Documents/releases/tibi-app-store-0.1.0/Tibi-0.1.0-1.pkg`。

商店与官网两套 Rust clippy 严格检查、桌面类型检查、1117 条文案检查和 11 项更新/公告测试通过。沙盒重启后仍可读取先前的 2 篇文章和 1 个生词；WebDAV 唯一同步选项已在实际界面确认。正式截图来自同源码的沙盒预览（仅窗口宽度改为 1280，Developer ID 本地测试签名），原始像素为 2560×1600。截图构建会覆盖 target 下的 `.app`，交付的 `.pkg` 为此前保存的商店签名原件，不应以截图构建替换。

后台已保存中文介绍、教育分类、0.1.0 版本号、审核联系方式和无需登录设置；免费定价、148 个非欧盟地区已配置，欧盟 27 国未选，未来新增地区不自动加入。年龄分级问卷结果为 16+。隐私链接已公开并保存；已发布的隐私标签包含可选第三方 AI 的用户内容、称呼、账号标识、搜索和学习活动，与服务账号关联、不用于追踪。

2026-11-06 后续进展：浏览器和桌面控制已恢复；完整沙盒预览 App 已实际通过首次引导、示例阅读和预生成总结、compiler 词典查询、加入生词本、手动备份、系统文件选择器导入文本。预览签名为 Developer ID，不能代替商店签名上传验证。

Apple 后台已创建 `app.tibi` 和 Tibi 应用记录（Apple ID `6831512333`），团队 `8XT8SVL7H6`。Application / Installer 两张商店证书及描述文件已签发、导入本机钥匙串；私钥和证书材料仅保留在用户私有配置目录，不进入仓库。用户确认免费、除欧盟地区首发、精简高级功能。审核联系方式在 App Store Connect 填写，不在仓库记录电话。

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
这里的 ad-hoc 签名只用于构建检查，不能上传商店。早期测试曾复用已安装 0.1.0 的 Core；正式候选包已从最终源码重建 Core。

最终签名须先为嵌套 Core 使用 `Entitlements.appstore-core.plist`，再为主 App 使用商店 entitlements（加入与描述文件一致的 App ID / Team ID），嵌入 `embedded.provisionprofile`，校验后用 Mac Installer Distribution 证书通过 `productbuild` 制作 `.pkg`。上传前必须完成完整沙盒功能测试。

嵌入从浏览器下载的描述文件后，应在**构建副本**移除该文件的 `com.apple.quarantine` 属性，再签名和打包。不能仅凭清理命令退出码判断成功：使用 `pkgutil --expand-full` 解包最终产物，检查 `xattr -lr` 输出无 quarantine，运行 `codesign --verify --deep --strict` 与 `pkgutil --check-signature`。本次 `xattr -cr` 后属性仍存在，显式 `xattr -d com.apple.quarantine <构建副本描述文件>` 才生效。
