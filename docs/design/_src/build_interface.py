# 由同一份接口定义生成 06-interface.md 与 overview.html 第 08 节（文档即代码：改这里，再运行）。
# 用法：在 docs/design/ 下运行 python3 _src/build_interface.py
import re, pathlib

TYPES = r"""
// 基础
type Id = string;            // 领域表主键，UUIDv7（R11：手机与电脑各自生成不冲突）
type Ts = number;            // 毫秒时间戳
type ConvId = string;        // conversations.id（UUIDv7）
type TurnId = string;        // 一轮回答：这一轮第一句用户消息的 id（T35：没有单独的任务）
type SkillId = 'tibi' | 'importer' | 'scout' | 'tutor' | 'coach' | 'insight' | 'archivist';
type Tier = 'fast' | 'deep';
type Status = 0 | 1 | 2 | 3 | 4 | 5 | 97 | 98;   // 生词…掌握、标为已知（不建卡，不等于掌握）、忽略；只有用户标过的词才有状态
type Kind = 'article' | 'book';
type Genre = 'tech' | 'news' | 'lit' | 'academic' | 'general';
type CardType = 'recognize' | 'choice' | 'cloze';   // 计分复习只有这三种（R6）；choice = 选义四选一（G2）；M1 只有 choice、cloze，M3 加 recognize
type PracticeMode = 'dictation' | 'spell' | 'confusable' | 'produce';   // 不计分练习：听写原句 / 拼写 / 易混词辨析 / 造句（R6 把拼写、造句移到这里）
type Rating = 1 | 2 | 3 | 4;                       // 忘了 / 模糊 / 记得 / 轻松
type Page<T> = { items: T[]; total: number; cursor?: string };
type Undo = { undo_id: Id; expires_at: Ts };       // 写操作的撤销凭据；system.undo 用
type Ok = { ok: true };
type AiStatus = 'none' | 'deferred' | 'running' | 'done' | 'failed';   // deferred = 离线或没配模型，"稍后补做"
type AiTask = 'summary' | 'phrases' | 'hard_sentences' | 'advice' | 'keywords' | 'glossary' | 'characters' | 'recap' | 'background' | 'translate' | 'explain' | 'grade_sentence' | 'context_meanings';   // 与 ai_results.task 一致；context_meanings = 内置示例预生成的语境释义
type LearningEventType = 'document_imported' | 'section_finished' | 'term_marked' | 'review_session' | 'quiz_done';   // 与 learning_events.type 一致

// 文档
interface DocumentSummary { id: Id; kind: Kind; genre: Genre; title: string; author?: string; source: string; tags: string[];
  minutes: number; level?: string; progress: number;          // level：按词频估的文本级别 A2–C2，与用户无关；progress 0–1
  book?: { chapter: number; chapters: number; chapter_progress: number }; status: 'processing' | 'ready' | 'failed'; ai_status: AiStatus;
  excerpt: string; cover_path?: string; added_at: Ts; opened_at?: Ts; finished_at?: Ts }
interface Document extends DocumentSummary { sections: { id: Id; idx: number; title: string; status: string; progress: number; word_count: number }[];
  ai?: { summary?: AiResult; advice?: AiResult; phrases?: AiResult; hard_sentences?: AiResult; glossary?: AiResult; characters?: AiResult } }
interface SampleInfo { id: string; title: string; author?: string; genre: Genre; source: string; minutes: number; is_default: boolean; document_id?: Id }   // 内置示例；导入过的带 document_id
interface Token { t: string; l: string; s: number; e: number; status?: Status; phrase_id?: Id; gloss?: string }   // 原文 · lemma · 偏移 · 状态 · 行间释义
interface Sentence { id: Id; idx: number; paragraph_idx: number; block_type: 'prose' | 'heading' | 'list_item' | 'quote'; text: string; tokens: Token[]; translation?: string }
interface SectionContent { id: Id; document_id: Id; title: string; blocks: ({ type: 'code'; lang?: string; code: string } | { type: 'sentences'; ids: Id[] })[];
  sentences: Sentence[]; phrases: { id: Id; text: string; sentence_ids: Id[] }[]; counts: { new: number; learning: number }; ai?: Record<string, AiResult> }
interface AiResult { task: string; output: unknown; model: string; prompt_version: string; created_at: Ts }

// 词汇
interface Term { id: Id; kind: 'word' | 'phrase'; text: string; display: string; ipa?: string; meaning: string; short_gloss?: string; status: Status;
  forms: string[]; star?: number; exam: string[]; tags: string[]; encounter_count: number; doc_count: number;
  due?: Ts; retention?: number; lapses: number; added_at: Ts; last_seen_at?: Ts }
interface TermDetail extends Term { en?: string; note?: string; contexts: { id: Id; source: 'article' | 'dictionary' | 'manual'; document_id?: Id; document_title?: string; sentence_id?: Id; sentence: string; surface?: string;
  meaning_in_context?: string; is_primary: boolean; unknown_others: number }[];   // unknown_others = 0 即 i+1 句
  card?: CardState; reviews: { rating: Rating; card_type: CardType; reviewed_at: Ts }[]; history: { status: Status; at: Ts; source: string }[] }
interface DictEntry { word: string; phonetic?: string; translation: string; definition?: string; pos?: string; collins?: number; oxford?: boolean; exam: string[]; frequency?: number; forms: string[]; inflections?: { type: 'p' | 'd' | 'i' | '3' | 'r' | 't' | 's'; form: string }[]; base?: string }
interface DictBrief { word: string; phonetic?: string; gloss: string }

// 复习
interface CardState { card_id: Id; term_id: Id; state: 0 | 1 | 2 | 3; due: Ts; stability: number; difficulty: number; reps: number; lapses: number; suspended: boolean; forced_type?: CardType }
interface QueueItem { step: number; card_id: Id; term: Term; card_type: CardType; is_new: boolean; last_review?: Ts;
  intro: boolean;                      // 没在文章里见过的新词先"初见"（G4），这一步不作答
  retry: 0 | 1 | 2;                    // >0 = 答错后换题型重练，不计分（G3）
  self_rated: boolean;                 // 只有 recognize 自评（G1）
  options?: { id: string; text: string; from?: string }[];   // 选义题的四个选项；from = 干扰项来源（易混词、同篇生词…），答错后展示
  context: { id: Id; sentence: string; answer: string[]; translation: string; document_title?: string; document_id?: Id; source: 'article' | 'dictionary' }; hint?: string; note?: string }
interface ReviewSession { session_id: Id; kind: 'review' | 'drill'; graded: boolean; steps: QueueItem[]; cursor: number; resumed: boolean; started_at: Ts; forecast: number[] }
interface Answer { choice?: string; typed?: string; self_rating?: Rating }
interface AnswerResult { step: number; correct: boolean; near_miss: boolean;
  rating?: Rating; reason?: string; auto: boolean;   // 系统评分与理由（"答对，用时 4 秒""用了 1 次提示"）；retry / drill 步没有 rating
  card?: CardState; status_change?: { from: Status; to: Status }; next?: { days: number; label: string };
  retry_step?: number;                 // 答错时插入的重练步序号
  undo: Undo }
interface PracticeItem { id: string; mode: PracticeMode; sentence: string; audio?: string; options?: [string, string]; answer?: string; explain?: string; source: { document_id?: Id; term_id?: Id } }
interface PracticeResult { practice_id: Id; accuracy: number; duration_ms: number; best: { dictation_accuracy: number; rounds: number } }
interface IntervalPreview { 1: string; 2: string; 3: string; 4: string }   // 每档评分对应的下次间隔文案

// 对话（一轮回答就是对话里的一段消息，T35）
interface Conversation { id: ConvId; kind: 'chat' | 'day' | 'document' | 'skill'; day?: string; device: 'desktop' | 'mobile'; skill_id: SkillId; title: string; document_id?: Id; trigger: 'user' | 'auto' | 'event' | 'mcp'; created_at: Ts; updated_at: Ts }
interface Message { id: string; role: 'user' | 'assistant' | 'tool'; text?: string; blocks?: MessageBlock[]; tool?: { name: string; args: unknown; result?: unknown; duration_ms?: number }; turn_id?: TurnId; interrupted?: { reason: 'cancel' | 'error'; message?: string }; steps?: { tool: string; summary: string; status: 'ok' | 'error' | 'denied' }[]; skill?: string; receipts?: { summary: string; undo?: Undo; undone?: boolean }[]; created_at: Ts }
interface AskOption { id: string; label: string; description?: string; action?: { tool: string; params: unknown; preview: string } }   // preview 由内核生成
interface AskData { question: string; multi: boolean; options: AskOption[]; untrusted: boolean }
interface AskState { answered?: { option_ids: string[]; text?: string; at: Ts }; expired?: boolean; results?: { option_id: string; ok: boolean; message: string }[] }
interface Approval { id: Id; conversation_id?: ConvId; turn_id?: TurnId; client?: string; skill_id?: SkillId; tool: string; title: string; body: string; impact: string; undoable: boolean; untrusted: boolean; always_ask?: boolean;   // 只在内存里；client = 外部工具名（MCP）；untrusted = 这一轮读过不可信内容
  editable?: { field: string; value: string }; requested_at: Ts }

// 技能、记忆、配置
interface Skill { id: SkillId; title: string; description: string; tools: string[]; model_tier: Tier; extra_instructions?: string;
  write_permission: 'inherit' | 'ask'; enabled: boolean }
interface Memory { id: Id; type: 'profile' | 'semantic' | 'episodic' | 'procedural'; content: string; subject?: string; confidence: number;
  source: { type: 'user' | 'agent' | 'consolidation'; ref?: string; label: string }; status: 'active' | 'superseded'; created_at: Ts; updated_at: Ts }
// model 是配置项（默认跟随 pi-ai 目录：deepseek-flash / deepseek-v4-pro），代码不写死
interface Provider { id: Id; kind: 'llm' | 'vision' | 'image' | 'tts'; name: string; protocol: string; base_url?: string; auth: 'api_key'; tier?: Tier; model: string;
  has_secret: boolean; is_default: boolean }
interface Profile { display_name: string; interests: string[];   // 不记英语水平、目标、词汇量和讲解语言（2026-11-03）
  daily_goal_minutes: number; daily_new_cards: number; desired_retention: number; assistant_prefs: { nickname: string; permission: 'ask' | 'default' | 'auto' } }

// M1 成功标准的脱敏汇总：只有计数与开关，不含词、正文、网址、文件名、绝对时间（数据来源见 01 §6）
interface UsageSummary { schema: 1; app_version: string; days_since_first_use: number; reviews: number;
  documents: { samples: number; self_imported: number; finished: number };
  h2: { window_closed: boolean; self_imports_7d: number; passed?: boolean };                                   // 窗口没过且还没导入时 passed 为空
  h3: { has_card: boolean; reviewed_next_day?: boolean } }                                                     // 还没到次日时为空

// 错误（JSON-RPC error.data.code）
type SyncBackendCfg = { kind: 'icloud' } | { kind: 'folder'; path: string } | { kind: 'webdav'; url: string; user: string; password_ref: string }
interface SyncStatus { enabled: boolean; backend?: SyncBackendCfg; state: 'off' | 'idle' | 'syncing' | 'error'; last_synced_at?: Ts; pending: number; sync_files: boolean; device?: { id: string; name: string }; peers: { id: string; name: string; platform: 'macos' | 'windows' | 'linux' | 'ios' | 'android'; last_seen_at?: Ts; removed: boolean }[]; error?: SyncError }
type SyncError = 'offline' | 'auth' | 'icloud_signed_out' | 'quota' | 'newer_format' | 'unknown';
type ErrorCode = 'not_found' | 'conflict' | 'permission_denied' | 'model_unavailable' | 'offline' | 'invalid_source' | 'busy';
"""

