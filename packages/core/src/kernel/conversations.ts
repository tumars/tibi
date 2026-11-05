import { j, now, type Database } from '../db/driver.js';
import { uuidv7 } from '../ids.js';
import { TibiError, type Approval, type AskOption, type AskState, type Conversation, type Message, type MessageBlock, type MessageInterrupted, type MessageReceipt, type MessageStep, type SkillId, type WidgetBlock, type WidgetSpec } from '../types.js';
import type { Turns } from './turns.js';
import type { CompactionBody, StoredMessage } from './engine.js';
import { skillDef } from './skills.js';

/**
 * 对话与消息（10 §5）：messages 是唯一的对话记录，模型和界面都读它。
 * - 每条 pi-ai 消息一行：user / assistant / tool_result；引擎压缩后一条 compaction；对话之外的事一条 note。
 * - body 是给模型的（Tibi 消息格式 v1，和 pi-ai 的 Message 同构），ui 只给界面（卡片、回执、步骤、附件）。
 * - 一轮回答 = 一句用户消息 + Tibi 为它说的话和调的工具，这些行带同一个 turn_id（第一句用户消息的 id）。
 *   这一轮用的技能、结果、是否读过不可信内容记在第一句用户消息的 ui.turn 里。
 * - 界面看到的 Message 由 history() 按 turn_id 合成：一轮的助手消息和工具结果合成一个回答气泡。
 */

interface ConvRow extends Record<string, string | number | null> { id: string; kind: string; day: string | null; device: string; title: string; last_message_at: number | null; created_at: number; updated_at: number }
interface LinkRow extends Record<string, string | number | null> { skill_id: string; document_id: string | null; trigger: string }
interface MsgRow extends Record<string, string | number | null> { id: string; role: string; body: string; ui: string; turn_id: string | null; created_at: number; rowid: number }

/** 工具结果在界面上的样子：过程卡的一步、对话卡片、写入回执；widgets 是子技能显示在这里的卡片（反问） */
export interface ToolResultUi { step?: MessageStep; widget?: WidgetBlock; widgets?: WidgetBlock[]; receipt?: MessageReceipt }
/** 一轮回答的结果（进行中的在内存里还有一份，见 turns.ts）；重启时还是 running 的记成中断 */
export interface TurnInfo { skill: SkillId; state: 'running' | 'done' | 'error' | 'cancel'; error?: string; tainted?: boolean }
/** 用户消息的附件：模型看到的文字在 body 里，这里是界面上的小标签；turn 只在一轮的第一句上 */
export interface UserUi { attachment?: string; turn?: TurnInfo }

type TextPart = { type: 'text'; text: string };
interface AssistantBody { role: 'assistant'; content: ({ type: string; text?: string; thinking?: string; redacted?: boolean } & Record<string, unknown>)[] }

