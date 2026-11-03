/**
 * 共享类型：与 docs/design/06-interface.md §2 一致（由 _src/build_interface.py 维护文档；改这里时同步改脚本）。
 */

export type Id = string;
export type Ts = number;
export type ConvId = string;
/** 一轮回答：值是这一轮第一句用户消息的 id */
export type TurnId = string;
export type SkillId = 'tibi' | 'importer' | 'scout' | 'tutor' | 'coach' | 'insight' | 'archivist';
export type Tier = 'fast' | 'deep';
/** 0 生词 … 5 掌握、97 标为已知、98 忽略。只有用户标过 / 查过的词才有状态 */
export type Status = 0 | 1 | 2 | 3 | 4 | 5 | 97 | 98;
export type Kind = 'article' | 'book';
export type Genre = 'tech' | 'news' | 'lit' | 'academic' | 'general';
export type CardType = 'recognize' | 'choice' | 'cloze';
export type PracticeMode = 'dictation' | 'spell' | 'confusable' | 'produce';
export type Rating = 1 | 2 | 3 | 4;
export type Page<T> = { items: T[]; total: number; cursor?: string };
export type Undo = { undo_id: Id; expires_at: Ts };
export type Ok = { ok: true };
export type AiStatus = 'none' | 'deferred' | 'running' | 'done' | 'failed';
export type AiTask = 'summary' | 'phrases' | 'hard_sentences' | 'advice' | 'glossary' | 'characters' | 'recap' | 'background' | 'translate' | 'explain' | 'grade_sentence' | 'context_meanings';
export type LearningEventType = 'document_imported' | 'section_finished' | 'term_marked' | 'review_session' | 'quiz_done';
export type BlockType = 'prose' | 'heading' | 'list_item' | 'quote';

// 文档
export interface DocumentSummary {
  id: Id; kind: Kind; genre: Genre; title: string; author?: string;
  /** 网址的域名、原文件名或来源类型 */ source: string; source_type: string; /** 来自网址时的原文地址 */ source_url?: string; tags: string[];
  minutes: number; /** 按词频估的文本级别 A2–C2（与用户无关）；没有词频表时没有 */ level?: string; progress: number;
  book?: { chapter: number; chapters: number; chapter_progress: number };
  status: 'processing' | 'ready' | 'failed'; ai_status: AiStatus;
  excerpt: string; cover_path?: string; added_at: Ts; opened_at?: Ts; finished_at?: Ts;
}
export interface Document extends DocumentSummary {
  sections: { id: Id; idx: number; title: string; status: string; progress: number; word_count: number }[];
  ai?: { summary?: AiResult; advice?: AiResult; phrases?: AiResult; hard_sentences?: AiResult; glossary?: AiResult; characters?: AiResult };
}
export interface Token { t: string; l: string; s: number; e: number; status?: Status; phrase_id?: Id; gloss?: string }
export interface Sentence { id: Id; idx: number; paragraph_idx: number; block_type: BlockType; text: string; tokens: Token[]; translation?: string }
export type SectionBlock = { type: 'code'; lang?: string; code: string } | { type: 'sentences'; ids: Id[]; block_type: BlockType; paragraph_idx: number };
export interface SectionContent {
  id: Id; document_id: Id; title: string; blocks: SectionBlock[];
  sentences: Sentence[]; phrases: { id: Id; text: string; sentence_ids: Id[] }[];
  counts: { new: number; learning: number }; ai?: Record<string, AiResult>;
}
/** documents.samples 的一项：内置示例，导入过的带 document_id */
export interface SampleInfo { id: string; title: string; author?: string; genre: Genre; source: string; minutes: number; is_default: boolean; document_id?: Id }
export interface AiResult { task: string; output: unknown; model: string; prompt_version: string; created_at: Ts }

// 词汇
export interface Term {
  id: Id; kind: 'word' | 'phrase'; text: string; display: string; ipa?: string; meaning: string; short_gloss?: string; status: Status;
  forms: string[]; star?: number; exam: string[]; tags: string[]; encounter_count: number; doc_count: number;
  due?: Ts; retention?: number; lapses: number; added_at: Ts; last_seen_at?: Ts;
}
export interface TermContext {
  id: Id; source: 'article' | 'dictionary' | 'manual'; document_id?: Id; document_title?: string; sentence_id?: Id; sentence: string; surface?: string;
  meaning_in_context?: string; is_primary: boolean; unknown_others: number;
}
export interface TermDetail extends Term {
  en?: string; note?: string; contexts: TermContext[];
  card?: CardState; reviews: { rating: Rating; card_type: CardType; reviewed_at: Ts }[]; history: { status: Status; at: Ts; source: string }[];
}
export interface DictEntry {
  word: string; phonetic?: string; translation: string; definition?: string; pos?: string; collins?: number; oxford?: boolean;
  exam: string[]; frequency?: number; forms: string[];
  /** 带类型的词形（p 过去式、d 过去分词、i 现在分词、3 三单、r 比较级、t 最高级、s 复数）；词典页按类型显示 */
  inflections?: { type: 'p' | 'd' | 'i' | '3' | 'r' | 't' | 's'; form: string }[];
  /** 这个词头是别的词的变形时，原形是谁（went → go） */
  base?: string;
}
/** 词典页的补充内容（T32）：词光和 Open English WordNet，都可能没有 */
export interface DictExtras {
  /** 内容属于哪个词头；和查的词不同时（went → go）界面要说明 */
  word: string;
  atlas?: {
    cefr?: string; tip?: string;
    examples: { en: string; zh?: string }[]; collocations: { en: string; zh?: string }[];
    /** 词族，形如 `adaptation (n.)` */
    family: string[]; synonyms: string[]; antonyms: string[];
  };
  /** 英文义项，已去掉没有近义词也没有例句的；pos 是 n / v / a / r */
  senses: { pos: string; definition: string; synonyms: string[]; examples: string[] }[];
  antonyms: string[];
}
/** 词典联想的一行 */
export interface DictBrief { word: string; phonetic?: string; gloss: string }

