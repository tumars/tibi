import type { Document } from '@tibi/core';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { fmtPct } from '../lib/util';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';

/**
 * 阅读器右侧"总结"面板（00 §3.2、原型 reader.html 的 pane-sum）：总结 → 难度 → 值得学的短语 → 长难句 → 学习建议。
 * 内置示例带预生成结果；用户的文章导入时由模型生成（M2），没连模型时记"稍后补做"，这里可以手动生成。
 */
export function SummaryPanel({ doc, onClose, onPhrase }: { doc: Document; onClose: () => void; onPhrase?: (text: string) => void }) {
  const ai = doc.ai ?? {};
  const summary = ai.summary?.output as string | undefined;
  const advice = ai.advice?.output as string | undefined;
  const phrases = (ai.phrases?.output as { text: string; zh: string }[] | undefined) ?? [];
  const hard = (ai.hard_sentences?.output as { s: string; zh: string }[] | undefined) ?? [];
  const pregenerated = ai.summary?.model === 'bundled';
  const modelOk = useCore(st => !!st.status?.models.ok);
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const running = busy || doc.ai_status === 'running';
  const generate = async () => {
    if (!modelOk) { nav(`/welcome?step=3&back=${encodeURIComponent(location.hash.slice(1) || '/')}`); return; }
    setBusy(true);
    try { await rpc.call('documents.analyze', { id: doc.id }); toast('正在生成总结，好了会自动出现'); } catch (e) { setBusy(false); toast(errorInfo(e).message, { kind: 'err' }); }
  };
  return (
    <aside className="rpanel" aria-label="总结">
      <div className="rph"><b>总结</b><span className="sp" /><button className="ibtn" title="关闭" onClick={onClose}><X size={16} /></button></div>
      <div className="rpb">
        {summary ? <section><h5><span className="note">✦ AI</span>总结</h5><p className="gloss">{summary}</p></section>
          : <section><h5>总结</h5>
              <p className="muted">{running ? '正在生成…' : doc.ai_status === 'deferred' ? (modelOk ? '导入时模型没用上，可以现在生成。' : '要连接模型才能生成总结。') : doc.ai_status === 'failed' ? '上次没有生成成功。' : '这篇还没有总结。'}</p>
              {!running && <button className="btn sm" style={{ marginTop: 8 }} onClick={generate}>{modelOk ? '现在生成' : '去连接模型'}</button>}
            </section>}
        <section><h5>难度</h5><p className="muted">生词率 {fmtPct(doc.unknown_ratio)} · {({ ok: '舒适', mid: '学习区', hard: '偏难' } as const)[doc.difficulty]}</p></section>
        {phrases.length > 0 && <section><h5>值得学的短语</h5><div className="plist">{phrases.map(p => <button key={p.text} className="pitem" onClick={() => onPhrase?.(p.text)}><b>{p.text}</b><span>{p.zh}</span></button>)}</div></section>}
        {hard.length > 0 && <section><h5>长难句</h5>{hard.map(h => <div key={h.s} className="hard"><p className="quote">{h.s}</p><p className="tr">{h.zh}</p></div>)}</section>}
        {advice && <section><h5><span className="note">✦ AI</span>学习建议</h5><p className="gloss">{advice}</p></section>}
      </div>
      {summary && <div className="rpf">{pregenerated ? '内置示例 · 随应用预生成，不用连模型' : <>Tibi · 导入时生成并缓存 · <button className="linkbtn" disabled={running} onClick={generate}>{running ? '正在重新生成…' : '重新生成'}</button></>}</div>}
    </aside>
  );
}
