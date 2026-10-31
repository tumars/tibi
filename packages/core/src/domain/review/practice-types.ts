import type { Id, PracticeMode } from '../../types.js';

/** 06 §2 的 PracticeItem / PracticeResult（主线的 types.ts 还没有这两条，先放这里；接线时挪过去） */
export interface PracticeItem { id: string; mode: PracticeMode; sentence: string; audio?: string; options?: [string, string]; answer?: string; explain?: string; source: { document_id?: Id; term_id?: Id } }
export interface PracticeResult { practice_id: Id; accuracy: number; duration_ms: number; best: { dictation_accuracy: number; rounds: number } }
