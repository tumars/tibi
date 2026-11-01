/**
 * 共享类型：与 docs/design/06-interface.md §2 一致（由 _src/build_interface.py 维护文档；改这里时同步改脚本）。
 */

export type Id = string;
export type Ts = number;
export type ConvId = string;
export type TaskId = string;
export type SkillId = 'tibi' | 'importer' | 'scout' | 'tutor' | 'coach' | 'insight' | 'archivist';
export type Tier = 'fast' | 'deep';
export type Status = 0 | 1 | 2 | 3 | 4 | 5 | 97 | 98 | 99;
export type Kind = 'article' | 'book';
export type Genre = 'tech' | 'news' | 'lit' | 'academic' | 'general';
export type CardType = 'recognize' | 'choice' | 'cloze';
export type PracticeMode = 'dictation' | 'spell' | 'confusable' | 'produce';
export type Rating = 1 | 2 | 3 | 4;
export type TaskState = 'run' | 'appr' | 'paused' | 'done' | 'err' | 'cancel';
export type Page<T> = { items: T[]; total: number; cursor?: string };
export type Undo = { undo_id: Id; expires_at: Ts };
export type Ok = { ok: true };
export type AiStatus = 'none' | 'deferred' | 'running' | 'done' | 'failed';
export type AiTask = 'summary' | 'phrases' | 'hard_sentences' | 'advice' | 'glossary' | 'characters' | 'recap' | 'background' | 'translate' | 'explain' | 'grade_sentence' | 'context_meanings';
export type LearningEventType = 'document_imported' | 'section_finished' | 'term_marked' | 'review_session' | 'vocab_test' | 'quiz_done';
export type BlockType = 'prose' | 'heading' | 'list_item' | 'quote';

// 文档
export interface DocumentSummary {
  id: Id; kind: Kind; genre: Genre; title: string; author?: string; source: string; tags: string[];
  minutes: number; unknown_ratio: number; difficulty: 'ok' | 'mid' | 'hard'; progress: number;
  book?: { chapter: number; chapters: number; chapter_progress: number };
  status: 'processing' | 'ready' | 'failed'; ai_status: AiStatus;
  excerpt: string; cover_path?: string; added_at: Ts; opened_at?: Ts; finished_at?: Ts;
}
export interface Document extends DocumentSummary {
  sections: { id: Id; idx: number; title: string; status: string; progress: number; word_count: number }[];
  ai?: { summary?: AiResult; advice?: AiResult; phrases?: AiResult; hard_sentences?: AiResult; glossary?: AiResult; characters?: AiResult };
}
export interface Token { t: string; l: string; s: number; e: number; status?: Status; phrase_id?: Id }
export interface Sentence { id: Id; idx: number; paragraph_idx: number; block_type: BlockType; text: string; tokens: Token[]; translation?: string }
export type SectionBlock = { type: 'code'; lang?: string; code: string } | { type: 'sentences'; ids: Id[]; block_type: BlockType; paragraph_idx: number };
export interface SectionContent {
  id: Id; document_id: Id; title: string; blocks: SectionBlock[];
  sentences: Sentence[]; phrases: { id: Id; text: string; sentence_ids: Id[] }[];
  counts: { new: number; learning: number; unsure: number }; ai?: Record<string, AiResult>;
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
export interface Message { id: string; role: 'user' | 'assistant' | 'tool'; text?: string; tool?: { name: string; args: unknown; result?: unknown; duration_ms?: number }; task_id?: TaskId; created_at: Ts }
export interface TaskSummary {
  id: TaskId; state: TaskState; skill_id: SkillId; title: string; document_title?: string; trigger: string; model: string;
  step: { index: number; total: number; label: string }; started_at: Ts; duration_ms: number; cost: number; error?: string;
}
export interface TaskStep { id: string; label: string; state: 'wait' | 'run' | 'ok' | 'err' | 'appr'; duration_ms?: number; skill_id?: SkillId; children?: TaskStep[] }
export interface Task extends TaskSummary { conversation_id: ConvId; steps: TaskStep[]; transcript: Message[]; usage: { tokens_in: number; tokens_out: number; cost: number }; approval?: Approval }
export interface Approval {
  task_id: TaskId; skill_id?: SkillId; tool: string; title: string; body: string; impact: string; undoable: boolean; untrusted: boolean;
  editable?: { field: string; value: string }; requested_at: Ts;
}

// 技能、记忆、配置
export interface Skill { id: SkillId; title: string; description: string; tools: string[]; model_tier: Tier; extra_instructions?: string; write_permission: 'inherit' | 'ask'; enabled: boolean; month_cost: number }
export interface Memory { id: Id; type: 'profile' | 'semantic' | 'episodic' | 'procedural'; content: string; subject?: string; confidence: number; source: { type: 'user' | 'agent' | 'consolidation'; ref?: string; label: string }; status: 'active' | 'superseded'; created_at: Ts; updated_at: Ts }
export interface Provider { id: Id; kind: 'llm' | 'vision' | 'image' | 'tts'; name: string; protocol: string; base_url?: string; auth: 'api_key'; tier?: Tier; model: string; has_secret: boolean; is_default: boolean; month_cost?: number }
export interface Profile {
  display_name: string; goal: string; level_self: string; interests: string[]; vocab_estimate: number; vocab_source: 'self' | 'test' | 'manual'; vocab_tested_at?: Ts;
  daily_goal_minutes: number; daily_new_cards: number; desired_retention: number;
  assistant_prefs: { nickname: string; language: 'mixed' | 'zh' | 'en'; permission: 'ask' | 'default' | 'auto' };
}
export interface UsageSummary {
  schema: 1; app_version: string; days_since_first_use: number; vocab_tested: boolean; reviews: number;
  documents: { samples: number; self_imported: number; finished: number };
  h1: { first_doc_finished: boolean; prelabeled_total: number; prelabeled_changed: number; ratio?: number };
  h2: { window_closed: boolean; self_imports_7d: number; passed?: boolean };
  h3: { has_card: boolean; reviewed_next_day?: boolean };
}
export interface SyncStatus { enabled: boolean; backend?: 'icloud' | 'webdav'; state: 'off' | 'idle' | 'syncing' | 'error'; last_synced_at?: Ts; pending: number; sync_files: boolean; device: { id: string; name: string }; peers: { id: string; name: string; platform: 'macos' | 'windows' | 'linux' | 'ios' | 'android'; last_seen_at: Ts }[]; error?: SyncError }
export type SyncError = 'offline' | 'auth' | 'icloud_signed_out' | 'quota' | 'newer_format' | 'unknown';
export type ErrorCode = 'not_found' | 'conflict' | 'permission_denied' | 'model_unavailable' | 'budget_exceeded' | 'offline' | 'invalid_source' | 'busy' | 'invalid_params';

/** 业务错误：JSON-RPC 里 error.data.code = code，error.message 可直接显示 */
export class TibiError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly data?: unknown) {
    super(message);
    this.name = 'TibiError';
  }
}
