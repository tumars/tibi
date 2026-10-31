/** 内容哈希（documents.content_hash）：规范化正文后 SHA-256，只用 WebCrypto */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, '0');
  return s;
}

/** 规范化：统一换行、压掉多余空白、去首尾，忽略大小写以外的差异 */
export function normalizeForHash(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
