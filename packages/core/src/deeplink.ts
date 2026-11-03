/**
 * 应用内深链（tibi://…）：对话卡片上的按钮、系统打开的链接都走这一份语法。
 * 只认下面这几个地方，只是跳转、不做任何写入；导入（tibi://import?url=…）另有确认流程，不在这里。
 * 界面按平台把它换成自己的路由（桌面、手机的页面不一样）。
 */
export type DeepLink =
  | { to: 'read'; document_id: string; section_id?: string }
  | { to: 'library' }
  | { to: 'words' }
  | { to: 'review' }
  | { to: 'dict'; q?: string }
  | { to: 'stats' }
  | { to: 'settings'; section?: string }
  | { to: 'chat'; conversation_id: string };

const ID = /^[0-9a-zA-Z_-]{1,64}$/;
const SECTION = /^[a-z_]{1,32}$/;

/** 解析 tibi://…；不认识的、参数不合规的返回 undefined */
export function parseDeepLink(href: string): DeepLink | undefined {
  let u: URL;
  try { u = new URL(href); } catch { return undefined; }
  if (u.protocol !== 'tibi:') return undefined;
  // tibi://read/<id> 里 read 是 host；有的平台会把它解析进 pathname（tibi:read/<id>）
  const parts = [u.host, ...u.pathname.split('/')].filter(Boolean).map(decodeURIComponent);
  const [to, a, b] = parts;
  const q = u.searchParams;
  switch (to) {
    case 'read': return a && ID.test(a) && (!b || ID.test(b)) ? { to, document_id: a, ...(b ? { section_id: b } : {}) } : undefined;
    case 'library': case 'words': case 'review': case 'stats': return parts.length === 1 ? { to } : undefined;
    case 'dict': { const w = q.get('q')?.trim(); return w && w.length > 64 ? undefined : { to, ...(w ? { q: w } : {}) }; }
    case 'settings': { const s = q.get('sec') ?? undefined; return s && !SECTION.test(s) ? undefined : { to, ...(s ? { section: s } : {}) }; }
    case 'chat': return a && ID.test(a) ? { to, conversation_id: a } : undefined;
    default: return undefined;
  }
}

export function deepLink(l: DeepLink): string {
  switch (l.to) {
    case 'read': return `tibi://read/${l.document_id}${l.section_id ? `/${l.section_id}` : ''}`;
    case 'dict': return `tibi://dict${l.q ? `?q=${encodeURIComponent(l.q)}` : ''}`;
    case 'settings': return `tibi://settings${l.section ? `?sec=${l.section}` : ''}`;
    case 'chat': return `tibi://chat/${l.conversation_id}`;
    default: return `tibi://${l.to}`;
  }
}