function localDay(t: number = now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 正在生成的回答（进程内）：离开再回来时接上已经说出来的部分 */
export const liveAnswers = new Map<string, () => { blocks: MessageBlock[]; steps: MessageStep[]; thinking?: string }>();
/** 正在运行的回答（进程内，按 turn_id）：工具执行中就把卡片显示出来（反问等回答时用）；step 是哪次工具调用，子技能的卡片不带 step */
export const presenters = new Map<string, (spec: WidgetSpec, step?: string) => ShownWidget | undefined>();
/** 显示出来的卡片；update 改它的状态：还没写库就跟着工具结果一起存，写过了就改库里那条 */
export interface ShownWidget { block: WidgetBlock; conversation_id: string; update(state: unknown, result?: string): Promise<void> }

/** 正在打开的文章对话（进程内去重） */
const OPENING = new Map<string, Promise<Conversation>>();

export class Conversations {
  constructor(private readonly db: Database) {}

  async get(id: string): Promise<Conversation | undefined> {
    const r = await this.db.get<ConvRow>('SELECT * FROM conversations WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!r) return undefined;
    const link = await this.db.get<LinkRow>('SELECT skill_id, document_id, trigger FROM thread_links WHERE conversation_id = ?', [id]);
    return toConversation(r, link);
  }

  /** chat.open 的三种情况：续某篇文章的线程 / 今天（手机，J9）/ 新建全局线程 */
  async open(opts: { conversation_id?: string; document_id?: string; today?: boolean; device?: 'desktop' | 'mobile' }): Promise<Conversation> {
    if (opts.conversation_id) {
      const c = await this.get(opts.conversation_id);
      if (!c) throw new TibiError('not_found', '找不到这个对话');
      return c;
    }
    if (opts.document_id) {
      // 同一篇文章同时打开两次（界面重复调用）只建一个对话
      const key = `doc:${opts.document_id}`;
      const inflight = OPENING.get(key); if (inflight) return inflight;
      const p = this.openForDocument(opts.document_id, opts.device).finally(() => OPENING.delete(key));
      OPENING.set(key, p); return p;
    }
    if (opts.today) {
      const day = localDay();
      const row = await this.db.get<{ id: string }>("SELECT id FROM conversations WHERE kind = 'day' AND day = ? AND deleted_at IS NULL", [day]);
      if (row) return (await this.get(row.id))!;
      return this.create({ kind: 'day', day, title: day, device: opts.device ?? 'mobile' });
    }
    return this.create({ kind: 'chat', title: '', device: opts.device });
  }

  private async openForDocument(document_id: string, device?: 'desktop' | 'mobile'): Promise<Conversation> {
    const link = await this.db.get<{ conversation_id: string }>('SELECT tl.conversation_id FROM thread_links tl JOIN conversations c ON c.id = tl.conversation_id WHERE tl.document_id = ? AND c.deleted_at IS NULL ORDER BY c.updated_at DESC LIMIT 1', [document_id]);
    if (link) return (await this.get(link.conversation_id))!;
    const doc = await this.db.get<{ title: string }>('SELECT title FROM documents WHERE id = ?', [document_id]);
    return this.create({ kind: 'document', title: doc?.title ?? '', document_id, device });
  }

  async create(opts: { kind: 'chat' | 'day' | 'document' | 'skill'; title: string; day?: string; document_id?: string; device?: 'desktop' | 'mobile'; skill_id?: SkillId; trigger?: string }): Promise<Conversation> {
    const id = uuidv7(); const t = now();
    await this.db.transaction(async tx => {
      await tx.run('INSERT INTO conversations(id, kind, day, device, title, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', [id, opts.kind, opts.day ?? null, opts.device ?? 'desktop', opts.title, t, t]);
      await tx.run('INSERT INTO thread_links(conversation_id, skill_id, document_id, title, trigger, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', [id, opts.skill_id ?? 'tibi', opts.document_id ?? null, opts.title, opts.trigger ?? 'user', t, t]);
    });
    return (await this.get(id))!;
  }

  /** 只列说过话的：打开阅读器面板、今天页就会建对话，没发过消息的不算记录 */
  async list(limit = 20): Promise<Conversation[]> {
    const rows = await this.db.all<ConvRow & LinkRow>('SELECT c.*, tl.skill_id, tl.document_id, tl.trigger FROM conversations c LEFT JOIN thread_links tl ON tl.conversation_id = c.id WHERE c.deleted_at IS NULL AND c.last_message_at IS NOT NULL AND c.kind != ? ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT ?', ['skill', limit]);
    return rows.map(r => toConversation(r, r));
  }

  async rename(id: string, title: string): Promise<Conversation> {
    const t = now();
    const r = await this.db.run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [title, t, id]);
    if (!r.changes) throw new TibiError('not_found', '找不到这个对话');
    await this.db.run('UPDATE thread_links SET title = ?, updated_at = ? WHERE conversation_id = ?', [title, t, id]);
    return (await this.get(id))!;
  }

  /** 硬删：对话、消息、thread_links、引擎缓存，以及 skill_audit 里引用它的 args / undo_payload（01 §9） */
  async delete(id: string): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.run('DELETE FROM messages WHERE conversation_id = ?', [id]);
      await tx.run('DELETE FROM thread_links WHERE conversation_id = ?', [id]);
      await tx.run('DELETE FROM engine_sessions WHERE conversation_id = ?', [id]);
      await tx.run("UPDATE skill_audit SET args = '{}', undo_payload = NULL WHERE args LIKE ? OR undo_payload LIKE ?", [`%${id}%`, `%${id}%`]);
      await tx.run("UPDATE memories SET source_ref = NULL WHERE source_ref = ?", [`conversation:${id}`]);
      const r = await tx.run('DELETE FROM conversations WHERE id = ?', [id]);
      if (!r.changes) throw new TibiError('not_found', '找不到这个对话');
    });
  }

  // ---------- 写 ----------

  private async insert(conversation_id: string, role: StoredMessage['role'], body: unknown, ui: object, turn_id?: string | null, engine?: string, id: string = uuidv7()): Promise<{ id: string; created_at: number }> {
    const t = now();
    await this.db.transaction(async tx => {
      await tx.run('INSERT INTO messages(id, conversation_id, turn_id, role, engine, body, ui, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, conversation_id, turn_id ?? null, role, engine ?? null, j.str(body), j.str(ui), t, t]);
      const conv = await tx.get<{ title: string }>('SELECT title FROM conversations WHERE id = ?', [conversation_id]);
      const said = role === 'user' ? userText(body) : '';
      const title = conv && !conv.title && said ? said.slice(0, 40) : null;
      await tx.run('UPDATE conversations SET last_message_at = ?, updated_at = ?, title = COALESCE(?, title) WHERE id = ?', [t, t, title, conversation_id]);
      if (title) await tx.run('UPDATE thread_links SET title = ? WHERE conversation_id = ?', [title, conversation_id]);
    });
    return { id, created_at: t };
  }

  /**
   * 用户说的话：原话，加上提问时的附件（给模型的文字 + 界面上的标签）。
   * 给 skill 时开新的一轮（turn_id = 这条的 id，状态 running）；给 turn_id 时是回答中补充的一句
   */
  async addUser(conversation_id: string, text: string, o: { attachment?: { text: string; label: string } } & ({ skill: SkillId; tainted?: boolean } | { turn_id: string })): Promise<Message> {
    const content: TextPart[] = [{ type: 'text', text }];
    if (o.attachment) content.push({ type: 'text', text: `<attachment>${o.attachment.text}</attachment>` });
    const body = { role: 'user', content, timestamp: now() };
    const id = uuidv7();
    const turn_id = 'turn_id' in o ? o.turn_id : id;
    const ui: UserUi = { ...(o.attachment ? { attachment: o.attachment.label } : {}), ...('skill' in o ? { turn: { skill: o.skill, state: 'running' as const, ...(o.tainted ? { tainted: true } : {}) } } : {}) };
    const r = await this.insert(conversation_id, 'user', body, ui, turn_id, undefined, id);
    return { id, role: 'user', text, ...(ui.attachment ? { attachment: ui.attachment } : {}), turn_id, created_at: r.created_at };
  }

  /** 引擎定稿的一条消息（助手消息、工具结果、压缩记录） */
  async addEngineMessage(conversation_id: string, turn_id: string, role: 'assistant' | 'tool_result' | 'compaction', body: unknown, ui: object = {}, engine = 'pi'): Promise<string> {
    return (await this.insert(conversation_id, role, body, ui, turn_id, engine)).id;
  }

  /** 这一轮的结果（第一句用户消息上的 ui.turn） */
  async turn(turn_id: string): Promise<(TurnInfo & { conversation_id: string }) | undefined> {
    const r = await this.db.get<{ ui: string; conversation_id: string }>("SELECT ui, conversation_id FROM messages WHERE id = ? AND role = 'user' AND deleted_at IS NULL", [turn_id]);
    const t = r ? j.parse<UserUi>(r.ui, {}).turn : undefined;
    return t && r ? { ...t, conversation_id: r.conversation_id } : undefined;
  }

  async setTurn(turn_id: string, patch: Partial<TurnInfo>): Promise<void> {
    await this.db.transaction(async tx => {
      const r = await tx.get<{ ui: string }>("SELECT ui FROM messages WHERE id = ? AND role = 'user'", [turn_id]);
      const ui = r ? j.parse<UserUi>(r.ui, {}) : undefined;
      if (!ui?.turn) return;
      const turn: TurnInfo = { ...ui.turn, ...patch };
      if (patch.state && patch.state !== 'error') delete turn.error;
      await tx.run('UPDATE messages SET ui = ?, updated_at = ? WHERE id = ?', [j.str({ ...ui, turn }), now(), turn_id]);
    });
  }

  /** 应用上次退出时还没答完的回答：记成中断，界面显示"重试" */
  async interruptRunning(): Promise<number> {
    const rows = await this.db.all<{ id: string }>("SELECT id FROM messages WHERE role = 'user' AND deleted_at IS NULL AND ui LIKE '%\"state\":\"running\"%'");
    for (const r of rows) await this.setTurn(r.id, { state: 'error', error: '上次没有回答完就中断了' });
    return rows.length;
  }

  /** 对话之外、模型该知道的事（撤销等）：进模型上下文，界面不显示成气泡 */
  async addNote(conversation_id: string, text: string): Promise<{ id: string; text: string }> {
    const r = await this.insert(conversation_id, 'note', { customType: 'tibi.note', content: text }, {});
    return { id: r.id, text };
  }

  /** 对话里还留着读过不可信内容的回答吗：历史都会带给模型。回退作废的消息不算 */
  async tainted(conversation_id: string): Promise<boolean> {
    return !!await this.db.get("SELECT 1 AS hit FROM messages WHERE conversation_id = ? AND role = 'user' AND deleted_at IS NULL AND ui LIKE '%\"tainted\":true%' LIMIT 1", [conversation_id]);
  }

  /** 重试这一轮时，上次没说完的回答作废（用户那句留着） */
  async dropAnswer(conversation_id: string, turn_id: string): Promise<void> {
    const t = now();
    await this.db.run("UPDATE messages SET deleted_at = ?, updated_at = ? WHERE conversation_id = ? AND turn_id = ? AND role != 'user' AND deleted_at IS NULL", [t, t, conversation_id, turn_id]);
  }

  /** 回到这句话之前：这条和它之后的消息作废（已写入的词不动）；之后的压缩记录一起作废 */
  async rewind(conversation_id: string, message_id: string): Promise<{ text: string; skill?: SkillId }> {
    const m = await this.db.get<{ body: string; turn_id: string | null; created_at: number; role: string }>('SELECT body, turn_id, created_at, role FROM messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL', [message_id, conversation_id]);
    if (!m || m.role !== 'user') throw new TibiError('not_found', '找不到这句话');
    const skill = m.turn_id ? (await this.turn(m.turn_id))?.skill : undefined;
    const t = now();
    await this.db.run('UPDATE messages SET deleted_at = ?, updated_at = ? WHERE conversation_id = ? AND deleted_at IS NULL AND (created_at > ? OR (created_at = ? AND id >= ?))', [t, t, conversation_id, m.created_at, m.created_at, message_id]);
    // 摘要里写进了被删的内容：保留原文起点在被删范围之后的压缩记录不存在，起点在之前的也要作废
    await this.db.run("UPDATE messages SET deleted_at = ?, updated_at = ? WHERE conversation_id = ? AND role = 'compaction' AND deleted_at IS NULL", [t, t, conversation_id]);
    return { text: userText(j.parse(m.body, {})), ...(skill ? { skill } : {}) };
  }

  /** 用户撤销了 Tibi 的一次写入：记在回执上，再写一条 note 让模型知道 */
  async markUndone(message_id: string, undo_id: string): Promise<{ conversation_id: string; note?: { id: string; text: string } }> {
    const conv = await this.db.get<{ conversation_id: string; turn_id: string | null }>('SELECT conversation_id, turn_id FROM messages WHERE id = ? AND deleted_at IS NULL', [message_id]);
    if (!conv) throw new TibiError('not_found', '找不到这条消息');
    const row = await this.findUi(conv.conversation_id, conv.turn_id, ui => (ui as ToolResultUi).receipt?.undo?.undo_id === undo_id);
    if (!row) throw new TibiError('not_found', '找不到这次写入');
    const ui = row.ui as ToolResultUi;
    if (ui.receipt!.undone) return { conversation_id: conv.conversation_id };
    ui.receipt!.undone = true;
    await this.db.run('UPDATE messages SET ui = ?, updated_at = ? WHERE id = ?', [j.str(ui), now(), row.id]);
    const note = await this.addNote(conv.conversation_id, `用户撤销了：${ui.receipt!.summary}`);
    return { conversation_id: conv.conversation_id, note };
  }

  /** 进行中的回答和等确认的审批：离开再回来时接上 */
  activity(conversation_id: string, turns: Turns): { active: string[]; approvals: Approval[]; live: { id: string; blocks: MessageBlock[]; steps: MessageStep[]; thinking?: string }[] } {
    const active = turns.activeIn(conversation_id);
    return {
      active,
      approvals: turns.approvals(conversation_id),
      live: active.flatMap(id => { const l = liveAnswers.get(id); return l ? [{ id, ...l() }] : []; }),
    };
  }

  /** 卡片上的操作结果：重开对话能恢复；结果文字也让模型知道 */
  async updateWidget(message_id: string, widget_id: string, state: unknown, result?: string): Promise<void> {
    const conv = await this.db.get<{ conversation_id: string; turn_id: string | null }>('SELECT conversation_id, turn_id FROM messages WHERE id = ? AND deleted_at IS NULL', [message_id]);
    if (!conv) throw new TibiError('not_found', '找不到这条消息');
    const row = await this.findWidget(conv.conversation_id, conv.turn_id, widget_id);
    const block = (row.ui as ToolResultUi).widget!;
    if (block.kind === 'ask') throw new TibiError('conflict', '反问卡要用 chat.answer 回答');
    const wasDone = quizDone(block);
    block.state = state; if (result) block.result = result; else delete block.result;
    await this.db.transaction(async tx => {
      await tx.run('UPDATE messages SET ui = ?, updated_at = ? WHERE id = ?', [j.str(row.ui), now(), row.id]);
      // 练习做完记一条学习事件（做错的词给整理记忆用）；再做一遍算新的一次
      const done = quizDone(block);
      if (done && !wasDone) await tx.run('INSERT INTO learning_events(id, type, payload, consolidated, created_at) VALUES (?,?,?,0,?)', [uuidv7(), 'quiz_done', j.str(done), now()]);
    });
  }

  /** 已经写库的卡片（含子技能显示在这里的）改状态；还没写库时什么都不做，返回 false */
  async patchWidget(conversation_id: string, widget_id: string, state: unknown, result?: string): Promise<boolean> {
    const row = await this.findUi(conversation_id, null, ui => [(ui as ToolResultUi).widget, ...((ui as ToolResultUi).widgets ?? [])].some(w => w?.id === widget_id));
    if (!row) return false;
    const ui = row.ui as ToolResultUi;
    for (const w of [ui.widget, ...(ui.widgets ?? [])]) if (w?.id === widget_id) { w.state = state; if (result) w.result = result; }
    await this.db.run('UPDATE messages SET ui = ?, updated_at = ? WHERE id = ?', [j.str(ui), now(), row.id]);
    return true;
  }

  private async findWidget(conversation_id: string, turn_id: string | null, widget_id: string, db: Database = this.db) {
    const row = await this.findUi(conversation_id, turn_id, ui => (ui as ToolResultUi).widget?.id === widget_id, db);
    if (!row) throw new TibiError('not_found', '找不到这张卡片');
    return row;
  }

  /** 在同一轮（没有 turn_id 时在整段对话）的工具结果里找 ui */
  private async findUi(conversation_id: string, turn_id: string | null, match: (ui: unknown) => boolean, db: Database = this.db): Promise<{ id: string; turn_id: string | null; ui: Record<string, unknown> } | undefined> {
    const rows = turn_id
      ? await db.all<{ id: string; turn_id: string | null; ui: string }>("SELECT id, turn_id, ui FROM messages WHERE conversation_id = ? AND turn_id = ? AND role = 'tool_result' AND deleted_at IS NULL", [conversation_id, turn_id])
      : await db.all<{ id: string; turn_id: string | null; ui: string }>("SELECT id, turn_id, ui FROM messages WHERE conversation_id = ? AND role = 'tool_result' AND deleted_at IS NULL", [conversation_id]);
    for (const r of rows) { const ui = j.parse<Record<string, unknown>>(r.ui, {}); if (match(ui)) return { id: r.id, turn_id: r.turn_id, ui }; }
    return undefined;
  }

  // ---------- 读 ----------

  /** 界面看的历史：按 turn_id 合成回答气泡；进行中的回答不在这里（走 activity().live） */
  async history(conversation_id: string, opts: { cursor?: string; limit?: number } = {}): Promise<{ items: Message[]; total: number; cursor?: string }> {
    const limit = opts.limit ?? 50;
    const rows = await this.db.all<MsgRow>("SELECT rowid, id, role, body, ui, turn_id, created_at FROM messages WHERE conversation_id = ? AND deleted_at IS NULL AND role IN ('user', 'assistant', 'tool_result') ORDER BY created_at, rowid", [conversation_id]);
    const turns = new Map<string, TurnInfo>();
    for (const r of rows) if (r.role === 'user') { const t = j.parse<UserUi>(r.ui, {}).turn; if (t) turns.set(r.id, t); }
    const all = project(rows, turns);
    // 游标带 id：同一毫秒写入的消息不会被跳过
    const [at, id] = (opts.cursor ?? '').split('_');
    const end = at ? all.findIndex(m => m.created_at > Number(at) || (m.created_at === Number(at) && m.id >= (id ?? ''))) : all.length;
    const upto = end < 0 ? all.length : end;
    const page = all.slice(Math.max(0, upto - limit), upto);
    return { items: page, total: all.length, cursor: upto - limit > 0 ? `${page[0]!.created_at}_${page[0]!.id}` : undefined };
  }

  /**
   * 给引擎重建会话的记录（10 §5.2、§5.3）：只取最近一次有效的压缩记录和它保留的原文之后的部分。
   * 压缩覆盖的范围里有消息被删、或同步进了更早的消息（rowid 比压缩记录大），这次压缩作废。
   */
  async engineHistory(conversation_id: string, opts: { before?: string } = {}): Promise<StoredMessage[]> {
    let rows = await this.db.all<MsgRow>('SELECT rowid, id, role, body, ui, turn_id, created_at FROM messages WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid', [conversation_id]);
    if (opts.before) { const i = rows.findIndex(r => r.id === opts.before); if (i >= 0) rows = rows.slice(0, i); }
    const compactions = rows.filter(r => r.role === 'compaction').reverse();
    let start = 0; let keep: MsgRow | undefined;
    for (const c of compactions) {
      const body = j.parse<CompactionBody>(c.body, { summary: '', first_kept_id: '', tokens_before: 0 });
      const k = rows.findIndex(r => r.id === body.first_kept_id);
      const late = k >= 0 && rows.slice(0, k).some(r => r.role !== 'compaction' && r.rowid > c.rowid);
      if (k >= 0 && !late) { start = k; keep = c; break; }
      await this.db.run('UPDATE messages SET deleted_at = ?, updated_at = ? WHERE id = ?', [now(), now(), c.id]);
    }
    const out = rows.slice(start).filter(r => r.role !== 'compaction' || r === keep);
    return out.map(r => ({ id: r.id, role: r.role as StoredMessage['role'], body: j.parse(r.body, {}), created_at: r.created_at }));
  }

  /** 库里最后一条消息（before 这条之前）：引擎据此判断常驻会话是否过期 */
  async lastMessageId(conversation_id: string, before?: string): Promise<string | undefined> {
    const rows = await this.db.all<{ id: string }>('SELECT id FROM messages WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 2', [conversation_id]);
    return before && rows[0]?.id === before ? rows[1]?.id : rows[0]?.id;
  }

  /**
   * 这一轮用户说的话在库里的样子（重试时从库里取）：第一句加上回答中补充的几句，按顺序拼成一条，
   * 重新回答时补充的条件不会丢。id 是第一句的
   */
  async userInput(conversation_id: string, turn_id: string): Promise<{ id: string; content: TextPart[] } | undefined> {
    const rows = await this.db.all<{ id: string; body: string }>("SELECT id, body FROM messages WHERE conversation_id = ? AND turn_id = ? AND role = 'user' AND deleted_at IS NULL ORDER BY created_at, rowid", [conversation_id, turn_id]);
    if (!rows.length) return undefined;
    const parts = (r: { body: string }): TextPart[] => { const body = j.parse<{ content?: string | TextPart[] }>(r.body, {}); return typeof body.content === 'string' ? [{ type: 'text', text: body.content }] : (body.content ?? []); };
    return { id: rows[0]!.id, content: rows.flatMap((r, i) => (i === 0 ? parts(r) : [{ type: 'text' as const, text: '（回答中补充）' }, ...parts(r)])) };
  }
}

