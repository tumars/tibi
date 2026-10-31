/* Tibi v2 共享外壳脚本：工具函数、页面互链、侧栏折叠、深浅色、提示条、滚动条。
   依赖（可缺省）：Motion、OverlayScrollbars。 */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LOCAL = location.protocol === 'file:';
const URLS = LOCAL
  ? { home: 'home.html', reader: 'reader.html', words: 'words.html', review: 'review.html', stats: 'stats.html', settings: 'settings.html', tasks: 'tasks.html', mobile: 'mobile.html', library: 'library.html', onboarding: 'onboarding.html' }
  : { home: 'https://claude.ai/artifact/25jzi4f4fvQg9qbpiQziqd', reader: 'https://claude.ai/artifact/WoQdUMnm2aTwoEaaW2uGiM', words: 'https://claude.ai/artifact/FqP5DF1DAyKoSPj3Ek8AEf', review: 'https://claude.ai/artifact/FTUFPKbBTQ2EV7NmkE8VF4', stats: 'https://claude.ai/artifact/Ry1MR9bvumcJ1cvMZYiH15', settings: 'https://claude.ai/artifact/4os2bCRwuuHXpXp6JYB8pA', tasks: 'https://claude.ai/artifact/FPy1wjttFMjohaYoZ4PWez', mobile: 'https://claude.ai/artifact/9V1ocjyp3cDBiT9aUbkinn', library: 'https://claude.ai/artifact/Cqyenzc3YMxdDTMfKRgrWo', onboarding: 'https://claude.ai/artifact/NbaX6HBbBSW6rmvM9fTPM3' };