// 复习
export interface CardState { card_id: Id; term_id: Id; state: 0 | 1 | 2 | 3; due: Ts; stability: number; difficulty: number; reps: number; lapses: number; suspended: boolean; forced_type?: CardType }
export interface QueueItem {
  step: number; card_id: Id; term: Term; card_type: CardType; is_new: boolean; last_review?: Ts;
  intro: boolean; retry: 0 | 1 | 2; self_rated: boolean;
  options?: { id: string; text: string; from?: string }[];
  context: { id: Id; sentence: string; answer: string[]; surface?: string; translation: string; document_title?: string; document_id?: Id; source: 'article' | 'dictionary' };
  hint?: string; note?: string;
  /** 本步的作答结果（续上会话时回显） */
  result?: { correct: boolean; rating?: Rating; answered_at: Ts };
}
export interface ReviewSession { session_id: Id; kind: 'review' | 'drill'; graded: boolean; steps: QueueItem[]; cursor: number; resumed: boolean; started_at: Ts; forecast: number[] }
export interface Answer { choice?: string; typed?: string; self_rating?: Rating }
export interface AnswerResult {
  step: number; correct: boolean; near_miss: boolean;
  rating?: Rating; reason?: string; auto: boolean;
  card?: CardState; status_change?: { from: Status; to: Status }; next?: { days: number; label: string };
  retry_step?: number; undo: Undo;
  /** 选义题的正确选项，答完后标出来 */
  correct_option?: string;
}
export interface IntervalPreview { 1: string; 2: string; 3: string; 4: string }
export interface PracticeItem { id: string; mode: PracticeMode; sentence: string; audio?: string; options?: [string, string]; answer?: string; explain?: string; source: { document_id?: Id; term_id?: Id } }
export interface PracticeResult { practice_id: Id; accuracy: number; duration_ms: number; best: { dictation_accuracy: number; rounds: number } }

// 对话与任务
export interface Conversation { id: ConvId; kind: 'chat' | 'day' | 'document' | 'skill'; day?: string; device: 'desktop' | 'mobile'; skill_id: SkillId; title: string; document_id?: Id; trigger: 'user' | 'auto' | 'event' | 'mcp'; created_at: Ts; updated_at: Ts }
/** 对话卡片（第一期）：数据来自能力结果，由界面用固定组件渲染；模型不碰样式 */
export type WidgetSpec =
  | { kind: 'word'; summary: string; data: { word: string; phonetic?: string; pos?: string; translation: string; example?: { en: string; zh?: string }; in_wordbook: boolean } }
  | { kind: 'compare'; summary: string; data: { words: { word: string; phonetic?: string; translation: string; example?: string }[] } }
  | { kind: 'quiz'; summary: string; data: { items: { term: string; type: 'choice' | 'cloze'; prompt: string; options?: string[]; answer: string[] }[] } }
  | { kind: 'ask'; summary: string; data: AskData }
  | { kind: 'settings_link'; summary: string; data: { section: string; label: string; reason: string } }
  /** 跳到应用里某处：按钮是 tibi:// 深链（deeplink.ts），界面按平台换成路由 */
  | { kind: 'link'; summary: string; data: { text: string; links: { label: string; href: string }[] } }
  /** 对话里起的导入：卡片跟着 import.progress / import.done 更新，结束后的样子存在 state（ImportCardState） */
  | { kind: 'import'; summary: string; data: { import_id: string; source: string } };
export type ImportCardState =
  | { status: 'running' }
  | { status: 'done'; document_id: string; title: string; duplicate?: boolean; minutes?: number; level?: string }
  | { status: 'failed'; error: string };
/**
 * 反问（ask_user）：工具原地等用户回答，回答就是工具结果，模型接着做。
 * url 是这一项对应的文章链接：用户选了它，这次导入不再审批。action 是旧版本的选项动作，只读显示
 */
