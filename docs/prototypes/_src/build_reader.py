import sys, re
sys.path.insert(0, '_src')
from _build_side import side, HEAD
v1 = open('v1/reader.html').read()
a = v1.index('<script>\n/* ============ 滚动条'); js = v1[a + len('<script>\n'): v1.rindex('</script>')]
def rep(o, n, cnt=1):
    global js
    assert o in js, 'MISS ' + o[:90]; js = js.replace(o, n, cnt)
# 侧栏不再整体套 OverlayScrollbars
rep("const READER = osInit('#reader'), PBODY = osInit('#pbody');\nosInit('#rail');", "const READER = osInit('#reader'), PBODY = osInit('#pbody');")
# 外壳：页面互链、折叠、菜单、深浅色
rep("/* ============ 示例数据", """/* ============ 外壳（与 v2-shell.js 行为一致） ============ */
const URLS = location.protocol === 'file:' ? { home: 'home.html', reader: 'reader.html', words: 'words.html' } : { home: 'https://claude.ai/artifact/25jzi4f4fvQg9qbpiQziqd', reader: 'https://claude.ai/artifact/WoQdUMnm2aTwoEaaW2uGiM', words: 'https://claude.ai/artifact/FqP5DF1DAyKoSPj3Ek8AEf' };
document.querySelectorAll('[data-link]').forEach(a => { a.href = URLS[a.dataset.link]; if (location.protocol !== 'file:') { a.target = '_blank'; a.rel = 'noopener'; } });
document.querySelectorAll('[data-todo]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); showToast(`「${a.dataset.todo}」的原型还没做`); }));
document.getElementById('collapseBtn').onclick = () => { document.getElementById('app').classList.toggle('collapsed'); setTimeout(() => { moveTabDot(false); rr(); }, 380); };
document.getElementById('menuBtn').onclick = () => document.getElementById('app').classList.toggle('menu');
addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === '\\\\') { e.preventDefault(); document.getElementById('collapseBtn').click(); } });

/* ============ 示例数据""")
rep("$('#rail').classList.remove('open');", "$('#app').classList.remove('menu');")
# 标签滑块
i = js.index('function moveTabDot(animate) {'); j = js.index('\n}\n', i) + 3
js = js[:i] + """function moveThumbG(g, animate) {
  const b = g && g.querySelector('button.on'), t = g && g.querySelector('.thumb'); if (!b || !t) return;
  if (animate && M && !REDUCE) anim(t, { x: b.offsetLeft - 3, width: b.offsetWidth + 'px' }, { type: 'spring', bounce: 0.2, duration: 0.4 });
  else { t.style.transform = `translateX(${b.offsetLeft - 3}px)`; t.style.width = b.offsetWidth + 'px'; }
}
function moveTabDot(animate) { moveThumbG($('#dtabs'), animate); }
""" + js[j:]
# 抽屉与词卡浮层
i = js.index('function switchTab(t) {'); j = js.index('\n}\n', i) + 3
js = js[:i] + """const drawerOpen = () => $('#app').classList.contains('drawer-open');
const TAB_BTN = { sum: 'sumBtn', vocab: 'vocabBtn', asst: 'lexiBtn' };
function markTopBtns(t) { Object.entries(TAB_BTN).forEach(([k, id]) => $('#' + id).classList.toggle('on', drawerOpen() && k === t)); }
function openDrawer() { if (drawerOpen()) return; $('#app').classList.add('drawer-open'); setTimeout(() => { moveTabDot(false); rr(); placePop(); }, 380); }
function closeDrawer() { $('#app').classList.remove('drawer-open'); markTopBtns(null); setTimeout(() => { rr(); placePop(); }, 380); }
function switchTab(t) {
  if (t === 'card') { openPop(); return; }
  document.querySelectorAll('#dtabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  ['sum', 'asst', 'vocab'].forEach(k => $('#pane-' + k).hidden = k !== t);
  $('#composer').hidden = t !== 'asst';
  if (t === 'sum') renderSum(); if (t === 'asst') renderAsst(); if (t === 'vocab') renderVocab();
  openDrawer(); moveTabDot(true); markTopBtns(t);
  anim($('#pane-' + t), { opacity: [0, 1], y: [8, 0] }, { duration: 0.35, ease: EASE });
}
function toggleTab(t) { if (drawerOpen() && !$('#pane-' + t).hidden) closeDrawer(); else switchTab(t); }
// 词卡浮层：贴着选中的词出现，空间不够时翻到上方；窄屏改为底部抽屉
function placePop() {
  const p = $('#wpop'); if (p.hidden || false) return;
  const el = selEl && selEl.isConnected ? selEl : document.querySelector('#page .w.sel, #page .ph.sel'); if (!el) return;
  const r = el.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight;
  const x = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), innerWidth - pw - 12);
  let y = r.bottom + 10; if (y + ph > innerHeight - 12) y = Math.max(12, r.top - ph - 10);
  p.style.left = x + 'px'; p.style.top = y + 'px';
}
function openPop() { const p = $('#wpop'), was = p.hidden; p.hidden = false; if (was) p.classList.remove('more'); placePop(); if (was) anim(p, { opacity: [0, 1], y: [6, 0], scale: [0.98, 1] }, { type: 'spring', bounce: 0.18, duration: 0.4 }); }
function closePop() { $('#wpop').hidden = true; }
""" + js[j:]
rep("const active = document.querySelector('.tab.on').dataset.tab;", "const active = (document.querySelector('#dtabs button.on') || {}).dataset.tab;")
# 所在句子默认折叠到"更多"
rep("return `<div class=\"sec\"><h5>所在句子</h5>", "return `<button class=\"linkbtn morebtn\" id=\"moreBtn\">所在句子、翻译与解析 ▾</button><div class=\"sec sentsec\"><h5>所在句子</h5>")
rep("  const t = $('#trBtn'); if (!t) return;", "  if ($('#moreBtn')) $('#moreBtn').onclick = () => { $('#wpop').classList.toggle('more'); $('#moreBtn').textContent = $('#wpop').classList.contains('more') ? '收起 ▴' : '所在句子、翻译与解析 ▾'; placePop(); };\n  const t = $('#trBtn'); if (!t) return;")
# 点词：打开浮层
rep("""  const t = document.querySelector('.tab.on').dataset.tab;
  if (t !== 'card' && t !== 'asst') switchTab('card');
  if (t === 'asst') renderAsst();
  if (false) $('#panel').classList.add('open');""", """  openPop();
  if (drawerOpen() && !$('#pane-asst').hidden) renderAsst();""")
