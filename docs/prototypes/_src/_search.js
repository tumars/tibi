/* Tibi v2 搜索面板（⌘K）：搜文章（标题与正文）、单词、设置项、页面与操作；找不到时可以直接问 Tibi。
   所有页面共用。依赖页面里已有的 URLS；Motion 可缺省。由 _src/_search.js 生成（注入生词数据）。 */
(() => {
  const S$ = s => document.querySelector(s);
  const sesc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const IS_LOCAL = location.protocol === 'file:';
  const say = (t) => (typeof toast === 'function' ? toast : typeof showToast === 'function' ? showToast : alert)(t);
  const STAGE = ['生词', '见过', '眼熟', '认得', '熟悉', '掌握'];
  const GEN = { tech: '技术', news: '新闻', lit: '文学', novel: '文学', academic: '学术', general: '一般' };
  const PAGE = { 'Tibi 生词本': 'words', 'Tibi 设置': 'settings', 'Tibi 复习': 'review', 'Tibi 统计': 'stats', 'Tibi 任务': 'tasks' }[document.title] || (document.getElementById('docTitle') ? 'reader' : 'home');
  const RECENT_KEY = 'lexi-search-recent';

  /* ---------- 数据（原型示例） ---------- */
  const DOCS = [
    { id: 'tech', g: 'tech', t: 'Understanding Ownership in Rust', p: 45, open: true, body: ['Ownership is the feature that makes Rust distinctive among systems languages.', 'When the owner goes out of scope, the value is dropped and its memory is reclaimed deterministically.', 'If you only need to read the data, you can borrow it instead.', 'The borrow checker verifies that no reference outlives the value it points to.'] },
    { id: 'novel', g: 'novel', t: 'Pride and Prejudice', p: 8, body: ['It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', '“You want to tell me, and I have no objection to hearing it.”'] },
    { id: 'news', g: 'news', t: 'Cities Turn to Sponge Design as Floods Intensify', p: 0, body: ['The approach relies on permeable pavements, rooftop gardens and restored wetlands.', 'Skeptics counter that the concept has been oversold.'] },
    { id: 'async', g: 'tech', t: 'A Gentle Introduction to Async Rust', p: 0, body: ['Concurrency is about dealing with many things at once, not doing them at once.', 'Async tasks avoid the overhead of spawning a thread for every connection.'] },
    { id: 'holmes', g: 'novel', t: 'A Scandal in Bohemia', p: 12, body: ['I was anxious to ascertain what my friend had been doing.', 'The King was notoriously indiscreet in his youth.'] },
    { id: 'trains', g: 'news', t: 'The Quiet Return of Night Trains in Europe', p: 100, body: ['Delays affect fewer than one in ten journeys.', 'Operators are retrofitting old carriages with private cabins.'] },
    { id: 'ctx', g: 'tech', t: 'How Transformers Handle Long Context', p: 0, body: ['Attention cost grows quadratically with the length of the input.'] },
  ];
  const WORDS = %WORDS%;
  const SETS = [
    ['general', '外观', '通用', '深色 浅色 主题 夜间 dark theme'], ['general', '界面语言', '通用', 'language english'], ['general', '英语水平与目标', '通用', '雅思 托福 词汇量测试 重新测'], ['general', '常读材料', '通用', '推荐 兴趣'],
    ['reading', '正文字体', '阅读', 'charter 字体 font'], ['reading', '字号', '阅读', '字体大小 font size'], ['reading', '标注强度', '阅读', '纯净阅读 高亮 标记'], ['reading', '默认显示译文', '阅读', '翻译 translation'], ['reading', '默认显示行间释义', '阅读', 'gloss 小字'], ['reading', '释义语言', '阅读', '英英 中英'],
    ['learning', '每日阅读目标', '学习与复习', '分钟 goal'], ['learning', '每天最多新学的词', '学习与复习', '新卡 上限'], ['learning', '目标记忆保持率', '学习与复习', 'fsrs retention 复习量'], ['learning', '题型', '学习与复习', '识别 填空 听写 拼写 造句'], ['learning', '按个人复习记录优化 FSRS 参数', '学习与复习', '优化 fsrs'],
    ['ai', 'DeepSeek', '模型', 'api key 模型 服务商 base url provider'], ['ai', '视觉模型', '模型', 'ocr 图片 识别'], ['ai', '图像模型', '模型', '封面 插画'], ['ai', '快速', '模型', '模型档 deepseek-chat'], ['ai', '深入', '模型', '模型档 deepseek-reasoner'], ['ai', '用 ChatGPT 账号登录', '模型', '订阅 chatgpt claude 账号 登录 oauth'], ['tibi', 'Tibi 修改学习数据时', 'Tibi', '权限 自动 询问'], ['tibi', 'Tibi 怎么称呼你', 'Tibi', '称呼 名字 对话语言 中英'], ['tibi', '允许其他 AI 工具使用 Tibi（MCP）', 'Tibi', 'mcp'],
    ['agents', 'Tibi 的技能', '技能', 'skill 技能 帮手 新建技能 自定义 agent 智能体'], ['agents', '导入文章', '技能', '导入 importer 总结 短语'], ['agents', '找文章', '技能', '选文 scout 推荐'], ['agents', '讲解', '技能', '伴读 tutor 长难句 语法'], ['agents', '出题与批改', '技能', '复习 coach 造句 批改'], ['agents', '学习洞察', '技能', 'insight 周报 统计'], ['agents', '整理记忆', '技能', 'archivist 记忆'], ['agents', '每天早上帮你找 3 篇文章', '例行任务', '定时 例行 推荐 schedule'], ['agents', '每晚整理一次记忆', '例行任务', '定时 例行'], ['agents', '每周一写一份学习周报', '例行任务', '定时 例行 周报'], ['agents', '每月预算', '技能', '花费 预算 费用 cost budget'],
    ['voice', '朗读引擎', '语音', 'tts kokoro 发音'], ['voice', '音色', '语音', '美音 英音 voice'], ['voice', '默认语速', '语音', '速度 speed'],
    ['memory', '记忆', '记忆', '记住 memory 清空 删除 tibi'],
    ['data', '数据库位置', '数据', 'sqlite db'], ['data', '备份', '数据', '恢复 backup'], ['data', '导出生词本', '数据', 'csv anki export'], ['data', '从其他工具导入已知词', '数据', 'anki lingq'], ['data', '重置 Tibi', '数据', '清空 删除 全部数据 reset'], ['data', '词典', '数据', 'ecdict'], ['data', '语音缓存', '数据', '清理 缓存'],
    ['about', '检查更新', '关于', '版本 version'],
  ];
  const ICON = {
    home: '<path d="M4 11l8-6 8 6v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z"/>', shelf: '<path d="M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.8-1 3 15.5-3.8 1z"/>',
    words: '<path d="M6 4h11a1 1 0 011 1v15l-6.5-3.5L5 20V5a1 1 0 011-1z"/>', review: '<path d="M20 12a8 8 0 11-2.3-5.6M20 4v4h-4"/>', stats: '<path d="M5 19V11M12 19V5M19 19v-6"/>', tasks: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11M4 18l1.2 1.2L7.5 17"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>', doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    text: '<path d="M5 7h14M5 12h14M5 17h9"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  };
  const SPARK = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/></svg>';
  const ico = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
  const ACTIONS = [
    { k: 'import', t: '导入文章', sub: '粘贴网址、文字，或拖入 PDF / EPUB / 图片', icon: 'plus', kbd: '⌘N', kw: 'import 新建 添加 url pdf epub' },
    { k: 'review', t: '开始复习', sub: '18 张到期 · 约 6 分钟', icon: 'review', kw: 'review 背单词 练习' },
    { k: 'theme', t: '切换深浅色', sub: '', icon: 'moon', kw: 'dark light theme 夜间 主题' },
    { k: 'page:home', t: '首页', icon: 'home', kw: 'home' }, { k: 'page:shelf', t: '书架', icon: 'shelf', kw: 'library shelf 文章' }, { k: 'page:words', t: '生词本', icon: 'words', kw: 'words vocabulary 单词' },
    { k: 'page:stats', t: '统计', icon: 'stats', kw: 'stats 数据 进度' }, { k: 'page:tasks', t: '任务', icon: 'tasks', kw: 'tasks 任务中心 运行 定时 确认 审批 花费' }, { k: 'page:settings', t: '设置', icon: 'settings', kw: 'settings preferences 偏好' },
  ];

  /* ---------- 匹配 ---------- */
  const norm = s => String(s).toLowerCase();
  function score(text, q) { const t = norm(text), i = t.indexOf(q); if (i < 0) return 0; if (i === 0) return 3; return /[\s\-（(]/.test(t[i - 1]) ? 2 : 1; }
  function hl(text, q) { if (!q) return sesc(text); const i = norm(text).indexOf(q); if (i < 0) return sesc(text); return sesc(text.slice(0, i)) + '<mark>' + sesc(text.slice(i, i + q.length)) + '</mark>' + sesc(text.slice(i + q.length)); }
  function snip(text, q) { const i = norm(text).indexOf(q); if (i < 0) return text; const a = Math.max(0, i - 28), b = Math.min(text.length, i + q.length + 40); return (a ? '…' : '') + text.slice(a, b) + (b < text.length ? '…' : ''); }

  function search(q, scope) {
    const out = [];
    if (scope === 'all' || scope === 'action') out.push({ g: '跳转与操作', items: ACTIONS.map(a => ({ a, s: Math.max(score(a.t, q), score(a.kw, q) && 1) })).filter(x => x.s).sort((x, y) => y.s - x.s).map(({ a, s }) => ({ s, type: 'action', key: a.k, icon: ico(a.icon), title: hl(a.t, q), sub: sesc(a.sub || ''), meta: a.kbd ? `<span class="kbd">${a.kbd}</span>` : '' })) });
    if (scope === 'all' || scope === 'doc') {
      const items = [];
      DOCS.forEach(d => { const s = score(d.t, q); if (s) items.push({ s: s + 1, type: 'doc', key: d.id, icon: `<span class="sg ${d.g}">${ico('doc')}</span>`, title: `<span class="rd">${hl(d.t, q)}</span>`, sub: `${GEN[d.g]} · ${d.p === 100 ? '已读完' : d.p ? '读到 ' + d.p + '%' : '未开始'}`, meta: '' }); });
      DOCS.forEach(d => d.body.forEach(line => { if (norm(line).includes(q) && !norm(d.t).includes(q)) items.push({ s: 0.5, type: 'doc', key: d.id, icon: ico('text'), title: `<span class="rd">${hl(snip(line, q), q)}</span>`, sub: `正文 · ${sesc(d.t)}`, meta: '' }); }));
      out.push({ g: '文章', items: items.sort((a, b) => b.s - a.s) });
    }
    if (scope === 'all' || scope === 'word') out.push({ g: '单词与短语', items: WORDS.map(w => ({ w, s: score(w[0], q) * 2 || score(w[2], q) })).filter(x => x.s).sort((a, b) => b.s - a.s).map(({ w, s }) => ({ s, type: 'word', key: w[0], icon: `<span class="wl">${w[1] ? '短' : 'Aa'}</span>`, title: `<span class="rd b">${hl(w[0], q)}</span><span class="zh">${hl(w[2], q)}</span>`, sub: `<span class="rd i">${sesc(snip(w[4], norm(w[0]).split(' ')[0]))}</span>`, meta: `<span class="stage s${w[3]}">${STAGE[w[3]]}</span>` })) });
    if (scope === 'all' || scope === 'set') out.push({ g: '设置', items: SETS.map(x => ({ x, s: score(x[1], q) * 2 || score(x[2], q) || score(x[3], q) })).filter(y => y.s).sort((a, b) => b.s - a.s).map(({ x, s }) => ({ s, type: 'set', key: x[0] + '/' + x[1], icon: ico('settings'), title: hl(x[1], q), sub: '设置 · ' + sesc(x[2]), meta: '' })) });
    // 分组按各自最佳匹配排序：输入单词时单词组在前，输入页面名时操作在前
    return out.filter(g => g.items.length).map((g, i) => ({ ...g, best: g.items[0].s, i })).sort((a, b) => b.best - a.best || a.i - b.i);
  }

  /* ---------- 界面 ---------- */
  let root, input, list, scope = 'all', items = [], cur = 0, lastFocus;
  const SCOPES = [['all', '全部'], ['doc', '文章'], ['word', '单词'], ['set', '设置'], ['action', '操作']];
  function build() {
    root = document.createElement('div'); root.className = 'cmdk'; root.hidden = true;
    root.innerHTML = `<div class="cmdk-scrim"></div>
      <div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="搜索">
        <div class="cmdk-head">${ico('search')}<input id="cmdkIn" placeholder="搜索文章、单词、设置，或输入问题问 Tibi" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="cmdkList"><button class="kbd cmdk-esc" title="关闭">Esc</button></div>
        <div class="cmdk-scopes" role="tablist">${SCOPES.map(([k, n]) => `<button role="tab" data-sc="${k}"${k === 'all' ? ' class="on" aria-selected="true"' : ''}>${n}</button>`).join('')}</div>
        <div class="cmdk-list" id="cmdkList" role="listbox"></div>
        <div class="cmdk-foot"><span><span class="kbd">↑</span><span class="kbd">↓</span> 选择</span><span><span class="kbd">↵</span> 打开</span><span><span class="kbd">Tab</span> 切换范围</span><span class="sp"></span><span class="cmdk-ai">${SPARK}<span class="kbd">⌘↵</span> 问 Tibi</span></div>
      </div>`;
    document.body.appendChild(root);
    input = S$('#cmdkIn'); list = S$('#cmdkList');
    root.querySelector('.cmdk-scrim').onclick = close; root.querySelector('.cmdk-esc').onclick = close;
    root.querySelectorAll('[data-sc]').forEach(b => b.onclick = () => { setScope(b.dataset.sc); input.focus(); });
    input.addEventListener('input', () => { cur = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) ask(input.value.trim()); else if (items[cur]) run(items[cur]); }
      else if (e.key === 'Tab') { e.preventDefault(); const i = SCOPES.findIndex(s => s[0] === scope); setScope(SCOPES[(i + (e.shiftKey ? SCOPES.length - 1 : 1)) % SCOPES.length][0]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (input.value) { input.value = ''; render(); } else close(); }
    });
    list.addEventListener('mousemove', e => { const r = e.target.closest('.cmdk-item'); if (r && +r.dataset.i !== cur) { cur = +r.dataset.i; mark(); } });
    list.addEventListener('click', e => { const r = e.target.closest('.cmdk-item'); if (r) run(items[+r.dataset.i]); const c = e.target.closest('.cmdk-clear'); if (c) { try { localStorage.removeItem(RECENT_KEY); } catch (er) {} render(); } });
  }
  function setScope(k) { scope = k; root.querySelectorAll('[data-sc]').forEach(b => { b.classList.toggle('on', b.dataset.sc === k); b.setAttribute('aria-selected', b.dataset.sc === k); }); cur = 0; render(); }
  function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
  function remember(q) { if (!q) return; try { const r = [q, ...recent().filter(x => x !== q)].slice(0, 4); localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (e) {} }

  function render() {
    const q = norm(input.value.trim()); let groups;
    if (!q) {
      const rec = recent();
      groups = [];
      if (rec.length) groups.push({ g: '最近搜索', clear: true, items: rec.map(r => ({ type: 'query', key: r, icon: ico('clock'), title: sesc(r), sub: '', meta: '' })) });
      if (scope === 'all' || scope === 'doc') groups.push({ g: '继续阅读', items: DOCS.filter(d => d.p > 0 && d.p < 100).map(d => ({ type: 'doc', key: d.id, icon: `<span class="sg ${d.g}">${ico('doc')}</span>`, title: `<span class="rd">${sesc(d.t)}</span>`, sub: `${GEN[d.g]} · 读到 ${d.p}%`, meta: '' })) });
      if (scope === 'all' || scope === 'action') groups.push({ g: '快捷操作', items: ACTIONS.slice(0, 3).map(a => ({ type: 'action', key: a.k, icon: ico(a.icon), title: sesc(a.t), sub: sesc(a.sub), meta: a.kbd ? `<span class="kbd">${a.kbd}</span>` : '' })) });
      if (scope === 'word') groups.push({ g: '最近加入的词', items: WORDS.slice(0, 5).map(w => ({ type: 'word', key: w[0], icon: `<span class="wl">${w[1] ? '短' : 'Aa'}</span>`, title: `<span class="rd b">${sesc(w[0])}</span><span class="zh">${sesc(w[2])}</span>`, sub: '', meta: `<span class="stage s${w[3]}">${STAGE[w[3]]}</span>` })) });
      if (scope === 'set') groups.push({ g: '设置分组', items: [...new Map(SETS.map(x => [x[0], x])).values()].map(x => ({ type: 'set', key: x[0] + '/', icon: ico('settings'), title: sesc(x[2]), sub: '', meta: '' })) });
    } else {
      groups = search(q, scope).map(g => ({ ...g, items: scope === 'all' ? g.items.slice(0, g.g === '文章' ? 4 : 5) : g.items }));
      groups.push({ g: '', items: [{ type: 'ask', key: input.value.trim(), icon: `<span class="ai">${SPARK}</span>`, title: `问 Tibi：“${sesc(input.value.trim())}”`, sub: '解释、翻译、出题，或按这个主题找文章', meta: '<span class="kbd">⌘↵</span>' }] });
    }
    items = []; let html = '';
    const found = groups.reduce((n, g) => n + (g.items[0] && g.items[0].type !== 'ask' ? g.items.length : 0), 0);
    if (q && !found) html += `<div class="cmdk-empty">没有找到 “${sesc(input.value.trim())}”${scope !== 'all' ? `，<button class="lnk" data-sc-all>在全部范围里找</button>` : ''}</div>`;
    groups.forEach(g => {
      if (g.g) html += `<div class="cmdk-g">${g.g}${g.clear ? '<button class="cmdk-clear">清除</button>' : ''}</div>`;
      g.items.forEach(it => { const i = items.push(it) - 1; html += `<div class="cmdk-item${it.type === 'ask' ? ' cmdk-ask' : ''}" role="option" id="cmdk-${i}" data-i="${i}"><span class="ic">${it.icon}</span><span class="tx"><span class="t">${it.title}</span>${it.sub ? `<span class="s">${it.sub}</span>` : ''}</span><span class="mt">${it.meta}</span></div>`; });
    });
    list.innerHTML = html;
    const all = list.querySelector('[data-sc-all]'); if (all) all.onclick = () => setScope('all');
    cur = Math.min(cur, Math.max(0, items.length - 1)); mark();
  }
  function mark() { list.querySelectorAll('.cmdk-item').forEach(r => { const on = +r.dataset.i === cur; r.classList.toggle('on', on); r.setAttribute('aria-selected', on); }); input.setAttribute('aria-activedescendant', 'cmdk-' + cur); const r = list.querySelector('.cmdk-item.on'); if (r) r.scrollIntoView({ block: 'nearest' }); }
  function move(d) { if (!items.length) return; cur = (cur + d + items.length) % items.length; mark(); }

  /* ---------- 打开结果 ---------- */
  function go(page, hash) {
    if (PAGE === page) { if (hash) { if (location.hash === '#' + hash) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; } return; }
    const a = document.createElement('a'); a.href = URLS[page] + (hash ? '#' + hash : ''); if (!IS_LOCAL) { a.target = '_blank'; a.rel = 'noopener'; } a.click();
  }
  function ask(q) {
    close();
    if (q && typeof runAsk === 'function') return runAsk(q);                       // 首页：右侧对话
    if (typeof sendAsk === 'function' && typeof switchTab === 'function' && S$('#askInput')) { switchTab('asst'); if (q) { S$('#askInput').value = q; sendAsk(); } return; } // 阅读器
    say(q ? `原型：会打开 Tibi 对话并发送“${q}”` : '原型：会打开 Tibi 对话');
  }
  function run(it) {
    if (it.type === 'query') { input.value = it.key; cur = 0; render(); return; }
    remember(input.value.trim());
    if (it.type === 'ask') return ask(it.key);
    close();
    if (it.type === 'doc') { const d = DOCS.find(x => x.id === it.key); if (d.open) go('reader'); else say(`原型里只有《${DOCS[0].t}》可以打开`); }
    else if (it.type === 'word') go('words', 'w=' + encodeURIComponent(it.key));
    else if (it.type === 'set') go('settings', encodeURIComponent(it.key.replace(/\/$/, '')));
    else if (it.type === 'action') {
      const k = it.key;
      if (k === 'import') { if (PAGE === 'home' && typeof focusImport === 'function') focusImport(); else go('home'); }
      else if (k === 'review') go('review');
      else if (k === 'theme') { const r = document.documentElement, dark = matchMedia('(prefers-color-scheme: dark)').matches, c = r.dataset.theme || (dark ? 'dark' : 'light'); r.dataset.theme = c === 'dark' ? 'light' : 'dark'; if (typeof shellHooks !== 'undefined') setTimeout(() => shellHooks.theme.forEach(f => f()), 30); }
      else if (k.startsWith('page:')) { const p = k.slice(5); go(p === 'shelf' ? 'home' : p); }
    }
  }

  function open() {
    if (!root) build();
    lastFocus = document.activeElement; root.hidden = false; input.value = ''; setScope('all'); input.focus();
    const M = window.Motion; if (M && !matchMedia('(prefers-reduced-motion: reduce)').matches) { M.animate(root.querySelector('.cmdk-panel'), { opacity: [0, 1], y: [-8, 0], scale: [0.98, 1] }, { duration: 0.22, ease: [0.22, 0.8, 0.24, 1] }); M.animate(root.querySelector('.cmdk-scrim'), { opacity: [0, 1] }, { duration: 0.2 }); }
  }
  function close() { if (!root || root.hidden) return; root.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  window.openSearch = open;
  document.querySelectorAll('.newbtn.search').forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); document.getElementById('app') && document.getElementById('app').classList.remove('menu'); open(); }, true));
})();
