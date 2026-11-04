# Claude CLI 403 / OAuth 失败诊断报告

## 摘要
- 本次只诊断：未登录、登出、刷新 token、调用模型、修改配置或 Keychain；仅新增本报告及其 /tmp 副本。
- 最强证据是网络路径差异：同一现有 OAuth token 请求同一 profile 端点，默认路径返回 **403 forbidden**，显式使用本机代理则返回 **200**。
- 代理路径匿名请求返回 **401 authentication_error**，说明认证检查正常；已测 token 当前可访问 profile，不能笼统判断所有 OAuth token 已过期。
- Desktop 正在运行，其 14 个内置 CLI 进程持有同一个环境 token；当前诊断 shell 没有该变量，独立 CLI 与 Desktop 的认证来源、版本和代理环境不同。
- 独立 CLI 的 Keychain 项存在，但未读取密码，因此其有效期、refresh token 状态以及原始报错的直接触发过程仍未查清。

## 环境快照
- 时间：2026-11-02 20:48–20:54，Asia/Shanghai（UTC+08:00）；本机 Asia/Singapore 同偏移。
- 用户：zhanghui；工作目录：/Users/zhanghui/Documents/github/tibi。
- `which claude`：`/Users/zhanghui/.nvm/versions/node/v24.15.0/bin/claude`。
- 实际文件：`/Users/zhanghui/.nvm/versions/node/v24.15.0/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`。
- `claude --version`：**2.1.215 (Claude Code)**。
- Desktop 内置 CLI 运行路径包含 **2.1.308**；这是进程路径版本标识，未另启内置 CLI。
- 本任务无产品代码变更，不涉及 Tibi 设计文档修改。

## 证据逐项

### 1. CLI 命令与安全边界
已执行：
```text
which claude
claude --version
claude --help
claude auth --help
claude auth status --help
claude doctor --help
```
- auth 子命令包含 login、logout、status；status 支持 --json（默认）与 --text。
- doctor 帮助称其读取当前目录配置，交互式 /doctor 可修复问题。
- **未执行 auth status、doctor 或 /status**：帮助不足以保证此版本内部不会做认证预取、自动刷新或状态写入；严格遵守禁止改登录态，改用直接只读 GET。/status 也需要进入会话。
- 未执行 setup-token、login、logout、update、install 或推理请求。

### 2. 环境变量与启动配置
所有环境探测仅输出名称、存在性、长度；未输出 token 前缀或全文。

| 来源 | 脱敏结果 |
| --- | --- |
| 当前诊断 shell | CLAUDE_CODE_OAUTH_TOKEN、ANTHROPIC_API_KEY、ANTHROPIC_AUTH_TOKEN 均无；未发现其他 ANTHROPIC_* |
| 当前 shell 代理 | 仅发现 NO_PROXY，长度 25；HTTP_PROXY/HTTPS_PROXY/ALL_PROXY 及对应小写变量未发现 |
| ~/.zshrc | 第 7 行为设置 http_proxy/https_proxy 的 alias，目标端口均为 8118；alias 的存在不等于启动 shell 自动启用 |
| 常见 shell 文件 | 扫描存在的 .zshrc/.zprofile/.zshenv/.bashrc/.bash_profile/.profile 及 /etc/zshenv、/etc/zprofile、/etc/zshrc；未发现上述认证变量文本引用 |
| LaunchAgents/LaunchDaemons plist | 扫描用户及系统可读 plist 的 EnvironmentVariables 与 ProgramArguments；未发现目标认证变量 |
| launchctl getenv | 三种认证变量及大写代理变量未返回值；此查询发生在受限上下文，只能作为辅助证据 |
| Desktop 内置 CLI | 14 个进程有 CLAUDE_CODE_OAUTH_TOKEN，长度均为 108，内存比较为同一个 token |
| Desktop CLI 其他环境 | ANTHROPIC_BASE_URL 长度 25；所选进程确认等于官方 API 地址；HTTP_PROXY/HTTPS_PROXY 长度 21，所选代理端点为 127.0.0.1:8118；NO_PROXY 长度 30 |
| Codex agent | 至少一个 agent 有小写 http_proxy/https_proxy（各 21）；另一个只有 NO_PROXY。不同父进程环境确有差异 |

