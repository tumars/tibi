import type { MouseEvent } from 'react';
import { errorInfo, isTauri } from '../rpc';
import { toast } from '../store/ui';
import { tl } from './i18n';

/** 在系统浏览器（Tauri）或新标签页（Web）里打开外部链接 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/** 打开外部链接并在失败时弹错误提示 */
export async function openExternalSafe(url: string): Promise<void> {
  try {
    await openExternal(url);
  } catch (e) {
    toast(errorInfo(e).message, { kind: 'err' });
  }
}

/**
 * <a> 点击处理：WebView 里 target="_blank" 打不开，桌面端交给系统浏览器。
 * 同步读取 e.currentTarget.href（await 之后 React 会释放或解绑 currentTarget）。
 */
export async function openExternalLink(e: MouseEvent<HTMLAnchorElement>): Promise<void> {
  if (!isTauri()) return;
  const href = e.currentTarget.href;
  if (!href) return;
  e.preventDefault();
  await openExternalSafe(href);
}

/** 复制纯文本到剪贴板；默认弹成功 / 失败提示 */
export async function copyToClipboard(
  text: string,
  opts: { silent?: boolean; errorMsg?: string } = {},
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    if (!opts.silent) toast(tl('已复制'));
    return true;
  } catch {
    if (!opts.silent) toast(opts.errorMsg ?? tl('没能复制'), { kind: 'err' });
    return false;
  }
}
