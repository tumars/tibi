import { errorInfo } from '../rpc';
import { toast } from '../store/ui';
import { copyToClipboard, openExternal } from './external';
import { tl } from './i18n';

export async function copyText(text: string) {
  await copyToClipboard(text);
}

/** 对象菜单的来源只接受网页地址，沿用壳的系统浏览器。 */
export async function openSource(url: string) {
  try {
    if (!/^https?:\/\//i.test(url)) throw new Error(tl('原文链接不可用'));
    await openExternal(url);
  } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
}