进程检查方法：Python 捕获 `ps -axo pid=,ppid=,comm=` 与 `ps eww -p <pid> -o command=`，在内存中提取指定变量，仅输出长度。原始进程环境未落盘、未直接输出。没有 source 用户配置，也没有执行配置中的 hooks。

### 3. 配置与凭证位置
选取关键元数据如下；时间均为本机 UTC+08:00。

| 路径 | 权限 / mtime | 说明 |
| --- | --- | --- |
| ~/.claude/.credentials.json | 不存在 | macOS 使用 Keychain 时属正常可能情况，不等于未登录 |
| ~/.config/claude* | 无匹配 | 未发现该目录族 |
| ~/.claude/settings.json | 0644 / 11-02 18:07:39 | env 含企业遥测配置；无目标认证变量，无 apiKeyHelper |
| ~/.claude.json | 0600 / 11-02 20:30:21 | 有 oauthAccount 元数据；未输出账号资料 |
| ~/.claude/.claude.json | 0600 / 10-30 16:32:08 | 另一个配置文件，未读取凭证内容 |
| ~/.claude/.claude/settings.local.json | 0644 / 07-16 19:43:50 | 嵌套配置文件 |
| 项目 .claude/settings.local.json | 0644 / 11-02 16:22:24 | 顶层仅 permissions |
| /Library/Application Support/ClaudeCode/managed-settings.json | 0644 / 09-01 17:40:39 | 顶层仅 hooks |
| ~/.claude/session-env/ | 目录 0755 / 11-02 20:30:03 | 检查时无文件 |
| ~/.claude/sessions/ | 目录 0700 / 11-02 20:30:20 | 28 个文件，包括进程 JSON 与 .key；未读取 .key 内容 |
| Desktop Cookies | 0600 / 11-02 20:47:18 | 仅元数据，未读 cookie |
| Desktop buddy-tokens.json | 0600 / 11-02 19:20:55 | 仅元数据，未读 token |
| Desktop config.json | 0600 / 11-02 19:20:59 | 仅元数据 |
| Desktop claude_desktop_config.json | 0600 / 11-02 19:16:01 | 仅元数据 |

Desktop 路径前缀：`~/Library/Application Support/Claude/`，包含 Local Storage、Session Storage、IndexedDB、claude-code、claude-code-sessions、claude-code-vm 等目录。CLI 目录还包含 cache、backups、logs、projects、state、telemetry、shell-snapshots；未遍历或输出聊天正文。

Keychain 命令仅使用 `security find-generic-password -s '<service>'`，无 -g、-w 或密码导出；工具输出仅保留 service/account：
- service **Claude Code-credentials**，account **zhanghui**，查询成功。
- service **Claude Safe Storage**，account **Claude Key**，查询成功。
- 精确 service Claude / Anthropic 未找到；不是全 Keychain 穷举。
- 最初沙箱内查询返回 44，沙箱外只读复核返回成功；报告不采用初次“未找到”作为凭证缺失证据。

### 4. 一次性只读 HTTP 对比
目标均为官方 HTTPS 域名；未访问刷新端点，未发送 POST、消息或计费模型请求。含 token 请求禁用 verbose，Authorization 通过 curl 配置标准输入传递，仅在内存中处理；不放入命令行参数，不记录响应账户信息。

| 路径 | GET 端点 | 认证 | HTTP | 正文类型 |
| --- | --- | --- | --- | --- |
| 默认路径，无显式代理 | https://api.anthropic.com/ | 无 | 403 | error.type=forbidden |
| 默认路径，无显式代理 | /api/oauth/profile | 无 | 403 | error.type=forbidden |
| 默认路径，无显式代理 | /api/oauth/profile | 现有 Desktop CLI token | 403 | error.type=forbidden |
| 显式本机代理 127.0.0.1:8118 | /api/oauth/profile | 无 | 401 | type=error；error.type=authentication_error |
| 显式本机代理 127.0.0.1:8118 | /api/oauth/profile | 同一 token | **200** | JSON，无错误类型 |

所有上述有效探测 curl 退出码为 0。所选 token 来自当时 PID 88578；Desktop 主进程当时 PID 87711，父进程为 1。PID 仅是本次快照。

