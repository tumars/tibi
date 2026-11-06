# Mac App Store 分发

2026-11-06：准备中，尚未上传或提交审核。原有 DMG 分发继续保留。

## 构建边界

- 官网版使用默认 Cargo feature `direct-distribution`，保留私有窗口 API 和自更新器。
- 商店版使用 `--no-default-features --features app-store`，覆盖 `tauri.appstore.conf.json`。两种 feature 不可同时开启。
- 商店版窗口不透明，不调用 vibrancy；不编译 updater 插件、更新命令，也不启动更新或公告轮询；设置提示用户通过 Mac App Store 更新。
- 主程序启用 App Sandbox、网络客户端/服务端权限（Core 提供本地 MCP socket）和用户选择文件的读写权限；Bun Core 单独签名，启用沙盒继承和 JIT。不能给子进程直接套用主程序 entitlements。
- 不改现有 Core 架构。数据由系统隔离到沙盒容器；不会静默读取或移动官网版数据库。

## 提交前仍须解决

- 完整签名应用在沙盒中的资源路径、Core 启动和退出、钥匙串、文件选择/拖入、OCR、模型调用、朗读、同步、备份恢复。
- 本地同步文件夹跨重启访问需要验证，必要时实现 security-scoped bookmark；仅声明 entitlement 不能实现授权持久化。
- MCP helper 在外部客户端启动时的沙盒继承语义需要验证，不能用应用内部子进程测试替代。
- 官网版已有数据的用户授权导入方式；不得假设两个渠道直接共享数据库。
- 商店分发证书、Mac Installer Distribution 证书、描述文件及对应 App/Team ID entitlements。
- 隐私政策、隐私申报、AI 数据传输告知、素材许可、审核说明与截图。

具体构建步骤和实测记录见 [发布记录](../dev/mac-app-store.md)。
