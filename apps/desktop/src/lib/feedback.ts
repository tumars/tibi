import type { NoticePlatform } from './notice';

/**
 * 反馈与建议：Tibi 没有服务器，只把用户写好的内容拼成 GitHub 新建 issue 或 mailto 的链接，
 * 交给浏览器 / 邮件客户端，用户在那边看过再发。诊断信息只有版本、系统、模型名和最近的报错，不带文章、生词、对话和 Key。
 */
export type FeedbackKind = 'bug' | 'idea' | 'other';
export type FeedbackVia = 'github' | 'mail';

export const FEEDBACK_EMAIL = 'menghui9898@hotmail.com';
const NEW_ISSUE = 'https://github.com/tumars/tibi/issues/new';
// GitHub 的网址超过 8 KB 会 414；有的邮件客户端 mailto 过 2 KB 就截断
const LIMIT: Record<FeedbackVia, number> = { github: 8000, mail: 1800 };

export interface Diag {
  version: string;
  platform: NoticePlatform;
  /** 只在 macOS 上有意义：Apple 芯片还是 Intel */
  arm?: boolean;
  lang: string;
  models: { fast?: string; deep?: string };
  errors: { at: string; text: string }[];
}

/** 和 bug.yml 的系统下拉选项一字不差，GitHub 才会预选上；手机没有对应选项 */
export function osLabel(d: Pick<Diag, 'platform' | 'arm'>): string | undefined {
  if (d.platform === 'macos') return d.arm === undefined ? undefined : d.arm ? 'macOS（Apple 芯片）' : 'macOS（Intel）';
  return ({ windows: 'Windows', linux: 'Linux' } as Partial<Record<NoticePlatform, string>>)[d.platform];
}

export function diagText(d: Diag): string {
  const os = osLabel(d) ?? d.platform;
  const lines = [
    `Tibi ${d.version || '?'} · ${os} · ${d.lang}`,
    `模型：快 ${d.models.fast ?? '未设置'} / 深 ${d.models.deep ?? '未设置'}`,
  ];
  if (d.errors.length) lines.push('最近的报错：', ...d.errors.map(e => `[${e.at}] ${e.text}`));
  return lines.join('\n');
}

const TITLE_PREFIX: Record<FeedbackKind, string> = { bug: '[问题]', idea: '[建议]', other: '[反馈]' };
/** 第一行当标题，太长截断 */
export function titleOf(kind: FeedbackKind, text: string): string {
  const first = (text.trim().split('\n')[0] ?? '').trim();
  return `${TITLE_PREFIX[kind]} ${first.length > 50 ? first.slice(0, 50) + '…' : first}`;
}

/** 拼好的链接；内容太长时 copied 是完整正文，链接里换成"粘贴到这里"的提示，由调用方先复制到剪贴板 */
export interface FeedbackLink { url: string; copied?: string }

const PASTE = '（内容太长，已复制到剪贴板，请粘贴到这里）';

export function feedbackLink(via: FeedbackVia, kind: FeedbackKind, text: string, diag?: Diag): FeedbackLink {
  const body = text.trim();
  const title = titleOf(kind, body);
  const dt = diag && diagText(diag);
  if (via === 'mail') {
    const full = dt ? `${body}\n\n---\n${dt}` : body;
    const make = (b: string) => `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(`Tibi ${title}`)}&body=${encodeURIComponent(b)}`;
    const url = make(full);
    return url.length <= LIMIT.mail ? { url } : { url: make(PASTE), copied: full };
  }
  // 问题和建议按仓库里的 issue 模板填字段（字段 id 见 .github/ISSUE_TEMPLATE），其他走空白 issue
  const fields = (b: string, d?: string): Record<string, string> => {
    if (kind === 'idea') return { template: 'feature.yml', problem: b };
    if (kind === 'bug') {
      const os = diag && osLabel(diag);
      return { template: 'bug.yml', what: b, ...(diag?.version ? { version: diag.version } : {}), ...(os ? { os } : {}), ...(d ? { diag: d } : {}) };
    }
    return { body: d ? `${b}\n\n---\n\`\`\`text\n${d}\n\`\`\`` : b };
  };
  const make = (f: Record<string, string>) => `${NEW_ISSUE}?${new URLSearchParams({ title, ...f })}`;
  // 建议模板没有诊断字段，不带
  const withDiag = kind === 'idea' ? undefined : dt;
  const url = make(fields(body, withDiag));
  if (url.length <= LIMIT.github) return { url };
  const full = withDiag ? `${body}\n\n---\n${withDiag}` : body;
  return { url: make(fields(PASTE)), copied: full };
}
