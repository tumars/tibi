/**
 * 界面用到的方法签名（06 §3 的子集，M0 / M1）。类型只从 @tibi/core 取类型，不引运行时。
 */
import type {
  Answer, AnswerResult, Conversation, Document, DocumentSummary, Genre, Id, IntervalPreview, Kind, Memory, Message, Ok, Page, Profile, Provider, Rating, ReviewSession, Skill,
  SampleInfo, SectionContent, Status, Task, TaskId, TaskSummary, UsageSummary, Term, TermDetail, DictEntry, Undo, Approval,
} from '@tibi/core';

export interface MethodTable {
  'system.status': { params: Record<string, never>; result: { version: string; db_path: string; offline: boolean; models: { fast?: string; deep?: string; ok: boolean }; budget: { month_spent: number; limit: number; per_task: number }; pending_approvals: number; running_tasks: number } };
  'system.undo': { params: { undo_id: Id }; result: Ok };
  'system.registerPaths': { params: { paths: string[] }; result: Ok };
  'system.backup': { params: { reason?: 'manual' | 'before_reset' | 'before_restore' }; result: { path: string; size: number; created_at: number } };
  'system.backups': { params: Record<string, never>; result: { auto: boolean; dir_supported: boolean; items: { name: string; path: string; size: number; created_at: number; reason: 'auto' | 'manual' | 'before_reset' | 'before_restore' }[] } };
  'stats.export_summary': { params: Record<string, never>; result: UsageSummary };
  'documents.import': { params: { source: { type: 'text'; text: string } | { type: 'url'; url: string } | { type: 'file'; path: string } | { type: 'images'; paths: string[] } | { type: 'sample'; id: string }; hints?: { kind?: Kind; genre?: Genre; tags?: string[] }; origin?: 'user' | 'deeplink' }; result: { task_id: TaskId } };
  'documents.samples': { params: Record<string, never>; result: SampleInfo[] };
  'documents.checkUrl': { params: { url: string }; result: { ok: boolean; url?: string; host?: string; error?: string } };
  'documents.list': { params: { kind?: Kind; genre?: Genre; tags?: string[]; q?: string; sort?: 'fit' | 'opened' | 'added' | 'progress' | 'minutes'; archived?: boolean; status?: 'unread' | 'reading' | 'done'; cursor?: string; limit?: number }; result: Page<DocumentSummary> };
  'documents.get': { params: { id: Id }; result: Document };
  'documents.update': { params: { id: Id; patch: { title?: string; genre?: Genre; tags?: string[]; is_favorite?: boolean; is_archived?: boolean } }; result: Document };
  'documents.delete': { params: { id: Id }; result: Undo };
  'sections.get': { params: { id: Id; with?: ('translations' | 'ai')[] }; result: SectionContent };
  'sections.translate': { params: { id: Id; sentence_ids?: Id[] }; result: { task_id: TaskId } };
  'documents.analyze': { params: { id: Id }; result: { task_id: TaskId } };
  'sections.progress': { params: { id: Id; sentence_id: Id; progress: number }; result: Ok };
  'sections.finish': { params: { id: Id; mark_rest_known: boolean }; result: { marked: number; undo?: Undo } };
  'terms.lookup': { params: { text: string; sentence_id?: Id }; result: { dict?: DictEntry; term?: Term; context_meaning?: string; status_change?: { from: Status; to: Status }; card_created?: boolean } };
  'terms.context_meaning': { params: { text: string; sentence_id: Id }; result: { meaning: string; cached: boolean } };
  'terms.list': { params: { view?: 'all' | 'due' | 'late' | 'new' | 'leech' | 'stuck' | 'stale' | 'unsure' | 'ignored' | 'known' | 'mastered'; status?: Status[]; kind?: 'word' | 'phrase'; document_id?: Id; tags?: string[]; q?: string; sort?: 'due' | 'added' | 'enc' | 'alpha' | 'stage' | 'freq'; cursor?: string; limit?: number }; result: Page<Term> & { counts: Record<string, number> } };
  'terms.export': { params: { format: 'csv' | 'anki' | 'txt'; ids?: Id[]; with_contexts?: boolean }; result: { filename: string; text: string; count: number } };
  'terms.import': { params: { path: string; format: 'csv' | 'txt' | 'anki' | 'known' }; result: { added: number; known: number; skipped: number; total: number } };
  'terms.get': { params: { id: Id } | { text: string }; result: TermDetail };
  'terms.setStatus': { params: { ids: Id[]; status: Status; source?: 'user' | 'page_done' }; result: { changed: number; undo: Undo } };
  'terms.remove': { params: { ids: Id[] }; result: Undo };
  'review.start': { params: { resume?: boolean; ahead?: boolean; limit?: number }; result: ReviewSession };
  'review.preview': { params: { card_id: Id }; result: IntervalPreview };
  'review.answer': { params: { session_id: Id; step: number; answer: Answer; hints: number; duration_ms: number }; result: AnswerResult };
  'review.override': { params: { session_id: Id; step: number; rating: Rating }; result: AnswerResult };
  'review.next': { params: { session_id: Id; step: number }; result: Ok };
  'review.undo': { params: { session_id: Id }; result: AnswerResult };
  'review.pause': { params: { session_id: Id }; result: Ok };
  'review.quiz': { params: { term_ids?: Id[]; count?: number; from?: 'session_mistakes' }; result: ReviewSession };
  'review.story': { params: { term_ids: Id[] }; result: { task_id: TaskId } };
  'practice.start': { params: { mode: 'dictation' | 'spell' | 'confusable' | 'produce'; source: 'recent' | 'mistakes' | 'leech' | 'document'; document_id?: Id; count?: number }; result: { practice_id: Id; items: { id: string; mode: string; sentence: string; options?: [string, string]; answer?: string; explain?: string; source: { document_id?: Id; term_id?: Id } }[] } };
  'practice.grade': { params: { word: string; text: string; sentence?: string }; result: { score: number; ok: boolean; feedback: string; better?: string } };
  'practice.finish': { params: { practice_id: Id; results: { item_id: string; accuracy: number; duration_ms: number }[] }; result: { practice_id: Id; accuracy: number; duration_ms: number; best: { dictation_accuracy: number; rounds: number } } };
  'stats.summary': { params: { range: 30 | 90 | 180 }; result: { known: number; known_delta: number; prev_delta: number; minutes: number; words: number; study_days: number; streak: number; longest_streak: number; reviews: number; retention: number } };
  'stats.series': { params: { metrics: ('known' | 'minutes' | 'words' | 'reviews')[]; days: number }; result: { dates: number[]; series: Record<string, number[]> } };
  'stats.retention': { params: { weeks: number }; result: { weeks: { ratings: [number, number, number, number]; retention: number }[]; lapses: number; leeches: number } };
  'stats.genres': { params: { range: number }; result: { genre: Genre; words: number; unknown_ratio: number }[] };
  'stats.insight': { params: { regenerate?: boolean }; result: { insight?: { text: string; actions: { label: string; route: string }[]; generated_at: number; cost: number } } };
  'stats.forecast': { params: { days?: number }; result: { days: number[]; target_retention: number } };
  'stats.stages': { params: Record<string, never>; result: { stages: number[] } };
  'profile.get': { params: Record<string, never>; result: Profile };
  'profile.update': { params: { patch: Omit<Partial<Profile>, 'assistant_prefs'> & { assistant_prefs?: Partial<Profile['assistant_prefs']> } }; result: Profile };
  'vocab.start': { params: Record<string, never>; result: { bands: { label: string; words: string[] }[] } };
  'vocab.submit': { params: { picks: string[][] }; result: { estimate: number; cefr: string; bands: number[]; pseudo_hits: number } };
  'settings.get': { params: { keys?: string[] }; result: Record<string, unknown> };
  'settings.set': { params: { patch: Record<string, unknown> }; result: Record<string, unknown> };
  'providers.list': { params: Record<string, never>; result: Provider[] };
  'providers.upsert': { params: { provider: Omit<Provider, 'id' | 'has_secret' | 'month_cost'> & { id?: Id }; secret_ref?: string }; result: Provider };
  'providers.test': { params: { id: Id }; result: { ok: boolean; model?: string; latency_ms?: number; json_mode?: boolean; error?: string } };
  'tasks.list': { params: { limit?: number }; result: { running: TaskSummary[]; pending: Approval[]; history: TaskSummary[]; kpis: { running: number; week_done: number; week_failed: number; month_cost: number; budget: number; top_skill: { id: string; cost: number } } } };
  'chat.list': { params: { limit?: number }; result: Conversation[] };
  'skills.list': { params: Record<string, never>; result: Skill[] };
  'skills.update': { params: { id: string; patch: { model_tier?: 'fast' | 'deep'; extra_instructions?: string; write_permission?: 'inherit' | 'ask'; enabled?: boolean } }; result: Skill };
  'skills.reset': { params: { id: string }; result: Skill };
  'skills.runNow': { params: { id: string; input?: string }; result: { task_id: TaskId } };
  'feeds.list': { params: Record<string, never>; result: { url: string; title: string; builtin: boolean; enabled: boolean }[] };
  'mcp.config': { params: Record<string, never>; result: { enabled: boolean; write_tools: string[]; tools: { name: string; description: string; write: boolean }[] } };
  'mcp.configure': { params: { enabled?: boolean; write_tools?: string[] }; result: Ok };
  'feeds.update': { params: { add?: { url: string; title?: string }; remove?: string; toggle?: { url: string; enabled: boolean } }; result: { url: string; title: string; builtin: boolean; enabled: boolean }[] };
  'memory.list': { params: { type?: Memory['type']; q?: string }; result: Memory[] };
  'memory.update': { params: { id: Id; content: string }; result: Memory };
  'memory.delete': { params: { id: Id }; result: Undo };
  'memory.pause': { params: { paused: boolean }; result: Ok };
  'memory.clear': { params: Record<string, never>; result: Undo };
  'chat.open': { params: { conversation_id?: Id; document_id?: Id; today?: boolean }; result: Conversation & { messages: Message[] } };
  'chat.send': { params: { conversation_id: Id; text: string; context?: { page: string; document_id?: Id; section_id?: Id; sentence_id?: Id; selection?: string; card_id?: Id }; skill?: string; tier?: 'fast' | 'deep' }; result: { submission_id: TaskId } };
  'chat.cancel': { params: { submission_id: TaskId }; result: Ok };
  'chat.rename': { params: { conversation_id: Id; title: string }; result: Conversation };
  'chat.delete': { params: { conversation_id: Id }; result: Ok };
  'tasks.approve': { params: { id: TaskId; decision: 'allow' | 'deny' | 'edit'; edited?: Record<string, unknown>; always?: boolean }; result: TaskSummary };
  'tasks.get': { params: { id: TaskId }; result: Task };
  'tasks.cancel': { params: { id: TaskId }; result: TaskSummary };
  'tasks.retry': { params: { id: TaskId }; result: TaskSummary };
  'chat.history': { params: { conversation_id: Id; cursor?: string }; result: Page<Message> };
}