rep("  refresh(); renderCard();\n}\n$('#page').addEventListener", "  refresh(); renderCard(); openPop();\n}\n$('#page').addEventListener")
rep("  if (k === 'escape') { selected = null; $('#settings').hidden = true; $('#panel').classList.remove('open'); refresh(); renderCard(); return; }",
    "  if (k === 'escape') { if (!$('#wpop').hidden) { selected = null; closePop(); refresh(); return; } $('#settings').hidden = true; closeDrawer(); return; }")
# 去掉 v1 的左栏配色、面板、标签按钮
i = js.index("$('#palSeg').onclick"); j = js.index('};\n', i) + 3; js = js[:i] + js[j:]
rep("document.querySelectorAll('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));",
    """document.querySelectorAll('#dtabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
$('#sumBtn').onclick = () => toggleTab('sum'); $('#vocabBtn').onclick = () => toggleTab('vocab'); $('#lexiBtn').onclick = () => toggleTab('asst');
$('#closeDrawer').onclick = closeDrawer;
$('#wpopClose').onclick = () => { selected = null; closePop(); refresh(); };
document.addEventListener('mousedown', e => {
  if ($('#wpop').hidden) return;
  if ($('#wpop').contains(e.target) || e.target.closest('#page .w') || e.target.closest('#selTool') || e.target.closest('#toast') || e.target.closest('.tools')) return;
  selected = null; closePop(); refresh();
});
addEventListener('resize', placePop);""")
rep("$('#sheetClose').onclick = () => $('#panel').classList.remove('open');\n", "")
rep("$('#railBtn').onclick = () => $('#rail').classList.toggle('open');\n", "")
i = js.index("// 返回首页：本地打开时"); j = js.index('\n', js.index('\n', i) + 1) + 1; js = js[:i] + js[j:]
rep("READER.addEventListener('scroll', () => {", "READER.addEventListener('scroll', () => {\n  placePop();")
# 深浅色切换按钮不在阅读器顶栏；跟随设置中的"纸面"
rep("anim(document.querySelectorAll('.docitem, .toc button, .legend > div')", "document.getElementById('ringArc').setAttribute('stroke-dashoffset', 87.96 * 0.4);\nanim(document.querySelectorAll('.docitem, .toc button')")
# 选中状态改变后浮层位置/关闭
rep("const ICON_SPK", "const _renderCard = renderCard;\nrenderCard = function () { _renderCard(); if (!selected) closePop(); else placePop(); };\nconst ICON_SPK")
for bad in ["#panel", "'.tab'", "#railBtn", "#sheetClose", "#palSeg", "#tabdot"]:
    assert bad not in js, bad
shell = open('_src/_reader_shell.html').read()
sb = side('none').replace('id="side"', 'id="rail"')
sb = sb.replace('<div class="sideh hide-c" id="sideH">最近</div>\n    <div class="recent hide-c" id="recent"></div>',
  '<div class="sideh hide-c" id="docH">书架</div>\n    <div class="hide-c" id="doclist"></div>\n    <div id="tocWrap" class="hide-c"><div class="sideh">目录</div><div class="toc" id="toc"></div></div>')
assert 'doclist' in sb
shell = shell.replace('%SIDE%', sb)
scripts = '''<script src="https://cdn.jsdelivr.net/npm/motion@11.11.17/dist/motion.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/overlayscrollbars/2.10.1/browser/overlayscrollbars.browser.es6.min.js"></script>
'''
open('reader.html', 'w').write(HEAD.format(title='Tibi 阅读器') + shell + '\n' + scripts + '<script>\n' + js + '</script>\n')
print('ok', len(js))
