/**
 * 哪些表同步、怎么同步（08 §3、§4、§7）。
 * - put：普通表，按字段比较时钟；exclude 里的字段不同步（本机路径、派生数据、FSRS 排期——合并后按复习记录重算）
 * - add：只追加的表，整行，按 id 去重
 * - 不在这里的表不同步：providers（各设备自己填 Key）、jobs / job_steps / skill_audit / usage_records（只对本机有意义）、
 *   review_sessions（做到一半的一轮不同步）、daily_stats / audio_cache（本地重算 / 缓存）
 * pk 是复合主键时同步用的 id 是各列用 "|" 连起来。
 */
export interface TableSpec {
  t: string; kind: 'put' | 'add';
  pk: string[];
  exclude?: string[];
  /** 自然键（08 §4）：两台设备各建了"同一个"时按它认作一条；where 是额外条件 */
  natural?: { cols: string[]; where?: string };
  /** 设置表：这些 GLOB 匹配的键是设备自己的设置，不同步 */
  localGlobs?: string[];
}

/** 外键：留下的那条换了 ID 时，引用它的列要改过去；收到指向旧 ID 的改动时按 sync_aliases 转过去 */
export const REFS: Record<string, { t: string; col: string }[]> = {
  terms: [{ t: 'cards', col: 'term_id' }, { t: 'term_contexts', col: 'term_id' }, { t: 'term_forms', col: 'term_id' }, { t: 'term_status_log', col: 'term_id' }],
  documents: [{ t: 'sections', col: 'document_id' }, { t: 'document_tags', col: 'document_id' }, { t: 'term_contexts', col: 'document_id' }, { t: 'term_status_log', col: 'document_id' }, { t: 'practice_logs', col: 'document_id' }, { t: 'reading_sessions', col: 'document_id' }, { t: 'thread_links', col: 'document_id' }],
  tags: [{ t: 'document_tags', col: 'tag_id' }],
  conversations: [{ t: 'messages', col: 'conversation_id' }, { t: 'thread_links', col: 'conversation_id' }],
  cards: [{ t: 'review_logs', col: 'card_id' }],
};

const CARD_SCHEDULE = ['due', 'stability', 'stability_fast', 'difficulty', 'elapsed_days', 'scheduled_days', 'learning_steps', 'reps', 'lapses', 'state', 'last_review'];

/** 顺序就是推送和初始导出的顺序：被引用的表在前 */
export const TABLES: TableSpec[] = [
  { t: 'user_profile', kind: 'put', pk: ['id'] },
  { t: 'settings', kind: 'put', pk: ['key'], localGlobs: ['tts.*', 'mcp.*', 'backup.*', 'sync.*', 'onboarding.*', 'reminder.*'] },   // 深浅色在 localStorage，不在库里
  { t: 'skills', kind: 'put', pk: ['id'] },
  { t: 'tags', kind: 'put', pk: ['id'], natural: { cols: ['name'], where: 'deleted_at IS NULL' } },
  { t: 'documents', kind: 'put', pk: ['id'], exclude: ['original_path', 'cover_path'], natural: { cols: ['content_hash'], where: 'deleted_at IS NULL' } },
  { t: 'sections', kind: 'put', pk: ['id'] },
  { t: 'sentences', kind: 'put', pk: ['id'] },
  { t: 'document_tags', kind: 'put', pk: ['document_id', 'tag_id'] },
  { t: 'terms', kind: 'put', pk: ['id'], exclude: ['encounter_count'], natural: { cols: ['kind', 'text'] } },
  { t: 'term_forms', kind: 'put', pk: ['term_id', 'form'], exclude: ['encounter_count'] },
  { t: 'term_contexts', kind: 'put', pk: ['id'] },
  { t: 'cards', kind: 'put', pk: ['id'], exclude: CARD_SCHEDULE, natural: { cols: ['term_id'] } },
  { t: 'ai_results', kind: 'put', pk: ['id'], natural: { cols: ['scope', 'target_id', 'task', 'prompt_version', 'model'] } },
  { t: 'reading_sessions', kind: 'put', pk: ['id'] },
  { t: 'conversations', kind: 'put', pk: ['id'], natural: { cols: ['day'], where: "kind = 'day' AND deleted_at IS NULL" } },
  { t: 'messages', kind: 'put', pk: ['id'] },
  { t: 'thread_links', kind: 'put', pk: ['conversation_id'] },
  { t: 'memories', kind: 'put', pk: ['id'] },
  { t: 'review_logs', kind: 'add', pk: ['id'] },
  { t: 'term_status_log', kind: 'add', pk: ['id'] },
  { t: 'learning_events', kind: 'add', pk: ['id'], exclude: ['consolidated'] },   // consolidated 是本机整理记忆的进度
  { t: 'practice_logs', kind: 'add', pk: ['id'] },
];
export const SPEC = new Map(TABLES.map(s => [s.t, s]));
export { CARD_SCHEDULE };
