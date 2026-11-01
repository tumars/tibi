# 开发说明

> 状态：M0 骨架、M1 最小闭环、M2 AI 与助手的功能都已做完（2026-10-31）；待在本机验证 Tauri 窗口、深链与真实模型调用（开发时可用 `--fake-model` 走通界面）。

## 1. 仓库结构

```
tibi/
  package.json            pnpm 工作区（Node ≥ 22，pnpm 10）
  packages/
    core/                 @tibi/core：Tibi Core 的全部业务逻辑。纯 TypeScript，不依赖 Node 专有 API（R11，手机复用）
      sql/                数据库迁移 NNNN_name.sql（表结构的唯一真相源，与 01-database.md 对应）
      src/
        types.ts          共享类型（= 06-interface.md §2）
        ids.ts            UUIDv7（R11）
        db/               Driver 接口、Database（事务互斥）、migrate（PRAGMA user_version）
        platform.ts       运行时接口：抓网页、抽正文、密钥、文件白名单
        dict/             词典接口（dict.db / ECDICT）
        kernel/           TibiKernel：对话、任务、步骤检查点、审批、用量、pi-agent-core 桥接
        rpc/              JSON-RPC 方法定义（TypeBox 参数）、分发器、system.*
        domain/           领域模块：text（切分 / 分词 / 还原 / 预标注）、documents、terms、review、stats、profile、memory、shared（撤销审计、建卡）
        core.ts           组装：db + dict + platform + jobs + 方法表
      skills/             内置 SKILL.md（真相源；构建成 src/kernel/skills.gen.ts）
      samples/            内置示例 <id>/article.md + ai.json（正文与预生成结果的真相源；构建成 src/domain/documents/samples.gen.ts）
      test/               vitest；helpers.ts 的 makeCore() 给出内存库 + 假平台
    core-node/            @tibi/core-node：Node 运行时。better-sqlite3 驱动、undici fetch + Readability、HTML→Markdown、
                          stdio / WebSocket 传输、启动入口 bin.ts、ECDICT 入库脚本；打包成 Tauri sidecar
  apps/
    desktop/              @tibi/desktop：Tauri 2 壳（src-tauri）+ React 界面（src）
  extensions/
    clipper/              剪藏插件（Chrome / Edge MV3，只有"发送到 Tibi"，见 README）
  docs/                   设计文档、原型、调研（文档即代码）
  tools/                  gen-mascot.py 等脚本
```

## 2. 常用命令

```bash
pnpm install                       # 装依赖（better-sqlite3、esbuild 的构建脚本已在 package.json 里允许）
pnpm test                          # 全部单测（vitest）
pnpm -r typecheck                  # 各包类型检查
pnpm core:dev                      # 起 Core 开发桥：ws://127.0.0.1:3456（JSON-RPC，协议同 stdio），库在 .tibi/app.db
pnpm --filter @tibi/core-node rpc system.status   # 直接调开发桥上的方法（调试用）
pnpm core:dev -- --fake-model      # 同上，但用假模型（不联网、不花钱）走通对话、总结、译文、语境释义的界面；还要先在设置里随便建一个模型连接
pnpm --filter @tibi/desktop web    # 浏览器里跑界面，连上面的开发桥（无需编译 Rust）；手机壳是 http://localhost:1420/mobile.html
pnpm dev                           # tauri dev（需要 Rust 工具链与系统库）
pnpm --filter @tibi/core-node build   # 打包 dist/tibi-core.js（sidecar 的 JS）
pnpm --filter @tibi/core-node sidecar # Bun --compile 单文件 sidecar → apps/desktop/src-tauri/binaries/（另把 OCR 的 worker 与 wasm 拷到 binaries/ocr/）
TIBI_TEST_OCR=1 pnpm --filter @tibi/core-node test   # 连带跑 OCR 测试（要下载约 10 MB 的语言包）
pnpm --filter @tibi/core gen          # 改了 sql/*.sql、skills/*.md 或 samples/ 后重新生成内嵌文件
pnpm ecdict                        # 下载 ECDICT 并生成 data/ecdict/dict.db（不进仓库；开发时壳和 Core 都会找这里）
pnpm clipper:zip                   # 打包剪藏插件 extensions/clipper/dist/*.zip
```

Core 的 stdio 协议（06 §1）：每行一条 JSON。壳 → Core 请求 `{jsonrpc, id, method, params}`；Core → 壳 响应 `{jsonrpc, id, result | error}`、事件 `{jsonrpc, method: 'event', params: {event, data}}`、反向请求 `{jsonrpc, id: 'h-n', method: 'secret.get', params: {ref}}`（壳回 `{id, result: {secret}}`）。日志只走 stderr。

