import type { FeedKind } from '@tibi/core';
import { saveText } from '../lib/files';
import { tl } from '../lib/i18n';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';

/** 打开文件选择框读取 OPML / XML 文本（桌面 Tauri WebView 与浏览器均原生支持） */
export function pickOpmlXml(): Promise<string | undefined> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.opml,.xml,text/xml,application/xml';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) { resolve(undefined); return; }
      f.text().then(resolve, () => resolve(undefined));
    };
    input.addEventListener('cancel', () => resolve(undefined));
    input.click();
  });
}

/** 执行 OPML 导入并弹出结果提示 */
export async function runImportOpml(xml: string, kind: FeedKind, folder?: string): Promise<boolean> {
  try {
    const r = await rpc.call('feeds.importOpml', { xml, kind, ...(folder?.trim() ? { folder: folder.trim() } : {}) });
    if (r.added > 0) {
      const extra: string[] = [];
      if (r.skipped) extra.push(tl('跳过 {n} 个已有', { n: r.skipped }));
      if (r.invalid) extra.push(tl('{n} 个无效', { n: r.invalid }));
      toast(extra.length
        ? tl('已导入 {added} 个源（{extra}）', { added: r.added, extra: extra.join('，') })
        : tl('已导入 {added} 个源，正在后台拉取更新', { added: r.added }));
      return true;
    }
    if (r.skipped > 0) toast(tl('文件里的 {n} 个源都已订阅过', { n: r.skipped }));
    else toast(tl('没有找到可导入的有效订阅地址'), { kind: 'err' });
    return false;
  } catch (e) {
    toast(errorInfo(e).message, { kind: 'err' });
    return false;
  }
}

/** 导出当前订阅 / 电台为 OPML 2.0 文件 */
export async function runExportOpml(kind: FeedKind): Promise<void> {
  try {
    const r = await rpc.call('feeds.exportOpml', { kind });
    if (!r.count) { toast(tl('当前没有可导出的订阅源')); return; }
    const saved = await saveText(r.filename, r.xml, 'text/xml;charset=utf-8');
    if (saved) toast(tl('已导出 {n} 个源为 OPML', { n: r.count }));
  } catch (e) {
    toast(errorInfo(e).message, { kind: 'err' });
  }
}
