import type { Document } from '@tibi/core';
import { X } from 'lucide-react';
import { fmtPct } from '../lib/util';

/**
 * 阅读器右侧"总结"面板（00 §3.2、原型 reader.html 的 pane-sum）：总结 → 难度 → 值得学的短语 → 长难句 → 学习建议。
 * M1 只有内置示例带预生成结果；用户自己的文章在 M2 接模型前显示"稍后补做"。
 */
export function SummaryPanel({ doc, onClose, onPhrase }: { doc: Document; onClose: () => void; onPhrase?: (text: string) => void }) {
  const ai = doc.ai ?? {};
  const summary = ai.summary?.output as string | undefined;
  const advice = ai.advice?.output as string | undefined;
  const phrases = (ai.phrases?.output as { text: string; zh: string }[] | undefined) ?? [];
  const hard = (ai.hard_sentences?.output as { s: string; zh: string }[] | undefined) ?? [];
  const pregenerated = ai.summary?.model === 'bundled';
  return (
    <aside className="rpanel" aria-label="总结">
      <div className="rph"><b>总结</b><span className="sp" /><button className="ibtn" title="关闭" onClick={onClose}><X size={16} /></button></div>
      <div className="rpb">
        {summary ? <section><h5><span className="note">✦ AI</span>总结</h5><p className="gloss">{summary}</p></section>
          : <section><h5>总结</h5><p className="muted">{doc.ai_status === 'deferred' ? '还没有生成。连上模型后会在后台补做（M2 起）。' : '这篇还没有总结。'}</p></section>}
        <section><h5>难度</h5><p className="muted">生词率 {fmtPct(doc.unknown_ratio)} · {({ ok: '舒适', mid: '学习区', hard: '偏难' } as const)[doc.difficulty]}</p></section>
        {phrases.length > 0 && <section><h5>值得学的短语</h5><div className="plist">{phrases.map(p => <button key={p.text} className="pitem" onClick={() => onPhrase?.(p.text)}><b>{p.text}</b><span>{p.zh}</span></button>)}</div></section>}
        {hard.length > 0 && <section><h5>长难句</h5>{hard.map(h => <div key={h.s} className="hard"><p className="quote">{h.s}</p><p className="tr">{h.zh}</p></div>)}</section>}
        {advice && <section><h5><span className="note">✦ AI</span>学习建议</h5><p className="gloss">{advice}</p></section>}
      </div>
      {summary && <div className="rpf">{pregenerated ? '内置示例 · 随应用预生成，不用连模型' : 'Tibi · 导入时生成并缓存'}</div>}
    </aside>
  );
}