## 3. 怎么改

- **表结构**：只加新的 `packages/core/sql/NNNN_*.sql`，不改旧的；同时改 `docs/design/01-database.md`。
- **接口**：先改 `docs/design/_src/build_interface.py` 并运行，再改 `packages/core/src/types.ts` 与对应方法；方法定义用 `method(TypeBoxSchema, handler)`，错误抛 `TibiError(code, message)`。
- **能力**：`capability({ name, description, params, perm, run })`，同一份定义给技能（pi 工具）、MCP、界面直接调用。
- **写操作**：走 `recordUndo` / `registerUndo`（撤销）、发 `data.changed` 事件；id 用 `uuidv7()`；写入带 `updated_at`；删除写 `deleted_at`；只追加的表不 UPDATE（08 §9 的五条约定）。
- **文档即代码**：实现与设计不一致时改设计文档，并在 `docs/CHANGELOG.md` 记一行；技术决定记在 `docs/DECISIONS.md` 的 T 组。

## 4. 出安装包与 CI

- **CI**（`.github/workflows/ci.yml`，每个 PR 和推到 main）：内嵌文件是否最新（`pnpm --filter @tibi/core gen` 后无改动）、类型检查、单测、界面构建、界面文案是否都有英文（`i18n:check`）；另起几个任务检查 Rust 壳：Ubuntu 上 `cargo clippy` 与 `--features mobile-preview`，`android`（`cargo check --target aarch64-linux-android`），`ios`（macOS runner：`cargo check --target aarch64-apple-ios`，两个扩展的 Swift 对 iOS SDK 做 `swiftc -typecheck`）。
- **发布**（`.github/workflows/release.yml`）：推一个 `v0.1.0` 这样的 tag → 先生成一次词典（缓存）→ macOS（Apple 芯片、Intel）、Windows、Linux 四个目标各自打 sidecar + 安装包 → 放进一个**草稿** Release，剪藏插件 zip 也挂上去；人工检查后再发布。tag 必须和 `tauri.conf.json`、`Cargo.toml` 的版本一致。另有 `android` 任务打 APK（aarch64，未签名），也挂到这个 Release。手动触发（Actions 页面 Run workflow，不打 tag）时跑同样的流程，但不建 Release，安装包和 APK 留作构建产物，用来在打 tag 之前验证打包（开发阶段曾经推 `m0-scaffold` 就跑，2026-11-01 合进 main 时去掉）。
- **2026-10-31 在 GitHub 上跑通**（开发分支，不建 Release）：CI 的 check、rust、android、ios 全部通过；发布流程的词典、macOS（Apple 芯片、Intel，未签名）、Linux、Windows（`windows-2022`）、Android APK 都打出了包，在 Actions 页面的构建产物里。之前修掉的问题：手机配置列的 `resources/dict.db` 在 CI 里不存在（放空文件占位）、没配签名密钥时空值被当成要签名、`windows-latest` 的 VS 2026 node-gyp 不认、Windows 上 `URL.pathname` 带 `/D:/` 前缀（改用 `fileURLToPath`）。2026-11-01 加了 `android-smoke`、`ios-smoke` 两个冒烟测试后整轮全绿（提交 fbeaf2d：词典、四个桌面目标、APK、Android 模拟器里走完首次引导到点词查词典、iPhone 模拟器里出现欢迎面板）。之后一轮（提交 19ccc04，加了 iOS 扩展）除 Windows 外全过；Windows 那一项没启动，GitHub 提示账号付款失败或超出花费上限（Billing & plans），不是代码问题。还没有真的打过 tag、建过 Release。
- **签名**：仓库里配了 `APPLE_CERTIFICATE` 等密钥就自动签名、公证 macOS 包；没配就出未签名的包（密钥是空的时候不传给 tauri，否则它会去导入空证书然后失败）。Windows 暂不签。Windows 用 `windows-2022` runner：`windows-latest` 带的 Visual Studio 2026 node-gyp 还认不出来，better-sqlite3 装不上。
- **本地出包**：

```bash
pnpm --filter @tibi/desktop bundle:prep      # sidecar（本机 target）+ OCR 资源 + 词典（没有就先跑 pnpm ecdict）
pnpm --filter @tibi/desktop bundle           # tauri build，带上 src-tauri/tauri.bundle.conf.json（把 dict.db 放进安装包）
```

词典不写在主配置 `tauri.conf.json` 的 resources 里：开发时没有词典也能编译；只有出包时用 `--config src-tauri/tauri.bundle.conf.json` 合并进去。