export interface AskOption { id: string; label: string; description?: string; url?: string; action?: { tool: string; params: unknown; preview: string } }
export interface AskData { question: string; multi: boolean; options: AskOption[]; /** 任务读过不可信内容：卡片提示 */ untrusted: boolean }
export interface AskState { answered?: { option_ids: string[]; text?: string; at: Ts }; expired?: boolean }
/** summary 写进后续对话历史，界面渲染出错时也显示它；result 是用户在卡片上的操作结果，下一轮带给模型 */
export type WidgetBlock = WidgetSpec & { type: 'widget'; id: string; v: 1; state?: unknown; result?: string };
export type MessageBlock = { type: 'text'; text: string } | WidgetBlock;
/** 回答没说完就结束了：用户停止（cancel）或模型出错（error，message 可直接显示） */
export interface MessageInterrupted { reason: 'cancel' | 'error'; message?: string }
export interface Message { id: string; role: 'user' | 'assistant' | 'tool'; text?: string; /** 用户提问时界面附上的（正在读的文章、选中的句子、当前卡片）：界面显示成小标签 */ attachment?: string; blocks?: MessageBlock[]; tool?: { name: string; args: unknown; result?: unknown; duration_ms?: number }; /** 属于哪一轮回答 */ turn_id?: TurnId; interrupted?: MessageInterrupted; /** 这次回答做过的步骤（收起的过程卡） */ steps?: MessageStep[]; /** 模型的思考过程（开了思考的模型才有），过程卡里折叠显示 */ thinking?: string; /** 思考用了多久 */ think_ms?: number; /** 用到的技能名（主对话不写） */ skill?: string; /** Tibi 写了什么：回答下面显示一行，能撤销 */ receipts?: MessageReceipt[]; created_at: Ts }
export interface MessageReceipt { summary: string; undo?: Undo; undone?: boolean }
/**
 * 回答里的一步工具调用（过程卡的一行）：summary 是"做了什么 + 对象"；展开后看 detail（关键参数）、result（结果摘要）、
 * error（出错原因）、duration_ms。tool 是能力名，只在"技术详情"里给人看
 */
export interface MessageStep { tool: string; summary: string; status: 'ok' | 'error' | 'denied'; call_id?: string; detail?: string; result?: string; error?: string; duration_ms?: number }
/** 等用户确认的一次写入。只在内存里：应用重启后那一轮回答算中断 */
export interface Approval {
  id: Id; /** 哪段对话的哪一轮；外部工具（MCP）来的没有 */ conversation_id?: ConvId; turn_id?: TurnId; /** 外部工具的名字（MCP） */ client?: string; skill_id?: SkillId; tool: string; title: string; body: string; impact: string; undoable: boolean; untrusted: boolean;
  editable?: { field: string; value: string }; /** 每次都问：不显示"以后都允许" */ always_ask?: boolean; requested_at: Ts;
}

// 技能、记忆、配置
export interface Skill { id: SkillId; title: string; description: string; tools: string[]; model_tier: Tier; extra_instructions?: string; write_permission: 'inherit' | 'ask'; enabled: boolean }
export interface Memory { id: Id; type: 'profile' | 'semantic' | 'episodic' | 'procedural'; content: string; subject?: string; confidence: number; source: { type: 'user' | 'agent' | 'consolidation'; ref?: string; label: string }; status: 'active' | 'superseded'; created_at: Ts; updated_at: Ts }
export interface Provider { id: Id; kind: 'llm' | 'vision' | 'image' | 'tts'; name: string; protocol: string; base_url?: string; auth: 'api_key'; tier?: Tier; model: string; has_secret: boolean; is_default: boolean }
export interface Profile {
  display_name: string; interests: string[];
  daily_goal_minutes: number; daily_new_cards: number; desired_retention: number;
  assistant_prefs: { nickname: string; permission: 'ask' | 'default' | 'auto' };
}
export interface UsageSummary {
  schema: 1; app_version: string; days_since_first_use: number; reviews: number;
  documents: { samples: number; self_imported: number; finished: number };
  h2: { window_closed: boolean; self_imports_7d: number; passed?: boolean };
  h3: { has_card: boolean; reviewed_next_day?: boolean };
}
export interface SyncStatus { enabled: boolean; backend?: 'icloud' | 'webdav'; state: 'off' | 'idle' | 'syncing' | 'error'; last_synced_at?: Ts; pending: number; sync_files: boolean; device: { id: string; name: string }; peers: { id: string; name: string; platform: 'macos' | 'windows' | 'linux' | 'ios' | 'android'; last_seen_at: Ts }[]; error?: SyncError }
export type SyncError = 'offline' | 'auth' | 'icloud_signed_out' | 'quota' | 'newer_format' | 'unknown';
export type ErrorCode = 'not_found' | 'conflict' | 'permission_denied' | 'model_unavailable' | 'offline' | 'invalid_source' | 'busy' | 'invalid_params';

/** 业务错误：JSON-RPC 里 error.data.code = code，error.message 可直接显示 */
export class TibiError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly data?: unknown) {
    super(message);
    this.name = 'TibiError';
  }
}
