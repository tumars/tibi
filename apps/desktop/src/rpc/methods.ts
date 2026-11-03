/**
 * 界面用到的方法签名（06 §3 的子集，M0 / M1）。类型只从 @tibi/core 取类型，不引运行时。
 */
import type {
  Answer, AnswerResult, MessageBlock, MessageStep, WidgetBlock, Conversation, Document, DocumentSummary, Genre, Id, IntervalPreview, Kind, Memory, Message, Ok, Page, Profile, Provider, Rating, ReviewSession, Skill,
  DictEntryResult, DictSuggestResult, SampleInfo, SearchResult, SectionContent, Status, TurnId, UsageSummary, Term, TermDetail, DictEntry, Undo, Approval, AskState,
} from '@tibi/core';

export interface WebSearchConfig { provider: 'deepseek' | 'tavily' | 'off'; deepseek_ready: boolean; tavily_ready: boolean }

export interface MethodTable {
  'system.status': { params: Record<string, never>; result: { version: string; db_path: string; offline: boolean; models: { fast?: string; deep?: string; ok: boolean } } };
  'system.undo': { params: { undo_id: Id }; result: Ok };
  'system.registerPaths': { params: { paths: string[] }; result: Ok };
  'system.backup': { params: { reason?: 'manual' | 'before_reset' | 'before_restore' | 'before_update' }; result: { path: string; size: number; created_at: number } };
  'system.backups': { params: Record<string, never>; result: { auto: boolean; dir_supported: boolean; items: { name: string; path: string; size: number; created_at: number; reason: 'auto' | 'manual' | 'before_reset' | 'before_restore' | 'before_update' }[] } };
  'stats.export_summary': { params: Record<string, never>; result: UsageSummary };
  'documents.import': { params: { source: { type: 'text'; text: string } | { type: 'url'; url: string } | { type: 'file'; path: string } | { type: 'images'; paths: string[] } | { type: 'sample'; id: string }; hints?: { kind?: Kind; genre?: Genre; tags?: string[] }; origin?: 'user' | 'deeplink' }; result: { import_id: Id } };
  'documents.samples': { params: Record<string, never>; result: SampleInfo[] };
  'documents.checkUrl': { params: { url: string }; result: { ok: boolean; url?: string; host?: string; error?: string } };
  'documents.list': { params: { kind?: Kind; genre?: Genre; tags?: string[]; q?: string; sort?: 'fit' | 'opened' | 'added' | 'progress' | 'minutes'; archived?: boolean; status?: 'unread' | 'reading' | 'done'; cursor?: string; limit?: number }; result: Page<DocumentSummary> };
  'documents.get': { params: { id: Id }; result: Document };
  'documents.update': { params: { id: Id; patch: { title?: string; genre?: Genre; tags?: string[]; is_favorite?: boolean; is_archived?: boolean } }; result: Document };
  'documents.delete': { params: { id: Id }; result: Undo };
  'sections.get': { params: { id: Id; with?: ('translations' | 'ai')[] }; result: SectionContent };
  'sections.translate': { params: { id: Id; sentence_ids?: Id[] }; result: Ok };
  'documents.analyze': { params: { id: Id }; result: Ok };
  'sections.progress': { params: { id: Id; sentence_id: Id; progress: number }; result: Ok };
  'sections.finish': { params: { id: Id }; result: Ok };
  'terms.lookup': { params: { text: string; sentence_id?: Id }; result: { dict?: DictEntry; term?: Term; context_meaning?: string; status_change?: { from: Status; to: Status }; card_created?: boolean } };
  'terms.context_meaning': { params: { text: string; sentence_id: Id }; result: { meaning: string; cached: boolean } };
  'terms.list': { params: { view?: 'all' | 'due' | 'late' | 'new' | 'leech' | 'stuck' | 'stale' | 'ignored' | 'known' | 'mastered'; status?: Status[]; kind?: 'word' | 'phrase'; document_id?: Id; tags?: string[]; q?: string; sort?: 'due' | 'added' | 'enc' | 'alpha' | 'stage' | 'freq'; cursor?: string; limit?: number }; result: Page<Term> & { counts: Record<string, number> } };
  'terms.export': { params: { format: 'csv' | 'anki' | 'txt'; ids?: Id[]; with_contexts?: boolean }; result: { filename: string; text: string; count: number } };
  'terms.import': { params: { path: string; format: 'csv' | 'txt' | 'anki' | 'known' }; result: { added: number; known: number; skipped: number; total: number } };
  'terms.add': { params: { entries: { text: string; meaning?: string }[] }; result: { created: Term[]; undo?: Undo } };
  'search.query': { params: { q: string; limit?: number }; result: SearchResult };
  'dict.suggest': { params: { q: string; limit?: number }; result: DictSuggestResult };
  'dict.entry': { params: { word: string }; result: DictEntryResult };
  'sync.status': { params: Record<string, never>; result: SyncStatus };
  'sync.probe': { params: { backend: SyncBackendCfg }; result: { ok: boolean; library?: { library_id: string; devices: number; updated_at: number }; error?: { code: string; message: string } } };
  'sync.enable': { params: { backend: SyncBackendCfg; device_name?: string; sync_files?: boolean }; result: SyncStatus };
  'sync.now': { params: Record<string, never>; result: SyncStatus };
  'sync.removeDevice': { params: { device_id: string }; result: SyncStatus };
  'sync.disable': { params: Record<string, never>; result: Ok };
  'terms.get': { params: { id: Id } | { text: string }; result: TermDetail };
  'terms.setStatus': { params: { ids: Id[]; status: Status; source?: 'user' | 'page_done' }; result: { changed: number; undo: Undo } };
  'terms.mark': { params: { text: string; status: Status; sentence_id?: Id }; result: { term: Term; previous?: Status; undo: Undo } };
  'terms.remove': { params: { ids: Id[] }; result: Undo };
  'review.start': { params: { resume?: boolean; ahead?: boolean; limit?: number }; result: ReviewSession };
  'review.preview': { params: { card_id: Id }; result: IntervalPreview };
  'review.answer': { params: { session_id: Id; step: number; answer: Answer; hints: number; duration_ms: number }; result: AnswerResult };
  'review.override': { params: { session_id: Id; step: number; rating: Rating }; result: AnswerResult };
  'review.next': { params: { session_id: Id; step: number }; result: Ok };
  'review.undo': { params: { session_id: Id }; result: AnswerResult };
  'review.pause': { params: { session_id: Id }; result: Ok };
  'review.overview': { params: Record<string, never>; result: { due: number; late: number; fresh: number; new_waiting: number; daily_new: number; open?: { session_id: Id; total: number; left: number; started_at: number; updated_at: number }; today: { reviews: number; correct: number; minutes: number; new_learned: number }; later_today: number; forecast: number[]; leeches: number; mistakes: { term_id: Id; display: string; meaning: string; lapses: number }[] } };
  'review.quiz': { params: { term_ids?: Id[]; count?: number; from?: 'session_mistakes' }; result: ReviewSession };
  'review.story': { params: { term_ids: Id[] }; result: { import_id: Id } };
  'practice.start': { params: { mode: 'dictation' | 'spell' | 'confusable' | 'produce'; source: 'recent' | 'mistakes' | 'leech' | 'document'; document_id?: Id; count?: number }; result: { practice_id: Id; items: { id: string; mode: string; sentence: string; options?: [string, string]; answer?: string; explain?: string; source: { document_id?: Id; term_id?: Id } }[] } };
  'practice.grade': { params: { word: string; text: string; sentence?: string }; result: { score: number; ok: boolean; feedback: string; better?: string } };
  'practice.finish': { params: { practice_id: Id; results: { item_id: string; accuracy: number; duration_ms: number }[] }; result: { practice_id: Id; accuracy: number; duration_ms: number; best: { dictation_accuracy: number; rounds: number } } };
  'stats.summary': { params: { range: 30 | 90 | 180 }; result: { mastered: number; mastered_delta: number; prev_delta: number; minutes: number; words: number; study_days: number; streak: number; longest_streak: number; reviews: number; retention: number } };
  'stats.series': { params: { metrics: ('mastered' | 'minutes' | 'words' | 'reviews')[]; days: number }; result: { dates: number[]; series: Record<string, number[]> } };
  'stats.retention': { params: { weeks: number }; result: { weeks: { ratings: [number, number, number, number]; retention: number }[]; lapses: number; leeches: number } };
  'stats.genres': { params: { range: number }; result: { genre: Genre; words: number }[] };
  'stats.insight': { params: { regenerate?: boolean }; result: { insight?: { text: string; actions: { label: string; route: string }[]; generated_at: number; cost: number } } };
  'stats.forecast': { params: { days?: number }; result: { days: number[]; target_retention: number } };
  'stats.stages': { params: Record<string, never>; result: { stages: number[] } };
  'profile.get': { params: Record<string, never>; result: Profile };
  'profile.update': { params: { patch: Omit<Partial<Profile>, 'assistant_prefs'> & { assistant_prefs?: Partial<Profile['assistant_prefs']> } }; result: Profile };
  'settings.get': { params: { keys?: string[] }; result: Record<string, unknown> };
  'settings.set': { params: { patch: Record<string, unknown> }; result: Record<string, unknown> };
  'providers.list': { params: Record<string, never>; result: Provider[] };
  'providers.upsert': { params: { provider: Omit<Provider, 'id' | 'has_secret'> & { id?: Id }; secret_ref?: string }; result: Provider };
  'providers.delete': { params: { id: Id }; result: { ok: true; secret_ref?: string } };
  'providers.test': { params: { id: Id }; result: { ok: boolean; model?: string; latency_ms?: number; json_mode?: boolean; error?: string } };
  'chat.list': { params: { limit?: number }; result: Conversation[] };
  'skills.list': { params: Record<string, never>; result: Skill[] };
  'skills.update': { params: { id: string; patch: { model_tier?: 'fast' | 'deep'; extra_instructions?: string; write_permission?: 'inherit' | 'ask'; enabled?: boolean } }; result: Skill };
  'skills.reset': { params: { id: string }; result: Skill };
  'skills.runNow': { params: { id: string; input?: string }; result: { conversation_id: Id; submission_id: TurnId } };
  'websearch.config': { params: Record<string, never>; result: WebSearchConfig };
  'websearch.configure': { params: { provider: WebSearchConfig['provider'] }; result: WebSearchConfig };
  'feeds.list': { params: Record<string, never>; result: { url: string; title: string; builtin: boolean; enabled: boolean }[] };
  'mcp.config': { params: Record<string, never>; result: { enabled: boolean; write_tools: string[]; tools: { name: string; description: string; write: boolean }[] } };
  'mcp.configure': { params: { enabled?: boolean; write_tools?: string[] }; result: Ok };
  'feeds.update': { params: { add?: { url: string; title?: string }; remove?: string; toggle?: { url: string; enabled: boolean } }; result: { url: string; title: string; builtin: boolean; enabled: boolean }[] };
  'memory.list': { params: { type?: Memory['type']; q?: string }; result: Memory[] };
  'memory.update': { params: { id: Id; content: string }; result: Memory };
  'memory.delete': { params: { id: Id }; result: Undo };
  'memory.pause': { params: { paused: boolean }; result: Ok };
  'memory.clear': { params: Record<string, never>; result: Undo };
  'chat.open': { params: { conversation_id?: Id; document_id?: Id; today?: boolean }; result: Conversation & { messages: Message[]; cursor?: string; active?: TurnId[]; approvals?: Approval[]; live?: { id: TurnId; blocks: MessageBlock[]; steps: MessageStep[]; thinking?: string }[] } };
  'chat.send': { params: { conversation_id: Id; text: string; context?: { page: string; document_id?: Id; section_id?: Id; sentence_id?: Id; selection?: string; card_id?: Id }; skill?: string; tier?: 'fast' | 'deep'; provider_id?: string }; result: { submission_id: TurnId; steered?: boolean; answered?: boolean } };
  'chat.cancel': { params: { submission_id: TurnId }; result: Ok };
  'chat.retry': { params: { conversation_id: Id; turn_id: TurnId }; result: { submission_id: TurnId } };
  'chat.widget_update': { params: { message_id: Id; widget_id: Id; state: unknown; result?: string }; result: Ok };
  'chat.answer': { params: { widget_id: Id; option_ids: string[]; text?: string }; result: { state: AskState } };
  'chat.rewind': { params: { conversation_id: Id; message_id: Id }; result: { text: string; skill?: string } };
  'chat.receipt_undone': { params: { message_id: Id; undo_id: Id }; result: Ok };
  'chat.rename': { params: { conversation_id: Id; title: string }; result: Conversation };
  'chat.delete': { params: { conversation_id: Id }; result: Ok };
  'approvals.list': { params: { conversation_id?: Id }; result: Approval[] };
  'approvals.decide': { params: { id: Id; decision: 'allow' | 'deny' | 'edit'; edited?: Record<string, unknown>; always?: boolean }; result: Ok };
  'chat.history': { params: { conversation_id: Id; cursor?: string }; result: Page<Message> };
}

