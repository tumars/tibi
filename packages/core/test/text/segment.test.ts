import { describe, expect, it } from 'vitest';
import { segmentMarkdown, splitBlocks, splitSentences } from '../../src/domain/text/index.js';

describe('splitSentences', () => {
  it('缩写、小数、引号、句尾括号', () => {
    const s = splitSentences('Mr. Smith paid $3.50 for it. "Really?" she asked. He said no (twice). It works, e.g. on Linux. Done!');
    expect(s).toEqual(['Mr. Smith paid $3.50 for it.', '"Really?" she asked.', 'He said no (twice).', 'It works, e.g. on Linux.', 'Done!']);
  });
  it('U.S. 与人名缩写不切', () => {
    expect(splitSentences('J. K. Rowling lives in the U.K. now. Fine.')).toEqual(['J. K. Rowling lives in the U.K. now.', 'Fine.']);
  });
  it('没有句末标点也成一句', () => {
    expect(splitSentences('no punctuation here')).toEqual(['no punctuation here']);
  });
});

describe('splitBlocks', () => {
  it('标题、段落、列表、引用、代码块', () => {
    const md = `# Title\n\nFirst para line one\nline two.\n\n- item one\n- item two\n\n> quoted text\n\n\`\`\`rust\nfn main() {}\n\`\`\`\n\nLast.`;
    const b = splitBlocks(md);
    expect(b.map(x => x.block_type)).toEqual(['heading', 'prose', 'list_item', 'list_item', 'quote', 'code', 'prose']);
    expect(b[1]!.text).toBe('First para line one line two.');
    expect(b[5]).toMatchObject({ text: 'fn main() {}', lang: 'rust' });
  });
  it('行内标记去掉但保留行内代码', () => {
    const b = splitBlocks('Use **bold** and [link](http://x) and `code()` here.');
    expect(b[0]!.text).toBe('Use bold and link and `code()` here.');
  });
});

describe('segmentMarkdown', () => {
  it('文章只有一个章节，去掉与标题相同的首行标题', () => {
    const seg = segmentMarkdown('# Hello\n\nA sentence. Another one.\n\n```js\nx\n```', { title: 'Hello' });
    expect(seg.sections).toHaveLength(1);
    expect(seg.sections[0]!.paragraphs.map(p => p.block_type)).toEqual(['prose', 'code']);
    expect(seg.word_count).toBe(4);
    expect(seg.lang).toBe('en');
  });
  it('书按一级标题分章', () => {
    const seg = segmentMarkdown('Intro text.\n\n# Chapter 1\n\nOne.\n\n# Chapter 2\n\nTwo.', { kind: 'book', title: 'Book' });
    expect(seg.sections.map(s => s.title)).toEqual(['Book', 'Chapter 1', 'Chapter 2']);
    expect(seg.sections[2]!.paragraphs[0]!.text).toBe('Two.');
  });
});
