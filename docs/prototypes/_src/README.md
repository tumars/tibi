# 原型构建源文件

v2 原型页面共用 `../v2.css` 与 `../v2-shell.js`。这里是生成各页面的辅助源文件（仅原型阶段使用）：

- `_build_side.py`：共用侧栏 HTML 与页面头部
- `_reader_shell.html` + `build_reader.py`：阅读器 v2 外壳，交互逻辑复用 `../v1/reader.html` 的脚本并改造为浮层词卡 / 按需抽屉
- `_words_body.html`：生词本 v2 页面主体
- `_review_body.html`：复习页主体（生成 `review.html`；含"练习"分段，网址加 `#practice` 直接进入）
- `_stats_body.html`：统计页主体（生成 `stats.html`）
- `_settings_body.html`：设置页主体（生成 `settings.html`）
- `_tasks_body.html`：任务中心主体（生成 `tasks.html`）
- `_library_body.html`：书架页主体（生成 `library.html`，侧栏高亮"书架"项）
- `../onboarding.html`：首次启动引导，独立单文件（复用 `v2.css`、`v2-shell.js`、`v2-fox.js`，左栏用 `img/mascot/` 的插画），不经过构建脚本
- `../mobile.html`：手机版原型，独立单文件（只复用 token、`v2-fox.js`、`v2-agents.js`），不经过构建脚本
- `../v2-fox.js`：吉祥物藏狐（SVG + CSS 动画，`Fox.mount` / `set` / `pulse`），首页、复习页与手机版使用；展示页 `../mascot.html`。直接编辑，不需要生成
- `../v2-agents.js`：智能体目录（名字、说明、图标、模型档、能力、定时），首页、设置、任务中心共用；直接编辑，不需要生成
- `_search.js` + `build_search.py`：搜索面板源码；`build_search.py` 从 `words.html` 取出词表注入后生成 `../v2-search.js`（需要 node）
- `build_pages.py`：把共用侧栏、页面头部和脚本拼进复习、统计、设置、任务、书架页的主体，生成对应页面

`_words_body.html` 的词表数据（`%DATA%`）取自 v1，`words.html` 生成后又直接改过，修改生词本时直接改 `words.html`，并同步改源文件里的样式。

在 `docs/prototypes/` 目录下运行 `python3 _src/build_reader.py` 重新生成阅读器（之后的小改动直接改生成后的文件即可）。

在 `docs/prototypes/` 目录下运行 `python3 _src/build_pages.py` 重新生成复习、统计、设置、任务、书架页。**这五页只改 `_src/_<name>_body.html`，不要直接改生成后的 `<name>.html`**——构建会整页覆盖（2026-10-30 复习页的 D11 改动就因此丢过一次）。改了界面文字后需要重新生成普惠体子集（见 `../fonts/README.md`）。

注意：阅读器的"标注说明"浮层脚本直接写在 `reader.html` 末尾（`build_reader.py` 未纳入），重新生成阅读器后需手动补回。
