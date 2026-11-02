import { j, now, type Database } from '../db/driver.js';
import { uuidv7 } from '../ids.js';
import { TibiError, type Conversation, type Message, type MessageBlock, type SkillId } from '../types.js';

/** 对话与消息（01 §7 conversations / messages / thread_links）：先写库再显示 */

interface ConvRow extends Record<string, string | number | null> { id: string; kind: string; day: string | null; device: string; title: string; summary: string | null; last_message_at: number | null; created_at: number; updated_at: number }
interface LinkRow extends Record<string, string | number | null> { skill_id: string; document_id: string | null; trigger: string }
interface MsgRow extends Record<string, string | number | null> { id: string; role: string; content: string; job_id: string | null; created_at: number }

export interface MessageContent { text?: string; blocks?: MessageBlock[]; tool?: { name: string; args: unknown; result?: unknown; duration_ms?: number } }

export function localDay(t: number = now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

  /** 卡片上的操作结果：重开对话能恢复，下一轮也带给模型 */
  async updateWidget(message_id: string, widget_id: string, state: unknown, result?: string): Promise<void> {
    await this.db.transaction(async tx => {
      const row = await tx.get<{ content: string }>('SELECT content FROM messages WHERE id = ? AND deleted_at IS NULL', [message_id]);
      if (!row) throw new TibiError('not_found', '找不到这条消息');
      const c = j.parse<MessageContent>(row.content, {});
      const block = c.blocks?.find(b => b.type === 'widget' && b.id === widget_id);
      if (!block || block.type !== 'widget') throw new TibiError('not_found', '找不到这张卡片');
      block.state = state; if (result) block.result = result; else delete block.result;
      await tx.run('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?', [j.str(c), now(), message_id]);
    });
  }

  async history(conversation_id: string, opts: { cursor?: string; limit?: number } = {}): Promise<{ items: Message[]; total: number; cursor?: string }> {
    const limit = opts.limit ?? 50;
    const before = opts.cursor ? Number(opts.cursor) : Number.MAX_SAFE_INTEGER;
    const rows = await this.db.all<MsgRow>('SELECT id, role, content, job_id, created_at FROM messages WHERE conversation_id = ? AND deleted_at IS NULL AND created_at < ? ORDER BY created_at DESC LIMIT ?', [conversation_id, before, limit + 1]);
    const total = await this.db.get<{ n: number }>('SELECT count(*) AS n FROM messages WHERE conversation_id = ? AND deleted_at IS NULL', [conversation_id]);
    const page = rows.slice(0, limit).reverse();
    return { items: page.map(toMessage), total: Number(total?.n ?? 0), cursor: rows.length > limit ? String(page[0]!.created_at) : undefined };
  }

  /** 最近 N 条（给模型的会话历史） */
  async recent(conversation_id: string, limit = 20): Promise<Message[]> {
    const rows = await this.db.all<MsgRow>('SELECT id, role, content, job_id, created_at FROM messages WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?', [conversation_id, limit]);
    return rows.reverse().map(toMessage);
  }
}

/** 给模型的历史：卡片换成一句摘要，否则用户追问卡片内容时模型接不上 */
export function messageForModel(m: Message): string {
  if (!m.blocks?.length) return m.text ?? '';
  return m.blocks.map(b => b.type === 'text' ? b.text : `[界面上显示了卡片：${b.summary}${b.result ? `；用户操作：${b.result}` : ''}]`).join('\n\n');
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
  return { id: r.id, role: r.role as Message['role'], text: c.text, blocks: c.blocks, tool: c.tool, task_id: r.job_id ?? undefined, created_at: r.created_at };
}
