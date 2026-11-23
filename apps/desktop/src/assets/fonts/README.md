# 应用字体资源

- `yozai-medium.woff2`：首页标题字体，许可见 `Yozai-OFL.txt`。
- `source-serif-4-latin-normal.woff2` / `source-serif-4-latin-italic.woff2`：阅读页英文正文与标题，Google Fonts 提供的 Source Serif 4 Latin 可变字体，字重 400–700、自动光学尺寸。两文件共 252,108 字节，CSS 为 `src/reader/fonts.css`；书架、词卡等位置保留原有字体。

Source Serif 4 使用 SIL OFL 1.1，许可原文在 [`public/licenses/SourceSerif4-OFL.txt`](../../../public/licenses/SourceSerif4-OFL.txt)，构建时随静态资源一同分发。文件未经自行转码，下载地址与 SHA-256 见[原型字体来源记录](../../../../../docs/prototypes/fonts/reading/README.md)。Latin 字集以外回退到 Charter / Charis SIL / Georgia，中文译文仍用系统字体。