export type MethodName = keyof MethodTable;
export type Params<M extends MethodName> = MethodTable[M]['params'];
export type Result<M extends MethodName> = MethodTable[M]['result'];

/** Core → 界面事件（06 §4） */
export interface EventTable {
  'task.update': { task: TaskSummary; steps?: unknown[] };
  'task.done': { task: TaskSummary; result?: { document_id?: Id; summary: string; action?: { label: string; route: string } } };
  'approval.requested': { approval: Approval };
  'approval.resolved': { task_id: TaskId; decision: 'allow' | 'deny' | 'edit' };
  'data.changed': { table: 'documents' | 'terms' | 'cards' | 'memories' | 'skills' | 'settings' | 'sentences'; ids?: Id[] };
  'usage.updated': { skill_id: string; month_cost: number; total: number };
  'model.status': { ok: boolean; reason?: 'offline' | 'unauthorized' | 'budget' };
  'chat.delta': { conversation_id: Id; submission_id: TaskId; delta: string; done?: boolean };
  'chat.tool': { conversation_id?: Id; task_id: TaskId; phase: 'start' | 'end'; tool: string; skill_id: string; summary: string; duration_ms?: number };
  'sync.update': { state: 'idle' | 'syncing' | 'error' };
}
export type EventName = keyof EventTable;
