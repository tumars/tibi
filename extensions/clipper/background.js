// 剪藏插件（00 §3.1 R4）：只有"发送到 Tibi"一个动作。
// 只用 activeTab 拿当前标签页的网址（只发 http / https），通过深链 tibi://import?url=… 交给 Tibi；
// 应用没开时由系统拉起。不读页面内容、不用本地服务和 native messaging、不登录。
// Tibi 收到后先弹确认卡，用户确认才抓取（05 §8）。
const api = globalThis.browser ?? globalThis.chrome;

function flash(tabId, text, color) {
  api.action.setBadgeBackgroundColor({ tabId, color });
  api.action.setBadgeText({ tabId, text });
  setTimeout(() => api.action.setBadgeText({ tabId, text: '' }), 2500);
}

api.action.onClicked.addListener(async tab => {
  const url = tab?.url ?? '';
  if (!/^https?:\/\//i.test(url)) {
    api.action.setTitle({ tabId: tab.id, title: '这一页不能发送：只支持 http / https 网页' });
    flash(tab.id, '!', '#c2410c');
    return;
  }
  const deep = 'tibi://import?url=' + encodeURIComponent(url);
  try {
    // 让当前标签页"打开"深链：浏览器会弹"要打开 Tibi 吗"，页面本身不会离开
    await api.tabs.update(tab.id, { url: deep });
    api.action.setTitle({ tabId: tab.id, title: '已发送到 Tibi' });
    flash(tab.id, '✓', '#3d52e0');
  } catch (e) {
    api.action.setTitle({ tabId: tab.id, title: '没能打开 Tibi：' + (e?.message ?? e) });
    flash(tab.id, '!', '#c2410c');
  }
});