“默认路径”指 curl 未显式配置代理，verbose 显示连接 api.anthropic.com；不能排除系统透明隧道。根路径不是健康检查接口，单独的根路径 403 不证明服务故障；结论主要来自同一 profile 端点的配对实验。profile 200 仅证明此 token 可访问该端点，不证明模型权限、额度或刷新能力。

### 5. 历史错误线索
- ~/.claude.json 存在 bridgeOauthDeadFailCount=2，bridgeOauthDeadExpiresAt 对应 **2026-08-14 20:24:47 +08:00**。这是旧 bridge 状态，不能当作当前 Keychain token 的到期时间。
- 对 ~/.claude/logs、Desktop 日志、session-env 的有限近期文件扫描，仅输出指定错误字符串命中数。Desktop main3.log（mtime 10-18）与 main4.log（mtime 10-08）各命中一次 invalid_grant。
- 这些旧日志不能证明今日仍存在同一刷新失败；本轮未复现用户所述完整 OAuth 报错，也未确定原错误来自独立 CLI 还是 Desktop 内置 CLI。

## Desktop vs CLI
- Desktop 与多个 Helper、内置 CLI 均运行中；不是“Desktop 未启动”。
- 本机存在两套认证入口：独立 CLI 的 Keychain service 与 Desktop 自身 Safe Storage；Desktop 启动的 CLI 还被注入环境 token。
- 官方文档说明 macOS CLI 凭证通常存于 Keychain；CLAUDE_CODE_OAUTH_TOKEN 优先于 Keychain 凭证。因此“当前终端无 token”不能推导出 Desktop agent 无 token；“Desktop 能用”也不能证明独立 CLI Keychain 凭证有效。
- 两者登录状态不同步、一个可用而另一个到期，在这种不同凭证来源下是合理可能性；本次没有频率统计，不能声称这是已确认的常见故障。
- Desktop 签名现状：Identifier=com.anthropic.claudefordesktop，Signature=adhoc，TeamIdentifier=not set。历史维护记录提示曾重签，本轮已独立核实签名现状。它可能影响 Keychain 访问控制，但没有本次访问拒绝证据，且已测进程 token 可用，不能据此归因。
- 官方资料（本次通过代理只读获取）：
  - https://code.claude.com/docs/en/authentication
  - https://code.claude.com/docs/en/env-vars

## 网络/代理/证书
- 沙箱内最初 DNS 失败、ps 被拒绝、scutil 代理为空；随后使用获准的沙箱外只读探测确认这些是诊断上下文限制，不能当作主机故障。
- 系统代理：HTTP/HTTPS 启用，127.0.0.1:8118；SOCKS 启用，127.0.0.1:8119；PAC 关闭。MonoProxyMac 正在运行。
- curl 默认未自动采用系统 HTTP 代理；Desktop CLI 显式持有代理环境变量。这与配对实验的状态差异吻合。
- DNS：api.anthropic.com 与 claude.ai 均解析为 160.79.104.10、2607:6bc0::10。
- 默认路径与显式代理路径均协商 TLSv1.3，证书 subject 为 CN=api.anthropic.com，issuer 为 **Google Trust Services / WE1**，校验通过。代理返回 CONNECT 200 后，端点匿名请求返回 401。
- 本次两条路径未见企业证书替换；无法据此排除所有透明网络策略。
- AspectService、AspectServiceHelper、AspectSystray 正在运行，说明存在企业终端防护。没有与本次请求关联的阻断日志，不能把 EDR 存在直接等同于 403 原因。
- 默认路径返回可解析 JSON forbidden，代理路径认证行为正常；更支持出口/IP/路径相关访问策略。未查询出口公网 IP、地域或供应商后台规则，无法确定具体策略主体。