**在 Linux 上验证装好的应用**（没有显示器的机器）：`Xvfb :99` 起虚拟屏幕，`apt install ./Tibi_*.deb` 安装，在 `dbus-run-session` 里先起 `gnome-keyring-daemon --unlock --components=secrets` 再跑 `tibi`（钥匙串要 Secret Service），用 `xdotool` 点、`import -window root` 截图；`tibi 'tibi://import?url=…'` 测深链。2026-10-31 用这个办法验证过首次引导、导入示例与网页、阅读与词卡、深链、⌘K、钥匙串和测试连接。

## 5. 界面文案（i18n）

- 源码里直接写中文，用 `tl('中文原文')` 包起来；有变量写成 `tl('已导入 {n} 篇', { n })`，不要把一句话拆成几段拼。
- 改完跑 `pnpm --filter @tibi/desktop i18n:sync`：把新键补进 `src/locales/en.json`（值为空）、删掉不用的；再填上英文。`i18n:check` 在 CI 里检查没有漏翻。
- 详见 T25。

## 6. 手机端（M7）

手机壳是 `apps/desktop` 的第二个入口 `mobile.html`（`src/mobile/`）。手机上没有 sidecar：Core 跑在 WebView 里，SQLite 由壳的 `local_db.rs`（rusqlite）提供（T28）。

**在电脑上看**

```bash
pnpm --filter @tibi/desktop web            # 浏览器打开 http://localhost:1420/mobile.html，连 pnpm core:dev 的开发桥（最快）
pnpm --filter @tibi/desktop mobile:preview # Tauri 窗口里按手机的方式跑：Core 在 WebView 里、自己的 app.db（--features mobile-preview）
```

**iOS**（要 macOS + Xcode 15 以上，这台 Linux 机器上做不了）

1. `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`
2. `cd apps/desktop && pnpm tauri ios init`，生成 `src-tauri/gen/apple/`（提交进仓库；`.gitignore` 只忽略 `gen/schemas`）
3. 在 `src-tauri/tauri.ios.conf.json` 的 `bundle.iOS` 里填 `developmentTeam`（Apple 开发者账号的 Team ID）；在 Xcode 里给 target 加 iCloud 能力，勾 iCloud Documents，容器填 `iCloud.app.tibi`（同步用，`sync_fs.rs` 经 NSFileManager 找这个容器）
4. 词典：`node apps/desktop/scripts/bundle-prep.mjs --skip-sidecar`（没有词典时先跑 `pnpm ecdict`，再拷到 `src-tauri/resources/dict.db`；`tauri.ios.conf.json` 会把它带进包）
5. `pnpm tauri ios dev`（模拟器或真机）/ `pnpm tauri ios build`

**Android**（要 Android Studio、SDK、NDK，设好 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`）

1. `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`
2. `cd apps/desktop && pnpm tauri android init`（生成 `src-tauri/gen/android/`，提交）
3. 词典同上；`pnpm tauri android dev` / `pnpm tauri android build --target aarch64 --apk`

2026-10-31 在 Linux 上（SDK 命令行工具 + NDK 27 + JDK 21）跑通：`tauri android init` 生成的 `gen/android/` 已提交；`pnpm tauri android build --target aarch64 --apk` 打出 `gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`（约 56 MB：`libtibi_lib.so` 15 MB 内嵌界面，`assets/dict.db` 90 MB 压缩后），Manifest 里带着备份规则。发布前要签名（`apksigner`，密钥放 `gen/android/keystore.properties`，已在 `.gitignore`）。这台机器没有 KVM：模拟器用 `-accel off` 能开机（约 15 分钟），但 system_server 几分钟就因为太慢重启一次，装不上应用。所以发布流程加了 `android-smoke` 任务：GitHub 的 ubuntu runner 有 KVM，打 x86_64 的 debug APK（WebView 开着远程调试）装进 API 34 模拟器，经 DevTools 协议像用户一样走一遍：Core 在 WebView 里起来 → 欢迎面板点「开始」→ 示例文章进书架 → 经壳的命令打开安装包里的词典查一个词 → 打开文章 → 点生词 → 词卡里有词典释义；再检查进程活着、没有崩溃。2026-11-01 全部通过（第 10 次）：词典拷到 `/data/user/0/app.tibi/dict.db`、能查，阅读器分好词，点 compiler 词卡显示「n. 编辑者 [计] 编译程序」。之前几次修词典以前，模拟器一打开阅读器页 qemu 进程就没了（磁盘、内存都够，没有 OOM，原因没查清）；脚本保留了兜底：前面几步都过了、只在阅读器页模拟器消失时记成警告（`.github/scripts/android-smoke.sh` 和 `android-smoke-cdp.mjs`，每步结果在任务日志里，截图在构建产物 `android-smoke` 里）。同一个 CDP 脚本也能对浏览器里模拟壳的 `mobile.html` 跑（Chromium 开 `--remote-debugging-port`），改脚本时先在本机跑通。

- Gradle 拉依赖时如果 Maven Central 返回 429（共享出口 IP 被限流），可以在本机 `~/.gradle/init.d/` 放一个脚本把 `repo.maven.apache.org` 换成 Google 的镜像 `https://maven-central.storage-download.googleapis.com/maven2/`，不用改工程。
- 词典在 Android 上：随包资源在 APK 的 assets 里不是文件，`local_db.rs` 第一次用（或升级后）经 fs 插件读出来拷到 `app_data_dir/dict.db`（旁边 `dict.db.version` 记版本）；桌面、iOS 直接打开资源目录里的文件。2026-11-01 冒烟测试查出之前 Android 上词典一直打不开。
- CI 的 `android` job 只做 `cargo check --target aarch64-linux-android`（用 runner 自带的 NDK），保证 Rust 这部分能编译。
- `gen/android` 的 `res/xml/backup_rules.xml`、`data_extraction_rules.xml` 是手加的（把 `secrets.json` 排除在云端备份和换机迁移之外），重新 `tauri android init` 时要保留。

