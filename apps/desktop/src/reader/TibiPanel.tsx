import type { Document } from '@tibi/core';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChatThread, type Pending } from '../components/ChatThread';
import { Mascot } from '../components/Mascot';
import { TibiAvatar } from '../components/TibiIcons';
import { Alert } from '../components/ui';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';
import { useCore } from '../store/core';
import { useNavigate } from 'react-router';

/**
 * 阅读器右侧"✦ Tibi"面板（00 §3.2）：每篇文章一个对话（chat.open({ document_id })），用"讲解"技能，
 * 带着正在读的文章、这一章、选中的句子发给 Tibi。选中文本或词卡上的"问 Tibi"会把问题作为 pending 发过来。
 */
export function TibiPanel({ doc, sectionId, pending, onClose }: { doc: Document; sectionId?: string; pending?: Pending; onClose: () => void }) {
  const [convId, setConvId] = useState<string>();
  const modelOk = useCore(s => !!s.status?.models.ok);
  const nav = useNavigate();
  useEffect(() => {
    const open = () => rpc.call('chat.open', { document_id: doc.id }).then(c => setConvId(c.id), e => toast(errorInfo(e).message, { kind: 'err' }));
    void open();
    // 读这篇时从左栏删了它的对话：换一个新的，不然接着发会找不到对话
    const onDeleted = (e: Event) => { if ((e as CustomEvent<string>).detail === doc.id) void open(); };
    window.addEventListener('tibi:chat-deleted', onDeleted);
    return () => window.removeEventListener('tibi:chat-deleted', onDeleted);
  }, [doc.id]);
  return (
    <aside className="rpanel tibi" aria-label="Tibi">
      <div className="rph"><span className="rph-title"><TibiAvatar size={22} />{tl('Tibi · 讲解')}</span><span className="sp" /><button className="ibtn" title={tl('关闭')} onClick={onClose}><X size={16} /></button></div>
      {pending?.draft && !modelOk && (
        <Alert tone="warning" compact className="rpanel-alert" action={<button className="linkbtn" onClick={() => nav(`/welcome?step=3&back=${encodeURIComponent(`/read/${doc.id}/${sectionId ?? ''}`)}`)}>{tl('连接模型')}</button>}>
          {tl('问题已暂存，连接模型后发送。')}
        </Alert>
      )}
      {convId && <ChatThread conversationId={convId} skill="tutor" context={{ page: 'reader', document_id: doc.id, section_id: sectionId }} pending={pending}
        placeholder={tl('问这篇文章里的词、句子或语法…')} back={`/read/${doc.id}`}
        empty={<div className="tibi-empty"><Mascot id="onboarding-hello" /><p>{tl('选中词句或直接输入问题，获取语境与语法讲解。')}</p></div>} />}
    </aside>
  );
}