## 根因假设（排序）
1. **高：默认网络出口或路由触发访问策略，进程代理环境不一致。** 同一 token、同一端点，默认 403、代理 200；匿名请求也有 403/401 差异。这是对 403 最有力的本机证据，但尚不能确定是地域、IP 风控或其他边缘策略。
2. **中：独立 CLI 与 Desktop 凭证分离，独立 CLI 本地会话过期或无法刷新。** shell 无环境 token、Keychain 项存在，Desktop token 当前有效；旧状态与日志有刷新失败线索。但未读取 Keychain 密码或刷新，因此今日独立 CLI 的会话有效性未证实。
3. **中低：旧进程仍持有失效的环境 token，或刷新请求走了不同路径。** 官方文档支持环境 token 优先级和整会话使用；本次 14 个所测进程 token 相同且 profile 成功，故没有“当前这批 token 已过期”的证据。
4. **低：账号、组织、模型权限或额度限制。** profile 成功不等于推理成功，但匿名默认路径也 403，更优先解释为路径问题；没有证据支持立即换账号。
5. **低：企业 SSL 拦截、Keychain 访问控制或签名变化。** 企业防护与 ad-hoc 签名存在，但证书验证正常，未捕获关联拒绝。不能确认，也不能完全排除。

## 建议修复步骤（勿自动执行）
**以下均为建议，由用户确认后再执行；本次没有执行任何修复。**

1. 先确认原报错发生于终端独立 CLI 还是 Desktop Code 会话，并保留发生时间、版本与脱敏错误类型。优先让 IT 核实已批准代理路径和 API 默认出口策略；不要禁用企业防护或绕过控制。
2. 若批准使用现有代理，统一目标 CLI 启动环境与已成功路径，再由用户验证原功能；本报告未改环境变量、shell 配置、系统代理或启动进程。
3. 网络路径确认后，若独立 CLI 仍报 OAuth 过期，由用户确认再执行该 CLI 的 /login 或 claude auth login。不要先删除 Keychain 或凭证文件。
4. 仅当 Desktop 自身会话也失效时，再由用户确认在 Desktop 重新登录；当前 profile 200 不支持把 Desktop 重登录作为首选。
5. 若确定某启动器设置了过期的 CLAUDE_CODE_OAUTH_TOKEN，再由用户确认更新或移除该启动源中的冲突变量。当前 shell 无该变量，不建议盲目 unset 或全局清理。
6. 若正确网络与有效登录后仍 403，再核对组织/订阅/模型权限，联系 Anthropic 支持或 IT；换账号应在确认账号限制后考虑。

## 未查清的项 / 风险
- 未读取 Keychain secret、refresh token、Desktop cookies 或 session .key；未核实独立 CLI 的 token 到期时间、权限范围及 refresh endpoint 返回。
- 未运行完整 CLI 会话，因此本报告不声称已复现或修复原始完整错误。auth status 也未执行。
- 未测试模型推理、计费、额度、全地域出口或公司规则；profile 200 不代表所有 CLI 请求成功。
- 配置扫描覆盖常见文件和可读 plist，不覆盖所有被 source 的脚本、启动器逻辑及所有动态环境注入。
- 日志只做有限文件和固定字符串命中扫描，未全面读取聊天记录。旧日志与旧 bridge 缓存不作为当前故障确证。
- 其他 Claude 进程持续运行，文件 mtime 可能因其自身活动变化；本诊断未主动改写登录态，不能承诺其他进程期间完全无写入。
- 含 token 的 GET 仅向官方 API 发出；响应内容留在内存，报告只保留 HTTP 状态和错误类型。没有凭证原文进入报告或 stdout。

## 补充：为何 Codex CLI 走代理、独立 Claude CLI 不走（2026-11-02 20:57 Asia/Shanghai）

只读复核 machineId `2318f63f-0706-44d4-9585-af22f49377dc`（tumars-MBP.local）。未改配置、未发消息、未贴 token。

### 结论（一两句）
MonoCloud/MonoProxyMac 已开，且 **macOS 系统代理**（Wi-Fi HTTP/HTTPS → `127.0.0.1:8118`，SOCKS → `8119`）正常；但 **独立终端里的 Claude CLI（Node/nvm）不会自动读系统代理**，当前 shell 也 **没有** `HTTP(S)_PROXY`。Codex CLI 在 `~/.codex/config.toml` 里开了 **`respect_system_proxy = true`**，因此能跟系统代理走。

### 证据对照

