# 发送到 Tibi（浏览器剪藏插件）

设计见 [00 §3.1 剪藏插件](../../docs/design/00-concept-design.md)（R4）。只有一个动作：把当前网页的网址交给 Tibi 导入。

- 权限只有 `activeTab`：点按钮时才拿到当前标签页的网址；不读页面内容，不访问其他网站。
- 只发送 http / https 网址。通过深链 `tibi://import?url=…` 打开 Tibi，应用没开时由系统拉起。
- Tibi 收到后弹确认卡（显示站点和网址），确认后才抓取；取消则什么都不留。
- 快捷键：Alt+Shift+T（可在浏览器的扩展快捷键设置里改）。

## 安装（开发版）

Chrome / Edge：打开 `chrome://extensions`（Edge 是 `edge://extensions`），打开"开发者模式"，点"加载已解压的扩展程序"，选这个目录。

第一次发送时浏览器会问"要打开 Tibi 吗"，勾选"始终允许"后以后不再问。

## 发布

打包：`pnpm clipper:zip`（生成 `extensions/clipper/dist/tibi-clipper-<版本>.zip`），再提交到 Chrome 网上应用店 / Edge 加载项。上架前确认商店说明里写清楚只有 activeTab 权限、不收集任何数据。