# (分组, 说明, [(方法, 参数, 返回, 备注)])
API = [
  ('documents', '文档与书架', [
    ('documents.import', "{ source: { type: 'text'; text: string } | { type: 'url'; url: string } | { type: 'file'; path: string } | { type: 'images'; paths: string[] } | { type: 'sample'; id: string }; hints?: { kind?: Kind; genre?: Genre; tags?: string[] }; origin?: 'user' | 'deeplink' }", '{ import_id: Id }', '在后台导入，立即返回；进度走 import.progress，完成走 import.done（载荷含 ok、document_id 或 error）；path 与 url 按 §1 校验；sample 直接写入预生成的 AI 结果，不调模型；deeplink 只在用户确认后才调'),
    ('documents.samples', '{}', 'SampleInfo[]', '内置示例（随应用打包，正文与预生成结果在 packages/core/samples/）；技术向那篇 is_default；用 documents.import({ source: { type: \'sample\', id } }) 导入，导入时写入预生成的总结、短语、长难句、建议与语境释义，不调模型'),
    ('documents.checkUrl', '{ url: string }', '{ ok: boolean; url?: string; host?: string; error?: ErrorCode }', '按 §1 校验网址，不抓内容；深链确认卡先调它'),
    ('documents.list', "{ kind?: Kind; genre?: Genre; tags?: string[]; q?: string; sort?: 'fit' | 'opened' | 'added' | 'progress' | 'minutes'; archived?: boolean; cursor?: string; limit?: number }", 'Page<DocumentSummary>', '书架页与首页书架；tags 多选为同时满足'),
    ('documents.get', '{ id: Id }', 'Document', '含章节列表与文档级 AI 结果'),
    ('documents.update', "{ id: Id; patch: { title?: string; genre?: Genre; tags?: string[]; is_favorite?: boolean; is_archived?: boolean } }", 'Document', '改 genre 会让相关 ai_results 失效'),
    ('documents.delete', '{ id: Id }', 'Undo', '软删（documents.deleted_at），书架不再显示，可撤销；原始文件副本一并移入回收区'),
    ('documents.reanalyze', '{ id: Id; ai?: boolean }', 'Ok', '在后台按当前词库重新标注，完成后 data.changed(documents)；ai=true 时把 AI 状态置回 deferred'),
    ('documents.analyze', '{ id: Id }', 'Ok', 'M2，在后台做：（重新）生成总结 + 学习建议 + 关键词、短语、长难句（三个子任务并行，各一次固定提示的快速档调用，JSON 输出，写 ai_results）。导入时不自动做，只由阅读器总结面板的"现在生成 / 重新生成"触发；内置示例不适用'),
    ('documents.export', "{ id: Id; format: 'markdown' }", '{ path: string }', '含标注与笔记'),
    ('sections.get', "{ id: Id; with?: ('translations' | 'ai')[] }", 'SectionContent', '阅读器一次取齐：句子、tokens、词状态、短语、计数'),
    ('sections.progress', '{ id: Id; sentence_id: Id; progress: number }', 'Ok', '阅读位置；节流后调用'),
    ('sections.finish', '{ id: Id }', 'Ok', '读完：只记进度和事件，不改任何词的状态'),
    ('sections.translate', "{ id: Id; sentence_ids?: Id[] }", 'Ok', '在后台做；译文开关首次打开时整节批量生成：30 句一批、快速档、JSON 数组输出，写 sentences.translation，完成后发 data.changed(sentences, ids = [section_id])；没连模型 → model_unavailable'),
  ]),
  ('terms', '词汇与生词本', [
    ('terms.lookup', '{ text: string; sentence_id?: Id }', '{ dict?: DictEntry; term?: Term; context_meaning?: string; status_change?: { from: Status; to: Status }; card_created?: boolean }', '词卡：词典 + 本地状态 + 语境释义缓存（内置示例先查预生成结果；否则 M1 由固定的模型调用补，M2 起由讲解技能补）。**写操作**（R5）：带 sentence_id 时，用户标过的生词（status = 0）自动设为 1（source = lookup）并建卡，每日新卡上限（默认 20）之外的排队到后面几天；其他状态不变，没有词条行的词只查不写（没标过的词释义缓存在句子的 ai_results 上）；不带 sentence_id 时只读。不返回 Undo，词卡上可改状态或忽略'),
    ('terms.context_meaning', '{ text: string; sentence_id: Id }', '{ meaning: string; cached: boolean }', 'M1 词卡的语境释义：先查缓存（内置示例的预生成结果、term_contexts.meaning_in_context）；没有就用快速档模型按固定提示现写一条（≤16 字），写回 term_contexts。没连模型 → model_unavailable，离线 → offline。词卡先显示词典释义，再异步补这一行；M2 起由讲解技能接手'),
    ('terms.list', "{ view?: 'all' | 'due' | 'late' | 'new' | 'leech' | 'stuck' | 'stale' | 'ignored' | 'known' | 'mastered'; status?: Status[]; kind?: 'word' | 'phrase'; document_id?: Id; tags?: string[]; q?: string; sort?: 'due' | 'added' | 'enc' | 'alpha' | 'stage' | 'freq'; cursor?: string; limit?: number }", 'Page<Term> & { counts: Record<string, number> }', 'counts 给左栏视图计数与标签计数；词条不单独打标签，tags 继承来源文章（01 §2）'),
    ('terms.get', '{ id: Id } | { text: string }', 'TermDetail', '详情抽屉；contexts 已按 i+1 适合度排序'),
    ('terms.mark', '{ text: string; status: Status; sentence_id?: Id }', '{ term: Term; previous?: Status; undo: Undo }', '按文字标一个词（词卡上点熟练度 / 忽略 / 其实认识）：没有词条时现建——0–4 加入生词本并建卡，5 / 97 / 98 只记状态；可撤销'),
    ('terms.setStatus', "{ ids: Id[]; status: Status; source?: 'user' | 'page_done' }", '{ changed: number; undo: Undo }', '0–5、97 标为已知、98 忽略；5、97、98 会暂停已有卡片，97 不建新卡'),
    ('terms.addPhrase', '{ text: string; sentence_id: Id; surface: string }', 'Term', '选中多个词标为短语；之后全文自动识别'),
    ('terms.add', '{ entries: { text: string; meaning?: string }[] }', '{ created: Term[]; undo: Undo }', '生词本"添加"：查词典补音标释义，用词典例句做卡'),
    ('terms.pause', '{ ids: Id[]; days: number }', '{ changed: number; undo: Undo }', '难词暂停复习'),
    ('terms.setCardType', '{ id: Id; card_type?: CardType }', 'CardState', '难词换题型；undefined 恢复默认'),
    ('terms.remove', '{ ids: Id[] }', 'Undo', '移出生词本：in_wordbook = 0，卡片软删（cards.deleted_at），review_logs 保留；再次加入时恢复原卡片'),
    ('terms.import', "{ path: string; format: 'csv' | 'txt' | 'anki' | 'known' }", '{ added: number; known: number; skipped: number; total: number }', 'M3：读用户选的文件（path 按 §1 校验）。known = 已知词表：没有的建成已知（97），生词改为已知，学习中、已知、忽略的不动；txt / csv / anki = 加进生词本，第二列当释义。每行一个词，# 开头的行和表头跳过，一次最多 20,000 个'),
    ('terms.export', "{ format: 'csv' | 'anki' | 'txt'; ids?: Id[]; with_contexts?: boolean }", '{ filename: string; text: string; count: number }', 'M3：只生成文本，壳用 save_text_file 另存为（Core 不写文件）。csv 带 BOM（Excel 直接打开）；anki 是 Anki"导入文件"认的制表符文本（#separator / #html / #columns 头，背面是释义 + 原句加粗 + 译文 + 出处）；txt 每行一个词。不给 ids 时导出整个生词本'),
  ]),
  ('review', '复习', [
    ('review.start', "{ resume?: boolean; ahead?: boolean; limit?: number }", 'ReviewSession', '默认先续上未完成的会话（G6）；否则按"先到期、后新词，新词 5 个一组先初见再回忆"排好步骤'),
    ('review.preview', '{ card_id: Id }', 'IntervalPreview', '自评题的四个按钮、"改评分"展开时的间隔文案'),
    ('review.answer', '{ session_id: Id; step: number; answer: Answer; hints: number; duration_ms: number }', 'AnswerResult', 'Core 判分（G1）：错 → 忘了；对但慢 / 用了提示 / 拼写差一点 → 模糊；对 → 记得；拼写又快又对 → 轻松。只有首次作答写 review_logs（G3）；答错插入换题型的重练步'),
    ('review.override', '{ session_id: Id; step: number; rating: Rating }', 'AnswerResult', '用户改系统给的评分；review_logs 记 suggested_rating 与最终 rating'),
    ('review.next', '{ session_id: Id; step: number }', 'Ok', '初见步"认识了"、重练步"继续"；推进游标并保存进度'),
    ('review.undo', '{ session_id: Id }', 'AnswerResult', '撤销上一张（恢复卡片状态与插入的重练步）'),
    ('review.pause', '{ session_id: Id }', 'Ok', '"稍后继续"；每次作答已自动保存，这里只标记暂停'),
    ('review.overview', '{}', '{ due, late, fresh, new_waiting, daily_new, open?, today, later_today, forecast, leeches, mistakes }', '复习页面板（00 §3.3）：到期 / 逾期 / 今天还能学的新词、做到一半的一轮、今天做了多少、7 天预报、难词数、这周忘过的词；不建会话'),
    ('review.grade', '{ session_id: Id; step: number; text: string }', '—', 'R6 后计分复习没有造句题，调用返回 conflict；造句批改用 practice.grade'),
    ('review.quiz', '{ term_ids?: Id[]; count?: number; from?: "session_mistakes" }', 'ReviewSession', '不计分的会话（kind = drill，graded = false）：完成页"再练错词"、空状态"用生词出题"（G7）'),
    ('review.story', '{ term_ids: Id[] }', '{ import_id: Id }', 'G7"读一篇用到这些词的短文"（M3）：快速档按固定提示写 150–250 词、其余用词尽量常见、贴近兴趣的短文，作为 tibi_generated 文章导入书架（标签"Tibi 写的"），返回这次导入的 import_id；没连模型 → model_unavailable'),
    ('review.optimize', '{}', 'Ok', '按个人记录优化 FSRS 参数（≥ 400 条）'),
  ]),
  ('practice', '练习（不计分，G8；排在后续）', [
    ('practice.start', "{ mode: PracticeMode; source: 'recent' | 'mistakes' | 'leech' | 'document'; document_id?: Id; count?: number }", '{ practice_id: Id; items: PracticeItem[] }', '句子来自用户读过的文章；易混词来自生词本与词典的易混提示'),
    ('practice.grade', '{ word: string; text: string; sentence?: string }', '{ score: number; ok: boolean; feedback: string; better?: string }', '造句批改（M3，不计分）：快速档按固定提示给 0–100 分、是否用对、一两句中文点评和改好的句子；学生句子当不可信材料'),
    ('practice.finish', '{ practice_id: Id; results: { item_id: string; accuracy: number; duration_ms: number }[] }', 'PracticeResult', '写 practice_logs，不改 cards / review_logs'),
  ]),
  ('stats', '统计', [
    ('feeds.list', '{}', '{ url: string; title: string; builtin: boolean; enabled: boolean }[]', 'M5 文章来源：内置 + 自己加的'),
    ('feeds.update', '{ add?: { url: string; title?: string }; remove?: string; toggle?: { url: string; enabled: boolean } }', '同 feeds.list', '加源时先抓一次，确认是 RSS / Atom'),
    ('feeds.search', '{ interests?: string[]; limit?: number }', 'search_feeds 的返回', '界面直接看候选，不经模型'),
    ('search.query', '{ q: string; limit?: number }', '{ documents: { id; title; genre; snippet? }[]; terms: { id; text; display; meaning?; status }[]; conversations: { id; title; kind; last_message_at? }[]; dict?: { lemma: string; entry: DictEntry } }', 'M6 全局搜索（⌘K，00 §3.8）：文章标题 + 正文 FTS5 片段、生词本里的词（英文前缀 / 词形 / 中文释义，不含已知和忽略）、对话标题；输入像英文单词又不在生词本里时附词典释义。设置项和跳转在界面本地匹配。只读'),
    ('dict.suggest', '{ q: string; limit?: number }', "{ available: boolean; mode: 'prefix' | 'zh' | 'similar'; items: DictBrief[] }", '词典页（00 §3.14）联想：输入正好是词头时排第一，是变形时原形紧跟，其余按词频；有汉字时中文反查；英文查不到时给拼写相近的词。只读，不联网。没装词典时 available = false'),
    ('dict.entry', '{ word: string }', '{ available: boolean; entry?: DictEntry; lemma: string; via?: string; term?: Term; in_wordbook: boolean; readings: { document_id: Id; title: string; snippet: string }[]; similar: DictBrief[] }', '词典页词条：词典内容、本地状态、读过的文章里出现这个词及其词形的地方（每篇一条，命中处用 ⟦ ⟧ 标出）。lemma 是进生词本的原形。只读，不改熟练度、不建卡；加入生词本走 terms.add'),
    ('stats.summary', '{ range: 30 | 90 | 180 }', '{ mastered: number; mastered_delta: number; prev_delta: number; minutes: number; words: number; study_days: number; streak: number; longest_streak: number; reviews: number; retention: number }', '四张指标卡'),
    ('stats.series', "{ metrics: ('mastered' | 'minutes' | 'words' | 'reviews')[]; days: number }", '{ dates: Ts[]; series: Record<string, number[]> }', '折线、柱状、热力图共用'),
    ('stats.retention', '{ weeks: number }', '{ weeks: { ratings: [number, number, number, number]; retention: number }[]; lapses: number; leeches: number }', '"复习表现"面板'),
    ('stats.genres', '{ range: number }', '{ genre: Genre; words: number }[]', ''),
    ('stats.insight', '{ regenerate?: boolean }', '{ insight?: { text: string; actions: { label: string; route: string }[]; generated_at: Ts; cost: number } }', 'M3：当天有缓存（settings stats.insight）直接返回；否则用快速档按固定提示写 2–3 句观察 + 1–3 个动作（只能从复习 / 难词 / 书架 / 生词本里挑），同步返回。输入只有计数。没连模型 → model_unavailable'),
    ('stats.forecast', '{ days?: number }', '{ days: number[]; target_retention: number }', '"接下来要复习"：未来 N 天（默认 14）每天到期的卡数，今天含逾期'),
    ('stats.stages', '{}', '{ stages: number[] }', '"生词本熟练度"：生词本里 0–5 六档的词数'),
    ('stats.export_summary', '{}', 'UsageSummary', '只读。M1 成功标准的脱敏汇总，只有计数，不含词和正文；界面先展示全部内容，用户复制或另存后自己发给作者，不做上报。数据来自 learning_events、term_status_log、cards、review_logs（01 §6）'),
  ]),
  ('chat', '对话（Tibi 主对话与各页面板）', [
    ('chat.widget_update', "{ message_id: Id; widget_id: Id; state: unknown; result?: string }", 'Ok', '保存卡片上的操作结果；`result` 下一轮带给模型'),
    ('chat.answer', "{ widget_id: Id; option_ids: string[]; text?: string }", '{ state: AskState }', '回答正在等的反问卡，一张卡只能答一次：回答交给原地等着的 `ask_user`，Tibi 在这一轮里接着做。卡片已经过期（这一轮取消、应用重启过）时报 conflict。Tibi 等回答时用户用 `chat.send` 说的话也算回答（返回 `answered: true`）'),
    ('chat.rewind', "{ conversation_id: ConvId; message_id: Id }", '{ text: string; skill?: SkillId }', '回到这句话之前：这条和之后的消息作废，已写入的词不动'),
    ('chat.receipt_undone', "{ message_id: Id; undo_id: Id }", 'Ok', '记下用户撤销了回答里的哪次写入'),
    ('chat.open', "{ conversation_id?: ConvId; document_id?: Id; today?: boolean }", 'Conversation & { messages: Message[]; cursor?: string; active: TurnId[]; approvals: Approval[]; live: { id: TurnId; blocks: MessageBlock[]; steps: MessageStep[] }[] }', 'cursor：更早的消息从这里接着翻（chat.history）。live：进行中的回答已经说出来的部分。active / approvals：进行中的回答和等确认的审批（只在内存里），离开再回来时接上。给 document_id 时续上该文章的线程；today 为 true（手机首页，J9）时打开或新建当天的 day 对话；都不给则新建全局线程'),
    ('chat.send', "{ conversation_id: ConvId; text: string; context?: { page: string; document_id?: Id; section_id?: Id; sentence_id?: Id; selection?: string; card_id?: Id }; skill?: SkillId; tier?: Tier }", '{ submission_id: TurnId }', '立即返回；开一轮回答（submission_id 就是 turn_id），文本增量与工具调用走事件，结束走 chat.end；skill 对应 / 选择'),
    ('chat.list', '{ limit?: number }', 'Conversation[]', '左栏"最近"'),
    ('chat.history', '{ conversation_id: ConvId; cursor?: string }', 'Page<Message>', ''),
    ('chat.cancel', '{ submission_id: TurnId }', 'Ok', '停止这一轮'),
    ('chat.retry', '{ conversation_id: ConvId; turn_id: TurnId }', '{ submission_id: TurnId }', '停止、出错或重启中断的那一轮重新回答：上次说了一半的作废，用户的话（含回答中补充的）留着'),
    ('chat.rename', '{ conversation_id: ConvId; title: string }', 'Conversation', ''),
    ('chat.delete', '{ conversation_id: ConvId }', 'Ok', '硬删：对话、thread_links，以及 skill_audit 里引用它的 args 与 undo_payload；不可撤销'),
  ]),
  ('approvals', '审批', [
    ('approvals.list', '{ conversation_id?: ConvId }', 'Approval[]', '等确认的操作（只在内存里）；不给 conversation_id 时是不在对话里的（外部工具来的）'),
    ('approvals.decide', "{ id: Id; decision: 'allow' | 'deny' | 'edit'; edited?: Record<string, unknown>; always?: boolean }", 'Ok', '解除等待；always 写入该技能这项能力的自动允许规则（对读过不可信内容的那一轮不生效）'),
  ]),
  ('skills', '技能', [
    ('skills.list', '{}', 'Skill[]', '设置页"Tibi 的技能"'),
    ('skills.update', "{ id: SkillId; patch: { model_tier?: Tier; extra_instructions?: string; write_permission?: 'inherit' | 'ask'; enabled?: boolean } }", 'Skill', ''),
    ('skills.reset', '{ id: SkillId }', 'Skill', '恢复默认（清空附加指令与覆盖）'),
    ('skills.runNow', '{ id: SkillId; input?: string }', '{ conversation_id: ConvId; submission_id: TurnId }', '直接运行一项技能：建一段 kind = skill 的对话（不进"最近"），在里面跑一轮；所有技能都由用户触发'),
  ]),
  ('memory', 'Tibi 记忆', [
    ('memory.list', "{ type?: Memory['type']; q?: string }", 'Memory[]', '每条带来源，可跳到对话或文章'),
    ('memory.update', '{ id: Id; content: string }', 'Memory', '用户修改后 source 变为 user'),
    ('memory.delete', '{ id: Id }', 'Undo', '撤销窗口过后硬删，连同 skill_audit 里的内容副本'),
    ('memory.pause', '{ paused: boolean }', 'Ok', '暂停写入新记忆，已有仍使用'),
    ('memory.clear', '{}', 'Undo', '同 memory.delete'),
  ]),
  ('settings', '设置与账户', [
    ('profile.get', '{}', 'Profile', ''),
    ('profile.update', '{ patch: Partial<Profile> }', 'Profile', '自动保存'),
    ('settings.get', '{ keys?: string[] }', 'Record<string, unknown>', 'reader.*、tts.*、ui.* 等键值'),
    ('settings.set', '{ patch: Record<string, unknown> }', 'Record<string, unknown>', ''),
    ('providers.list', '{}', 'Provider[]', '密钥不返回，只有 has_secret'),
    ('providers.upsert', '{ provider: Omit<Provider, \'id\' | \'has_secret\'> & { id?: Id }; secret_ref?: string }', 'Provider', '密钥先由 Rust 写入钥匙串，这里只传引用；没带 id 时，同服务同档已有记录就更新它'),
    ('providers.delete', '{ id: Id }', '{ ok: true; secret_ref?: string }', '软删；默认被删时交给剩下的一条。secret_ref 只在没有别的记录再用这个密钥时返回，由调用方从钥匙串删掉'),
    ('providers.test', '{ id: Id }', '{ ok: boolean; model?: string; latency_ms?: number; json_mode?: boolean; error?: string }', '连接测试：用这个服务商发一条很短的请求，返回模型名与耗时；失败时 ok = false 并带原因'),
  ]),
  ('sync', '同步（M7，见 08）', [
    ('sync.status', '{}', 'SyncStatus', '设置 → 数据 → 同步、手机"我 › 同步"'),
    ('sync.probe', '{ backend: SyncBackendCfg }', "{ ok: boolean; library?: { library_id: string; devices: number; updated_at: Ts }; error?: SyncError }", '测试连接并看文件夹里有没有已有的资料库；WebDAV 密码先由壳写进钥匙串，这里只传 password_ref。M7：后端多了 folder（任意本地文件夹：Dropbox、OneDrive、NAS 挂载等），桌面之间也能同步'),
    ('sync.enable', '{ backend: SyncBackendCfg; device_name?: string; sync_files?: boolean }', 'SyncStatus', '文件夹里已有资料库就加入，否则新建；本机已有数据作为第一批改动推送（08 §9），再拉一次。设备名默认取主机名'),
    ('sync.now', '{}', 'SyncStatus', '立即推送 + 拉取，跑完返回；过程走 sync.update，失败原因记在 SyncStatus.error'),
    ('sync.auto', '{}', '{ ran: boolean }', '自动同步的时机（启动后 10 秒、每 5 分钟、本机改动后 30 秒）由运行时调用；没开或正在同步时直接返回'),
    ('sync.setOptions', '{ sync_files?: boolean; device_name?: string }', 'SyncStatus', ''),
    ('sync.removeDevice', '{ device_id: string }', 'SyncStatus', '不再等这台设备的确认；它的文件夹保留，回来时按新设备处理'),
    ('sync.disable', '{}', 'Ok', '停止同步；本机数据保留，云端文件不删'),
  ]),
  ('system', '系统', [
    ('system.status', '{}', "{ version: string; db_path: string; offline: boolean; models: { fast?: string; deep?: string; ok: boolean } }", '启动与顶栏'),
    ('system.undo', '{ undo_id: Id }', 'Ok', '所有返回 Undo 的操作统一从这里撤销'),
    ('system.backup', "{ reason?: 'manual' | 'before_reset' | 'before_restore' }", '{ path: string; size: number; created_at: Ts }', '立即备份：VACUUM INTO 到 app.db 旁边的 backups/，文件名 tibi-YYYYMMDD-HHMMSS-<reason>.db。自动备份由 Core 每小时检查一次，最近一份自动备份超过一天就备（settings backup.auto 可关），只轮换自动备份、保留 7 份'),
    ('system.backups', '{}', "{ auto: boolean; dir_supported: boolean; items: { name: string; path: string; size: number; created_at: Ts; reason: 'auto' | 'manual' | 'before_reset' | 'before_restore' }[] }", '备份列表（新的在前）。恢复由壳的 restore_backup 做'),
    ('system.restore', '{ path: string }', 'Ok', '重启 Core'),
    ('system.clearCache', "{ kind: 'audio' | 'ai' }", '{ freed: number }', ''),
    ('system.reset', '{ confirm: true }', 'Ok', '先备份再清空，回到首次使用引导'),
  ]),
]

