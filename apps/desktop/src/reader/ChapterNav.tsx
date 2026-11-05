import { ChevronLeft, ChevronRight } from 'lucide-react';
import { tl } from '../lib/i18n';

type Chapter = { id: string; idx: number; title: string };

/** 书的章末：上一章 / 下一章（只有一章时不显示）；桌面和手机共用 */
export function ChapterNav({ sections, current, onGo }: { sections: Chapter[]; current?: Chapter; onGo: (id: string) => void }) {
  if (!current || sections.length < 2) return null;
  const prev = sections.find(s => s.idx === current.idx - 1);
  const next = sections.find(s => s.idx === current.idx + 1);
  const name = (s: Chapter) => s.title || tl('第 {v0} 章', { v0: s.idx + 1 });
  return (
    <nav className="chapnav" aria-label={tl('章节')}>
      {prev ? <button className="prev" title={name(prev)} onClick={() => onGo(prev.id)}><ChevronLeft size={16} /><span><small>{tl('上一章')}</small><b>{name(prev)}</b></span></button> : <span />}
      {next ? <button className="next" title={name(next)} onClick={() => onGo(next.id)}><span><small>{tl('下一章')}</small><b>{name(next)}</b></span><ChevronRight size={16} /></button> : <span />}
    </nav>
  );
}
