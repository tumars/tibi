/**
 * Web 版的跨域请求（12 §5）：浏览器不能直接抓别的网站，站内有个中转 /api/proxy（edge-functions/api/proxy.js）。
 * - 抓网页、RSS：一律经中转（throughProxy）
 * - 其余（模型 API、WebDAV）：先直连，被 CORS 拦了（fetch 抛 TypeError）再经中转，并记住这个站点（webFetch）
 * 经中转拿到的 Response，url 换回目标地址（重定向后的，中转放在 x-tibi-final-url 里）。
 */
const PROXY = `${import.meta.env.BASE_URL}api/proxy`;
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

export const proxyUrl = (target: string) => `${PROXY}?url=${encodeURIComponent(target)}`;

const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

export async function throughProxy(pageFetch: typeof fetch, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = urlOf(input);
  let opts: RequestInit = { ...init };
  if (input instanceof Request) {
    const method = init?.method ?? input.method;
    opts = { method, headers: init?.headers ?? input.headers, signal: init?.signal ?? input.signal, body: init?.body ?? (/^(GET|HEAD)$/i.test(method) ? undefined : await input.clone().arrayBuffer()) };
  }
  delete (opts as { maxRedirections?: number }).maxRedirections;
  const r = await pageFetch(proxyUrl(url), { ...opts, cache: 'no-store' });
  const err = r.headers.get('x-tibi-proxy-error');
  if (err) throw new TypeError(decodeURIComponent(err));
  const res = new Response(NULL_BODY.has(r.status) ? null : r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
  Object.defineProperty(res, 'url', { value: r.headers.get('x-tibi-final-url') ?? url });
  return res;
}

export function webFetch(pageFetch: typeof fetch): typeof fetch {
  const viaProxy = new Set<string>();
  return async (input, init) => {
    const url = urlOf(input);
    const host = new URL(url).host;
    if (viaProxy.has(host)) return throughProxy(pageFetch, input, init);
    try { return await pageFetch(input, init); }
    catch (e) {
      if (init?.signal?.aborted || (e as Error).name === 'AbortError') throw e;
      viaProxy.add(host);
      return throughProxy(pageFetch, input, init);
    }
  };
}