**iOS 冒烟测试**（发布流程 `ios-smoke`，macOS runner）：`tauri ios init` 生成工程，`tauri ios dev <模拟器>` 在 iPhone 模拟器里编译、安装、打开（模拟器不用签名、不用开发者账号；界面从 dev server 加载，Rust 壳、插件、WKWebView、WebView 里的 Core 都是真的），截图后用 macOS 的 Vision 识别屏幕文字（`.github/scripts/ocr.swift`），看到欢迎面板、进程活着、没有崩溃报告就算过（`.github/scripts/ios-smoke.sh`）。2026-11-01 在 iPhone 模拟器（iOS 26.5）上第一次跑起来：打开 10 秒后屏幕上识别出欢迎面板（"你好，我是 Tibi。"、四档水平、"开始"）和「今天」页（"今日 0/20 分钟"、"今天没有要复习的"），没有崩溃报告。

**iOS 扩展**（Safari 分享、小组件，J3 / J7）：Swift 代码在 `src-tauri/ios-extensions/`，`add-targets.py` 把它们加进 `tauri ios init` 生成的 xcodegen 工程（App Groups、内嵌），步骤见那里的 README。主应用和扩展经 App Group `group.app.tibi` 交换数据：壳的 `app_group.rs` 提供 `share_take_pending`（取走分享进来的网址）和 `widget_write`（写小组件快照），`src/mobile/native.ts` 在打开 / 回到前台时导入、状态变了写快照。不是 iOS 时这两条命令什么都不做；测试时 `TIBI_APP_GROUP_DIR` 可以指一个目录。

**拍书页**：导入面板的「拍书页」是带 `capture` 的 `<input type="file">`（iOS、Android 都直接开相机；Android 的 WebView 走系统相机应用，不用声明 CAMERA 权限），「从相册选」可多选；拿到的是内存里的 File，登记成 `mem:` 路径交给导入流水线（`mobile/local/files.ts`）。iOS 的相机 / 相册用途说明在 `src-tauri/Info.ios.plist`（Tauri 合并进 Info.plist）。

**还没做 / 没验证**：iOS 上的 iCloud 同步代码写好了（`sync_fs.rs` 的 iOS 分支调 NSFileManager），CI 里 `cargo check --target aarch64-apple-ios` 通过，但没在真机上跑过（要 iCloud 权限和开发者账号）；Android 上 API Key 存在应用私有目录的 `secrets.json`（0600，`keys.rs`；`gen/android` 的备份规则把它排除在云端备份和换机迁移之外），还没接 Android Keystore 再加一层加密；Safari 分享扩展和小组件：`ios-smoke` 在 iPhone 模拟器里验证了两个扩展编进应用、被系统登记，App Group 里有主应用写的小组件快照、分享收件箱里的网址被主应用取走；分享面板里点「导入」、主屏小组件的显示没在模拟器里点过（要真机或手动）。CI 里 `cargo check --features mobile-preview` 保证手机这条路至少能编译。

## 7. M0 的技术决定（T 组）

见 [`docs/DECISIONS.md`](../DECISIONS.md#m0-技术决定t-组)。
