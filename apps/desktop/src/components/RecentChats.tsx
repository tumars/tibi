import type { Conversation } from '@tibi/core';
import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { tl } from '../lib/i18n';
import { fmtDate, isImeKey } from '../lib/util';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';
import { ObjectMenuButton, useObjectMenu } from './ObjectMenu';
import { Modal } from './Modal';

function chatLabel(c: Conversation): string {
  if (c.kind === 'document') return tl('讲解 · {title}', { title: c.title });
  // "今天"对话的默认标题就是日期；改过名就显示新名字
  if (c.kind === 'day' && c.day && c.title === c.day) return c.device === 'mobile' ? tl('{d} · 手机', { d: fmtDate(Date.parse(c.day)) }) : fmtDate(Date.parse(c.day));
  return c.title || tl('对话');
}

/** 左栏"最近"：只放对话。悬停出现"…"，或右键打开菜单：重命名（行内改）、删除（要确认，不可撤销） */
export function RecentChats() {
  const chats = useCore(s => s.recentChats);
  const loc = useLocation(); const nav = useNavigate();
  const [deleting, setDeleting] = useState<Conversation>();

  const remove = async () => {
    const c = deleting; if (!c) return;
    setDeleting(undefined);
    try {
      await rpc.call('chat.delete', { conversation_id: c.id });
      useCore.setState(s => ({ recentChats: s.recentChats.filter(x => x.id !== c.id) }));
      if (loc.pathname === `/chat/${c.id}`) nav('/');
      if (c.document_id) window.dispatchEvent(new CustomEvent('tibi:chat-deleted', { detail: c.document_id }));
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  return (
    <>
      {chats.length > 0 && <div className="sideh hide-c">{tl('最近')}</div>}
      <div className="recent hide-c">
        {chats.map(c => <RecentRow key={c.id} chat={c} onDelete={() => setDeleting(c)} />)}
      </div>
      <Modal open={!!deleting} onOpenChange={o => { if (!o) setDeleting(undefined); }} title={tl('删除这段对话？')}
        actions={<><button className="btn" onClick={() => setDeleting(undefined)}>{tl('取消')}</button><button className="btn pri" onClick={() => void remove()}>{tl('删除')}</button></>}>
        <p>{tl('「{title}」和里面的消息会被删除，无法恢复。', { title: deleting ? chatLabel(deleting) : '' })}</p>
      </Modal>
    </>
  );
}

function RecentRow({ chat, onDelete }: { chat: Conversation; onDelete: () => void }) {
  const location = useLocation();
  const [editing, setEditing] = useState(false);
  const label = chatLabel(chat);
  const menu = useObjectMenu<Conversation>(() => [
    { label: tl('重命名'), run: () => setEditing(true) },
    { label: tl('删除'), danger: true, run: onDelete },
  ], chat);
  useEffect(() => { menu.close(); }, [location.key, menu.close]);

  if (editing) return <RenameInput chat={chat} onDone={() => setEditing(false)} />;
  return (
    <div className={`rrow${menu.isOpen ? ' open' : ''}`} tabIndex={-1} onContextMenu={e => menu.open(chat, e)} onKeyDown={e => menu.onKeyDown(chat, e)}>
      <NavLink to={`/chat/${chat.id}`} title={label} className={({ isActive }) => (isActive ? 'cur' : '')}><span>{label}</span></NavLink>
      <ObjectMenuButton className="more" onClick={e => menu.open(chat, e)} />
      {menu.menu}
    </div>
  );
}

/** 回车或点别处保存，Esc 放弃；清空或没改就不保存 */
function RenameInput({ chat, onDone }: { chat: Conversation; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const title = input.current?.value.trim() ?? '';
    onDone();
    if (!save || !title || title === chat.title) return;
    rpc.call('chat.rename', { conversation_id: chat.id, title }).then(
      c => useCore.setState(s => ({ recentChats: s.recentChats.map(x => (x.id === c.id ? c : x)) })),
      e => toast(errorInfo(e).message, { kind: 'err' }),
    );
  };

  return <input ref={input} className="input rename" defaultValue={chat.title} maxLength={80} aria-label={tl('重命名')} onBlur={() => finish(true)}
    onKeyDown={e => { if (isImeKey(e.nativeEvent)) return; if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); }} />;
}