/** 行 → 界面的 Message：用户一条一句；一次运行的助手消息和工具结果合成一个回答 */
function project(rows: MsgRow[], turns: Map<string, TurnInfo>): Message[] {
  const out: Message[] = [];
  const answered = new Set<string>();
  let cur: (Message & { blocks: MessageBlock[]; steps: MessageStep[]; receipts: MessageReceipt[]; thinking?: string; think_ms?: number; /** 最后一个工具结果之后从 blocks 第几个起 */ cut: number }) | undefined;
  const flush = () => {
    if (!cur) return;
    const turn = cur.turn_id ? turns.get(cur.turn_id) : undefined;
    const interrupted = turn ? interruptedOf(turn) : undefined;
    const widgets = cur.blocks.some(b => b.type === 'widget');
    const text = cur.blocks.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join('\n\n');
    // 最后一次调工具之后说的话才是正文；前面"我先查一下"这类过渡话不算。最后没说话（停在工具上）就用全部
    const reply = cur.blocks.slice(cur.cut).filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join('\n\n');
    const skill = turn && turn.skill !== 'tibi' ? skillDef(turn.skill)?.title : undefined;
    out.push({
      id: cur.id, role: 'assistant', text, ...(reply && reply !== text ? { reply } : {}), ...(widgets ? { blocks: cur.blocks } : {}), turn_id: cur.turn_id, created_at: cur.created_at,
      ...(cur.steps.length ? { steps: cur.steps } : {}), ...(cur.receipts.length ? { receipts: cur.receipts } : {}),
      ...(skill ? { skill } : {}), ...(interrupted ? { interrupted } : {}), ...(cur.thinking ? { thinking: cur.thinking, ...(cur.think_ms !== undefined ? { think_ms: cur.think_ms } : {}) } : {}),
    });
    if (cur.turn_id) answered.add(cur.turn_id);
    cur = undefined;
  };
  for (const r of rows) {
    const turn = r.turn_id ? turns.get(r.turn_id) : undefined;
    if (turn?.state === 'running' && r.role !== 'user') continue;
    if (r.role === 'user') {
      flush();
      const ui = j.parse<UserUi>(r.ui, {});
      out.push({ id: r.id, role: 'user', text: userText(j.parse(r.body, {})), ...(ui.attachment ? { attachment: ui.attachment } : {}), turn_id: r.turn_id ?? undefined, created_at: r.created_at });
      continue;
    }
    if (cur && cur.turn_id !== (r.turn_id ?? undefined)) flush();
    cur ??= { id: r.id, role: 'assistant', turn_id: r.turn_id ?? undefined, created_at: r.created_at, blocks: [], steps: [], receipts: [], cut: 0 };
    if (r.role === 'assistant') {
      const body = j.parse<AssistantBody>(r.body, { role: 'assistant', content: [] });
      const t = j.parse<{ think_ms?: number }>(r.ui, {}).think_ms;
      if (typeof t === 'number') cur.think_ms = (cur.think_ms ?? 0) + t;
      for (const c of body.content ?? []) {
        if (c.type === 'text' && c.text) cur.blocks.push({ type: 'text', text: c.text });
        else if (c.type === 'thinking' && c.thinking && !c.redacted) cur.thinking = cur.thinking ? `${cur.thinking}\n\n${c.thinking}` : c.thinking;
      }
    } else {
      const ui = j.parse<ToolResultUi>(r.ui, {});
      // 记录里的反问都结束了：没答的（旧版本、中断）不能再点
      for (const w of [...(ui.widgets ?? []), ...(ui.widget ? [ui.widget] : [])]) cur.blocks.push(w.kind === 'ask' && !(w.state as AskState | undefined)?.answered ? { ...w, state: { expired: true } satisfies AskState } : w);
      if (ui.step) cur.steps.push(ui.step);
      if (ui.receipt) cur.receipts.push(ui.receipt);
      cur.cut = cur.blocks.length;
    }
  }
  flush();
  // 什么都没说就失败了：错误也留在对话里，放在那句话后面
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]!;
    if (m.role !== 'user' || !m.turn_id || answered.has(m.turn_id)) continue;
    const turn = turns.get(m.turn_id);
    const interrupted = turn ? interruptedOf(turn) : undefined;
    if (interrupted && interrupted.reason === 'error') out.splice(i + 1, 0, { id: `${m.id}_err`, role: 'assistant', text: '', turn_id: m.turn_id, interrupted, created_at: m.created_at });
  }
  return out;
}

