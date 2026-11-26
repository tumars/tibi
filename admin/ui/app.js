const $ = selector => document.querySelector(selector);
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const state = { page: 'overview', status: null, jobs: [], prefix: '', token: '', next: null,
  notice: null, remote: null, revision: null, dirty: false, release: null, uploading: false };
const pages = {
  overview: ['概览', '分发概览'],
  storage: ['文件存储', '文件存储'],
  releases: ['版本发布', '版本发布'],
  notices: ['公告推送', '公告推送'],
};
const platforms = { macos: 'macOS', windows: 'Windows', linux: 'Linux', android: 'Android', ios: 'iOS' };
const bytes = n => n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(2) + ' GB' : n >= 1024 ** 2 ? (n / 1024 ** 2).toFixed(1) + ' MB'
  : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
const date = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
const readable = value => typeof value === 'string' ? value : value?.[$('#preview-language').value] || value?.zh || '';
const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function api(path, { method = 'GET', data } = {}) {
  const response = await fetch('/api/' + path, { method, headers: { 'X-Tibi-Admin': '1', ...(data ? { 'Content-Type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}) });
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : {}; }
  catch { result = { error: text || '请求失败（' + response.status + '）' }; }
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
function notify(message) {
  $('#toast').textContent = message; $('#toast').classList.remove('hidden');
  clearTimeout(notify.timer); notify.timer = setTimeout(() => $('#toast').classList.add('hidden'), 4200);
}
function showError(error) {
  $('#global-error').textContent = error.message || String(error);
  $('#global-error').classList.remove('hidden');
}
function clearError() { $('#global-error').classList.add('hidden'); }
const safely = fn => async event => { clearError(); try { await fn(event); } catch (error) { showError(error); } };
async function confirmAction(title, description, action = '确认') {
  $('#confirm-title').textContent = title; $('#confirm-description').textContent = description;
  $('#confirm-submit').textContent = action; $('#confirm-dialog').returnValue = '';
  $('#confirm-dialog').showModal();
  return new Promise(resolve => $('#confirm-dialog').addEventListener('close', () => resolve($('#confirm-dialog').returnValue === 'confirm'), { once: true }));
}
function syncButtons() {
  const busy = state.uploading || state.jobs.some(j => j.status === 'running');
  document.querySelectorAll('[data-write]').forEach(button => { button.disabled = busy; });
  $('#release-publish').disabled = busy || !state.release || !!state.release.blocked || !$('#release-validated').checked;
  $('#notice-publish').disabled = busy || !state.notice || state.dirty;
  $('#notice-save').disabled = busy || !state.notice || !state.dirty;
}
async function switchPage(page) {
  state.page = page; clearError();
  document.querySelectorAll('.page').forEach(node => node.classList.toggle('hidden', node.id !== 'page-' + page));
  document.querySelectorAll('.nav-item').forEach(node => node.classList.toggle('selected', node.dataset.page === page));
  [$('#breadcrumb').textContent, $('#page-title').textContent] = pages[page];
  if (page === 'storage') await loadStorage();
  if (page === 'notices' && !state.notice) await loadNotices();
  if (page === 'releases') await loadLocalReleases();
}
async function loadStatus() {
  const data = await api('status'); state.status = data;
  $('#connection span').textContent = data.connected ? '已连接腾讯云' : '连接异常';
  $('#connection').classList.toggle('offline', !data.connected);
  $('#metric-version').textContent = data.latest ? 'v' + data.latest.version : '—';
  $('#metric-platforms').textContent = data.latest ? Object.keys(data.latest.platforms || {}).map(p => p.replace('darwin-aarch64', 'macOS · Apple Silicon')
    .replace('darwin-x86_64', 'macOS · Intel')).join(' / ') : '暂无更新清单';
  $('#metric-notices').textContent = data.notice?.notices?.length ?? '—';
  $('#metric-health').textContent = data.connected ? '正常运行' : '连接异常';
  $('#metric-base').textContent = new URL(data.base).hostname;
  $('#bucket').textContent = data.bucket; $('#region').textContent = data.region;
  $('#base').textContent = data.base; $('#latest-link').href = data.base + '/latest.json'; $('#notice-link').href = data.base + '/notice.json';
  const updated = $('#footer-updated');
  if (updated) updated.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  if (data.error) showError(new Error(data.error));
}
let storageRequest = 0;
async function loadStorage() {
  const request = ++storageRequest;
  $('#storage-prefix').value = state.prefix;
  const data = await api('storage?prefix=' + encodeURIComponent(state.prefix) + '&token=' + encodeURIComponent(state.token));
  // 切换目录或刷新时，较早的请求可能较晚返回，不能覆盖新目录。
  if (request !== storageRequest || state.page !== 'storage') return;
  state.next = data.next;
  const crumbs = $('#storage-breadcrumbs'); crumbs.replaceChildren();
  const root = el('button', '⌂ 根目录'); root.onclick = safely(async () => { state.prefix = ''; state.token = ''; await loadStorage(); }); crumbs.append(root);
  let prefix = '';
  for (const segment of state.prefix.split('/').filter(Boolean)) {
    prefix += segment + '/'; const value = prefix;
    crumbs.append(el('span', '/')); const button = el('button', segment);
    button.onclick = safely(async () => { state.prefix = value; state.token = ''; await loadStorage(); }); crumbs.append(button);
  }
  const rows = $('#storage-rows'); rows.replaceChildren();
  for (const directory of data.dirs) {
    const row = el('tr'); const cell = el('td', undefined, 'file-name'); const button = el('button', directory.slice(state.prefix.length));
    const symbol = el('span', '▱', 'file-symbol'); symbol.setAttribute('aria-hidden', 'true');
    button.prepend(symbol);
    button.onclick = safely(async () => { state.prefix = directory; state.token = ''; await loadStorage(); });
    cell.append(button); row.append(cell, el('td', '—'), el('td', '—'), el('td', '目录', 'align-right')); rows.append(row);
  }
  for (const file of data.files) {
    const row = el('tr'); const name = el('td', undefined, 'file-name');
    name.append(el('span', '▤', 'file-symbol'), document.createTextNode(file.key.slice(state.prefix.length)));
    if (!file.writable) name.append(el('span', '发布流程维护', 'file-lock'));
    const actions = el('td', undefined, 'actions');
    const open = el('a', '打开 ↗'); open.href = file.url; open.target = '_blank'; open.rel = 'noopener noreferrer';
    const copy = el('button', '复制链接', 'text-button'); copy.onclick = safely(async () => { await navigator.clipboard.writeText(file.url); notify('链接已复制'); });
    actions.append(open, copy);
    if (file.writable) {
      const remove = el('button', '删除', 'text-button delete-button'); remove.dataset.write = '';
      remove.onclick = safely(async () => {
        if (!await confirmAction('删除这个文件？', file.key + '\n删除后，此文件的公开链接将失效。', '删除文件')) return;
        await api('storage', { method: 'DELETE', data: { key: file.key, confirm: file.key } }); await pollJobs();
      });
      actions.append(remove);
    }
    row.append(name, el('td', bytes(file.size)), el('td', date(file.modified)), actions); rows.append(row);
  }
  if (!data.files.length && !data.dirs.length) {
    const cell = el('td', undefined, 'empty'); cell.colSpan = 4;
    cell.append(el('div', '当前目录暂无文件。'));
    const act = el('div', undefined, 'empty-act');
    const btn = el('button', '上传文件', 'button secondary small');
    btn.type = 'button';
    btn.onclick = () => $('#show-upload').click();
    act.append(btn); cell.append(act);
    const row = el('tr'); row.append(cell); rows.append(row);
  }
  $('#storage-summary').textContent = '本页 ' + data.dirs.length + ' 个目录 · ' + data.files.length + ' 个文件 · ' + bytes(data.files.reduce((sum, file) => sum + file.size, 0));
  $('#storage-next').disabled = !data.next; $('#storage-first').disabled = !state.token; syncButtons();
}
async function loadLocalReleases() {
  const data = await api('releases/local'); const list = $('#release-directories'); list.replaceChildren();
  data.directories.forEach(directory => { const option = el('option'); option.value = directory; list.append(option); });
}
function renderRelease(data) {
  state.release = data; $('#release-preview').classList.remove('hidden');
  $('#release-preview-title').textContent = 'Tibi ' + data.tag + ' · 发行预览';
  $('#release-notes-input').value = data.notes || data.suggestedNotes || '';
  const fill = $('#release-notes-fill');
  fill.classList.toggle('hidden', !data.suggestedNotes);
  fill.onclick = () => { $('#release-notes-input').value = data.suggestedNotes || ''; notify('已填入 docs/CHANGELOG.md 摘要'); };
  $('#release-platforms').replaceChildren(...data.platforms.map(p => el('span', '✓ ' + p.platform + ' · 已验签', 'platform-chip')));
  $('#release-blocked').classList.toggle('hidden', !data.blocked); $('#release-blocked').textContent = data.blocked || '';
  const rows = $('#release-files'); rows.replaceChildren();
  data.files.forEach(file => {
    const row = el('tr'); const sum = el('td', file.sha256.slice(0, 18) + '…', 'sha'); sum.title = file.sha256;
    row.append(el('td', file.name, 'file-name'), el('td', bytes(file.size)), sum); rows.append(row);
  });
  $('#release-validated').checked = false; syncButtons();
}
function markDirty() { state.dirty = true; renderNoticesStatus(); renderNoticePreview(); }
function renderNoticesStatus() {
  $('#draft-status').textContent = state.dirty ? '未保存' : '已保存';
  const remote = state.remote?.notices?.length;
  $('#notice-comparison').textContent = '本机 ' + state.notice.notices.length + ' 条 · 线上 ' + (remote ?? '未知') + ' 条' +
    (!state.dirty && jsonEqual(state.notice, state.remote) ? ' · 内容一致' : ' · 保存草稿后可推送');
  syncButtons();
}
function inputField(label, value, update, { area = false, placeholder = '', type = 'text' } = {}) {
  const container = el('div'); const id = 'field-' + crypto.randomUUID();
  const caption = el('label', label); caption.htmlFor = id;
  const input = el(area ? 'textarea' : 'input'); input.id = id; input.value = value || ''; input.placeholder = placeholder;
  if (!area) input.type = type;
  input.oninput = () => { update(input.value); markDirty(); };
  container.append(caption, input); return container;
}
function localized(n, key, language, value) {
  const old = typeof n[key] === 'string' ? { zh: n[key] } : { ...n[key] };
  if (value) old[language] = value; else delete old[language];
  if (!old.zh && !old.en) delete n[key];
  else n[key] = old.en ? { zh: old.zh || '', en: old.en } : old.zh || '';
}
function fieldText(value, language = 'zh') { return typeof value === 'string' ? language === 'zh' ? value : '' : value?.[language] || ''; }
function renderNoticeCards() {
  const cards = $('#notice-cards'); cards.replaceChildren();
  state.notice.notices.forEach((n, index) => {
    const card = el('article', undefined, 'notice-card'); const header = el('div', undefined, 'notice-card-header');
    const remove = el('button', '移除', 'text-button delete-button');
    remove.onclick = () => { state.notice.notices.splice(index, 1); state.dirty = true; renderNoticeCards(); };
    header.append(el('b', '公告 ' + String(index + 1).padStart(2, '0')), remove); card.append(header);
    card.append(inputField('公告 ID', n.id, v => { n.id = v; }, { placeholder: '例如 welcome-20261117' }),
      inputField('消息正文', fieldText(n.message), v => localized(n, 'message', 'zh', v), { area: true, placeholder: '写一句清晰、对用户有用的话。' }));
    const grid = el('div', undefined, 'form-grid');
    grid.append(inputField('仅提醒低于此版本的用户（可选）', n.below, v => { if (v) n.below = v; else delete n.below; }, { placeholder: '例如 0.2.0' }),
      inputField('展示截止日期（可选，含当天）', n.until, v => { if (v) n.until = v; else delete n.until; }, { type: 'date' }));
    card.append(grid, el('label', '目标平台（不选表示全部）'));
    const choices = el('div', undefined, 'platform-options');
    for (const [value, label] of Object.entries(platforms)) {
      const wrapper = el('label'); const input = el('input'); input.type = 'checkbox'; input.checked = n.platforms?.includes(value) || false;
      input.onchange = () => {
        const selected = new Set(n.platforms || []); if (input.checked) selected.add(value); else selected.delete(value);
        if (selected.size) n.platforms = [...selected]; else delete n.platforms; markDirty();
      }; wrapper.append(input, document.createTextNode(label)); choices.append(wrapper);
    }
    card.append(choices);
    const details = el('details'); details.append(el('summary', '英文与操作按钮'));
    details.append(inputField('英文正文（可选）', fieldText(n.message, 'en'), v => localized(n, 'message', 'en', v), { area: true }),
      inputField('按钮链接（可选）', n.url, v => { if (v) n.url = v; else delete n.url; }, { placeholder: 'https://… 或 tibi://…' }));
    const labels = el('div', undefined, 'form-grid');
    labels.append(inputField('中文按钮文案', fieldText(n.label), v => localized(n, 'label', 'zh', v), { placeholder: '去看看' }),
      inputField('英文按钮文案（可选）', fieldText(n.label, 'en'), v => localized(n, 'label', 'en', v)));
    details.append(labels); card.append(details); cards.append(card);
  });
  if (!state.notice.notices.length) {
    const empty = el('div', undefined, 'empty');
    empty.append(el('div', '暂无公告草稿。'));
    const act = el('div', undefined, 'empty-act');
    const btn = el('button', '新增公告', 'button secondary small');
    btn.type = 'button';
    btn.onclick = () => $('#notice-add').click();
    act.append(btn); empty.append(act);
    cards.append(empty);
  }
  renderNoticesStatus(); renderNoticePreview();
}
function renderNoticePreview() {
  const container = $('#notice-previews'); container.replaceChildren();
  for (const n of state.notice?.notices || []) {
    const card = el('div', undefined, 'notice-bubble'); const header = el('div', undefined, 'bubble-head');
    header.append(el('span', 't.', 'bubble-dot'), el('span', 'Tibi 提比')); card.append(header);
    card.append(el('div', readable(n.message) || '消息正文预览', 'bubble-message'));
    if (n.url) card.append(el('div', (readable(n.label) || ($('#preview-language').value === 'en' ? 'Learn more' : '查看详情')) + ' ↗', 'bubble-button'));
    const target = n.platforms?.length ? n.platforms.map(p => platforms[p]).join('、') : '全部平台';
    card.append(el('div', target + (n.below ? ' · 低于 ' + n.below + ' · 每天提醒' : ' · 仅提醒一次') + (n.until ? ' · 至 ' + n.until : ''), 'bubble-target'));
    container.append(card);
  }
  if (!container.children.length) container.append(el('div', '新增公告后可在此预览。', 'empty'));
}
async function loadNotices() {
  const data = await api('notices'); state.notice = data.data; state.remote = data.remote;
  state.revision = data.revision; state.dirty = false; renderNoticeCards();
  if (data.remoteError) showError(new Error('线上公告读取失败：' + data.remoteError));
}
let pollInFlight = null;
function pollJobs() {
  if (pollInFlight) return pollInFlight;
  pollInFlight = (async () => {
    const previouslyRunning = state.jobs.some(job => job.status === 'running');
    const jobs = await api('jobs'); state.jobs = jobs;
    const open = new Set([...document.querySelectorAll('.job[open]')].map(node => node.dataset.id));
    const container = $('#jobs'); container.replaceChildren();
    for (const job of jobs) {
      const detail = el('details', undefined, 'job'); detail.dataset.id = job.id;
      detail.open = open.has(job.id) || job.status === 'running';
      const summary = el('summary'); summary.append(el('span', { running: '进行中', succeeded: '已完成', failed: '未完成' }[job.status], 'badge ' +
        { running: 'running', succeeded: 'success', failed: 'failed' }[job.status]),
      el('span', job.title, 'job-name'), el('span', date(job.started), 'job-date'), el('span', '⌄', 'muted'));
      detail.append(summary, el('pre', job.lines.join('\n') || '正在开始…')); container.append(detail);
    }
    if (!jobs.length) container.append(el('div', '暂无后台任务记录。', 'empty'));
    const running = jobs.find(job => job.status === 'running');
    $('#running-status').textContent = running ? '任务执行中' : '空闲'; $('#running-status').className = 'badge' + (running ? ' running' : '');
    syncButtons();
    if (previouslyRunning && !running) {
      await loadStatus();
      if (state.page === 'storage') await loadStorage();
      if (state.page === 'notices' && !state.dirty) await loadNotices();
    }
  })().finally(() => { pollInFlight = null; });
  return pollInFlight;
}

document.querySelectorAll('[data-page]').forEach(node => node.onclick = safely(() => switchPage(node.dataset.page)));
$('#refresh').onclick = safely(async () => { await loadStatus(); await pollJobs(); if (state.page === 'storage') await loadStorage(); if (state.page === 'notices' && !state.dirty) await loadNotices(); notify('已刷新线上状态'); });
$('#storage-search').onsubmit = safely(async e => { e.preventDefault(); state.prefix = $('#storage-prefix').value.trim(); if (state.prefix && !state.prefix.endsWith('/')) state.prefix += '/'; state.token = ''; await loadStorage(); });
$('#storage-next').onclick = safely(async () => { state.token = state.next; await loadStorage(); });
$('#storage-first').onclick = safely(async () => { state.token = ''; await loadStorage(); });
$('#show-upload').onclick = () => { $('#upload-key').value = state.prefix.startsWith('uploads/') ? state.prefix : 'uploads/'; $('#upload-dialog').showModal(); };
$('#upload-close').onclick = () => { if (!state.uploading) $('#upload-dialog').close(); };
$('#upload-dialog').addEventListener('cancel', event => { if (state.uploading) event.preventDefault(); });
$('#upload-file').onchange = () => {
  const directory = $('#upload-key').value.slice(0, $('#upload-key').value.lastIndexOf('/') + 1) || 'uploads/';
  $('#upload-key').value = directory + ($('#upload-file').files[0]?.name || '');
};
$('#upload-form').onsubmit = safely(async event => {
  event.preventDefault(); const file = $('#upload-file').files[0]; const key = $('#upload-key').value.trim();
  if (!file) return;
  if (!key.startsWith('uploads/')) throw new Error('普通文件需要放在 uploads/ 目录');
  if (file.size > 2 * 1024 ** 3) throw new Error('单个文件最大 2 GB');
  state.uploading = true; $('#upload-submit').disabled = true; $('#upload-close').disabled = true; syncButtons();
  $('#upload-progress').classList.remove('hidden'); $('#upload-status').textContent = '正在传入本机服务…';
  try {
    await new Promise((resolve, reject) => {
      const request = new XMLHttpRequest(); request.open('PUT', '/api/storage?key=' + encodeURIComponent(key)); request.setRequestHeader('X-Tibi-Admin', '1');
      request.timeout = 3_600_000;
      request.upload.onprogress = event => { if (event.lengthComputable) { const percent = Math.round(event.loaded / event.total * 100); $('#upload-progress').value = percent; $('#upload-status').textContent = percent === 100 ? '已传入本机，正在创建云端上传任务…' : '传入本机 ' + percent + '%'; } };
      request.onload = () => { try { const result = JSON.parse(request.responseText); if (request.status >= 400) reject(new Error(result.error)); else resolve(result); } catch { reject(new Error('上传响应异常')); } };
      request.onerror = () => reject(new Error('本机连接中断，上传未完成'));
      request.onabort = () => reject(new Error('上传已取消'));
      request.ontimeout = () => reject(new Error('上传超时'));
      request.send(file);
    });
    $('#upload-dialog').close(); $('#upload-file').value = ''; notify('正在上传至腾讯云，请查看最近操作'); await pollJobs();
  } finally { state.uploading = false; $('#upload-submit').disabled = false; $('#upload-close').disabled = false; $('#upload-progress').classList.add('hidden'); syncButtons(); }
});
$('#release-inspect').onsubmit = safely(async event => {
  event.preventDefault(); $('#inspect-button').disabled = true; $('#inspect-button').textContent = '正在校验…';
  state.release = null; $('#release-preview').classList.add('hidden'); syncButtons();
  try { renderRelease(await api('releases/inspect', { method: 'POST', data: { directory: $('#release-directory').value } })); }
  finally { $('#inspect-button').disabled = false; $('#inspect-button').textContent = '校验产物'; }
});
$('#release-directory').oninput = () => { state.release = null; $('#release-preview').classList.add('hidden'); syncButtons(); };
$('#release-validated').onchange = syncButtons;
$('#release-publish').onclick = safely(async () => {
  const r = state.release;
  if (!r || r.blocked || !$('#release-validated').checked) return;
  if (!await confirmAction('发布 Tibi ' + r.tag + '？', r.platforms.map(p => p.platform).join('、') + '\n' + r.files.length + ' 个文件，共 ' +
    bytes(r.files.reduce((n, f) => n + f.size, 0)) + '\n\n完成后将切换官网下载与应用更新清单。', '确认发布')) return;
  const notes = $('#release-notes-input').value.trim();
  await api('releases/publish', { method: 'POST', data: { token: r.token, confirm: r.tag, validated: true, notes } });
  state.release = null; syncButtons(); await pollJobs(); notify('版本发布已开始，请查看任务日志');
});
$('#notice-add').onclick = () => {
  if (!state.notice) return;
  state.notice.notices.push({ id: 'notice-' + Date.now(), message: '' }); state.dirty = true; renderNoticeCards();
};
$('#preview-language').onchange = renderNoticePreview;
$('#notice-load-remote').onclick = safely(async () => {
  if (!state.remote) throw new Error('未读取到线上公告，请刷新后重试');
  if (state.dirty && !await confirmAction('载入线上公告？', '这会替换页面中尚未保存的编辑。', '载入')) return;
  state.notice = structuredClone(state.remote); state.dirty = true; renderNoticeCards();
});
$('#notice-save').onclick = safely(async () => {
  const result = await api('notices', { method: 'PUT', data: { data: state.notice, revision: state.revision } });
  state.revision = result.revision; state.notice = result.data; state.dirty = false; renderNoticesStatus(); notify('草稿已保存到本机，尚未推送');
});
$('#notice-publish').onclick = safely(async () => {
  if (state.dirty) throw new Error('请先保存草稿');
  const count = state.notice.notices.length;
  if (!await confirmAction(count ? '推送这 ' + count + ' 条公告？' : '停止全部线上公告？', count ?
    '已保存的草稿将替换线上公告，符合平台、版本与日期条件的客户端会在下次检查时获取。' :
    '线上公告将变为空列表，客户端后续检查时不再展示这些公告。', count ? '确认推送' : '确认停止')) return;
  await api('notices/publish', { method: 'POST', data: { revision: state.revision, confirm: true } });
  await pollJobs(); notify('公告发布已开始');
});
window.addEventListener('beforeunload', event => { if (state.dirty || state.uploading) { event.preventDefault(); event.returnValue = ''; } });

/* ① 提示气泡：默认隐藏，悬停/聚焦/点击弹出并贴合视口边界 */
let pinnedTip = null;
const tipPop = $('#tip-pop');
function hideTip() {
  if (pinnedTip) { pinnedTip.setAttribute('aria-expanded', 'false'); pinnedTip = null; }
  tipPop?.classList.add('hidden');
}
function showTip(trigger, pin = false) {
  if (!tipPop || !trigger?.dataset?.tip) return;
  if (pinnedTip && pinnedTip !== trigger) pinnedTip.setAttribute('aria-expanded', 'false');
  tipPop.textContent = trigger.dataset.tip;
  tipPop.classList.remove('hidden');
  const r = trigger.getBoundingClientRect();
  const pr = tipPop.getBoundingClientRect();
  const left = Math.max(12, Math.min(window.innerWidth - pr.width - 12, r.left + r.width / 2 - pr.width / 2));
  const top = r.bottom + 8 + pr.height <= window.innerHeight - 12 ? r.bottom + 8 : Math.max(12, r.top - pr.height - 8);
  tipPop.style.left = left + 'px';
  tipPop.style.top = top + 'px';
  if (pin) { pinnedTip = trigger; trigger.setAttribute('aria-expanded', 'true'); }
}
document.querySelectorAll('.tip-btn').forEach(btn => {
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('mouseenter', () => { if (!pinnedTip) showTip(btn, false); });
  btn.addEventListener('mouseleave', () => { if (!pinnedTip) tipPop?.classList.add('hidden'); });
  btn.addEventListener('focus', () => { if (!pinnedTip) showTip(btn, false); });
  btn.addEventListener('blur', () => { if (!pinnedTip) tipPop?.classList.add('hidden'); });
  btn.addEventListener('click', event => {
    event.stopPropagation();
    if (pinnedTip === btn) hideTip(); else showTip(btn, true);
  });
});
document.addEventListener('click', event => { if (pinnedTip && !tipPop?.contains(event.target)) hideTip(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && pinnedTip) hideTip(); });

await Promise.all([loadStatus(), pollJobs()]).catch(showError);
setInterval(() => { if (!document.hidden) pollJobs().catch(showError); }, 2000);