export type MethodName = keyof MethodTable;
export type Params<M extends MethodName> = MethodTable[M]['params'];
export type Result<M extends MethodName> = MethodTable[M]['result'];

/** Core → 界面事件（06 §4） */
export type SyncBackendCfg = { kind: 'icloud' } | { kind: 'folder'; path: string } | { kind: 'webdav'; url: string; user: string; password_ref: string };
export interface SyncStatus {
  enabled: boolean; backend?: SyncBackendCfg; state: 'off' | 'idle' | 'syncing' | 'error'; last_synced_at?: number; pending: number; sync_files: boolean;
  device?: { id: string; name: string }; peers: { id: string; name: string; platform: string; last_seen_at?: number; removed: boolean }[]; error?: { code: string; message: string };
}

export interface EventTable {
  /** origin = chat：Tibi 在对话里起的导入，进度和结果显示在对话的导入卡上，不弹全局提示 */
  'import.progress': { import_id: Id; title: string; label: string; origin: 'user' | 'deeplink' | 'mcp' | 'share' | 'chat' };
  'import.done': { import_id: Id; title: string; origin: 'user' | 'deeplink' | 'mcp' | 'share' | 'chat'; ok: boolean; document_id?: Id; duplicate?: boolean; minutes?: number; level?: string; summary?: string; action?: { label: string; route: string }; error?: string };
  'chat.end': { conversation_id: Id; submission_id: TurnId; state: 'done' | 'error' | 'cancel'; error?: string };
  'approval.requested': { approval: Approval };
  'approval.resolved': { id: Id; decision: 'allow' | 'deny' | 'edit' };
  'data.changed': { table: 'documents' | 'terms' | 'cards' | 'memories' | 'skills' | 'settings' | 'sentences'; ids?: Id[] };
  'model.status': { ok: boolean; reason?: 'offline' | 'unauthorized' };
  'chat.delta': { conversation_id: Id; submission_id: TurnId; delta: string; done?: boolean };
  'chat.block': { conversation_id: Id; submission_id: TurnId; block: WidgetBlock };
  'chat.thinking': { conversation_id: Id; submission_id: TurnId; delta: string };
  /** call_id 把开始和结束配成一对；end 带结果摘要、出错原因和耗时 */
  'chat.tool': { conversation_id?: Id; turn_id: TurnId; phase: 'start' | 'end'; tool: string; skill_id: string; status?: 'ok' | 'error' | 'denied'; summary: string; call_id?: string; detail?: string; result?: string; error?: string; duration_ms?: number };
  'sync.update': { state: 'idle' | 'syncing' | 'error'; pushed?: number; pulled?: number; last_synced_at?: number; error?: { code: string; message: string } };
}
export type EventName = keyof EventTable;
