import { j, now, type Database } from '../db/driver.js';
import { uuidv7 } from '../ids.js';
import { TibiError, type Approval, type AskData, type AskOption, type AskResult, type AskState, type Conversation, type Message, type MessageBlock, type MessageInterrupted, type MessageReceipt, type MessageStep, type SkillId } from '../types.js';

/** 对话与消息（01 §7 conversations / messages / thread_links）：先写库再显示 */

interface ConvRow extends Record<string, string | number | null> { id: string; kind: string; day: string | null; device: string; title: string; summary: string | null; last_message_at: number | null; created_at: number; updated_at: number }
interface LinkRow extends Record<string, string | number | null> { skill_id: string; document_id: string | null; trigger: string }
interface MsgRow extends Record<string, string | number | null> { id: string; role: string; content: string; job_id: string | null; created_at: number }

export interface MessageContent { text?: string; blocks?: MessageBlock[]; tool?: { name: string; args: unknown; result?: unknown; duration_ms?: number }; interrupted?: MessageInterrupted; steps?: MessageStep[]; skill?: string; receipts?: MessageReceipt[] }

export function localDay(t: number = now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 正在生成的回答（进程内）：离开再回来时接上已经说出来的部分 */
export const liveAnswers = new Map<string, () => { blocks: MessageBlock[]; steps: MessageStep[] }>();

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

  /** 硬删：对话、消息、thread_links，以及 skill_audit 里引用它的 args / undo_payload（01 §9） */
  async delete(id: string): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.run('DELETE FROM messages WHERE conversation_id = ?', [id]);
      await tx.run('DELETE FROM thread_links WHERE conversation_id = ?', [id]);
      await tx.run("UPDATE skill_audit SET args = '{}', undo_payload = NULL WHERE args LIKE ? OR undo_payload LIKE ?", [`%${id}%`, `%${id}%`]);
      await tx.run("UPDATE memories SET source_ref = NULL WHERE source_ref = ?", [`conversation:${id}`]);
      const r = await tx.run('DELETE FROM conversations WHERE id = ?', [id]);
      if (!r.changes) throw new TibiError('not_found', '找不到这个对话');
    });
  }

  async addMessage(conversation_id: string, role: 'user' | 'assistant' | 'tool', content: MessageContent, job_id?: string): Promise<Message> {
    const id = uuidv7(); const t = now();
    await this.db.transaction(async tx => {
      await tx.run('INSERT INTO messages(id, conversation_id, role, content, job_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', [id, conversation_id, role, j.str(content), job_id ?? null, t, t]);
      const conv = await tx.get<{ title: string }>('SELECT title FROM conversations WHERE id = ?', [conversation_id]);
      const title = conv && !conv.title && role === 'user' && content.text ? content.text.slice(0, 40) : null;
      await tx.run('UPDATE conversations SET last_message_at = ?, updated_at = ?, title = COALESCE(?, title) WHERE id = ?', [t, t, title, conversation_id]);
      if (title) await tx.run('UPDATE thread_links SET title = ? WHERE conversation_id = ?', [title, conversation_id]);
    });
    return { id, role, ...content, task_id: job_id, created_at: t };
  }

  /** 同一任务重试或恢复时，上次没说完的回答作废 */
  async dropAnswer(conversation_id: string, job_id: string): Promise<void> {
    const t = now();
    await this.db.run("UPDATE messages SET deleted_at = ?, updated_at = ? WHERE conversation_id = ? AND job_id = ? AND role = 'assistant' AND deleted_at IS NULL", [t, t, conversation_id, job_id]);
  }

  /** 回到这句话之前：这条和它之后的消息作废（已写入的词不动）。摘要里如果含被删的内容就重新来 */
  async rewind(conversation_id: string, message_id: string): Promise<{ text: string; job_id: string | null }> {
    const m = await this.db.get<{ content: string; job_id: string | null; created_at: number; role: string }>('SELECT content, job_id, created_at, role FROM messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL', [message_id, conversation_id]);
    if (!m || m.role !== 'user') throw new TibiError('not_found', '找不到这句话');
    const t = now();
    await this.db.run('UPDATE messages SET deleted_at = ?, updated_at = ? WHERE conversation_id = ? AND deleted_at IS NULL AND (created_at > ? OR (created_at = ? AND id >= ?))', [t, t, conversation_id, m.created_at, m.created_at, message_id]);
    const s = await this.summary(conversation_id);
    if (s && s.upto >= m.created_at) await this.db.run('UPDATE conversations SET summary = NULL WHERE id = ?', [conversation_id]);
    return { text: j.parse<MessageContent>(m.content, {}).text ?? '', job_id: m.job_id };
  }

  /** 用户撤销了 Tibi 的一次写入：记下来，重开不再显示按钮，下一轮模型也知道 */
  async markUndone(message_id: string, undo_id: string): Promise<void> {
    await this.db.transaction(async tx => {
      const row = await tx.get<{ content: string }>('SELECT content FROM messages WHERE id = ? AND deleted_at IS NULL', [message_id]);
      if (!row) throw new TibiError('not_found', '找不到这条消息');
      const c = j.parse<MessageContent>(row.content, {});
      for (const r of c.receipts ?? []) if (r.undo?.undo_id === undo_id) r.undone = true;
      await tx.run('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?', [j.str(c), now(), message_id]);
    });
  }

  /** 进行中的任务和等确认的审批：离开再回来时接上 */
  async activity(conversation_id: string): Promise<{ active: string[]; approvals: Approval[]; live: { id: string; blocks: MessageBlock[]; steps: MessageStep[] }[] }> {
    const active = await this.db.all<{ id: string }>("SELECT id FROM jobs WHERE conversation_id = ? AND status IN ('queued', 'running', 'waiting_approval') AND deleted_at IS NULL ORDER BY created_at", [conversation_id]);
    const rows = await this.db.all<{ approval: string }>("SELECT j.approval FROM jobs j LEFT JOIN jobs p ON p.id = j.parent_job_id WHERE j.status = 'waiting_approval' AND j.approval IS NOT NULL AND j.deleted_at IS NULL AND COALESCE(j.conversation_id, p.conversation_id) = ? ORDER BY j.updated_at", [conversation_id]);
    return {
      active: active.map(r => r.id),
      approvals: rows.map(r => j.parse<Approval | null>(r.approval, null)).filter((a): a is Approval => !!a && !('decision' in a)),
      live: active.flatMap(r => { const l = liveAnswers.get(r.id); return l ? [{ id: r.id, ...l() }] : []; }),
    };
  }

  /** 卡片上的操作结果：重开对话能恢复，下一轮也带给模型 */
  async updateWidget(message_id: string, widget_id: string, state: unknown, result?: string): Promise<void> {
    await this.db.transaction(async tx => {
      const row = await tx.get<{ content: string }>('SELECT content FROM messages WHERE id = ? AND deleted_at IS NULL', [message_id]);
      if (!row) throw new TibiError('not_found', '找不到这条消息');
      const c = j.parse<MessageContent>(row.content, {});
      const block = c.blocks?.find(b => b.type === 'widget' && b.id === widget_id);
      if (!block || block.type !== 'widget') throw new TibiError('not_found', '找不到这张卡片');
      if (block.kind === 'ask') throw new TibiError('conflict', '反问卡要用 chat.answer 回答');
      const wasDone = quizDone(block);
      block.state = state; if (result) block.result = result; else delete block.result;
      await tx.run('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?', [j.str(c), now(), message_id]);
      // 练习做完记一条学习事件（做错的词给整理记忆用）；再做一遍算新的一次
      const done = quizDone(block);
      if (done && !wasDone) await tx.run('INSERT INTO learning_events(id, type, payload, consolidated, created_at) VALUES (?,?,?,0,?)', [uuidv7(), 'quiz_done', j.str(done), now()]);
    });
  }

  /** 认领一次回答：校验选项并标记已答，一张卡只能答一次（两边同时点、连点都走这里） */
  async claimAsk(message_id: string, widget_id: string, option_ids: string[], text?: string): Promise<{ conversation_id: string; job_id: string | null; data: AskData; picked: AskOption[]; state: AskState }> {
    let out!: { conversation_id: string; job_id: string | null; data: AskData; picked: AskOption[]; state: AskState };
    await this.db.transaction(async tx => {
      const row = await tx.get<{ conversation_id: string; job_id: string | null; content: string }>('SELECT conversation_id, job_id, content FROM messages WHERE id = ? AND deleted_at IS NULL', [message_id]);
      if (!row) throw new TibiError('not_found', '找不到这条消息');
      const c = j.parse<MessageContent>(row.content, {});
      const block = c.blocks?.find(b => b.type === 'widget' && b.id === widget_id);
      if (!block || block.type !== 'widget' || block.kind !== 'ask') throw new TibiError('not_found', '找不到这张卡片');
      const state = (block.state ?? {}) as AskState;
      if (state.answered) throw new TibiError('conflict', '这个问题已经答过了');
      if (state.expired) throw new TibiError('conflict', '这个问题已经过期了');
      const picked = block.data.options.filter(o => option_ids.includes(o.id));
      if (picked.length !== new Set(option_ids).size) throw new TibiError('invalid_params', '没有这个选项');
      if (!picked.length && !text) throw new TibiError('invalid_params', '选一项或者写一句');
      if (picked.length > 1 && !block.data.multi) throw new TibiError('invalid_params', '这个问题只能选一项');
      const claimed: AskState = { answered: { option_ids, ...(text ? { text } : {}), at: now() } };
      block.state = claimed;
      block.result = askResultText(picked, text);
      await tx.run('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?', [j.str(c), now(), message_id]);
      out = { conversation_id: row.conversation_id, job_id: row.job_id, data: block.data, picked, state: claimed };
    });
    return out;
  }

  /** 记下选项动作的执行结果：界面显示，下一轮也带给模型 */
  async finishAsk(message_id: string, widget_id: string, results: AskResult[]): Promise<AskState> {
    let state!: AskState;
    await this.db.transaction(async tx => {
      const row = await tx.get<{ content: string }>('SELECT content FROM messages WHERE id = ?', [message_id]);
      const c = j.parse<MessageContent>(row?.content, {});
      const block = c.blocks?.find(b => b.type === 'widget' && b.id === widget_id);
      if (!block || block.type !== 'widget' || block.kind !== 'ask') throw new TibiError('not_found', '找不到这张卡片');
      state = { ...(block.state as AskState), results };
      block.state = state;
      block.result = [block.result, ...results.map(r => `${r.ok ? '已' : '没有成功：'}${r.message}`)].filter(Boolean).join('；');
      await tx.run('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?', [j.str(c), now(), message_id]);
    });
    return state;
  }

  /** 用户没回答、接着说了别的：还开着的反问作废，不能再点 */
  async expireAsks(conversation_id: string): Promise<void> {
    await this.db.transaction(async tx => {
      const rows = await tx.all<{ id: string; content: string }>("SELECT id, content FROM messages WHERE conversation_id = ? AND role = 'assistant' AND deleted_at IS NULL AND content LIKE '%\"kind\":\"ask\"%' ORDER BY created_at DESC LIMIT 20", [conversation_id]);
      for (const row of rows) {
        const c = j.parse<MessageContent>(row.content, {});
        let changed = false;
        for (const b of c.blocks ?? []) {
          if (b.type !== 'widget' || b.kind !== 'ask') continue;
          const s = (b.state ?? {}) as AskState;
          if (s.answered || s.expired) continue;
          b.state = { expired: true } satisfies AskState; b.result = '用户没有回答，接着说了别的'; changed = true;
        }
        if (changed) await tx.run('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?', [j.str(c), now(), row.id]);
      }
    });
  }

  async history(conversation_id: string, opts: { cursor?: string; limit?: number } = {}): Promise<{ items: Message[]; total: number; cursor?: string }> {
    const limit = opts.limit ?? 50;
    // 游标带 id：同一毫秒写入的消息不会被跳过
    const [at, id] = (opts.cursor ?? '').split('_');
    const before = at ? Number(at) : Number.MAX_SAFE_INTEGER;
    const rows = await this.db.all<MsgRow>('SELECT id, role, content, job_id, created_at FROM messages WHERE conversation_id = ? AND deleted_at IS NULL AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?', [conversation_id, before, before, id ?? '', limit + 1]);
    const total = await this.db.get<{ n: number }>('SELECT count(*) AS n FROM messages WHERE conversation_id = ? AND deleted_at IS NULL', [conversation_id]);
    const page = rows.slice(0, limit).reverse();
    return { items: page.map(toMessage), total: Number(total?.n ?? 0), cursor: rows.length > limit ? `${page[0]!.created_at}_${page[0]!.id}` : undefined };
  }

  /** 旧内容的摘要（05 §6）：upto 之前的消息都已摘进去，原文仍在 messages */
  async summary(id: string): Promise<{ text: string; upto: number } | undefined> {
    const r = await this.db.get<{ summary: string | null }>('SELECT summary FROM conversations WHERE id = ?', [id]);
    return j.parse<{ text: string; upto: number } | undefined>(r?.summary, undefined);
  }
  async saveSummary(id: string, text: string, upto: number): Promise<void> {
    await this.db.run('UPDATE conversations SET summary = ?, updated_at = ? WHERE id = ?', [j.str({ text, upto }), now(), id]);
  }
  /** 还没摘进去的旧消息：摘要之后、before 之前 */
  async between(id: string, after: number, before: number): Promise<Message[]> {
    const rows = await this.db.all<MsgRow>('SELECT id, role, content, job_id, created_at FROM messages WHERE conversation_id = ? AND deleted_at IS NULL AND created_at > ? AND created_at < ? ORDER BY created_at, id', [id, after, before]);
    return rows.map(toMessage);
  }

  /** 最近 N 条（给模型的会话历史） */
  async recent(conversation_id: string, limit = 20): Promise<Message[]> {
    const rows = await this.db.all<MsgRow>('SELECT id, role, content, job_id, created_at FROM messages WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?', [conversation_id, limit]);
    return rows.reverse().map(toMessage);
  }
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