EVENTS = [
  ('chat.delta', '{ conversation_id: ConvId; submission_id: TurnId; delta: string; done?: boolean }', '对话页、各页 Tibi 面板逐字显示'),
  ('chat.block', "{ conversation_id: ConvId; submission_id: TurnId; block: WidgetBlock }", '显示对话卡片：查词、辨析、练习、设置入口在工具结束后；反问在工具开始等回答时'),
  ('chat.end', "{ conversation_id: ConvId; submission_id: TurnId; state: 'done' | 'error' | 'cancel'; error?: string }", '这一轮结束：完成后界面从库里重读；出错或停止时显示原因和"重试"'),
  ('chat.tool', "{ conversation_id: ConvId; turn_id: TurnId; phase: 'start' | 'end'; tool: string; skill_id: SkillId; status?: 'ok' | 'error' | 'denied'; summary: string; duration_ms?: number }", '收起的过程卡（子技能的步骤不发）'),
  ('import.progress', "{ import_id: Id; title: string; label: string; origin: 'user' | 'deeplink' | 'mcp' | 'share' | 'chat' }", '首页"正在导入"一行；origin = chat 是 Tibi 在对话里起的导入，进度显示在对话的导入卡上，首页和全局提示都不显示'),
  ('import.done', "{ import_id: Id; title: string; origin: string; ok: boolean; document_id?: Id; duplicate?: boolean; summary?: string; action?: { label: string; route: string }; error?: string }", '带动作的通知（"导入完成 · 开始阅读"）；失败时带原因'),
  ('approval.requested', '{ approval: Approval }', '审批卡（对话页；外部工具来的在桌面窗口右下角）；界面回 approvals.decide'),
  ('approval.resolved', "{ id: Id; decision: 'allow' | 'deny' | 'edit' }", '多处显示同一张卡时同步收起；这一轮停止时也发'),
  ('data.changed', "{ table: 'documents' | 'terms' | 'cards' | 'memories' | 'skills' | 'settings'; ids?: Id[] }", '书架、生词本、统计做局部刷新'),
  ('sync.update', "{ state: 'idle' | 'syncing' | 'error'; pushed?: number; pulled?: number; last_synced_at?: Ts; error?: SyncError }", '同步状态行；拉取后有改动时另发 data.changed'),
  ('model.status', "{ ok: boolean; reason?: 'offline' | 'unauthorized' }", '顶栏提示"AI 未运行，可稍后补做"'),
]

