import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/lib/md';

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));
// Streamdown 会给标签加 class / data-streamdown：比较结构时去掉属性，mdtable 那层框原样留着
const tags = (text: string) => html(text).replace(/<(\w+)(?: [^>]*?)?(\/?)>/g, (m, tag: string, close: string) => m.includes('class="mdtable"') ? m : `<${tag}${close}>`);

describe('Markdown', () => {
  it('渲染表格，并包一层可横向滚动的框', () => {
    const out = tags('| 词 | 释义 |\n| --- | --- |\n| **tide** | 潮汐 |');
    expect(out).toContain('<div class="mdtable"><table>');
    expect(out).toContain('<th>词</th>');
    expect(out).toContain('<td><strong>tide</strong></td>');
  });

  it('嵌套列表', () => {
    expect(tags('- a\n  - b')).toMatch(/<ul>\s*<li>a\s*<ul>\s*<li>b<\/li>/);
  });

  it('粗体紧贴中文标点也生效', () => {
    expect(tags('**“潮汐”**的意思')).toContain('<strong>“潮汐”</strong>的意思');
  });

  it('单个换行保留，• 仍算列表', () => {
    expect(tags('第一行\n第二行')).toContain('<br/>');
    expect(tags('• 一项')).toContain('<li>一项</li>');
  });

  it('模型输出不能带来 HTML、外部图片和非 http 链接', () => {
    expect(html('<script>x</script>')).not.toContain('<script>');
    expect(html('![说明](https://evil.example/a.png)')).not.toContain('<img');
    expect(html('[点我](javascript:alert(1))')).not.toContain('<a');
    expect(html('[站点](https://example.com)')).toContain('target="_blank"');
  });
});
