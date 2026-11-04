import type { Status, Term, TermContext, TermDetail } from '@tibi/core';
import { Star, X } from 'lucide-react';
import { SpeakButtons } from '../components/Speak';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Empty } from '../components/Empty';
import { Menu } from '../components/Menu';
import { Top } from '../components/Shell';
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
  const setStatus = async (id: string, s: Status) => {
    try { await rpc.call('terms.setStatus', { ids: [id], status: s, source: 'user' }); setDetail(d => d && d.id === id ? { ...d, status: s } : d); void load(); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
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
  const ctxRow = (c: TermContext) => <div key={c.id} style={{ display: 'flex', gap: 8, padding: '8px 0', boxShadow: '0 1px 0 var(--line)' }}>
    <div style={{ flex: 1, fontFamily: 'var(--f-read)', fontSize: 15, lineHeight: 1.6 }}>
      {c.sentence}
      <div className="lbl" style={{ fontFamily: 'var(--f-ui)' }}>{c.document_title ?? (c.source === 'dictionary' ? tl('词典例句') : tl('手动添加'))}{c.unknown_others === 0 ? tl(' · 复习卡用这句') : c.unknown_others > 0 ? tl(' · 还有 {unknown_others} 个生词', { unknown_others: c.unknown_others }) : ''}</div>
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
        <div className="words" style={{ marginTop: 12 }}>
          <div className="views">
            {VIEWS.map(v => <button key={v.key} className={view === v.key ? 'cur' : ''} onClick={() => setView(v.key)}>{v.label}<span className="n">{counts[v.key] ?? ''}</span></button>)}
            {view === 'leech' && <div className="lbl" style={{ padding: '10px 10px 0', lineHeight: 1.6 }}>{tl('复习里忘了 3 次以上的词。')}</div>}
          </div>
          <div>
            {view === 'known' && <div className="seg" style={{ marginBottom: 10 }}>{SUB.map(s => <button key={s.key} className={sub === s.key ? 'on' : ''} onClick={() => setSub(s.key)}>{s.label}</button>)}</div>}
            {items === undefined ? null : items.length === 0 ? <Empty image={q ? undefined : 'empty-words'} quip={q ? undefined : tl('罐子还是空的。')} title={q ? tl('没有找到') : tl('这里还没有词')} text={q ? undefined : tl('读文章时点开的生词会出现在这里。')} /> : (
              <div>
                <div className="wrow h"><span>{tl('单词')}</span><span>{tl('释义')}</span><span>{tl('熟练度')}</span><span>{tl('遇见')}</span><span>{tl('下次复习')}</span></div>
                {items.map(t => <div key={t.id} className="wrow" onClick={() => open(t)}>
                  <span className="t">{t.display}</span>
                  <span className="m">{t.meaning || t.short_gloss || ''}</span>
                  <span><span className={`stage s${t.status}`}>{STATUS_NAMES[t.status]}</span></span>
                  <span className="lbl">{t.encounter_count}</span>
                  <span className="lbl">{t.status <= 4 ? dueLabel(t.due) : '—'}</span>
                </div>)}
              </div>
            )}
          </div>
        </div>
      </div></div>
      {detail && (
        <div className="drawer" role="dialog" aria-label={detail.display}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <b style={{ fontFamily: 'var(--f-read)', fontSize: 26 }}>{detail.display}</b>
            {ipa && <span className="lbl" style={{ fontFamily: 'var(--f-read)', fontStyle: 'italic', fontSize: 14 }}>/{ipa}/</span>}
            <SpeakButtons text={detail.display} size={16} />
            <span className="sp" />
            <button className="ibtn" onClick={() => setDetail(undefined)} aria-label={tl('关闭')}><X /></button>
          </div>
          {entry && (entry.collins || entry.oxford || entry.exam.length > 0) ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {entry.collins ? <span className="tagc" title={tl('柯林斯星级')}>{'★'.repeat(entry.collins)}</span> : null}
            {entry.oxford && <span className="tagc">{tl('牛津 3000')}</span>}
            {entry.exam.map(x => <span key={x} className="tagc">{EXAM_NAMES[x] ?? x}</span>)}
          </div> : null}
          {detail.meaning && <div style={{ marginTop: 8, color: 'var(--ink)' }}>{detail.meaning}</div>}
          {detail.en && <div className="lbl" style={{ marginTop: 4 }}>{detail.en}</div>}
          {gloss.length > 0 && <div className="dx-gloss" style={{ marginTop: 8, fontSize: 14, color: detail.meaning ? 'var(--ink-2)' : undefined }}>{gloss.map((l, i) => <div key={i}>{l.tag && <em>{l.tag}</em>}<span>{l.text}</span></div>)}</div>}
          {dict && !entry && !detail.meaning && <div className="lbl" style={{ marginTop: 8 }}>{dict.available ? tl('词典里没有这个词') : tl('没有装词典')}</div>}
          {entry?.inflections && entry.inflections.length > 0 && <div className="dx-forms" style={{ marginTop: 10 }}>{entry.inflections.map(f => <button key={f.type + f.form} onClick={() => toDict(f.form)}><i>{INFLECTION_NAMES[f.type] ?? f.type}</i>{f.form}</button>)}</div>}
          <div className="lbl" style={{ marginTop: 10 }}>{tl('熟练度')}</div>
          <div className="seg" style={{ marginTop: 6, flexWrap: 'wrap' }}>{([0, 1, 2, 3, 4, 5] as Status[]).map(s => <button key={s} className={detail.status === s ? 'on' : ''} onClick={() => setStatus(detail.id, s)}>{STATUS_NAMES[s]}</button>)}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn sm" onClick={() => setStatus(detail.id, 97)}>{tl('标为已知')}</button>
            <button className="btn sm" onClick={() => setStatus(detail.id, 98)}>{tl('忽略')}</button>
            <button className="btn sm" onClick={() => toDict(detail.text)}>{tl('在词典里看')}</button>
            {detail.lapses >= 3 && <span className="tagc" style={{ color: 'var(--hard)' }}>{tl('难词 · 忘了 {lapses} 次', { lapses: detail.lapses })}</span>}
          </div>
          {favs.length > 0 && <>
            <div className="lbl" style={{ marginTop: 16 }}>{tl('收藏的句子 {length}', { length: favs.length })}</div>
            {favs.map(ctxRow)}
          </>}
          <div className="lbl" style={{ marginTop: 16 }}>{tl('遇到过的句子 {length}', { length: seen.length })}<span style={{ marginLeft: 6 }}>{tl('· 只留最近 {n} 句，收藏的一直留着', { n: 10 })}</span></div>
          {seen.map(ctxRow)}
          {detail.card && <div className="lbl" style={{ marginTop: 14 }}>{tl('复习 {reps} 次 · 忘了 {lapses} 次 · 下次 {due} · 记得率 {ret}', { reps: detail.card.reps, lapses: detail.card.lapses, due: dueLabel(detail.card.due), ret: detail.retention ? Math.round(detail.retention * 100) + '%' : '—' })}</div>}
          {detail.history.length > 0 && <div className="lbl" style={{ marginTop: 10 }}>{detail.history.slice(0, 5).map((h, i) => <div key={i}>{fmtAgo(h.at)} → {STATUS_NAMES[h.status]}</div>)}</div>}
        </div>
      )}
    </>
  );
}