RUST = [
  ('keyring_set', '{ ref: string; secret: string }', 'Ok', '写入密钥只走 WebView → Rust → 密钥存储（05 §8），不进 Core 的 RPC'),
  ('keyring_delete', '{ ref: string }', 'Ok', ''),
  ('secret_get', '{ ref: string }', '{ secret: string }', '只给 Core：经 sidecar 通道按需取，只留内存，不写库、不写日志；WebView 不能调用'),
  ('core_status / core_restart', '{}', '{ pid: number; uptime_ms: number }', 'sidecar 守护'),
  ('open_path', '{ path: string }', 'Ok', '在 Finder / 资源管理器中显示（白名单路径、app.db、backups/ 下的文件）'),
  ('restore_backup', '{ path: string }', 'Ok', '从 backups/ 下的一份备份恢复：先 system.backup(before_restore)，停 Core，删 -wal / -shm，换 app.db，重启 Core；界面随后刷新'),
  ('save_text_file', '{ default_name: string; text: string }', '{ saved: boolean; path?: string }', '弹保存对话框，用户选了位置才写（导出学习汇总）'),
  ('pick_file', "{ kinds: ('pdf' | 'epub' | 'docx' | 'txt' | 'image' | 'csv' | 'apkg')[] ; multiple?: boolean }", '{ paths: string[] }', '文件选择对话框；所选路径（含拖入的文件）由 Rust 登记给 Core，能力层的 path 只认登记过的'),
  ('window_set_tray_mode', '{ keep_running: boolean }', 'Ok', '关窗口后 Core 是否留在托盘'),
  ('deep_link（Rust → WebView 事件）', "{ action: 'import' | 'open'; url: string }", '—', '系统把 tibi:// 链接交给应用时发出（应用没开时先拉起）。import：WebView 调 documents.checkUrl，弹确认卡，确认后才调 documents.import（origin = deeplink）；open：原样交给 WebView 按深链白名单跳转，不认识的丢弃'),
]