/** 给模型的历史：卡片换成一句摘要，否则用户追问卡片内容时模型接不上 */
export function messageForModel(m: Message): string {
  const text = m.blocks?.length ? m.blocks.map(b => b.type === 'text' ? b.text : `[界面上显示了卡片：${b.summary}${b.result ? `；用户操作：${b.result}` : ''}]`).join('\n\n') : m.text ?? '';
  const undone = m.receipts?.filter(r => r.undone).map(r => `[用户撤销了：${r.summary}]`) ?? [];
  return [text && m.interrupted ? `${text}\n\n[这段回答没有说完就中断了]` : text, ...undone].filter(Boolean).join('\n\n');
}

function toConversation(r: ConvRow, link?: LinkRow | null): Conversation {
  return {
    id: r.id, kind: r.kind as Conversation['kind'], day: r.day ?? undefined, device: r.device as 'desktop' | 'mobile',
    skill_id: (link?.skill_id ?? 'tibi') as SkillId, title: r.title, document_id: link?.document_id ?? undefined,
    trigger: (link?.trigger ?? 'user') as Conversation['trigger'], created_at: r.created_at, updated_at: r.updated_at,
  };
}
function toMessage(r: MsgRow): Message {
  const c = j.parse<MessageContent>(r.content, {});
  return { id: r.id, role: r.role as Message['role'], text: c.text, blocks: c.blocks, tool: c.tool, task_id: r.job_id ?? undefined, interrupted: c.interrupted, steps: c.steps, skill: c.skill, receipts: c.receipts, created_at: r.created_at };
}
