import { describe, expect, it } from 'vitest';
import { nodePlatform } from '../src/platform.js';

const p = nodePlatform({ app_version: 't', db_path: ':memory:', getSecret: async () => undefined });
const para = (s: string) => `<p>${s} ${'This sentence is here to make the paragraph long enough for the readability scorer to keep it as content. '.repeat(3)}</p>`;

describe('正文抽取（文档站）', () => {
  it('mdBook：去掉快捷键帮助、菜单栏标题；标题取正文的 h2', async () => {
    const html = `<html><head><title>What is Ownership? - The Rust Programming Language</title></head><body>
      <div id="mdbook-help-container"><div id="mdbook-help-popup"><h2>Keyboard shortcuts</h2><p>Press ← or → to navigate between chapters</p></div></div>
      <div id="mdbook-body-container"><nav id="mdbook-sidebar"><ol><li>Introduction</li></ol></nav>
      <div class="page"><div id="mdbook-menu-bar" class="menu-bar"><h1 class="menu-title">The Rust Programming Language</h1></div>
      <div id="mdbook-content" class="content"><main><h2 id="what-is-ownership">What Is Ownership?</h2>${para('Ownership is a set of rules.')}${para('Memory is managed through a system of ownership.')}</main></div></div></div></body></html>`;
    const a = await p.extractReadable(html, 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html');
    expect(a.markdown).not.toMatch(/Keyboard shortcuts|Press ←|Introduction/);
    expect(a.h1).toBe('What Is Ownership?');
    expect(a.markdown).toContain('Ownership is a set of rules.');
  });

  it('MDN：标题所在的 header 块里的导语不丢', async () => {
    const html = `<html><head><title>Using the Fetch API - Web APIs | MDN</title><meta property="og:site_name" content="MDN Web Docs"></head><body>
      <main id="content"><div class="layout__header"><h1>Using the Fetch API</h1><section class="content-section">${para('The Fetch API provides a JavaScript interface for making HTTP requests.')}</section></div>
      <div class="layout__body"><h2>Making a request</h2>${para('To make a request, call fetch().')}${para('The second argument is optional.')}${para('A third paragraph about responses.')}</div></main></body></html>`;
    const a = await p.extractReadable(html, 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch');
    expect(a.site_name).toBe('MDN Web Docs');
    expect(a.markdown.indexOf('The Fetch API provides')).toBeGreaterThanOrEqual(0);
    expect(a.markdown.indexOf('The Fetch API provides')).toBeLessThan(a.markdown.indexOf('To make a request'));
  });
});