| 项 | 状态 |
| --- | --- |
| MonoProxyMac | 进程在跑；LISTEN `127.0.0.1:8118` / `8119` |
| `scutil --proxy` / Wi-Fi | HTTP/HTTPS Enable=1 → 127.0.0.1:8118；SOCKS → 8119 |
| 终端 `printenv` 代理变量 | **无** `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`（及小写） |
| `launchctl getenv` 代理 | 空 |
| `~/.zshrc` | 仅有 alias `claude-proxy=...8118... && claude`；**未** `export` 常驻代理 |
| 独立 `claude` | nvm：`~/.nvm/versions/node/v24.15.0/bin/claude` → `@anthropic-ai/claude-code` **2.1.215** |
| `codex` | Homebrew Mach-O：`/opt/homebrew/bin/codex` **0.161.0**；`[features] respect_system_proxy = true` |
| Claude Desktop 主进程 | 未见 `*_PROXY` |
| Desktop 内置 claude-code 子进程（如 2.1.308） | **有** `HTTPS_PROXY`/`HTTP_PROXY=http://127.0.0.1:8118` 与 `NO_PROXY`（Desktop 注入，与终端独立 CLI 不同） |

因此：开了 MonoCloud ≠ 所有 CLI 自动走代理。Codex 显式尊重系统代理；Node 版 Claude CLI 依赖环境变量（或 Desktop 注入）。直接敲 `claude` 不会触发 `claude-proxy` alias。

### 可执行修复（由用户自行执行；本轮未改）

**A. 终端临时验证（当前会话）**
```bash
export HTTP_PROXY=http://127.0.0.1:8118
export HTTPS_PROXY=http://127.0.0.1:8118
export http_proxy="$HTTP_PROXY"
export https_proxy="$HTTPS_PROXY"
export NO_PROXY=localhost,127.0.0.1,::1,.local
# 可选：export ALL_PROXY=socks5://127.0.0.1:8119
claude --version
# 再试原先失败的命令；可用：env | rg -i '^(http|https|all|no)_?proxy='
```
或继续用已有 alias：`claude-proxy`（仅该次启动生效）。

**B. 写入 shell 常驻（推荐给独立 CLI）** — 在 `~/.zshrc` 增加（勿把 alias 当成 export）：
```bash
# MonoCloud / MonoProxyMac — Claude CLI (Node) needs explicit env; Codex uses respect_system_proxy
export HTTP_PROXY=http://127.0.0.1:8118
export HTTPS_PROXY=http://127.0.0.1:8118
export http_proxy="$HTTP_PROXY"
export https_proxy="$HTTPS_PROXY"
export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,::1,.local}"
```
然后 `source ~/.zshrc` 或开新终端。若用 bash，写到 `~/.bash_profile`。

**C. 给 GUI / 非 login shell 继承（可选）**
```bash
launchctl setenv HTTP_PROXY http://127.0.0.1:8118
launchctl setenv HTTPS_PROXY http://127.0.0.1:8118
launchctl setenv NO_PROXY 'localhost,127.0.0.1,::1,.local'
# 改完后需重启从 Dock/Finder 拉起的 App；终端已开窗口需重开
```
注意：Claude Desktop 子进程当前已自带 8118；若 Desktop 正常可不必强行改主进程。独立 CLI 仍以 B 为主。

**D. Desktop vs CLI**
- 终端独立 `claude`（nvm 2.1.215）：必须显式 `HTTPS_PROXY`（A/B）。
- Desktop 内置 CLI：已注入代理；若仍 403，对照本报告前文「默认出口 vs 代理」与凭证分离，而不是「没开 MonoCloud」。
- Codex：保持 `respect_system_proxy = true` 即可；与 Claude 修复正交。

**E. 自检**
```bash
scutil --proxy | rg 'HTTPEnable|HTTPProxy|HTTPPort|HTTPS'
lsof -nP -iTCP:8118 -sTCP:LISTEN
printenv | rg -i '^(http|https|all|no)_?proxy='
# 显式经代理探活（不贴响应正文/token）：
curl -sS -o /dev/null -w '%{http_code}\n' -x http://127.0.0.1:8118 https://api.anthropic.com/
```

### 勿做
- 不要为了「通代理」粘贴或导出 OAuth/API token。
- 不要关掉企业防护或改 MonoCloud 白名单除非 IT 批准。
- 不要假设 `alias claude-proxy` 已等于全局代理已开。
