import { hasLocalCore, isTauri } from '../rpc';
import { toast } from '../store/ui';
import { tl } from './i18n';

/** Uint8Array → base64（分块转换，避免大数组 spread 爆调用栈） */
export function bytesToBase64(data: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 另存为文本：桌面端弹保存对话框（壳的 save_text_file），浏览器里直接下载并释放 ObjectURL */
export async function saveText(defaultName: string, text: string, mime = 'text/plain;charset=utf-8'): Promise<boolean> {
  if (!isTauri()) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = defaultName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const r = await invoke<{ saved: boolean }>('save_text_file', { defaultName, text });
  return r.saved;
}

/** 选一个文件（路径由壳登记给 Core）；Web 版经 <input type=file>；浏览器开发模式不能选 */
export async function pickFile(kinds: string[]): Promise<string | undefined> {
  return (await pickFiles(kinds, false))[0];
}

/** 选文件：Tauri 由壳弹系统对话框；Web 版（Core 在页面里）用 <input type=file>，文件留在内存，登记成 mem: 路径 */
export async function pickFiles(kinds: string[], multiple: boolean): Promise<string[]> {
  if (!isTauri() && hasLocalCore()) {
    const files = await chooseFiles(kinds, multiple);
    const { registerMemFile } = await import('../mobile/local/files');
    return Promise.all(files.map(registerMemFile));
  }
  if (!isTauri()) { toast(tl('浏览器开发模式不能选文件，请在桌面端里操作')); return []; }
  const { invoke } = await import('@tauri-apps/api/core');
  const r = await invoke<{ paths: string[] }>('pick_file', { kinds, multiple });
  return r.paths;
}

/** 拖进来的文件（Web 版）：登记成 mem: 路径 */
export async function registerFiles(files: File[]): Promise<string[]> {
  const { registerMemFile } = await import('../mobile/local/files');
  return Promise.all(files.map(registerMemFile));
}

function chooseFiles(kinds: string[], multiple: boolean): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = multiple;
    input.accept = kinds.flatMap(k => (k === 'image' ? ['image/*'] : k === 'txt' ? ['.txt', '.md', '.markdown'] : [`.${k}`])).join(',');
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