# 能力层：一份定义 → pi 工具（技能）/ MCP 工具（外部 AI）/ 界面直接调用。
# (分组, [(能力, 参数, 返回, 权限, 备注)])；权限：read / write（可设自动，可撤销）/ confirm（需确认）
CAPS = [
  ('上下文', [
    ('get_context', '{}', "{ page: 'home' | 'library' | 'reader' | 'words' | 'review' | 'stats' | 'settings' | 'chat'; document?: { id: Id; title: string; section_id?: Id; sentence_id?: Id; progress: number }; selection?: { text: string; sentence_id: Id }; card?: { card_id: Id; term: string }; profile: { interests: string[] }; today: { minutes: number; due: number; reviewed: number; new_words: number; streak: number }; recent_documents: { id: Id; title: string }[]; permission: 'ask' | 'default' | 'auto' }", 'read', '界面上下文 + 学习快照；技能的系统提示词片段和 MCP 外部工具都从这里拿'),
  ]),
  ('词典', [
    ('lookup_word', '{ word: string; lemmatize?: boolean }', '{ entry?: DictEntry; lemma: string; status?: Status; term_id?: Id; examples: { en: string; zh?: string }[] }', 'read', 'ECDICT 本地查询 + 词形还原 + 本地状态；查不到时 entry 为空，由技能决定是否让模型解释'),
    ('compare_words', '{ words: string[] }', "{ entries: DictEntry[]; collocations: Record<string, string[]>; corpus_examples: { word: string; sentence: string; document_id?: Id }[] }", 'read', '近义词对比只取材料，解释由模型写'),
  ]),
  ('文章', [
    ('list_documents', "{ kind?: Kind; genre?: Genre; tags?: string[]; status?: 'unread' | 'reading' | 'done'; q?: string; sort?: 'fit' | 'opened' | 'added'; limit?: number }", 'DocumentSummary[]', 'read', ''),
    ('get_document', "{ id: Id; section_id?: Id; paragraphs?: [number, number]; with?: ('tokens' | 'ai' | 'translations')[] }", '{ document: DocumentSummary; section: { id: Id; title: string; paragraphs: { idx: number; text: string; sentence_ids: Id[] }[]; tokens?: Token[][]; ai?: Record<string, AiResult> }; sections: { id: Id; idx: number; title: string }[] }', 'read', '按章节 / 段落范围取正文，避免整本书进上下文'),
    ('search_documents', '{ q: string; document_id?: Id; limit?: number }', '{ document_id: Id; title: string; sentence_id: Id; snippet: string; score: number }[]', 'read', 'FTS5 全文检索'),
    ('tag_document', '{ id: Id; tags?: string[]; genre?: Genre; replace?: boolean }', '{ document: DocumentSummary; undo: Undo }', 'write', "导入技能写建议标签时 source = 'tibi'"),
  ]),
  ('导入流水线', [
    ('fetch_url', '{ url: string }', "{ url: string; site: string; title: string; author?: string; published_at?: Ts; lang: string; text: string; html?: string; images: string[] }", 'read', '只抓用户给的网址（含用户确认过的深链）或白名单来源；Core 校验 URL：只收 http(s)，解析后拒绝回环、内网、链路本地地址，重定向每跳重查；正文抽取用可读性算法；结果视为不可信数据，不当指令'),
    ('extract_pdf', '{ path: string; pages?: [number, number] }', '{ pages: number; text: string; needs_ocr: boolean; toc?: { title: string; page: number }[]; images: string[] }', 'read', 'path 按 §1 校验'),
    ('extract_epub', '{ path: string }', '{ title?: string; author?: string; text: string; toc: { title: string; href: string }[]; cover_path?: string; images: string[] }', 'read', 'path 按 §1 校验；书的章节由 segment_document 切分'),
    ('extract_docx', '{ path: string }', '{ title?: string; text: string; images: string[] }', 'read', 'path 按 §1 校验'),
    ('ocr_image', '{ paths: string[] }', '{ text: string; confidence: number; lang: string }', 'read', '本地或视觉模型，按设置；path 按 §1 校验'),
    ('segment_document', "{ text: string; kind?: Kind; toc?: { title: string; page?: number }[] }", "{ kind: Kind; lang: string; word_count: number; sections: { idx: number; title: string; paragraphs: { idx: number; text: string; block_type: 'prose' | 'heading' | 'list_item' | 'quote' | 'code'; lang?: string }[] }[] }", 'read', '规则切分章节 / 段落 / 句子，识别代码块；不调模型'),
    ('annotate_terms', '{ sentences: string[] }', '{ sentences: { text: string; tokens: Token[] }[]; phrases: { text: string; sentence_idx: number[] }[]; counts: { total: number; new: number; learning: number }; level?: string }', 'read', '分词、词形还原、按词库标状态（只有用户标过的词带状态，不建行）、识别已有短语'),
    ('estimate_difficulty', '{ text?: string; document_id?: Id }', "{ level?: string; rare_ratio?: number; minutes: number; learning_terms: string[] }", 'read', '文本级别只按词频估（常用 3000 词以外的占比 → A2–C2），与用户无关；learning_terms 是文中出现的生词本里的词'),
    ('save_document', "{ kind: Kind; genre: Genre; title: string; author?: string; source: string; lang: string; sections: { title: string; paragraphs: { text: string; block_type: string }[] }[]; tags?: string[]; cover_path?: string; original_path?: string }", '{ document_id: Id; section_ids: Id[]; undo: Undo }', 'confirm', '保存到书架需确认（默认权限模式下）；审批卡展示标题、类型、字数'),
    ('save_ai_result', "{ scope: 'document' | 'section' | 'sentence' | 'term_context'; target_id: Id; task: AiTask; output: unknown; prompt_version: string }", '{ id: Id }', 'write', '模型产出的结构化结果入 ai_results 缓存，自动、可覆盖（同一键只留一条，01 §9）；导入流水线的固定步骤不受不可信内容规则影响，因为它只写缓存'),
    ('import_document', "{ source: { type: 'text'; text: string } | { type: 'url'; url: string } | { type: 'file'; path: string }; hints?: { kind?: Kind; genre?: Genre; tags?: string[] } }", "{ import_id: Id } | { document_id: Id; title: string; status: 'imported' } | { import_id: Id; status: 'still_running'; note: string }", 'confirm', '复合能力：主对话与 MCP 用，走导入流水线。技能里调用时等导入做完（最多 3 分钟）再返回'),
  ]),
  ('找文章', [
    ('search_feeds', "{ interests?: string[]; genres?: Genre[]; since?: Ts; limit?: number }", "{ url: string; title: string; site: string; published_at?: Ts; excerpt: string; est_minutes: number; est_level?: string }[]", 'read', '从用户配置的文章来源与内置推荐源拉取候选；文本级别用摘要按词频粗估。M5：内置 Hacker News Best、News in Levels、The Conversation，设置里可关掉或加自己的 RSS / Atom；一小时内用缓存；书架里已有的不再推荐'),
    ('web_search', '{ q: string; limit?: number }', '{ url: string; title: string; snippet: string }[]', 'read', '用设置里选的服务：DeepSeek Search（默认，和模型共用 Key）或 Tavily（自己填 Key），也可关闭；用不了时返回 conflict，技能改用文章来源'),
  ]),
  ('词汇', [
    ('get_term', '{ text: string } | { id: Id }', 'TermDetail', 'read', ''),
    ('list_terms', "{ view?: 'due' | 'late' | 'new' | 'leech' | 'stuck' | 'stale'; status?: Status[]; document_id?: Id; tags?: string[]; limit?: number }", '{ items: Term[]; counts: Record<string, number> }', 'read', '与 terms.list 同一实现，默认 limit 50'),
    ('get_term_contexts', '{ term_id: Id; limit?: number; prefer_i1?: boolean }', "{ source: 'article' | 'dictionary' | 'manual'; sentence_id?: Id; document_id?: Id; document_title?: string; sentence: string; surface?: string; unknown_others: number; meaning_in_context?: string }[]", 'read', 'prefer_i1 时只剩一个生词的句子排前面'),
    ('mark_term', '{ term: string; status: Status; sentence_id?: Id }', '{ term_id: Id; previous: Status; undo: Undo }', 'write', '默认权限模式下自动执行；阅读器按钮直接调它，不经模型'),
    ('add_to_wordbook', '{ words: { text: string; meaning?: string; sentence_id?: Id }[] }', '{ created: Id[]; existed: Id[]; undo: Undo }', 'write', '查词典补音标释义，建卡片'),
    ('add_phrase', '{ text: string; sentence_id: Id; surface: string; meaning?: string }', '{ term_id: Id; undo: Undo }', 'write', ''),
    ('set_context_meaning', '{ term_id: Id; sentence_id: Id; meaning: string; source: SkillId }', '{ ok: true }', 'write', '讲解技能把语境释义写回 term_contexts，下次点词直接用'),
  ]),
  ('复习', [
    ('get_review_stats', '{ range?: 7 | 30 | 90 }', '{ due: number; overdue: number; new_available: number; today_reviews: number; retention: number; streak: number; forecast: number[]; leeches: number }', 'read', ''),
    ('create_quiz', '{ term_ids?: Id[]; count?: number; types?: CardType[]; document_id?: Id }', '{ items: { term_id: Id; term: string; card_type: CardType; prompt: string; answer: string[]; options?: { text: string; from?: string }[]; context?: { sentence_id: Id; sentence: string } }[] }', 'read', '临时练习，不影响 FSRS 排期；对话里做的"考我"、完成页"再练错词"用它'),
    ('pick_distractors', "{ term_id: Id; card_type: 'choice'; count?: number }", '{ options: { text: string; from: string }[] }', 'read', '选义题干扰项（G2）：同词性同难度、中文不重叠；优先同一篇文章里的生词、易混词、生词本里的词'),
    ('grade_answer', '{ term_id: Id; card_type: CardType | PracticeMode; expected: string[]; answer: string; hints?: number; duration_ms?: number }', "{ correct: boolean; near_miss: boolean; distance?: number; rating: Rating; reason: string; uses_target: boolean; issues: ('missing_target' | 'wrong_form' | 'too_short')[] }", 'read', '规则判定 + 系统评分（G1 的阈值：选义 9 秒、填空 / 听写 15 秒、拼写 20 秒算慢，拼写 6 秒内算快）；评语与修改建议由技能用模型写'),
    ('record_review', '{ card_id: Id; card_type: CardType; rating: Rating; suggested_rating?: Rating; auto: boolean; hints?: number; context_id?: Id; typed?: string; duration_ms?: number; session_id?: Id }', 'AnswerResult', 'write', '只记首次作答（G3）；复习页经 review.answer 调它；对话里完成的练习由教练技能记录'),
  ]),
  ('统计', [
    ('get_learning_stats', '{ range: 30 | 90 | 180 }', "stats.summary 的返回", 'read', ''),
    ('get_stats_series', "{ metrics: ('mastered' | 'minutes' | 'words' | 'reviews')[]; days: number }", 'stats.series 的返回', 'read', '洞察技能用'),
  ]),
  ('记忆', [
    ('search_memory', "{ q?: string; type?: Memory['type']; limit?: number }", 'Memory[]', 'read', 'FTS5 关键词 + 时间衰减（A4）；每条带来源'),
    ('list_learning_events', "{ since?: Ts; types?: LearningEventType[]; limit?: number }", '{ type: LearningEventType; at: Ts; ref: { table: string; id: Id | string }; summary: string }[]', 'read', '整理记忆技能读一段时间的事件；对话内容经 pi-durable 另读'),
    ('remember', "{ type: Memory['type']; content: string; subject?: string; confidence?: number; source_ref?: string }", '{ memory_id: Id; superseded?: Id; undo: Undo }', 'confirm', '需确认；用户手动运行整理记忆时的内部合并（consolidation）不弹卡，但写审计'),
    ('forget', '{ id: Id }', '{ undo: Undo }', 'confirm', ''),
  ]),
  ('音频', [
    ('speak', "{ text: string; voice?: string; rate?: number }", '{ engine: string; file_path?: string; duration_ms?: number; cached: boolean }', 'read', '配置的引擎合成并缓存到 media/audio（字段同 audio_cache）；系统语音由 WebView 直接播放，没有 file_path'),
  ]),
  ('配置与数据管理', [
    ('get_config', '{}', "{ items: { key: string; label: string; value: unknown; asks_every_time: boolean }[]; not_here: string }", 'read', '只列白名单里的设置；不对 MCP 开放'),
    ('set_config', '{ key: ConfigKey; value: unknown }', '{ key: string; value: unknown; prev: unknown; undo: Undo }', 'write', '`ConfigKey` 是白名单。称呼、兴趣、每日目标、每日新词、语速、提醒按 write；复习记得率、花费上限、搜索服务、暂停记忆按 always。没有通用 settings.set，也没有 SQL。不对 MCP 开放'),
    ('configure_skill', "{ id: SkillId; patch: { model_tier?: Tier; extra_instructions?: string; enabled?: boolean } }", '{ skill: Skill; undo: Undo }', 'always', '附加指令会进系统提示，所以每次都问；不能放宽写入权限，不能关主对话。不对 MCP 开放'),
    ('open_settings', "{ section: 'general' | 'model' | 'learning' | 'memory' | 'advanced' | 'data' | 'about'; reason: string }", '{ shown: true }', 'read', '显示一张跳转卡（link），按钮是 `tibi://settings?sec=…`。API Key、服务商和地址、权限模式、MCP、登录同步、恢复备份、清空记忆只能这样处理。不对 MCP 开放'),
    ('show_link', "{ text: string; links: { label: string; href: string }[] }", '{ shown: true }', 'read', '在对话里放一张跳转卡（link），按钮是应用内深链（`tibi://read/<id>`、`library`、`words`、`review`、`dict?q=`、`stats`、`settings?sec=`）；不认识的链接、书架里没有的文章报错。不对 MCP 开放'),
    ('create_backup', '{}', '{ path: string; size: number; created_at: Ts }', 'confirm', '不对 MCP 开放'),
    ('update_document', "{ id: Id; patch: { title?: string; genre?: Genre; tags?: string[]; is_favorite?: boolean; is_archived?: boolean } }", '{ id: Id; title: string; undo: Undo }', 'write', '不对 MCP 开放'),
    ('delete_documents', '{ ids: Id[] }', '{ deleted: number; undo: Undo }', 'always', '软删，最多 50 篇，一次撤销；审批卡写标题。不对 MCP 开放'),
    ('update_memory', '{ id: Id; content: string }', '{ memory: Memory; undo: Undo }', 'confirm', '不对 MCP 开放'),
    ('remove_terms', '{ ids: Id[] }', '{ removed: number; undo: Undo }', 'confirm', '移出生词本，不对 MCP 开放'),
    ('list_feeds', '{}', '{ url: string; title: string; enabled: boolean }[]', 'read', '不对 MCP 开放'),
    ('manage_feed', '{ add?: { url: string; title?: string }; remove?: string; toggle?: { url: string; enabled: boolean } }', 'Ok', 'confirm', '不对 MCP 开放'),
  ]),
  ('调度', [
    ('ask_user', "{ question: string; options: { label: string; description?: string; url?: string }[]; multi?: boolean }", '{ answer: string }', 'read', '反问：显示成卡片，原地等用户回答（`chat.answer` 或直接说话），返回用户选了什么（带链接）、说了什么。`url` 必须出现在这一轮的工具结果或输入里；用户选中的网址这一轮 `import_document` 不再审批。子技能的反问显示在主对话里。不对 MCP 开放'),
    ('run_skill', '{ skill_id: SkillId; input: string; context?: unknown }', '{ result: string }', 'write', '主对话专用：子技能在同一轮里跑，共用停止、审批和不可信标记，说完返回结果。会调模型，所以不算读；子技能的写操作各自过审批；嵌套深度上限 1，子技能不能再调它'),
    ('tool_search', '{ q: string }', '{ name: string; description: string }[]', 'read', '命中的工具加载进当前对话'),
  ]),
]

