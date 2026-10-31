import { describe, expect, it } from 'vitest';
import { checkUrl, htmlToMarkdown } from '../src/index.js';

describe('checkUrl', () => {
  it('拒绝非 http、本机与内网', async () => {
    await expect(checkUrl('ftp://a.b')).rejects.toThrow();
    await expect(checkUrl('http://localhost/x')).rejects.toThrow();
    await expect(checkUrl('http://127.0.0.1/')).rejects.toThrow();
    await expect(checkUrl('http://192.168.1.2/')).rejects.toThrow();
    await expect(checkUrl('http://[::1]/')).rejects.toThrow();
    await expect(checkUrl('not a url')).rejects.toThrow();
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
