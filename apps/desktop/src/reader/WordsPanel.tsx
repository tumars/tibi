import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Mascot } from '../components/Mascot';
import { NavWordsIcon } from '../components/TibiIcons';
import { tl } from '../lib/i18n';
import { STATUS_NAMES } from '../lib/util';
import { errorInfo, rpc, type Result } from '../rpc';

/** 整篇文章的生词与学习中词条；只读列表，点击后在阅读器内查词典。 */
export function WordsPanel({ documentId, onClose, onWord }: { documentId: string; onClose: () => void; onWord: (word: string) => void }) {
  const [data, setData] = useState<Result<'terms.list'>>();
  const [request, setRequest] = useState<{ cursor?: string; revision: number }>({ revision: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    // 标词、撤销、同步或文章完成分词后，重新读取；不用全局生词本计数充当本篇计数。
    return rpc.on('data.changed', d => {
      if (d.table === 'terms' || (d.table === 'documents' && (!d.ids || d.ids.includes(documentId)))) {
        setRequest(r => ({ revision: r.revision + 1 }));
      }
    });
  }, [documentId]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(undefined);
    void rpc.call('terms.list', { document_id: documentId, view: 'all', sort: 'alpha', limit: 200, cursor: request.cursor }).then(r => {
      if (!alive) return;
      setData(previous => ({ ...r, items: request.cursor && previous ? [...previous.items, ...r.items] : r.items }));
      setLoading(false);
    }, e => { if (alive) { setErr(errorInfo(e).message); setLoading(false); } });
    return () => { alive = false; };
  }, [documentId, request]);

  return (
    <aside className="rpanel" aria-label={tl('生词')}>
      <div className="rph"><span className="rph-title"><NavWordsIcon size={15} />{tl('生词')}</span>{data && <span className="sum-count">{data.total}</span>}<span className="sp" /><button className="ibtn" title={tl('关闭')} aria-label={tl('关闭')} onClick={onClose}><X size={16} /></button></div>
      <div className="rpb" aria-busy={loading}>
        {data && data.items.length > 0 && <div className="reader-words">{data.items.map(term => (
          <button key={term.id} className="reader-word" onClick={() => onWord(term.text)}>
            <span className="reader-word-head"><b>{term.display}</b><span className={`stage s${term.status}`}>{STATUS_NAMES[term.status]}</span></span>
            {term.ipa && <span className="ipa">/{term.ipa}/</span>}
            <span className="reader-word-meaning">{term.meaning || term.short_gloss || tl('（没有释义）')}</span>
          </button>
        ))}</div>}
        {!loading && !err && data?.total === 0 && <div className="rwords-empty"><Mascot id="empty-words" /><p>{tl('本篇暂无已标记的生词。')}</p></div>}
        {loading && <p className="muted" role="status">{tl('正在加载生词…')}</p>}
        {err && <section role="alert"><p className="muted">{err}</p><button className="btn sm" onClick={() => setRequest(r => ({ ...r, revision: r.revision + 1 }))}>{tl('重试')}</button></section>}
        {!loading && !err && data?.cursor && <button className="btn sm" onClick={() => setRequest(r => ({ ...r, cursor: data.cursor }))}>{tl('加载更多生词')}</button>}
      </div>
    </aside>
  );
}