# MCP Server：工具 = 能力层（除 run_skill / tool_search），名称、参数、返回一致；默认只开读能力白名单。
MCP_RESULT = r"""
// 读工具：直接返回能力的返回值（JSON）。外部工具开场先调 get_context，拿当前页面与学习快照。
// 写 / 需确认工具：按当前权限模式。自动执行时同上；需要用户点头时，这次调用等用户在 Tibi 里确认（最多 5 分钟）：
//   允许 → 返回能力的返回值；拒绝或超时 → 错误 permission_denied（"用户没有在 Tibi 里确认"）
"""
MCP_EXTRA = []
MCP_RESOURCES = [
  ('tibi://document/{id}', 'text/markdown', '文章正文（含章节标题），只读'),
  ('tibi://term/{text}', 'application/json', 'TermDetail'),
  ('tibi://profile', 'application/json', '学习者画像（Profile 去掉 assistant_prefs）'),
]

PERM = {'read': ('读', 'r'), 'write': ('写 · 可设自动', 'a'), 'confirm': ('需确认', 'w'), 'always': ('每次都问', 'w')}

def esc(s): return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
def cell(s): return s.replace('|', '\\|')   # Markdown 表格里的联合类型

def md():
    out = ['# 06 接口定义：WebView ↔ Tibi Core', '',
           '> 由 `_src/build_interface.py` 生成，改接口请改脚本再运行；总览页 `overview.html` 第 04 节能力清单与第 08 节接口同步生成。方法命名为 M0 前的草案，与 `TibiKernel` 一起定稿（2026-10-30）。', '',
           '## 1. 约定', '',
           '- 传输：JSON-RPC 2.0。WebView 经 Tauri `invoke("core_call", { method, params })` 发请求，Rust 转发到 Core 的 stdio；Core 的事件经 Rust 转成 Tauri 事件 `core_event`，载荷 `{ event, data }`。',
           '- 没有"任务"（T35）：对话里一轮回答的 `submission_id` 就是 `turn_id`，结束走 `chat.end`；导入返回 `{ import_id }`，进度走 `import.progress`，结果走 `import.done`；总结、翻译、重新分析在后台做，结果看文章状态和 `data.changed`。',
           '- 所有写操作返回 `Undo`（或在结果里带 `undo`），统一用 `system.undo` 撤销；同时写入 `skill_audit`。例外：`terms.lookup` 的自动 0 → 1 不返回 `Undo`、不写 `skill_audit`，只记 `term_status_log`。',
           '- 分页用 `cursor`（不透明字符串）+ `limit`，返回 `Page<T>`。',
           '- 时间一律毫秒时间戳；所有 ID 都是 UUIDv7 字符串（R11），对话也是我们自己的表（R9）。',
           '- 错误：JSON-RPC `error.code` 用标准值，`error.data.code` 为业务码（见下方 `ErrorCode`），`error.message` 可直接显示给用户。',
           '- 这些方法都是能力层的薄封装：技能、MCP 工具调用的是同一批能力，所以参数与返回的形状与本文 §5 的能力定义一致。',
           '- 文件路径：`path` 只接受 `pick_file` 所选或拖入后由 Rust 登记的路径，否则返回 `permission_denied`；MCP 调用方不能传本地路径。',
           '- 网址：由 Core 校验（只收 http(s)，拒绝回环、内网、链路本地地址，重定向每跳重查），否则返回 `invalid_source`。',
           '- 深链：`tibi://import?url=…` 算外部触发，先按上一条校验，弹出确认卡，用户确认后才抓取；抓取失败（如需要登录）走失败态，提示粘贴正文。其余 `tibi://` 只做应用内跳转（`read/<id>`、`library`、`words`、`review`、`dict?q=`、`stats`、`settings?sec=`、`chat/<id>`），由 `@tibi/core/deeplink` 按白名单解析，不认识的丢弃；对话卡片上的按钮（导入卡、跳转卡）和系统打开的链接走同一份解析，界面按平台换成路由。', '',
           '失败路径：', '',
           '- 花费：Tibi 不算钱、不设预算（T36），花了多少在服务商后台看；每轮回答最多调用几次模型（`agent.max_turns`）。',
           '- 模型不可用：确定性步骤照常完成，`ai_status = deferred`，界面显示"稍后补做"，之后经 `documents.reanalyze` 补。',
           '- 应用中途退出：没答完的那一轮记成中断，由用户点重试（不续跑，没有检查点）；做了一半的总结改回"稍后补做"。', '',
           '## 2. 共享类型', '', '```ts' + TYPES + '```', '', '## 3. 方法', '']
    for g, title, ms in API:
        out.append(f'### {g} · {title}'); out.append('')
        out.append('| 方法 | 参数 | 返回 | 说明 |'); out.append('|---|---|---|---|')
        for m, p, r, n in ms:
            out.append(f'| `{m}` | `{cell(p)}` | `{cell(r)}` | {n} |')
        out.append('')
    out += ['## 4. Core → WebView 事件', '', '| 事件 | 载荷 | 谁在听 |', '|---|---|---|']
    for e, p, n in EVENTS: out.append(f'| `{e}` | `{cell(p)}` | {n} |')
    out += ['', '## 5. 能力层（技能工具 / MCP 工具 / 界面直接调用）', '',
            '一份定义（名称、说明、TypeBox 参数、结构化返回、权限、是否可撤销、replay）生成三种出口。下面用 TypeScript 写法给出参数与返回；实现时参数即 TypeBox schema，pi-ai 自动校验。权限：**读** 不动数据；**写** 可设自动（默认模式下自动执行，可撤销）；**需确认** 弹审批卡（全部自动模式除外）。一轮回答读过不可信内容（抓取的网页、导入正文、搜索结果）后，它的写入和外联（`fetch_url`、`web_search`）一律弹审批卡，全部自动和"以后都自动"也不放行。', '',
            '- 能力是确定性的（查库、规则、本地算法），不在能力里调语言模型；需要模型判断的（评语、对比解释、推荐理由）由技能完成。',
            '- 每项技能只拿自己那组能力（SKILL.md 的 `allowed-tools`）；主对话默认带常用能力，其余 deferred，用 `tool_search` 加载。',
            '- 所有写能力写 `skill_audit`（技能、参数、undo_payload、幂等键），返回 `Undo`；界面直接调用时技能为空。', '']
    for g, caps in CAPS:
        out.append(f'### {g}'); out.append('')
        out.append('| 能力 | 参数 | 返回 | 权限 | 说明 |'); out.append('|---|---|---|---|---|')
        for c, p, r, perm, n in caps:
            out.append(f'| `{c}` | `{cell(p)}` | `{cell(r)}` | {PERM[perm][0]} | {n} |')
        out.append('')
    out += ['## 6. MCP Server', '',
            '- 外部工具以 stdio 启动 `tibi mcp`。它只是代理：经本地 socket 加令牌连运行中的 Core，自己不开数据库。Core 持单实例锁，保证 `app.db` 只有一个写入者。',
            '- 设置里开关 + 可复制的接入配置。外部工具的写调用要确认时，审批卡注明来源（如 Codex），显示在桌面窗口右下角。',
            '- **实现**（M5，2026-10-31）：代理是 sidecar 本身（`tibi-core --mcp --data-dir <app 数据目录>`）；Core 启动时在数据目录开本地 socket（Windows 是命名管道），令牌放在同目录的 `mcp.token`（权限 0600，T24：原定存钥匙串，改成只有本用户可读的文件，代理才能自己读到）。开关、写工具白名单存 settings（`mcp.enabled`、`mcp.write_tools`），由 Core 的 `mcp.config` / `mcp.configure` / `mcp.tools` / `mcp.call` 判断；写调用要确认时原地等用户点（最多 5 分钟，超时算没确认）。',
            '- 默认只开读能力白名单；写能力由用户逐项开启，开启后仍按权限模式审批。',
            '- 工具 = 能力层（名称、参数、返回与 §5 一致），不暴露 `run_skill`、`tool_search`、`ask_user`。', '']
    for c, p, r, n in MCP_EXTRA: out.append(f'| `{c}` | `{cell(p)}` | `{cell(r)}` | {n} |')
    out += ['', '写工具的返回约定：', '', '```ts' + MCP_RESULT + '```', '',
            '资源（建议，M5 再定）：', '', '| URI | 类型 | 内容 |', '|---|---|---|']
    for u, t, n in MCP_RESOURCES: out.append(f'| `{u}` | `{t}` | {n} |')
    out += ['', '## 7. Tauri（Rust）命令', '', '只做系统能力，不碰业务数据。WebView 只能调这些命令里标给它的；严格 CSP，见 05 §8。', '', '| 命令 | 参数 | 返回 | 说明 |', '|---|---|---|---|']
    for c, p, r, n in RUST: out.append(f'| `{c}` | `{cell(p)}` | `{cell(r)}` | {n} |')
    out += ['',
            '## 8. 待定', '',
            '- `chat.send` 的 `context` 是否改为由 WebView 定期上报（`ui.context`），减少每次传输。',
            '- `sections.get` 对长章节是否分页（按段落）。',
            '- MCP 资源（tibi:// URI）是否真的需要，还是只用工具。',
            '- 事件是否改为 WebSocket（Core 本地端口）以绕开 Rust 转发；M0 先用 stdio。', '']
    return '\n'.join(out)

