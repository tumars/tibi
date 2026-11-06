/**
 * Web 版的密钥（12 §6）：API Key、WebDAV 密码存在 IndexedDB 的 tibi-secrets 里，页面和 Worker 都能读。
 * 比系统钥匙串弱（同一浏览器里的扩展、本站的 XSS 都拿得到），设置页要写明。
 */
const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open('tibi-secrets', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('secrets');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

async function inStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction('secrets', mode).objectStore('secrets'));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

export const getSecret = (ref: string) => inStore<string | undefined>('readonly', s => s.get(ref));
export const setSecret = (ref: string, secret: string) => inStore<void>('readwrite', s => s.put(secret, ref));
export const deleteSecret = (ref: string) => inStore<void>('readwrite', s => s.delete(ref));
