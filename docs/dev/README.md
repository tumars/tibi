# 开发说明

> 状态：M0 进行中（2026-10-31 开工）。设计以 `docs/design/` 为准，这里只写"怎么跑、代码在哪、怎么改"。

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
      test/               vitest；helpers.ts 的 makeCore() 给出内存库 + 假平台
    core-node/            @tibi/core-node：Node 运行时。better-sqlite3 驱动、undici fetch + Readability、HTML→Markdown、
                          stdio / WebSocket 传输、启动入口 bin.ts、ECDICT 入库脚本；打包成 Tauri sidecar
  apps/
    desktop/              @tibi/desktop：Tauri 2 壳（src-tauri）+ React 界面（src）
  docs/                   设计文档、原型、调研（文档即代码）
  tools/                  gen-mascot.py 等脚本
```

## 2. 常用命令

```bash
pnpm install                       # 装依赖（better-sqlite3、esbuild 的构建脚本已在 package.json 里允许）
pnpm test                          # 全部单测（vitest）
pnpm -r typecheck                  # 各包类型检查
pnpm core:dev                      # 起 Core 开发桥：ws://127.0.0.1:3456（JSON-RPC，协议同 stdio），库在 .tibi/app.db
pnpm --filter @tibi/desktop web    # 浏览器里跑界面，连上面的开发桥（无需编译 Rust）
pnpm dev                           # tauri dev（需要 Rust 工具链与系统库）
pnpm --filter @tibi/core-node build   # 打包 dist/tibi-core.js（sidecar 的 JS）
pnpm --filter @tibi/core-node sidecar # Bun --compile 单文件 sidecar → apps/desktop/src-tauri/binaries/
pnpm --filter @tibi/core gen          # 改了 sql/*.sql 或 skills/*.md 后重新生成内嵌文件
pnpm ecdict                        # 下载 ECDICT 并生成 data/dict.db（不进仓库）
```

Core 的 stdio 协议（06 §1）：每行一条 JSON。壳 → Core 请求 `{jsonrpc, id, method, params}`；Core → 壳 响应 `{jsonrpc, id, result | error}`、事件 `{jsonrpc, method: 'event', params: {event, data}}`、反向请求 `{jsonrpc, id: 'h-n', method: 'secret.get', params: {ref}}`（壳回 `{id, result: {secret}}`）。日志只走 stderr。

## 3. 怎么改

- **表结构**：只加新的 `packages/core/sql/NNNN_*.sql`，不改旧的；同时改 `docs/design/01-database.md`。
- **接口**：先改 `docs/design/_src/build_interface.py` 并运行，再改 `packages/core/src/types.ts` 与对应方法；方法定义用 `method(TypeBoxSchema, handler)`，错误抛 `TibiError(code, message)`。
- **能力**：`capability({ name, description, params, perm, run })`，同一份定义给技能（pi 工具）、MCP、界面直接调用。
- **写操作**：走 `recordUndo` / `registerUndo`（撤销）、发 `data.changed` 事件；id 用 `uuidv7()`；写入带 `updated_at`；删除写 `deleted_at`；只追加的表不 UPDATE（08 §9 的五条约定）。
- **文档即代码**：实现与设计不一致时改设计文档，并在 `docs/CHANGELOG.md` 记一行；技术决定记在 `docs/DECISIONS.md` 的 T 组。

## 4. M0 的技术决定（T 组）

见 [`docs/DECISIONS.md`](../DECISIONS.md#m0-技术决定t-组)。