def html():
    parts = []
    parts.append('<h3>约定</h3><ul><li>JSON-RPC 2.0：WebView 经 Tauri <code>invoke("core_call")</code> 发请求，Rust 转发到 Core 的 stdio；事件经 Rust 转成 Tauri 事件 <code>core_event</code>。</li><li>没有任务：一轮回答的 <code>submission_id</code> 就是 <code>turn_id</code>，结束走 <code>chat.end</code>；导入返回 <code>{ import_id }</code>，进度走 <code>import.progress</code>，结果走 <code>import.done</code>。</li><li>写操作返回 <code>Undo</code>，统一用 <code>system.undo</code> 撤销，同时写入 skill_audit。</li><li>分页 <code>cursor + limit → Page&lt;T&gt;</code>；时间为毫秒时间戳；错误用标准 JSON-RPC 码 + <code>error.data.code</code> 业务码。</li><li><code>path</code> 只接受 <code>pick_file</code> 或拖入后登记的路径；网址由 Core 校验，禁内网地址；深链 <code>tibi://import?url=…</code> 校验后弹确认卡，确认后才抓取。</li><li><code>terms.lookup</code> 是写操作：带句子时把生词自动设为见过并建卡，不返回 <code>Undo</code>。</li><li>失败路径：调用前预留预算；模型不可用时 <code>ai_status = deferred</code>（稍后补做）；写能力带幂等键。</li></ul>')
    parts.append('<details class="tbl api"><summary><code>共享类型</code><span class="d">TypeScript 声明：实体、枚举、错误码</span></summary><pre style="margin:0 16px 14px">' + esc(TYPES.strip()) + '</pre></details>')
    parts.append('<h3>方法（按分组展开）</h3><div class="apis">')
    for g, title, ms in API:
        rows = ''.join(f'<tr><td><code>{esc(m)}</code></td><td><code class="sig">{esc(p)}</code></td><td><code class="sig">{esc(r)}</code></td><td>{esc(n)}</td></tr>' for m, p, r, n in ms)
        parts.append(f'<details class="tbl api"><summary><code>{g}.*</code><span class="d">{title} · {len(ms)} 个方法</span></summary><div class="tblwrap inner"><table><tr><th>方法</th><th>参数</th><th>返回</th><th>说明</th></tr>{rows}</table></div></details>')
    parts.append('</div><h3>Core → WebView 事件</h3><div class="tblwrap"><table><tr><th>事件</th><th>载荷</th><th>谁在听</th></tr>')
    for e, p, n in EVENTS: parts.append(f'<tr><td><code>{esc(e)}</code></td><td><code class="sig">{esc(p)}</code></td><td>{esc(n)}</td></tr>')
    parts.append('</table></div><h3>Tauri（Rust）命令</h3><div class="tblwrap"><table><tr><th>命令</th><th>参数</th><th>返回</th><th>说明</th></tr>')
    for c, p, r, n in RUST: parts.append(f'<tr><td><code>{esc(c)}</code></td><td><code class="sig">{esc(p)}</code></td><td><code class="sig">{esc(r)}</code></td><td>{esc(n)}</td></tr>')
    parts.append('</table></div>')
    return '\n'.join(parts)

