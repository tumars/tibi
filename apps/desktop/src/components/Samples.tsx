import type { SampleInfo } from '@tibi/core';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { GENRE_NAMES } from '../lib/util';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

/** 导入一篇内置示例并在完成后打开；已经导入过的直接打开 */
export async function openSample(s: SampleInfo, nav: (to: string) => void) {
  if (s.document_id) { nav(`/read/${s.document_id}`); return; }
  // 先挂监听再提交：示例很短，import.done 可能比 import 的返回先到
  let importId: string | undefined; const early = new Map<string, string | undefined>();
  const off = rpc.on('import.done', d => {
    if (!importId) { early.set(d.import_id, d.document_id); return; }
    if (d.import_id === importId) { off(); if (d.document_id) nav(`/read/${d.document_id}`); }
  });
  setTimeout(off, 60_000);
  try {
    const id0 = importId = (await rpc.call('documents.import', { source: { type: 'sample', id: s.id } })).import_id;
    if (early.has(id0)) { off(); const id = early.get(id0); if (id) nav(`/read/${id}`); }
  } catch (e) { off(); toast(errorInfo(e).message, { kind: 'err' }); }
}

/** 示例卡片的第三行：书显示章数，文章显示分钟数；作者是 Tibi 的不写 */
export function sampleMeta(s: SampleInfo) {
  const size = s.chapters ? tl('全本 {chapters} 章', { chapters: s.chapters }) : tl('约 {minutes} 分钟', { minutes: s.minutes });
  return s.author && s.author !== 'Tibi' ? `${size} · ${s.author}` : size;
}

/** 内置示例卡片（空书架、首次引导里用；00 §3.9：技术向一篇默认，另有小说、新闻各一篇） */
export function Samples() {
  const nav = useNavigate();
  const [list, setList] = useState<SampleInfo[]>([]);
  useEffect(() => { rpc.call('documents.samples', {}).then(setList, () => setList([])); }, []);
  if (!list.length) return null;
  return (
    <div className="samples">
      {list.map(s => (
        <button key={s.id} className="sample" onClick={() => void openSample(s, nav)}>
          <span className="g">{tl('{v0} · 示例', { v0: GENRE_NAMES[s.genre] ?? s.genre })}</span>
          <span className="t">{s.title}</span>
          <span className="m">{sampleMeta(s)}</span>
        </button>
      ))}
    </div>
  );
}
