import type { DocumentSummary } from '@tibi/core';
import { tl } from '../lib/i18n';
import { docSource } from '../lib/util';
import { isTauri } from '../rpc';
import { toast } from '../store/ui';

/** 阅读页的来源：网址可点，在系统浏览器里打开原文；文件显示文件名 */
export function DocSource({ d }: { d: Pick<DocumentSummary, 'source' | 'source_type' | 'source_url'> }) {
  const label = docSource(d);
  if (!label) return null;
  if (!d.source_url) return <span className="src" title={label}>{label}</span>;
  const url = d.source_url;
  const open = async (e: React.MouseEvent) => {
    if (!isTauri()) return;
    e.preventDefault();
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url).catch(err => toast(String(err), { kind: 'err' }));
  };
  return <a className="src" href={url} target="_blank" rel="noopener noreferrer" title={tl('打开原文 {url}', { url })} onClick={e => void open(e)}>{label}</a>;
}
