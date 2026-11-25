import type { Status, Term, TermContext, TermDetail, Undo } from '@tibi/core';
import { Star, X } from 'lucide-react';
import { SpeakButtons, speakWith } from '../components/Speak';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Empty } from '../components/Empty';
import { Menu } from '../components/Menu';
import { Top } from '../components/Shell';
import { ObjectMenuButton, useObjectMenu } from '../components/ObjectMenu';
import { Badge, InfoTip, StageBar } from '../components/ui';
import { copyText } from '../lib/contextActions';
import '../components/dict.css';
import { EXAM_NAMES, INFLECTION_NAMES, parseGloss } from '../lib/dict';
import { pickFile, saveText } from '../lib/files';
import { fmtAgo, STATUS_NAMES } from '../lib/util';
import { errorInfo, rpc, type Params, type Result } from '../rpc';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

type View = NonNullable<Params<'terms.list'>['view']>;
const VIEWS: { key: View; label: string }[] = [{ key: 'all', label: tl('全部') }, { key: 'due', label: tl('今天到期') }, { key: 'leech', label: tl('难词') }, { key: 'known', label: tl('不在复习里') }];
const SUB: { key: View; label: string }[] = [{ key: 'known', label: tl('标为已知') }, { key: 'mastered', label: tl('已掌握') }, { key: 'ignored', label: tl('已忽略') }];

function dueLabel(due?: number) {
  if (!due) return '—';
  const d = Math.round((due - Date.now()) / 86400000);
  return d < 0 ? tl('逾期 {v0} 天', { v0: -d }) : d === 0 ? tl('今天') : d === 1 ? tl('明天') : tl('{d} 天后', { d });
}

