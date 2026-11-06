/**
 * Web 版的中转（docs/design/12-web.md §5）：EdgeOne Makers 边缘函数，路径 /api/proxy?url=<目标地址>。
 * 浏览器不能直接抓别的网站、RSS，部分模型服务商和坚果云也不给 CORS，经这里转一手。
 * - 只给本站页面用（Sec-Fetch-Site: same-origin 或 Origin 是本站）；挡不住命令行，只挡别的网站借用
 * - 只去公网：只认 http(s)，拦 localhost、内网和保留地址；GET / HEAD 手动跟重定向（最多 5 跳，每跳重查），别的方法不跟
 * - 不记日志、不缓存、不改内容；去掉 cookie、来源等请求头和 set-cookie，回来时加 x-tibi-final-url
 * 开发时 vite.config.ts 用同一份（handleProxy），不用起 EdgeOne。
 */

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PROPFIND', 'MKCOL', 'MOVE', 'COPY']);
const DROP_REQ = /^(host|cookie|origin|referer|connection|content-length|keep-alive|transfer-encoding|upgrade|priority|sec-.*|x-forwarded-.*|x-real-ip|cf-.*|eo-.*|x-tibi-.*)$/i;
const DROP_RES = /^(set-cookie2?|content-encoding|content-length|transfer-encoding|connection|keep-alive|access-control-.*|strict-transport-security|alt-svc)$/i;
const MAX_HOPS = 5;

/** 不能去的地址：本机、内网、保留段（IP 字面量）和局域网域名 */
export function blockedHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h || h === 'localhost' || /\.(localhost|local|internal|lan|home\.arpa)$/.test(h)) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0);
  }
  // IPv6 字面量：只放行全球单播（2000::/3）
  if (h.includes(':')) return !/^[23][0-9a-f]{0,3}:/.test(h);
  return false;
}

function fail(status, message) {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-tibi-proxy-error': encodeURIComponent(message) } });
}

function checkTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { return { error: '网址不对' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: '只能访问 http / https 网址' };
  if (u.username || u.password) return { error: '网址里不能带用户名和密码' };
  if (blockedHost(u.hostname)) return { error: '不能访问本机或内网地址' };
  return { url: u };
}

export async function handleProxy(request) {
  const self = new URL(request.url);
  const site = request.headers.get('sec-fetch-site'); const origin = request.headers.get('origin');
  if (!(site === 'same-origin' || (origin && origin === self.origin))) return fail(403, '只能从 Tibi 网页版里用');
  const method = request.method.toUpperCase();
  if (!METHODS.has(method)) return fail(405, `不支持 ${method}`);
  const first = checkTarget(self.searchParams.get('url') ?? '');
  if (first.error) return fail(400, first.error);

  const headers = new Headers();
  for (const [k, v] of request.headers) if (!DROP_REQ.test(k)) headers.set(k, v);
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
  const follow = method === 'GET' || method === 'HEAD';

  let url = first.url; let res;
  try {
    for (let hop = 0; ; hop++) {
      res = await fetch(url.href, { method, headers, body, redirect: 'manual' });
      const loc = res.headers.get('location');
      if (!follow || res.status < 300 || res.status >= 400 || !loc) break;
      if (hop >= MAX_HOPS) return fail(508, '重定向太多次');
      const next = checkTarget(new URL(loc, url).href);
      if (next.error) return fail(400, `被重定向到了不能访问的地址：${next.error}`);
      url = next.url;
    }
  } catch (e) {
    return fail(502, `连不上 ${url.hostname}：${e instanceof Error ? e.message : String(e)}`);
  }

  const out = new Headers();
  // 没跟的重定向：location 改名，不然浏览器会自己跟过去（绕过中转、被 CORS 拦）
  for (const [k, v] of res.headers) if (!DROP_RES.test(k)) out.set(k.toLowerCase() === 'location' ? 'x-tibi-location' : k, v);
  out.set('x-tibi-final-url', url.href);
  out.set('cache-control', 'no-store');
  const empty = method === 'HEAD' || [101, 103, 204, 205, 304].includes(res.status);
  return new Response(empty ? null : res.body, { status: res.status, statusText: res.statusText, headers: out });
}

export function onRequest(context) {
  return handleProxy(context.request);
}