def caps_html():
    parts = ['<div class="apis">']
    for g, caps in CAPS:
        rows = ''.join(f'<tr><td><code>{esc(c)}</code></td><td><code class="sig">{esc(p)}</code></td><td><code class="sig">{esc(r)}</code></td><td><span class="tag {PERM[perm][1]}">{PERM[perm][0]}</span></td><td>{esc(n)}</td></tr>' for c, p, r, perm, n in caps)
        names = ' '.join(f'<code>{esc(c)}</code>' for c, *_ in caps)
        parts.append(f'<details class="tbl api"><summary><span class="g">{g}</span><span class="d">{names}</span></summary><div class="tblwrap inner"><table><tr><th>能力</th><th>参数</th><th>返回</th><th>权限</th><th>说明</th></tr>{rows}</table></div></details>')
    parts.append('</div>')
    return '\n'.join(parts)

def mcp_html():
    parts = ['<div class="grid2"><div class="card"><div class="kv"><code>传输</code><span>stdio 启动 <code>tibi mcp</code>；它只是代理，经本地 socket 加令牌连运行中的 Core（单实例锁）；设置里开关 + 可复制的接入配置</span><code>工具</code><span>= 能力层（名称、参数、返回与第 04 节一致），不暴露 <code>run_skill</code> / <code>tool_search</code>；默认只开读能力白名单，写能力逐项开启，走同一套审批，记录在运行记录，trigger = mcp</span><code>安全</code><span>不暴露任意代码执行；抓取内容视为数据不当指令</span></div></div>',
             '<div class="card"><pre style="margin:0">{ "mcpServers": { "tibi": {\n    "command": "tibi", "args": ["mcp"] } } }\n<span class="c">// Codex / Claude Code 里：查词、出题、导入文章</span></pre></div></div>',
             '<div class="tblwrap"><table><tr><th>MCP 专有</th><th>参数</th><th>返回</th><th>说明</th></tr>']
    for c, p, r, n in MCP_EXTRA: parts.append(f'<tr><td><code>{esc(c)}</code></td><td><code class="sig">{esc(p)}</code></td><td><code class="sig">{esc(r)}</code></td><td>{esc(n)}</td></tr>')
    parts.append('</table></div><details class="tbl api"><summary><code>写工具的返回约定</code><span class="d">要确认时原地等用户点（最多 5 分钟）</span></summary><pre style="margin:0 16px 14px">' + esc(MCP_RESULT.strip()) + '</pre></details>')
    parts.append('<div class="tblwrap"><table><tr><th>资源（建议）</th><th>类型</th><th>内容</th></tr>')
    for u, t, n in MCP_RESOURCES: parts.append(f'<tr><td><code>{esc(u)}</code></td><td><code>{esc(t)}</code></td><td>{esc(n)}</td></tr>')
    parts.append('</table></div>')
    return '\n'.join(parts)

here = pathlib.Path(__file__).resolve().parent.parent
(here / '06-interface.md').write_text(md(), encoding='utf-8')
ov = here / 'overview.html'; s = ov.read_text(encoding='utf-8')
def fill(s, tag, body):
    start = s.index(f'<!-- {tag}:begin -->'); end = s.index(f'<!-- {tag}:end -->')
    return s[:start] + f'<!-- {tag}:begin -->\n' + body + '\n' + s[end:]
s = fill(s, 'api', html()); s = fill(s, 'caps', caps_html()); s = fill(s, 'mcp', mcp_html())
ov.write_text(s, encoding='utf-8')
print('built 06-interface.md and overview.html §04/§08')
