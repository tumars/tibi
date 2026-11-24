import { describe, expect, it } from 'vitest';
import { classifyClipboardHint, classifyTrayQuery, DEFAULT_TRAY_HOTKEY, hotkeyKeys } from '../src/tray/classify';

describe('macOS 顶栏快捷查词：输入意图分类', () => {
  it('空串和空白归为 empty', () => {
    expect(classifyTrayQuery('')).toEqual({ kind: 'empty' });
    expect(classifyTrayQuery('   \t ')).toEqual({ kind: 'empty' });
  });

  it('识别英文单词、变形、短语和短中文为查词', () => {
    expect(classifyTrayQuery('ubiquitous')).toEqual({ kind: 'dict', text: 'ubiquitous' });
    expect(classifyTrayQuery('  went  ')).toEqual({ kind: 'dict', text: 'went' });
    expect(classifyTrayQuery('look forward to')).toEqual({ kind: 'dict', text: 'look forward to' });
    expect(classifyTrayQuery('苹果')).toEqual({ kind: 'dict', text: '苹果' });
    expect(classifyTrayQuery('re-render')).toEqual({ kind: 'dict', text: 're-render' });
  });

  it('识别 http(s) 网址为导入', () => {
    expect(classifyTrayQuery('https://blog.rust-lang.org/2026/01/post')).toEqual({
      kind: 'url',
      url: 'https://blog.rust-lang.org/2026/01/post',
      host: 'blog.rust-lang.org',
    });
  });

  it('识别长英文段落为 passage，问句和长句子为 ask', () => {
    const passage = 'Remote work has become ubiquitous across modern software engineering teams, reshaping how distributed organizations write documentation, review architecture proposals, and mentor junior engineers every single day.';
    expect(classifyTrayQuery(passage)).toEqual({ kind: 'passage', text: passage });
    expect(classifyTrayQuery('ubiquitous 和 pervasive 有什么区别？')).toEqual({ kind: 'ask', text: 'ubiquitous 和 pervasive 有什么区别？' });
    expect(classifyTrayQuery('What does this sentence mean in context?')).toEqual({ kind: 'ask', text: 'What does this sentence mean in context?' });
  });
});

describe('macOS 顶栏快捷查词：剪贴板建议过滤', () => {
  it('接受干净的英文词/短语与网址', () => {
    expect(classifyClipboardHint('serendipity')).toEqual({ kind: 'word', text: 'serendipity' });
    expect(classifyClipboardHint('break down')).toEqual({ kind: 'word', text: 'break down' });
    expect(classifyClipboardHint('https://example.com/article')).toEqual({
      kind: 'url',
      url: 'https://example.com/article',
      host: 'example.com',
    });
  });

  it('过滤多行内容、全大写常量、含数字 token 与中文长句', () => {
    expect(classifyClipboardHint('')).toBeNull();
    expect(classifyClipboardHint('line1\nline2')).toBeNull();
    expect(classifyClipboardHint('API_KEY_SECRET')).toBeNull();
    expect(classifyClipboardHint('abc123def')).toBeNull();
    expect(classifyClipboardHint('这是一段很长的中文剪贴板内容')).toBeNull();
  });

  it('快捷键预设映射正确', () => {
    expect(hotkeyKeys(DEFAULT_TRAY_HOTKEY)).toBe('⌥⇧D');
    expect(hotkeyKeys('off')).toBe('');
    expect(hotkeyKeys('alt+space')).toBe('⌥Space');
  });
});
