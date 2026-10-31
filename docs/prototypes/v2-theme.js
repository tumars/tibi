/* Tibi v2 深浅色：在 <head> 里最先加载，所有页面共用。记住用户的选择，并让 #themeBtn 的图标跟随当前主题。
   各页面的切换入口（顶栏按钮、设置、搜索面板、阅读器纸面）只需改 <html data-theme>，这里统一保存。 */
(function () {
  const KEY = 'tibi-theme', r = document.documentElement, sys = matchMedia('(prefers-color-scheme: dark)');
  const MOON = '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>';
  const SUN = '<circle cx="12" cy="12" r="4"/><path stroke-linecap="round" d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>';
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') r.dataset.theme = v; } catch (e) {}
  function paint() {
    const b = document.getElementById('themeBtn'), svg = b && b.querySelector('svg'); if (!svg) return;
    const dark = (r.dataset.theme || (sys.matches ? 'dark' : 'light')) === 'dark';
    svg.innerHTML = dark ? SUN : MOON; b.title = dark ? '切换到浅色' : '切换到深色'; b.setAttribute('aria-label', b.title);
  }
  new MutationObserver(() => {
    try { if (r.dataset.theme) localStorage.setItem(KEY, r.dataset.theme); else localStorage.removeItem(KEY); } catch (e) {}
    paint();
  }).observe(r, { attributes: true, attributeFilter: ['data-theme'] });
  sys.addEventListener('change', paint);
  document.addEventListener('DOMContentLoaded', paint);
})();