const ext = a => { if (a && !LOCAL) { a.target = '_blank'; a.rel = 'noopener'; } };
const M = window.Motion, REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches, EASE = [0.22, 0.8, 0.24, 1];
const anim = (el, kf, o) => { if (!M || REDUCE || !el || el.length === 0) return null; try { return M.animate(el, kf, o); } catch (e) { return null; } };
const stag = (d, o) => (M && M.stagger ? M.stagger(d, o) : 0);
const SPRING = { type: 'spring', bounce: 0.18, duration: 0.5 };
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function osInit(el) {
  const OSG = window.OverlayScrollbarsGlobal; if (!OSG || !el) return el;
  try { return OSG.OverlayScrollbars(el, { overflow: { x: 'hidden' }, scrollbars: { theme: 'os-theme-lexi', autoHide: 'scroll', autoHideDelay: 900, clickScroll: true } }).elements().viewport; } catch (e) { return el; }
}
let toastT;
function toast(t, undoFn, label = '撤销') {   // 第三个参数可把按钮改成别的动作，如「开始阅读」
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.hidden = true; document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(t)}</span>${undoFn ? ' <button style="margin-left:12px;text-decoration:underline;color:inherit;font-weight:500">' + esc(label) + '</button>' : ''}`;
  if (undoFn) el.querySelector('button').onclick = () => { undoFn(); el.hidden = true; };
  const was = el.hidden; el.hidden = false;
  if (was) anim(el, { opacity: [0, 1], y: [12, 0] }, { type: 'spring', bounce: 0.2, duration: 0.45 });
  clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3400);
}
/* 涂鸦封面：rough.js 程序化生成（正式版可替换为图像模型生成的插画） */
/* 外壳：侧栏折叠、窄屏菜单、深浅色、页面互链、未做页面提示 */
const shellHooks = { theme: [] };
function initShell(opts = {}) {
  const app = $('#app');
  const onLayout = () => (opts.onLayout || (() => {}))();
  if (opts.collapsed) app.classList.add('collapsed');
  const cb = $('#collapseBtn'); if (cb) cb.onclick = () => { app.classList.toggle('collapsed'); setTimeout(onLayout, 380); };
  const mb = $('#menuBtn'); if (mb) mb.onclick = () => app.classList.toggle('menu');
  const tb = $('#themeBtn'); if (tb) tb.onclick = () => {
    const r = document.documentElement, dark = matchMedia('(prefers-color-scheme: dark)').matches; const cur = r.dataset.theme || (dark ? 'dark' : 'light');
    r.dataset.theme = cur === 'dark' ? 'light' : 'dark'; setTimeout(() => shellHooks.theme.forEach(f => f()), 30);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(() => shellHooks.theme.forEach(f => f()), 30));
  document.querySelectorAll('[data-link]').forEach(a => { a.href = URLS[a.dataset.link]; ext(a); });
  document.querySelectorAll('[data-todo]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); toast(`「${a.dataset.todo}」的原型还没做`); }));
  phoneHint();
  const ring = $('#ringArc'); if (ring) { ring.setAttribute('stroke-dashoffset', 87.96 * 0.4); anim(ring, { strokeDashoffset: [87.96, 87.96 * 0.4] }, { duration: 1, ease: EASE, delay: 0.3 }); }
  addEventListener('keydown', e => { if (!(e.metaKey || e.ctrlKey)) return; if (e.key === '\\') { e.preventDefault(); cb && cb.click(); } else if (e.key.toLowerCase() === 'k') { e.preventDefault(); const sb = document.querySelector('.newbtn.search'); sb && sb.click(); } });
}
function moveThumb(group, animate) {
  const b = group && group.querySelector('button.on'), t = group && group.querySelector('.thumb'); if (!b || !t) return;
  if (animate && M && !REDUCE) anim(t, { x: b.offsetLeft - 3, width: b.offsetWidth + 'px' }, { type: 'spring', bounce: 0.2, duration: 0.4 });
  else { t.style.transform = `translateX(${b.offsetLeft - 3}px)`; t.style.width = b.offsetWidth + 'px'; }
}

/* 吉祥物插画（@1x / @2x） */
const mascotImg = id => `<img src="img/mascot/${id}.webp" srcset="img/mascot/${id}.webp 1x, img/mascot/${id}@2x.webp 2x" alt="">`;
/* 空状态：吉祥物 + 标题 + 说明 + 动作。actions: [{t, pri, link, onclick}] */
function emptyState(el, { state = 'idle', img, title, desc, actions = [], cls = '', extra = '' } = {}) {
  el.innerHTML = `<div class="empty ${cls}"><div class="fx${img ? ' art' : ''}">${img ? mascotImg(img) : ''}</div><h3>${title}</h3>${desc ? `<p>${desc}</p>` : ''}${extra}${actions.length ? `<div class="acts">${actions.map((a, i) => a.link ? `<a class="btn${a.pri ? ' pri' : ''}" data-link="${a.link}" href="#">${a.t}</a>` : `<button class="btn${a.pri ? ' pri' : ''}" data-ea="${i}">${a.t}</button>`).join('')}</div>` : ''}</div>`;
  if (!img && window.Fox) Fox.mount(el.querySelector('.fx'), { state, size: 132, interactive: true });
  el.querySelectorAll('[data-link]').forEach(a => { a.href = URLS[a.dataset.link]; ext(a); });
  el.querySelectorAll('[data-ea]').forEach(b => b.onclick = actions[+b.dataset.ea].onclick);
  anim(el.firstElementChild, { opacity: [0, 1], y: [8, 0] }, { duration: 0.4, ease: EASE });
}
/* 原型演示：用 #empty 切换“有数据 / 空状态” */
const IS_EMPTY = location.hash === '#empty';
function demoToggle() {
  const b = document.createElement('button'); b.className = 'demo-tog'; b.title = '原型演示开关';
  b.innerHTML = `原型演示：<b>${IS_EMPTY ? '空状态' : '有数据'}</b> · 切换到${IS_EMPTY ? '有数据' : '空状态'}`;
  b.onclick = () => { location.hash = IS_EMPTY ? '' : '#empty'; location.reload(); };
  document.body.appendChild(b);
}

/* 桌面原型在手机上打开时的提示（桌面应用最小窗口 960px，手机端是独立的壳） */
function phoneHint() {
  if (!(screen.width < 760 || (visualViewport && visualViewport.width < 760))) return; /* 桌面页有 min-width，innerWidth 不可靠 */
  const d = document.createElement('div'); d.className = 'phone-hint';
  d.innerHTML = `这是桌面版原型（窗口最小 960px）。手机上请看 <a href="${URLS.mobile}">手机版原型</a>`; ext(d.querySelector('a'));
  document.body.appendChild(d);
}
