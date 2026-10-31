import { isTauri } from '../rpc';
import { toast } from '../store/ui';
import { tl } from './i18n';

/** 另存为文本：桌面端弹保存对话框（壳的 save_text_file），浏览器开发模式直接下载 */
export async function saveText(defaultName: string, text: string): Promise<boolean> {
  if (!isTauri()) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); a.download = defaultName; a.click();
    return true;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const r = await invoke<{ saved: boolean }>('save_text_file', { defaultName, text });
  return r.saved;
}

/** 选一个文件（路径由壳登记给 Core）；浏览器开发模式不能选 */
export async function pickFile(kinds: string[]): Promise<string | undefined> {
  if (!isTauri()) { toast(tl('浏览器开发模式不能选文件，请在桌面端里操作')); return undefined; }
  const { invoke } = await import('@tauri-apps/api/core');
  const r = await invoke<{ paths: string[] }>('pick_file', { kinds, multiple: false });
  return r.paths[0];
}
