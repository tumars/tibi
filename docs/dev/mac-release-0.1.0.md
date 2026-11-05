# Mac 0.1.0 首发验证

2026-11-05，初始基于 `bc5b7ec` 检查，发行包对应 `2be0adc`（包含期间合入的订阅离线修复）。16:53（新加坡时间）已正式发布 [v0.1.0](https://github.com/tumars/tibi/releases/tag/v0.1.0)。

## 当前候选包

- 本机留存目录：`/Users/zhanghui/Documents/releases/Tibi/0.1.0/`。
- 公证前 DMG SHA-256：`4aef4b0df09c7aef81fd2e907c2d51a3563ff0811ec2b6a54bf8ee184fd01bb6`；staple 后文件校验和会变化。
- 最终公证申请：`785a4d71-2ae1-437f-a6dc-222932d6e829`，2026-11-05 16:06（新加坡时间）创建，16:42 检查确认为 Accepted，日志为 Ready for distribution、issues 为 null。使用 `--no-s3-acceleration` 完成上传；此前两份申请不是最终候选包。
- GitHub CI `41991852440` 全部必需检查通过。`v0.1.0` Release 对应 `2be0adc`；更新包签名工作流 `41997617512` 成功，使用应用内置公钥经 minisign 校验通过。远端 DMG 和更新包的 SHA-256 与本机一致后正式发布。
- 最终包在公证前完整启动时曾观察到一次 Core 子进程退出，无明确错误日志；重新启动后首页数据正常，随后三次冷启动主程序和 Core 均存活。公证后从 DMG 挂载并复制 App，Gatekeeper 放行，连续三次冷启动均通过，未再复现；首次异常根因仍未确认。

## 已完成

- 修正最低系统要求为 macOS 13：实际 Bun sidecar 的 Mach-O `LC_BUILD_VERSION` 声明 `minos 13.0`，原配置 macOS 12 会允许不受支持的系统尝试启动。安装包和发布说明必须与 Core 一致，修改后重新签名、公证。

- Vitest：59 个测试文件通过，333 项通过、1 项跳过。
- 全部工作区 TypeScript 类型检查、桌面生产构建通过；1110 条界面文案无缺译。
- 本机 Rust `cargo clippy --all-targets -- -D warnings` 通过；修复两处模块文档列表后的段落分隔，不改变产品设计或运行逻辑。
- 本机 Apple Silicon 构建生成 `Tibi.app` 和 `Tibi_0.1.0_aarch64.dmg`，已完成 Developer ID 签名、公证及 staple；App 与 DMG 的 Gatekeeper 检查均为 accepted / Notarized Developer ID。
- `codesign --verify --deep --strict` 通过，签名链为本人的 Developer ID Application → Developer ID Certification Authority → Apple Root CA，启用 hardened runtime 和可信时间戳。签名后的实际 Bun sidecar 可启动并查询随包词典。
- 从安装包中运行实际 Bun sidecar，使用独立临时数据库验证：内置词典、示例文章导入、阅读分词、语境释义、备份、重启后的数据保留。
- 实际发布构建窗口启动正常；首页加载既有数据，词典界面查询 compiler 返回中英文释义，设置页可打开。

## 发行说明与验证边界

- Apple 签名身份已完成：网页签发 Developer ID Application，证书 ID `8W7P73M2G9`，团队 `8XT8SVL7H6`，有效期至 2027-12-05。证书、私钥和 Apple Developer ID G2 中间证书已导入本机 login 钥匙串，`security find-identity -v -p codesigning` 可识别有效身份。私钥保存在仓库外，不提交 Git。
- Xcode 显示 **Admin**，创建证书曾报 `This operation can only be performed by the Account Holder.`；App Store Connect 同一账号实际为 **Account Holder + Admin**，网页签发成功。Xcode 报错原因未确认，不能据此判断用户没有持有人权限。
- 签名、公证、staple、Gatekeeper、从 DMG 安装冷启动已完成；Intel 构建尚未在本次检查中验证，真实模型调用、OCR 与同步也未做完整端到端复测。
- 更新签名、元数据、GitHub 正式发布已完成；国内分发由 mirror-cn 工作流 `41997945723` 处理。
- 公证后的 App 已安装到本机 `/Applications/Tibi.app`，已实际打开并确认原有书架和学习数据正常。

## 本次本机构建

本机原本未安装 Bun；临时安装在 `/tmp/tibi-release-tools`，未修改项目依赖。复现出包前需在 PATH 中提供 Bun：

```sh
pnpm --filter @tibi/desktop bundle:prep
pnpm --filter @tibi/desktop bundle --bundles app,dmg
```

构建产物位于 `apps/desktop/src-tauri/target/release/bundle/`。上述验证不等于所有功能无缺陷，也不替代签名后发行包验证。

Mac 发行配置使用 `Entitlements.mac.plist` 开启 `com.apple.security.cs.allow-jit`，用于 Bun sidecar 的 JavaScriptCore 在 hardened runtime 下运行。签名后还需实测 sidecar 和应用，不能仅凭签名命令成功就发布。
