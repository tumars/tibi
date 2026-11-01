import type { Document } from '@tibi/core';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChatThread, type Pending } from '../components/ChatThread';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

/**
 * 阅读器右侧"✦ Tibi"面板（00 §3.2）：每篇文章一个对话（chat.open({ document_id })），用"讲解"技能，
 * 带着正在读的文章、这一章、选中的句子发给 Tibi。选中文本或词卡上的"问 Tibi"会把问题作为 pending 发过来。
 */
export function TibiPanel({ doc, sectionId, pending, onClose }: { doc: Document; sectionId?: string; pending?: Pending; onClose: () => void }) {
  const [convId, setConvId] = useState<string>();
  useEffect(() => { rpc.call('chat.open', { document_id: doc.id }).then(c => setConvId(c.id), e => toast(errorInfo(e).message, { kind: 'err' })); }, [doc.id]);
  return (
    <aside className="rpanel tibi" aria-label="Tibi">
      <div className="rph"><b><span style={{ color: 'var(--accent)' }}>✦</span> {tl('Tibi · 讲解')}</b><span className="sp" /><button className="ibtn" title={tl('关闭')} onClick={onClose}><X size={16} /></button></div>
      {convId && <ChatThread conversationId={convId} skill="tutor" context={{ page: 'reader', document_id: doc.id, section_id: sectionId }} pending={pending}
        placeholder={tl('问这篇文章里的词、句子或语法…')} back={`/read/${doc.id}`}
        empty={<div className="tibi-empty"><p>{tl('选中一句话或点开一个词，就能让 Tibi 讲。')}</p><p className="lbl">{tl('也可以直接问：这一段在说什么？这里为什么用过去完成时？')}</p></div>} />}
    </aside>
  );
}
