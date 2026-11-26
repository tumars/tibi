import { describe, expect, it } from 'vitest';
import { checkUrl, htmlToMarkdown } from '../src/index.js';

describe('checkUrl', () => {
  it('拒绝非 http、本机与内网（含字面量 Fake-IP）', async () => {
    await expect(checkUrl('ftp://a.b')).rejects.toThrow();
    await expect(checkUrl('http://localhost/x')).rejects.toThrow();
    await expect(checkUrl('http://127.0.0.1/')).rejects.toThrow();
    await expect(checkUrl('http://192.168.1.2/')).rejects.toThrow();
    await expect(checkUrl('http://198.18.0.1/')).rejects.toThrow();
    await expect(checkUrl('http://198.18.1.60/')).rejects.toThrow();
    await expect(checkUrl('http://[::1]/')).rejects.toThrow();
    await expect(checkUrl('http://[fc00::1]/')).rejects.toThrow();
    await expect(checkUrl('not a url')).rejects.toThrow();
  });

  it('兼容 TUN 透明代理的 Fake-IP DNS 解析，同时继续拦截本机网关与真实内网', async () => {
    const tunLocals = new Set(['127.0.0.1', '::1', '198.18.0.1', 'fdfe:dcba:9876::1', 'fd00:1:1003::1']);
    const plainLocals = new Set(['127.0.0.1', '::1', '192.168.1.10']);

    // 域名经 TUN / 旁路由代理返回 198.18.0.0/15 Fake-IP → 放行
    await expect(checkUrl('http://open.live.bbc.co.uk/audio.mp3', {
      lookupHost: async () => [{ address: '198.18.1.60' }],
      localIps: tunLocals,
    })).resolves.toBeInstanceOf(URL);
    await expect(checkUrl('https://api.siliconflow.cn/v1/audio/transcriptions', {
      lookupHost: async () => [{ address: '198.18.0.159' }],
      localIps: plainLocals,
    })).resolves.toBeInstanceOf(URL);

    // 双栈 Fake-IP（198.18 + fc00::/18）或开启 TUN 代理时的 IPv6 Fake-IP → 放行
    await expect(checkUrl('https://example.com/feed.xml', {
      lookupHost: async () => [{ address: '198.18.1.10' }, { address: 'fc00::42' }],
      localIps: tunLocals,
    })).resolves.toBeInstanceOf(URL);
    await expect(checkUrl('https://example.com/feed.xml', {
      lookupHost: async () => [{ address: 'fc00::42' }],
      localIps: tunLocals,
    })).resolves.toBeInstanceOf(URL);

    // NAT64/DNS64 公网 IPv4 → 放行；内嵌私网 IPv4 → 拒绝
    await expect(checkUrl('https://example.com/a', {
      lookupHost: async () => [{ address: '64:ff9b::5db8:d822' }],
      localIps: plainLocals,
    })).resolves.toBeInstanceOf(URL);
    await expect(checkUrl('https://example.com/a', {
      lookupHost: async () => [{ address: '64:ff9b::127.0.0.1' }],
      localIps: plainLocals,
    })).rejects.toThrow('不能抓取本机或局域网地址');

    // 解析到本机 TUN 网关自身 IP → 拒绝
    await expect(checkUrl('https://evil.example/a', {
      lookupHost: async () => [{ address: '198.18.0.1' }],
      localIps: tunLocals,
    })).rejects.toThrow('不能抓取本机或局域网地址');

    // 无 Fake-IP 环境下的 fc00::/18，以及任何环境下的真实局域网 fd00::/8、127/8、192.168/16、10/8、100.64/10 → 拒绝
    await expect(checkUrl('https://evil.example/a', {
      lookupHost: async () => [{ address: 'fc00::42' }],
      localIps: plainLocals,
    })).rejects.toThrow('不能抓取本机或局域网地址');
    for (const addr of ['fd00:1:1003::2', '127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '100.64.0.1', '169.254.169.254', 'fe80::1']) {
      await expect(checkUrl('https://evil.example/a', {
        lookupHost: async () => [{ address: addr }],
        localIps: tunLocals,
      }), addr).rejects.toThrow('不能抓取本机或局域网地址');
    }
  });
});

describe('htmlToMarkdown', () => {
  it('保留标题、段落、列表、引用、代码块', () => {
    const md = htmlToMarkdown(`<article><h1>Title</h1><p>Hello <b>world</b>, see <a href="x">link</a>.</p>
      <ul><li>one</li><li>two <code>x</code></li></ul><blockquote><p>quoted</p></blockquote>
      <pre><code class="language-rust">fn main() {}\n</code></pre><p>end</p></article>`);
    expect(md).toContain('# Title');
    expect(md).toContain('Hello **world**, see link.');
    expect(md).toContain('- one\n- two `x`');
    expect(md).toContain('> quoted');
    expect(md).toContain('```rust\nfn main() {}\n```');
    expect(md.trim().endsWith('end')).toBe(true);
  });
});
