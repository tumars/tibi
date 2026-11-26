/**
 * 统一的网址形态与私有 IP 校验（05 §8，纯 TS，Core / Core-Node / 手机 / Web 共用）。
 * - 严格区分 IPv6 字面量与普通域名（避免 fc* / fd* / fe80* 误杀 fcc.gov、fdic.gov、fdroid.org 等域名）
 * - 覆盖 IPv4 私有/回环/CGNAT/链路本地/多播/保留段，以及 IPv6 ::/::1、fc00::/7、fe80::/10、ff00::/8、IPv4 映射/兼容与 NAT64 地址
 * - 区分字面量地址与 DNS 解析出的代理 Fake-IP（Clash / Mihomo / Surge / Sing-box TUN 默认 198.18.0.0/15 与 fc00::/18）
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEX4_RE = /^[0-9a-f]{1,4}$/;

export interface PrivateIpOptions {
  /** 允许 DNS 解析出的代理 IPv4 Fake-IP（198.18.0.0/15，Clash / Mihomo / Surge / Sing-box TUN 默认段） */
  allowFakeIp?: boolean;
  /** 允许 DNS 解析出的代理 IPv6 Fake-IP（fc00::/18，仅在确认启用 Fake-IP 代理时打开，不放行 fd00::/8 真实局域网 ULA） */
  allowFakeIpV6?: boolean;
}

function parseIpv4Octets(ip: string): [number, number, number, number] | undefined {
  const m = IPV4_RE.exec(ip);
  if (!m) return undefined;
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
  if (a > 255 || b > 255 || c > 255 || d > 255) return undefined;
  return [a, b, c, d];
}

function parseIpv6Words(ip: string): number[] | undefined {
  let s = ip;
  if (s.includes('.')) {
    const lastColon = s.lastIndexOf(':');
    if (lastColon < 0) return undefined;
    const octets = parseIpv4Octets(s.slice(lastColon + 1));
    if (!octets) return undefined;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return undefined;
  const parsePart = (part: string): number[] | undefined => {
    if (!part) return [];
    const segs = part.split(':');
    const out: number[] = [];
    for (const seg of segs) {
      if (!HEX4_RE.test(seg)) return undefined;
      out.push(Number.parseInt(seg, 16));
    }
    return out;
  };
  if (halves.length === 1) {
    const words = parsePart(halves[0]!);
    return words && words.length === 8 ? words : undefined;
  }
  const left = parsePart(halves[0]!);
  const right = parsePart(halves[1]!);
  if (!left || !right || left.length + right.length >= 8) return undefined;
  const zeros = new Array<number>(8 - left.length - right.length).fill(0);
  return [...left, ...zeros, ...right];
}

function wordsToIpv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/** 从 IPv4-mapped（::ffff:0:0/96）、IPv4-translated（::ffff:0:0:0/96）或 NAT64（64:ff9b::/96）提取内嵌 IPv4 */
export function extractEmbeddedIpv4(rawIp: string): string | undefined {
  const ip = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0]!.toLowerCase();
  if (!ip.includes(':')) return undefined;
  const w = parseIpv6Words(ip);
  if (!w) return undefined;
  const zero0to3 = w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0;
  // ::ffff:a.b.c.d
  if (zero0to3 && w[4] === 0 && w[5] === 0xffff) return wordsToIpv4(w[6]!, w[7]!);
  // ::ffff:0:a.b.c.d (RFC 2765)
  if (zero0to3 && w[4] === 0xffff && w[5] === 0) return wordsToIpv4(w[6]!, w[7]!);
  // 64:ff9b::a.b.c.d (RFC 6052 Well-Known NAT64)
  if (w[0] === 0x0064 && w[1] === 0xff9b && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0) {
    return wordsToIpv4(w[6]!, w[7]!);
  }
  return undefined;
}

/** 198.18.0.0/15（RFC 2544 benchmark，桌面 TUN 透明代理默认 Fake-IP 地址池） */
export function isFakeIpV4(rawIp: string): boolean {
  const ip = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0]!.toLowerCase();
  const v4 = ip.includes(':') ? extractEmbeddedIpv4(ip) : ip;
  if (!v4) return false;
  const octets = parseIpv4Octets(v4);
  return !!octets && octets[0] === 198 && (octets[1] === 18 || octets[1] === 19);
}

export function isPrivateIpv4(ip: string, opts?: PrivateIpOptions): boolean {
  const octets = parseIpv4Octets(ip);
  if (!octets) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;          // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true;                     // 169.254.0.0/16 Link-local
  if (a === 172 && b >= 16 && b <= 31) return true;            // 172.16.0.0/12
  if (a === 192 && b === 168) return true;                     // 192.168.0.0/16
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return !opts?.allowFakeIp; // 198.18.0.0/15 benchmark / TUN Fake-IP
  if (a >= 224) return true;                                   // Multicast & reserved/broadcast
  return false;
}

export function isPrivateIp(rawIp: string, opts?: PrivateIpOptions): boolean {
  const ip = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0]!.toLowerCase();
  if (!ip) return false;
  if (!ip.includes(':')) return isPrivateIpv4(ip, opts);

  const w = parseIpv6Words(ip);
  if (!w) return true;

  // 未指定 (::)、回环 (::1) 及已废弃的 IPv4-compatible (::/96)
  if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0) return true;

  // IPv4-mapped / IPv4-translated / NAT64 Well-Known Prefix：按内嵌 IPv4 判定
  const embedded = extractEmbeddedIpv4(ip);
  if (embedded) return isPrivateIpv4(embedded, opts);

  if (w[0] === 0x0064 && w[1] === 0xff9b && w[2] === 0x0001) return true; // RFC 8215 本地 NAT64
  if (w[0] === 0x0100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return true; // RFC 6666 Discard-Only
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true;                        // RFC 3849 文档地址

  // fc00::/7 唯一本地地址 (fc00–fdff)；仅在明确允许 IPv6 Fake-IP 时放行 fc00::/18，fd00::/8 真实局域网 ULA 始终拦截
  if ((w[0]! & 0xfe00) === 0xfc00) {
    if (opts?.allowFakeIpV6 && w[0] === 0xfc00 && (w[1]! & 0xc000) === 0) return false;
    return true;
  }
  if ((w[0]! & 0xffc0) === 0xfe80) return true;   // fe80::/10 链路本地地址 (fe80–febf)
  if ((w[0]! & 0xffc0) === 0xfec0) return true;   // fec0::/10 已废弃站点本地地址
  if ((w[0]! & 0xff00) === 0xff00) return true;   // ff00::/8 多播
  return false;
}

export function isBlockedHostname(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.localhost')) return true;
  return isPrivateIp(h);
}

/** 校验网址形态（不抓内容、不查 DNS）：只收 http(s)，拒绝本机与内网字面地址 */
export function checkUrlShape(raw: string): { ok: boolean; url?: string; host?: string; error?: 'invalid_source' } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, error: 'invalid_source' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'invalid_source' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isBlockedHostname(host)) return { ok: false, error: 'invalid_source' };
  u.hash = '';
  return { ok: true, url: u.toString(), host: host.replace(/^www\./, '') };
}
