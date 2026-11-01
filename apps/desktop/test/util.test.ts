import { describe, expect, it } from 'vitest';
import { classifyInput, splitAnswer, wordClass } from '../src/lib/util';

describe('wordClass', () => {
  it('按状态着色：生词 / 学习中 / 待确认；已知不标', () => {
    expect(wordClass(0)).toBe('w s0');
    expect(wordClass(3)).toBe('w s3');
    expect(wordClass(99)).toBe('w s99');
    expect(wordClass(5)).toBe('w');
    expect(wordClass(97)).toBe('w');
    expect(wordClass(98)).toBe('w');
    expect(wordClass(undefined)).toBe('w');
  });
});

describe('classifyInput（R13）', () => {
  it('网址 → url；长段英文 → text；其余 → ask', () => {
    expect(classifyInput('https://blog.rust-lang.org/2026/10/30/Rust-1.90.0.html')).toBe('url');
    expect(classifyInput('Ownership is the feature that makes Rust distinctive among systems languages. '.repeat(3))).toBe('text');
    expect(classifyInput('推荐一篇 10 分钟的新闻')).toBe('ask');
    expect(classifyInput('what does upshot mean')).toBe('ask');
  });
});

describe('splitAnswer', () => {
  it('只认整词，不切到别的词中间', () => {
    expect(splitAnswer('Open the window and do it.', ['do'])).toEqual({ before: 'Open the window and ', mid: 'do', after: ' it.' });
  });
  it('原文是变形时切出整个变形', () => {
    expect(splitAnswer('A compiler does this.', ['do', 'does', 'did'], 'does')).toEqual({ before: 'A compiler ', mid: 'does', after: ' this.' });
    expect(splitAnswer('She made it.', ['make', 'made'])).toMatchObject({ mid: 'made' });
  });
  it('填空题遮住句子里别处的同一个词', () => {
    expect(splitAnswer('Do it, then do it again.', ['do'], 'do', true)).toEqual({ before: '', mid: 'Do', after: ' it, then ____ it again.' });
  });
  it('句子里没有这个词时不切', () => {
    expect(splitAnswer('Nothing here.', ['do'])).toEqual({ before: 'Nothing here.', mid: '', after: '' });
  });
});
