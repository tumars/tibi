import { errorInfo, isTauri } from '../rpc';
import { toast } from '../store/ui';
import { tl } from './i18n';

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast(tl('已复制')); }
  catch { toast(tl('没能复制'), { kind: 'err' }); }
}

/** 对象菜单的来源只接受网页地址，沿用壳的系统浏览器。 */
export async function openSource(url: string) {
  try {
    if (!/^https?:\/\//i.test(url)) throw new Error(tl('原文链接不可用'));
    if (isTauri()) { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(url); }
    else window.open(url, '_blank', 'noopener');
  } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
}
