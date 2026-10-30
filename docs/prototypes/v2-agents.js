/* Tibi v2 技能目录（原型共用）。内部是 Tibi 主智能体 + 6 个专职智能体（05 §4.3）；
   用户界面只出现 Tibi 和它的“技能”（动词命名，05 §13），不出现“智能体 / 子智能体 / 委派”。 */
const AGENT_ICON = {
  tibi: '',
  importer: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  scout: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
  tutor: '<path d="M4 6c3-1 6-1 8 1 2-2 5-2 8-1v12c-3-1-6-1-8 1-2-2-5-2-8-1z"/><path d="M12 7v12"/>',
  coach: '<path d="M20 12a8 8 0 11-2.3-5.6M20 4v4h-4"/>',
  insight: '<path d="M5 19V11M12 19V5M19 19v-6"/>',
  archivist: '<path d="M9 4a4 4 0 00-4 4c0 1 .3 1.8.8 2.5A4 4 0 007 18h2V4zM15 4a4 4 0 014 4c0 1-.3 1.8-.8 2.5A4 4 0 0117 18h-2V4z"/>',
  custom: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-3.5 4-5 7-5s6 1.5 7 5"/>',
};
const AGENTS = [
  { id: 'tibi', skill: '对话', slash: '问 Tibi', name: 'Tibi', role: '主智能体', desc: '和你对话；自己能做的直接做，专门的工作交给下面的帮手', model: 'fast', tools: ['lookup_word', 'get_document', 'list_terms', 'mark_term', 'add_to_wordbook', 'search_memory', 'delegate', 'tool_search'], cost: 1.12 },
  { id: 'importer', skill: '导入文章', slash: '导入', name: '导入', desc: '抓取或识别文章，提取正文，分句着色，判断类型与难度，写总结、挑短语和长难句', model: 'fast', tools: ['fetch_url', 'extract_pdf', 'ocr_image', 'segment_document', 'annotate_terms', 'estimate_difficulty', 'save_document'], cost: 1.46 },
  { id: 'scout', skill: '找文章', slash: '找文章', name: '选文', desc: '按你的水平、兴趣和正在学的词找文章，并说明推荐理由', model: 'fast', tools: ['search_feeds', 'web_search', 'fetch_url', 'estimate_difficulty', 'list_terms'], cost: 0.31, schedule: { label: '每天早上帮你找 3 篇文章', time: '08:00', on: false } },
  { id: 'tutor', skill: '讲解', slash: '讲解', name: '伴读', desc: '阅读时讲解语境释义、长难句、语法和背景；读完出几道理解题', model: 'fast', tools: ['get_document', 'lookup_word', 'get_term_contexts', 'create_quiz', 'mark_term'], cost: 0.42 },
  { id: 'coach', skill: '出题与批改', slash: '出题', name: '复习教练', desc: '为复习卡片准备例句，批改造句，答错时解释原因', model: 'fast', tools: ['get_term', 'get_term_contexts', 'grade_answer', 'create_quiz'], cost: 0.18 },
  { id: 'insight', skill: '学习洞察', slash: '学习洞察', name: '洞察', desc: '读你的学习数据，写观察和下一步建议', model: 'deep', tools: ['get_stats_series', 'get_learning_stats', 'list_terms'], cost: 0.09, schedule: { label: '每周一写一份学习周报', time: '周一 09:00', on: false } },
  { id: 'archivist', skill: '整理记忆', slash: '整理记忆', name: '记忆管家', desc: '把对话和学习事件整理成记忆：去重、合并、标记过时的', model: 'fast', tools: ['search_memory', 'remember', 'forget', 'list_learning_events'], cost: 0.04, schedule: { label: '每晚整理一次记忆', time: '23:00', on: true } },
];
const MODEL_NAME = { fast: 'DeepSeek · 快速', deep: 'DeepSeek · 深入' };
const skillOf = id => (AGENTS.find(a => a.id === id) || AGENTS[0]).skill;
const agentById = id => AGENTS.find(a => a.id === id) || AGENTS[0];
const FOX_FACE = '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4.6 9.5 3.6 3.2c0-.6.6-.9 1.1-.6l5.2 3.6zM19.4 9.5l1-6.3c0-.6-.6-.9-1.1-.6l-5.2 3.6z" fill="#f5a043"/><rect x="2.6" y="5" width="18.8" height="15.4" rx="7" fill="#f5a043"/><path d="M2.6 14.4c0-1.6 4.4-1.3 9.4-1.3s9.4-.3 9.4 1.3c0 3.4-4.2 6-9.4 6s-9.4-2.6-9.4-6z" fill="#fff4e2"/><circle cx="8.4" cy="11.2" r="1.9" fill="#2b1f17"/><circle cx="15.6" cy="11.2" r="1.9" fill="#2b1f17"/><circle cx="8.9" cy="10.6" r=".6" fill="#fff"/><circle cx="16.1" cy="10.6" r=".6" fill="#fff"/><ellipse cx="12" cy="14.4" rx="1.4" ry="1.05" fill="#2b1f17"/></svg>';
const agentIcon = (id, size = 14) => id === 'tibi' ? FOX_FACE : `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${AGENT_ICON[id] || AGENT_ICON.custom}</svg>`;
const agentAv = (id, cls = '') => `<span class="av-ag${id === 'tibi' ? ' tibi' : ''}${cls ? ' ' + cls : ''}" aria-hidden="true">${agentIcon(id)}</span>`;
