import { parseDeepLink, type DeepLink } from '@tibi/core/deeplink';

/** 手机壳（Core 跑在 WebView 里）：页面比桌面少，设置都在"我的"里 */
const isMobile = () => !!(window as { __TIBI_LOCAL_CORE__?: boolean }).__TIBI_LOCAL_CORE__;

/** tibi:// 深链 → 这个平台的路由；手机上没有的页面退回最接近的 */
function routeOf(l: DeepLink, mobile = isMobile()): string {
  switch (l.to) {
    case 'read': return mobile || !l.section_id ? `/read/${l.document_id}` : `/read/${l.document_id}/${l.section_id}`;
    case 'library': return '/library';
    case 'review': return '/review';
    case 'settings': return mobile ? '/me' : `/settings${l.section ? `?sec=${encodeURIComponent(l.section)}` : ''}`;
    case 'chat': return mobile ? '/' : `/chat/${l.conversation_id}`;
    case 'words': return mobile ? '/library' : '/words';
    case 'dict': return mobile ? '/' : `/dict${l.q ? `?q=${encodeURIComponent(l.q)}` : ''}`;
    case 'stats': return mobile ? '/me' : '/stats';
  }
}

/** 跳到深链指的地方；不认识的链接返回 false，什么都不做 */
export function openDeepLink(href: string): boolean {
  const l = parseDeepLink(href);
  if (!l) return false;
  location.hash = routeOf(l);
  return true;
}