export function Words() {
  const [params] = useSearchParams();
  const [view, setView] = useState<View>((VIEWS.find(v => v.key === params.get('view'))?.key) ?? 'all');
  const [sub, setSub] = useState<View>('known');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Term[]>();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [detail, setDetail] = useState<TermDetail>();

  const load = useCallback(async () => {
    const v = view === 'known' ? sub : view;
    try { const r = await rpc.call('terms.list', { view: v, q: q || undefined, limit: 200 }); setItems(r.items); setCounts(r.counts ?? {}); } catch { setItems([]); }
  }, [view, sub, q]);
  useEffect(() => { void load(); return rpc.on('data.changed', d => { if (d.table === 'terms' || d.table === 'cards') void load(); }); }, [load]);

  // 导出 / 导入（M3）：导出生成文本后另存为；导入读选中的文件
  const doExport = async (format: 'csv' | 'anki' | 'txt') => {
    try { const r = await rpc.call('terms.export', { format }); if (!r.count) { toast(tl('生词本是空的')); return; } if (await saveText(r.filename, r.text)) toast(tl('已导出 {count} 个词', { count: r.count })); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const doImport = async (format: 'txt' | 'known') => {
    const path = await pickFile(['txt', 'csv']); if (!path) return;
    try {
      const r = await rpc.call('terms.import', { path, format });
      toast(format === 'known' ? tl('已标为已知 {known} 个词{v1}', { known: r.known, v1: r.skipped ? tl('，{skipped} 个在学习中没动', { skipped: r.skipped }) : '' }) : tl('加入生词本 {added} 个词{v1}', { added: r.added, v1: r.skipped ? tl('，{skipped} 个已经在了', { skipped: r.skipped }) : '' })); void load();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  // 全局搜索打开某个词：/words?term=<id>
  const termParam = params.get('term');
  useEffect(() => { if (termParam) rpc.call('terms.get', { id: termParam }).then(setDetail, () => undefined); }, [termParam]);
  // 详情配上词典：音标、释义、考试标签、词形；自己写的释义排在前面
  const nav = useNavigate();
  const [dict, setDict] = useState<Result<'dict.entry'>>();
  const dictWord = detail?.text;
  useEffect(() => {
    setDict(undefined); if (!dictWord) return;
    let alive = true;
    rpc.call('dict.entry', { word: dictWord }).then(r => { if (alive) setDict(r); }, () => undefined);
    return () => { alive = false; };
  }, [dictWord]);
  const toDict = (w: string) => nav(`/dict?w=${encodeURIComponent(w)}`);
  const open = async (t: Term) => { try { setDetail(await rpc.call('terms.get', { id: t.id })); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  const refreshDetail = async (id: string) => {
    const fresh = await rpc.call('terms.get', { id });
    setDetail(d => d?.id === id ? fresh : d);
  };
  const undoAction = (undo: Undo, id: string) => ({ label: tl('撤销'), run: () => void rpc.call('system.undo', { undo_id: undo.undo_id }).then(async () => { await load(); await refreshDetail(id); }).catch(e => toast(errorInfo(e).message, { kind: 'err' })) });
  const setStatus = async (id: string, s: Status) => {
    if ((detail?.id === id ? detail : items?.find(t => t.id === id))?.status === s) return;
    try {
      const r = await rpc.call('terms.setStatus', { ids: [id], status: s, source: 'user' });
      toast(tl('已设为{status}', { status: STATUS_NAMES[s] }), { action: undoAction(r.undo, id) });
      void load(); await refreshDetail(id);
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const remove = async (t: Term) => {
    try {
      const undo = await rpc.call('terms.remove', { ids: [t.id] });
      setDetail(d => d?.id === t.id ? undefined : d); void load();
      toast(tl('已移出生词本：{word}', { word: t.display }), { action: undoAction(undo, t.id) });
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const menu = useObjectMenu<Term>(t => [
    { label: tl('打开详情'), run: () => void open(t) },
    { label: t.kind === 'phrase' ? tl('朗读短语') : tl('朗读单词'), run: () => void speakWith(t.display, 'system', `term:${t.id}`) },
    { label: t.kind === 'phrase' ? tl('复制短语') : tl('复制单词'), run: () => void copyText(t.display) }, null,
    { label: tl('熟练度'), items: ([0, 1, 2, 3, 4, 5, 97, 98] as Status[]).map(s => ({ label: STATUS_NAMES[s]!, checked: t.status === s, enabled: t.status !== s, run: () => void setStatus(t.id, s) })) },
    ...(view !== 'known' ? [null, { label: tl('移出生词本'), danger: true, run: () => void remove(t) }] : []),
  ], `${view}:${sub}:${q}`);
  useEffect(() => { menu.close(); }, [items, menu.close]);
  const favorite = async (c: TermContext) => {
    try { await rpc.call('terms.favoriteContext', { id: c.id, favorite: !c.is_favorite }); setDetail(d => d && { ...d, contexts: d.contexts.map(x => x.id === c.id ? { ...x, is_favorite: !c.is_favorite } : x) }); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const entry = dict?.entry;
  const ipa = entry?.phonetic?.replace(/^\/|\/$/g, '') || detail?.ipa;
  // 自己的释义已经包含词典的每一行（从词典抄来的，或只是少了词性）就不再重复
  const lines = parseGloss(entry?.translation ?? '');
  const gloss = detail?.meaning && lines.every(l => detail.meaning!.includes(l.text)) ? [] : lines;
  const favs = detail?.contexts.filter(c => c.is_favorite) ?? [];
  const seen = detail?.contexts.filter(c => !c.is_favorite) ?? [];
  const ctxRow = (c: TermContext) => <div key={c.id} className="drawer-ctx">
    <div className="drawer-ctx-body">
      {c.sentence}
      <div className="lbl drawer-ctx-meta">{c.document_title ?? (c.source === 'dictionary' ? tl('词典例句') : tl('手动添加'))}{c.unknown_others === 0 ? tl(' · 复习卡用这句') : c.unknown_others > 0 ? tl(' · 还有 {unknown_others} 个生词', { unknown_others: c.unknown_others }) : ''}</div>
    </div>
    <button className="ibtn" onClick={() => void favorite(c)} aria-label={c.is_favorite ? tl('取消收藏') : tl('收藏这句')} title={c.is_favorite ? tl('取消收藏') : tl('收藏这句')} aria-pressed={c.is_favorite}>
      <Star size={16} fill={c.is_favorite ? 'currentColor' : 'none'} style={c.is_favorite ? { color: 'var(--accent)' } : undefined} />
    </button>
  </div>;

  return (
    <>
      <Top crumbs={[{ label: tl('生词本') }]} right={<>
        <input className="input" placeholder={tl('搜索单词、释义')} value={q} onChange={e => setQ(e.target.value)} style={{ width: 200 }} />
        <Menu trigger={<button className="btn sm">{tl('导入')}</button>} items={[
          { label: tl('导入单词表进生词本'), hint: tl('.txt / .csv，每行一个词，第二列可写释义'), run: () => void doImport('txt') },
          { label: tl('导入已知词表'), hint: tl('从其他工具导出的已知词，直接标为已知'), run: () => void doImport('known') },
        ]} />
        <Menu trigger={<button className="btn sm">{tl('导出')}</button>} items={[
          { label: tl('导出为 Anki'), hint: tl('Anki → 文件 → 导入，背面带原句'), run: () => void doExport('anki') },
          { label: tl('导出为 CSV'), hint: tl('Excel / Numbers 可直接打开'), run: () => void doExport('csv') },
          { label: tl('导出为纯文本'), hint: tl('每行一个词'), run: () => void doExport('txt') },
        ]} />
      </>} />
      <div className="scroll"><div className="page">
        <div className="words">
          <div className="views">
            {VIEWS.map(v => (
              <div key={v.key} className="view-row">
                <button className={`view-btn${view === v.key ? ' cur' : ''}`} onClick={() => setView(v.key)}>
                  {v.label}<span className="n">{counts[v.key] ?? ''}</span>
                </button>
                {v.key === 'leech' && <InfoTip content={tl('复习中遗忘 3 次以上的词条。')} />}
              </div>
            ))}
          </div>
          <div className="wtable">
            {view === 'known' && <div className="seg sub-seg">{SUB.map(s => <button key={s.key} className={sub === s.key ? 'on' : ''} onClick={() => setSub(s.key)}>{s.label}</button>)}</div>}
            {items === undefined ? null : items.length === 0 ? (
              q
                ? <Empty title={tl('未找到匹配的词条。')} action={<button className="btn" onClick={() => setQ('')}>{tl('清除搜索')}</button>} />
                : view === 'all'
                  ? <Empty image="empty-words" title={tl('罐子还是空的，阅读时点选生词即可收录。')} action={<button className="btn pri" onClick={() => nav('/library')}>{tl('前往书架')}</button>} />
                  : <Empty image="empty-words" title={tl('当前分类暂无词条。')} action={<button className="btn" onClick={() => setView('all')}>{tl('查看全部')}</button>} />
            ) : (
              <div>
                <div className="wrow h"><span>{tl('单词')}</span><span>{tl('释义')}</span><span>{tl('熟练度')}</span><span>{tl('遇见')}</span><span>{tl('下次复习')}</span></div>
                {items.map(t => <div key={t.id} className="wrow object-row" role="button" tabIndex={0} aria-label={t.display}
                  onClick={e => { if (!e.ctrlKey) void open(t); }} onContextMenu={e => menu.open(t, e)} onKeyDown={e => {
                    menu.onKeyDown(t, e);
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); void open(t); }
                  }}>
                  <span className="t">{t.display}</span>
                  <span className="m">{t.meaning || t.short_gloss || ''}</span>
                  <span><span className={`stage s${t.status}`}>{STATUS_NAMES[t.status]}</span></span>
                  <span className="lbl">{t.encounter_count}</span>
                  <span className="lbl">{t.status <= 4 ? dueLabel(t.due) : '—'}</span>
                  <ObjectMenuButton onClick={e => menu.open(t, e)} />
                </div>)}
              </div>
            )}
          </div>
        </div>
      </div></div>
      {menu.menu}
      {detail && (
        <div className="drawer" role="dialog" aria-label={detail.display}>
          <div className="drawer-head">
            <b>{detail.display}</b>
            {ipa && <span className="ipa">/{ipa}/</span>}
            <SpeakButtons text={detail.display} size={16} />
            <span className="sp" />
            <button className="ibtn" onClick={() => setDetail(undefined)} aria-label={tl('关闭')}><X /></button>
          </div>
          {entry && (entry.collins || entry.oxford || entry.exam.length > 0) ? <div className="drawer-tags">
            {entry.collins ? <Badge title={tl('柯林斯星级')}>{'★'.repeat(entry.collins)}</Badge> : null}
            {entry.oxford && <Badge>{tl('牛津 3000')}</Badge>}
            {entry.exam.map(x => <Badge key={x}>{EXAM_NAMES[x] ?? x}</Badge>)}
          </div> : null}
          {detail.meaning && <div>{detail.meaning}</div>}
          {detail.en && <div className="lbl">{detail.en}</div>}
          {gloss.length > 0 && <div className="dx-gloss" style={{ marginTop: 0, fontSize: 14, color: detail.meaning ? 'var(--ink-2)' : undefined }}>{gloss.map((l, i) => <div key={i}>{l.tag && <em>{l.tag}</em>}<span>{l.text}</span></div>)}</div>}
          {dict && !entry && !detail.meaning && <div className="lbl">{dict.available ? tl('词典里没有这个词') : tl('没有装词典')}</div>}
          {entry?.inflections && entry.inflections.length > 0 && <div className="dx-forms">{entry.inflections.map(f => <button key={f.type + f.form} onClick={() => toDict(f.form)}><i>{INFLECTION_NAMES[f.type] ?? f.type}</i>{f.form}</button>)}</div>}
          <div className="drawer-sec"><span>{tl('熟练度')}</span></div>
          <StageBar status={detail.status} onSelect={s => void setStatus(detail.id, s)} />
          <div className="drawer-acts">
            <button className="btn sm" onClick={() => setStatus(detail.id, 97)}>{tl('标为已知')}</button>
            <button className="btn sm" onClick={() => setStatus(detail.id, 98)}>{tl('忽略')}</button>
            <button className="btn sm" onClick={() => toDict(detail.text)}>{tl('查词典')}</button>
            {detail.lapses >= 3 && <Badge tone="danger">{tl('难词 · 忘了 {lapses} 次', { lapses: detail.lapses })}</Badge>}
          </div>
          {favs.length > 0 && <>
            <div className="drawer-sec"><span>{tl('收藏的句子 {length}', { length: favs.length })}</span></div>
            {favs.map(ctxRow)}
          </>}
          <div className="drawer-sec">
            <span>{tl('遇到过的句子 {length}', { length: seen.length })}</span>
            <InfoTip content={tl('默认保留最近 {n} 句，已收藏的句子长期保留。', { n: 10 })} />
          </div>
          {seen.map(ctxRow)}
          {detail.card && <div className="lbl">{tl('复习 {reps} 次 · 忘了 {lapses} 次 · 下次 {due} · 记得率 {ret}', { reps: detail.card.reps, lapses: detail.card.lapses, due: dueLabel(detail.card.due), ret: detail.retention ? Math.round(detail.retention * 100) + '%' : '—' })}</div>}
          {detail.history.length > 0 && <div className="lbl">{detail.history.slice(0, 5).map((h, i) => <div key={i}>{fmtAgo(h.at)} → {STATUS_NAMES[h.status]}</div>)}</div>}
        </div>
      )}
    </>
  );
}