function interruptedOf(turn: TurnInfo): MessageInterrupted | undefined {
  if (turn.state === 'cancel') return { reason: 'cancel' };
  if (turn.state === 'error') return { reason: 'error', ...(turn.error ? { message: turn.error } : {}) };
  return undefined;
}

/** 用户消息的原话（不含附件） */
function userText(body: unknown): string {
  const c = (body as { content?: unknown } | null)?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) { const first = c.find(x => (x as TextPart).type === 'text') as TextPart | undefined; return first?.text ?? ''; }
  return '';
}

function quizDone(b: MessageBlock): { total: number; correct: number; wrong: string[] } | undefined {
  if (b.type !== 'widget' || b.kind !== 'quiz') return undefined;
  const picks = (b.state as { picks?: string[] } | undefined)?.picks ?? [];
  const items = b.data.items;
  if (!items.length || picks.length < items.length) return undefined;
  const norm = (s: string) => s.trim().toLowerCase();
  const wrong = items.filter((q, i) => !q.answer.map(norm).includes(norm(picks[i] ?? ''))).map(q => q.term);
  return { total: items.length, correct: items.length - wrong.length, wrong };
}

export function askResultText(picked: AskOption[], text?: string): string {
  return [picked.length ? `用户选了：${picked.map(o => o.label).join('、')}` : '', text ? `用户说：${text}` : ''].filter(Boolean).join('；');
}

function toConversation(r: ConvRow, link?: LinkRow | null): Conversation {
  return {
    id: r.id, kind: r.kind as Conversation['kind'], day: r.day ?? undefined, device: r.device as 'desktop' | 'mobile',
    skill_id: (link?.skill_id ?? 'tibi') as SkillId, title: r.title, document_id: link?.document_id ?? undefined,
    trigger: (link?.trigger ?? 'user') as Conversation['trigger'], created_at: r.created_at, updated_at: r.updated_at,
  };
}
