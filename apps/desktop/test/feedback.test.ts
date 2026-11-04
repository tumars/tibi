import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diagText, feedbackLink, FEEDBACK_EMAIL, osLabel, titleOf, type Diag } from '../src/lib/feedback';

const diag = (o: Partial<Diag> = {}): Diag => ({ version: '0.3.0', platform: 'macos', arm: true, lang: 'zh', models: { fast: 'deepseek-chat' }, errors: [], ...o });
const params = (url: string) => new URL(url).searchParams;
const template = (name: string) => readFileSync(new URL(`../../../.github/ISSUE_TEMPLATE/${name}`, import.meta.url), 'utf8');

describe('反馈', () => {
  it('系统名和 bug 模板的下拉选项对得上', () => {
    const bug = template('bug.yml');
    for (const d of [diag(), diag({ arm: false }), diag({ platform: 'windows' }), diag({ platform: 'linux' })]) expect(bug).toContain(osLabel(d)!);
    expect(osLabel(diag({ platform: 'ios' }))).toBeUndefined();
    expect(osLabel(diag({ arm: undefined }))).toBeUndefined();
  });

  it('预填的字段都是模板里有的', () => {
    const bug = params(feedbackLink('github', 'bug', '点了没反应', diag()).url);
    expect(bug.get('template')).toBe('bug.yml');
    for (const k of ['what', 'version', 'os', 'diag']) { expect(bug.get(k)).toBeTruthy(); expect(template('bug.yml')).toContain(`id: ${k}`); }
    const idea = params(feedbackLink('github', 'idea', '想要夜间模式', diag()).url);
    expect(idea.get('template')).toBe('feature.yml');
    expect(template('feature.yml')).toContain('id: problem');
    expect(idea.get('diag')).toBeNull();
  });

  it('不勾诊断信息就不带', () => {
    const p = params(feedbackLink('github', 'bug', 'x', undefined).url);
    expect(p.get('diag')).toBeNull();
    expect(p.get('version')).toBeNull();
    expect(feedbackLink('mail', 'other', 'hello', undefined).url).not.toContain('Tibi%200.3.0');
  });

  it('诊断信息带上最近的报错', () => {
    const t = diagText(diag({ errors: [{ at: '10:02', text: '导入失败' }] }));
    expect(t).toContain('Tibi 0.3.0 · macOS（Apple 芯片）');
    expect(t).toContain('[10:02] 导入失败');
    expect(t).toContain('深 未设置');
  });

  it('标题取第一行，太长截断', () => {
    expect(titleOf('bug', '第一行\n第二行')).toBe('[问题] 第一行');
    expect(titleOf('idea', 'a'.repeat(80))).toBe(`[建议] ${'a'.repeat(50)}…`);
  });

  it('邮件发到反馈邮箱', () => {
    const { url, copied } = feedbackLink('mail', 'bug', '查词卡住', diag());
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?`)).toBe(true);
    expect(decodeURIComponent(url)).toContain('查词卡住');
    expect(copied).toBeUndefined();
  });

  it('太长时改成复制到剪贴板', () => {
    const long = '很长的描述'.repeat(400);
    const mail = feedbackLink('mail', 'bug', long, diag());
    expect(mail.url.length).toBeLessThan(1800);
    expect(mail.copied).toContain(long);
    expect(mail.copied).toContain('Tibi 0.3.0');
    const gh = feedbackLink('github', 'other', long.repeat(2), diag());
    expect(gh.url.length).toBeLessThan(8000);
    expect(gh.copied).toContain('Tibi 0.3.0');
  });
});
