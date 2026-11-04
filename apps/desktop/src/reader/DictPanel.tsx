import { X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Dictionary } from '../components/Dictionary';
import { tl } from '../lib/i18n';

/** 阅读器右侧"词典"面板：词卡上点"查词典"在这里查，不离开正在读的文章；一列布局，和手机词典共用 compact */
export function DictPanel({ word, onClose, onAsk }: { word?: string; onClose: () => void; onAsk?: (text: string) => void }) {
  const nav = useNavigate();
  return (
    <aside className="rpanel dict" aria-label={tl('词典')}>
      <div className="rph"><b>{tl('词典')}</b><span className="sp" /><button className="ibtn" title={tl('关闭')} onClick={onClose}><X size={16} /></button></div>
      <div className="rpb">
        <Dictionary compact initial={word} onOpenDoc={id => nav(`/read/${id}`)} onOpenTerm={id => nav(`/words?term=${id}`)} onAsk={onAsk} />
      </div>
    </aside>
  );
}
