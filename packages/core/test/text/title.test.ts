import { describe, expect, it } from 'vitest';
import { cleanTitle, dropLeadingTitle } from '../../src/domain/text/title.js';

describe('网页标题清理', () => {
  it('去掉站点名后缀 / 前缀', () => {
    expect(cleanTitle('What is Ownership? - The Rust Programming Language', { site: 'The Rust Programming Language' })).toBe('What is Ownership?');
    expect(cleanTitle('MDN Web Docs | Using Fetch', { site: 'MDN Web Docs' })).toBe('Using Fetch');
  });
  it('没有站点名时按 h1 或主机名判断', () => {
    expect(cleanTitle('What is Ownership? - The Rust Programming Language', { h1: 'What Is Ownership?' })).toBe('What is Ownership?');
    expect(cleanTitle('Why Rust Is Eating the Backend | Acme Blog', { host: 'blog.acme.com' })).toBe('Why Rust Is Eating the Backend');
  });
  it('主机名是标题后缀里的一个词', () => {
    expect(cleanTitle('Go 1.22 is released! - The Go Programming Language', { host: 'go.dev' })).toBe('Go 1.22 is released!');
  });
  it('拿不准就不动', () => {
    expect(cleanTitle('Rust - A Language Empowering Everyone')).toBe('Rust - A Language Empowering Everyone');
  });
  it('正文开头重复的标题去掉', () => {
    expect(dropLeadingTitle('## What Is Ownership?\n\nOwnership is…', 'What is Ownership?')).toBe('Ownership is…');
    expect(dropLeadingTitle('## Intro\n\nText', 'Other')).toBe('## Intro\n\nText');
  });
});
