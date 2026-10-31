import { describe, expect, it } from 'vitest';
import { classifyInput, wordClass } from '../src/lib/util';

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
