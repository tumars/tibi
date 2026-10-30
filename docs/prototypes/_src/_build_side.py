# 生成 v2 页面共用的侧栏 HTML（原型构建辅助脚本）。用法：from _build_side import side; side('words')
I = {
  'home': '<path d="M4 11l8-6 8 6v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z"/>',
  'shelf': '<path d="M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.8-1 3 15.5-3.8 1z"/>',
  'words': '<path d="M6 4h11a1 1 0 011 1v15l-6.5-3.5L5 20V5a1 1 0 011-1z"/>',
  'review': '<path d="M20 12a8 8 0 11-2.3-5.6M20 4v4h-4"/>',
  'stats': '<path d="M5 19V11M12 19V5M19 19v-6"/>',
  'tasks': '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11M4 18l1.2 1.2L7.5 17"/>',
}
SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">{}</svg>'

def side(cur):
    def item(key, label, extra='', link=None, todo=None):
        attrs = f' data-link="{link}"' if link else (f' data-todo="{todo}"' if todo else '')
        c = ' class="cur"' if key == cur else ''
        href = '#'
        return f'      <a href="{href}"{c}{attrs if key != cur else ""} title="{label}">{SVG.format(I[key])}<span class="hide-c">{label}</span>{extra}</a>\n'
    nav = (item('home', '首页', link='home') + item('shelf', '书架', '<span class="n hide-c">8</span>', link='library')
           + item('words', '生词本', '<span class="n hide-c" id="navWords">33</span>', link='words')
           + item('review', '复习', '<span class="n badge hide-c">18</span>', link='review') + item('stats', '统计', link='stats') + item('tasks', '任务', '<span class="n badge hide-c" id="navTasks">3</span>', link='tasks'))
    return f'''  <aside class="side" id="side">
    <div class="brand"><span class="logo"><img class="mark-img" src="img/logo.svg" alt="Tibi"><span class="hide-c">Tibi</span></span><button class="ibtn hide-c cbtn" id="collapseBtn" title="折叠 / 展开侧栏（⌘\\）"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/></svg></button></div>
    <button class="newbtn search" title="搜索文章、单词与设置（⌘K）"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><span class="hide-c">搜索</span><span class="k hide-c">⌘K</span></button>
    <nav class="nav">
{nav}    </nav>
    <div class="sideh hide-c" id="sideH">最近</div>
    <div class="recent hide-c" id="recent"></div>
    <div class="sidefoot">
      <div class="streak" title="连续 9 天 · 今日 12 / 20 分钟">
        <svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="none" stroke="var(--line-2)" stroke-width="4"/><circle id="ringArc" cx="18" cy="18" r="14" fill="none" stroke="var(--warm)" stroke-width="4" stroke-linecap="round" stroke-dasharray="87.96" stroke-dashoffset="87.96" transform="rotate(-90 18 18)"/></svg>
        <div class="hide-c"><div class="t">连续 9 天</div><div class="s">今日 12 / 20 分钟</div></div>
      </div>
      <div class="user"><span class="av">你</span><span class="t hide-c">约 6,214 词</span><a class="ibtn hide-c" title="设置" data-link="settings" href="#" id="setLink"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 00-2 1.2l-2.4-.9-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></svg></a></div>
    </div>
  </aside>
'''

HEAD = '''<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Charis+SIL:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono&display=swap">
<link rel="stylesheet" href="v2.css">
'''
SCRIPTS = '''<script src="https://cdn.jsdelivr.net/npm/motion@11.11.17/dist/motion.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/overlayscrollbars/2.10.1/browser/overlayscrollbars.browser.es6.min.js"></script>
{extra}<script src="v2-shell.js"></script>
'''
