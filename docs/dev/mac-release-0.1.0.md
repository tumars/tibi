# Mac 0.1.0 首发验证

2026-11-05，基于 `bc5b7ec` 检查，尚未发布。

## 已完成

- 修正最低系统要求为 macOS 13：实际 Bun sidecar 的 Mach-O `LC_BUILD_VERSION` 声明 `minos 13.0`，原配置 macOS 12 会允许不受支持的系统尝试启动。安装包和发布说明必须与 Core 一致，修改后重新签名、公证。

- Vitest：59 个测试文件通过，333 项通过、1 项跳过。
- 全部工作区 TypeScript 类型检查、桌面生产构建通过；1110 条界面文案无缺译。
- 本机 Rust `cargo clippy --all-targets -- -D warnings` 通过；修复两处模块文档列表后的段落分隔，不改变产品设计或运行逻辑。
- 本机 Apple Silicon 构建生成 `Tibi.app` 和 `Tibi_0.1.0_aarch64.dmg`，现已完成 Developer ID 签名；公证尚未完成，不能当作正式发行包。
- `codesign --verify --deep --strict` 通过，签名链为本人的 Developer ID Application → Developer ID Certification Authority → Apple Root CA，启用 hardened runtime 和可信时间戳。签名后的实际 Bun sidecar 可启动并查询随包词典。
- 从安装包中运行实际 Bun sidecar，使用独立临时数据库验证：内置词典、示例文章导入、阅读分词、语境释义、备份、重启后的数据保留。
- 实际发布构建窗口启动正常；首页加载既有数据，词典界面查询 compiler 返回中英文释义，设置页可打开。

## 发布前待完成

- Apple 签名身份已完成：网页签发 Developer ID Application，证书 ID `8W7P73M2G9`，团队 `8XT8SVL7H6`，有效期至 2027-12-05。证书、私钥和 Apple Developer ID G2 中间证书已导入本机 login 钥匙串，`security find-identity -v -p codesigning` 可识别有效身份。私钥保存在仓库外，不提交 Git。
- Xcode 显示 **Admin**，创建证书曾报 `This operation can only be performed by the Account Holder.`；App Store Connect 同一账号实际为 **Account Holder + Admin**，网页签发成功。Xcode 报错原因未确认，不能据此判断用户没有持有人权限。
- 配置 Apple 公证认证（本机钥匙串 profile `tibi`），完成公证、staple 和 Gatekeeper 验证。签名打包与 hardened runtime 下的 sidecar 启动验证已完成。
- 验证签名后的安装及主要界面流程；Intel 构建尚未在本次检查中验证，真实模型调用、OCR 与同步也未做完整端到端复测。
- 生成并验证自动更新签名与元数据，再上传及发布 GitHub Release；需要的国内分发按现有 mirror-cn 工作流处理。

## 本次本机构建

本机原本未安装 Bun；临时安装在 `/tmp/tibi-release-tools`，未修改项目依赖。复现出包前需在 PATH 中提供 Bun：

```sh
pnpm --filter @tibi/desktop bundle:prep
pnpm --filter @tibi/desktop bundle --bundles app,dmg
```

构建产物位于 `apps/desktop/src-tauri/target/release/bundle/`。上述验证不等于所有功能无缺陷，也不替代签名后发行包验证。

Mac 发行配置使用 `Entitlements.mac.plist` 开启 `com.apple.security.cs.allow-jit`，用于 Bun sidecar 的 JavaScriptCore 在 hardened runtime 下运行。签名后还需实测 sidecar 和应用，不能仅凭签名命令成功就发布。
