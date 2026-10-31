# 参与 Tibi

谢谢你愿意帮忙。下面是让改动顺利合进来的约定。（English speakers: issues and PRs in English are welcome too.）

## 先说一声

- **小改动**（错别字、明显的 bug、文案）：直接提 PR。
- **新功能、改交互、改数据结构**：先开一个 issue 说说想法，免得白做。Tibi 的设计在 `docs/design/` 里，很多取舍都有记录（[DECISIONS.md](docs/DECISIONS.md)），先看一下能省很多来回。

## 跑起来

需要 Node 22、pnpm 10；要跑桌面壳还要 Rust 和 [Tauri 的系统依赖](https://tauri.app/start/prerequisites/)。

```bash
pnpm install
pnpm ecdict                          # 可选：下载并生成词典（几分钟），没有词典时退化为规则还原
pnpm core:dev -- --fake-model        # Core 开发桥，假模型不联网
pnpm --filter @tibi/desktop web      # 浏览器打开 http://localhost:1420
```

更多命令、仓库结构见 [开发说明](docs/dev/README.md)。

## 提交前

```bash
pnpm -r typecheck
pnpm test
pnpm --filter @tibi/desktop i18n:check   # 改了界面文案时
```

CI 会跑同样的检查，外加 `cargo clippy` 和"内嵌文件是否最新"（改了 `packages/core/sql`、`skills`、`samples` 后要跑 `pnpm --filter @tibi/core gen`）。

## 约定

- **文档即代码**：实现和设计不一致时改设计文档（`docs/design/`），在 [CHANGELOG.md](docs/CHANGELOG.md) 记一行；技术决定记在 [DECISIONS.md](docs/DECISIONS.md) 的 T 组。PR 里改了行为却没改文档，评审会请你补上。
- **接口**：先改 `docs/design/_src/build_interface.py` 并运行，再改代码（详见开发说明 §3）。
- **表结构**：只加新的迁移文件，不改旧的。
- **界面文案**：直接写中文，用 `tl('…')` 包起来，有变量用 `{name}` 占位，不要把一句话拆成几段；然后 `i18n:sync` 并补英文。
- **写操作**要能撤销、要发 `data.changed` 事件；AI 的写操作走能力层和审批。
- **文案风格**：短、直接、平和；不用感叹号和"您"；Tibi 说话像一个安静的学习伙伴。
- 提交信息用一句话说清改了什么，中英文都可以。

## 许可

提交代码即表示你同意以 [MIT](LICENSE) 协议发布你的贡献。

参与即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。
