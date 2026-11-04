import { ChevronLeft, ChevronRight } from 'lucide-react';
import { tl } from '../lib/i18n';

/** 列表底下的翻页：只有一页时不出现。page 从 0 起 */
export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / size);
  if (!Number.isFinite(pages) || pages <= 1) return null;
  return (
    <nav className="pager" aria-label={tl('翻页')}>
      <button className="btn sm" disabled={page <= 0} onClick={() => onPage(page - 1)}><ChevronLeft />{tl('上一页')}</button>
      <span className="lbl">{tl('第 {n} / {total} 页', { n: page + 1, total: pages })}</span>
      <button className="btn sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>{tl('下一页')}<ChevronRight /></button>
    </nav>
  );
}
