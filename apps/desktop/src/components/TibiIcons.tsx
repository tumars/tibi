import type { SVGProps } from 'react';
import { GENRE_NAMES } from '../lib/util';
import { tl } from '../lib/i18n';

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number, props: IconProps) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
  ...props,
});

/* ======================== Tibi 品牌小头像 ======================== */

/** Tibi 迷你藏狐正脸徽章：用于 AI 摘要、学习洞察、对话来源与审批卡（03 §5） */
export function TibiAvatar({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`tibi-av${className ? ` ${className}` : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="3 4.5 58 58" width={Math.round(size * 0.82)} height={Math.round(size * 0.82)}>
        <path d="M14.5 29 12 13.5c-.2-1.6 1.5-2.6 2.8-1.6L27 20zM49.5 29 52 13.5c.2-1.6-1.5-2.6-2.8-1.6L37 20z" fill="#f5a043" />
        <path d="M16.6 24.5 15.4 16.6l6.8 5.2zM47.4 24.5l1.2-7.9-6.8 5.2z" fill="#ffc7a6" />
        <rect x="9" y="17" width="46" height="38" rx="17" fill="#f5a043" />
        <path d="M9 40.5c0-3.6 9.6-3 23-3s23-.6 23 3C55 49 45.6 55 32 55S9 49 9 40.5z" fill="#fff4e2" />
        <circle cx="23" cy="32" r="5.6" fill="#fff" />
        <circle cx="41" cy="32" r="5.6" fill="#fff" />
        <circle cx="23.6" cy="33" r="3.4" fill="#2b1f17" />
        <circle cx="40.4" cy="33" r="3.4" fill="#2b1f17" />
        <circle cx="24.8" cy="31.7" r="1.15" fill="#fff" />
        <circle cx="41.6" cy="31.7" r="1.15" fill="#fff" />
        <path d="M16.5 28.2h12.8M34.7 28.2h12.8" stroke="#e3842a" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M28.8 39.6c0-2 6.4-2 6.4 0 0 2-1.8 3.2-3.2 3.2s-3.2-1.2-3.2-3.2z" fill="#2b1f17" />
        <path d="M32 42.6v1.4m0 0c-1 1.6-3.2 1.6-3.8.4m3.8-.4c1 1.6 3.2 1.6 3.8.4" stroke="#2b1f17" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        <ellipse cx="15.5" cy="41.5" rx="3.4" ry="2" fill="#ff8f7d" opacity=".6" />
        <ellipse cx="48.5" cy="41.5" rx="3.4" ry="2" fill="#ff8f7d" opacity=".6" />
      </svg>
    </span>
  );
}

/* ======================== 侧栏与主导航双色调图标 ======================== */

export function NavHomeIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M4.5 10.6 12 4.4l7.5 6.2v8.1a1.8 1.8 0 0 1-1.8 1.8H6.3a1.8 1.8 0 0 1-1.8-1.8v-8.1Z" className="ti-fill" />
      <path d="M3.5 11.2 11.1 4.9a1.4 1.4 0 0 1 1.8 0l7.6 6.3" />
      <path d="M5.2 10.2v8.4a1.9 1.9 0 0 0 1.9 1.9h9.8a1.9 1.9 0 0 0 1.9-1.9v-8.4" />
      <path d="M9.7 20.5v-5.2a2.3 2.3 0 0 1 4.6 0v5.2" />
    </svg>
  );
}

export function NavLibraryIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 6.5c-1.8-1.4-4.7-2-7.5-1.7v12.8c2.8-.3 5.7.3 7.5 1.7 1.8-1.4 4.7-2 7.5-1.7V4.8c-2.8-.3-5.7.3-7.5 1.7Z" className="ti-fill" />
      <path d="M12 6.5v12.8" />
      <path d="M12 6.5c-1.8-1.4-4.6-2-7.5-1.7a1 1 0 0 0-.9 1v11a1 1 0 0 0 1.1 1c2.7-.2 5.4.4 7.3 1.7 1.9-1.3 4.6-1.9 7.3-1.7a1 1 0 0 0 1.1-1v-11a1 1 0 0 0-.9-1c-2.9-.3-5.7.3-7.5 1.7Z" />
      <path d="M15.4 5.2v4.6l1.3-.9 1.3.9V4.9" className="ti-warm" />
    </svg>
  );
}

export function NavFeedsIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="4" y="4" width="16" height="16" rx="4.5" className="ti-fill" />
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <path d="M8.5 15.6a.6.6 0 1 0 0-.01" strokeWidth="2.4" className="ti-warm" />
      <path d="M8.5 12a3.6 3.6 0 0 1 3.6 3.6" />
      <path d="M8.5 8.5a7.1 7.1 0 0 1 7.1 7.1" />
    </svg>
  );
}

/** 生词本：呼应 Tibi 的生词罐子（empty-words） */
export function NavWordsIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M6.5 5.2A2.2 2.2 0 0 1 8.7 3h6.6a2.2 2.2 0 0 1 2.2 2.2v15.1l-5.5-3.4-5.5 3.4V5.2Z" className="ti-fill" />
      <path d="M6.5 5.2A2.2 2.2 0 0 1 8.7 3h6.6a2.2 2.2 0 0 1 2.2 2.2v15.1l-5.5-3.4-5.5 3.4V5.2Z" />
      <path d="M12 7.4l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7.7-1.7Z" className="ti-warm-fill" stroke="none" />
    </svg>
  );
}

export function NavDictIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M5.5 4.2A2.2 2.2 0 0 1 7.7 2h9.8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H7.7a2.2 2.2 0 0 1-2.2-2.2V4.2Z" className="ti-fill" />
      <path d="M5.5 18.8V4.2A2.2 2.2 0 0 1 7.7 2h9.8a1.5 1.5 0 0 1 1.5 1.5V17H7.7a2.2 2.2 0 0 0-2.2 1.8Zm0 0A2.2 2.2 0 0 0 7.7 21H19" />
      <path d="m10 12.6 2.3-5.8 2.3 5.8" />
      <path d="M10.8 10.9h3" />
    </svg>
  );
}

export function NavReviewIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="4" y="6.5" width="13.5" height="12" rx="3" className="ti-fill" />
      <rect x="4" y="6.5" width="13.5" height="12" rx="3" />
      <path d="M8.5 6.5V5.3A1.8 1.8 0 0 1 10.3 3.5h8.2a1.8 1.8 0 0 1 1.8 1.8v8.4a1.8 1.8 0 0 1-1.8 1.8h-1" />
      <path d="m8.6 12.6 1.7 1.7 3.4-3.4" className="ti-warm" />
    </svg>
  );
}

export function NavStatsIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="4.5" y="13" width="3.8" height="7" rx="1.6" className="ti-fill" />
      <rect x="10.1" y="9" width="3.8" height="11" rx="1.6" className="ti-fill" />
      <rect x="15.7" y="4.5" width="3.8" height="15.5" rx="1.6" className="ti-fill" />
      <rect x="4.5" y="13" width="3.8" height="7" rx="1.6" />
      <rect x="10.1" y="9" width="3.8" height="11" rx="1.6" />
      <rect x="15.7" y="4.5" width="3.8" height="15.5" rx="1.6" />
    </svg>
  );
}

export function NavSettingsIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="3.2" className="ti-fill" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

/* ======================== 总结面板 & 阅读器图标 ======================== */

export function SummaryOverviewIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M11 3.2 12.8 8.2 17.8 10l-5 1.8L11 16.8l-1.8-5-5-1.8 5-1.8L11 3.2Z" className="ti-fill" />
      <path d="M11 3.2 12.8 8.2 17.8 10l-5 1.8L11 16.8l-1.8-5-5-1.8 5-1.8L11 3.2Z" />
      <path d="M18.2 15.2l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" className="ti-warm-fill" stroke="none" />
    </svg>
  );
}

export function SummaryLevelIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="4" y="14" width="3.5" height="6" rx="1.4" className="ti-fill" />
      <rect x="10.2" y="10" width="3.5" height="10" rx="1.4" className="ti-fill" />
      <rect x="16.4" y="5" width="3.5" height="15" rx="1.4" className="ti-fill" />
      <rect x="4" y="14" width="3.5" height="6" rx="1.4" />
      <rect x="10.2" y="10" width="3.5" height="10" rx="1.4" />
      <rect x="16.4" y="5" width="3.5" height="15" rx="1.4" />
    </svg>
  );
}

export function SummaryPhrasesIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="3.5" y="5" width="17" height="14" rx="4" className="ti-fill" />
      <rect x="3.5" y="5" width="17" height="14" rx="4" />
      <path d="M7.5 10h9" />
      <path d="M7.5 14h5.5" />
      <circle cx="16.2" cy="14" r="1.2" className="ti-warm-fill" stroke="none" />
    </svg>
  );
}

export function SummaryHardIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v8A2.5 2.5 0 0 1 16.5 17H11l-4 3v-3H7.5A2.5 2.5 0 0 1 5 14.5v-8Z" className="ti-fill" />
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v8A2.5 2.5 0 0 1 16.5 17H11l-4 3v-3H7.5A2.5 2.5 0 0 1 5 14.5v-8Z" />
      <path d="M9.5 10.5h.01M12 10.5h.01M14.5 10.5h.01" strokeWidth="2.4" />
    </svg>
  );
}

export function SummaryAdviceIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 3.5a6.5 6.5 0 0 0-3.8 11.8c.6.5 1 1.2 1 2h5.6c0-.8.4-1.5 1-2A6.5 6.5 0 0 0 12 3.5Z" className="ti-fill" />
      <path d="M12 3.5a6.5 6.5 0 0 0-3.8 11.8c.6.5 1 1.2 1 2h5.6c0-.8.4-1.5 1-2A6.5 6.5 0 0 0 12 3.5Z" />
      <path d="M9.8 20.3h4.4" />
      <path d="M12 7.8v3.2" />
    </svg>
  );
}

/* ======================== 练习模式图标 ======================== */

export function PracticeDictationIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M4.5 13a7.5 7.5 0 0 1 15 0" />
      <rect x="4" y="13" width="3.8" height="6.5" rx="1.9" className="ti-fill" />
      <rect x="16.2" y="13" width="3.8" height="6.5" rx="1.9" className="ti-fill" />
      <rect x="4" y="13" width="3.8" height="6.5" rx="1.9" />
      <rect x="16.2" y="13" width="3.8" height="6.5" rx="1.9" />
      <path d="M10.5 14v2.5M13.5 13v4.5" />
    </svg>
  );
}

export function PracticeSpellIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="3.5" y="5.5" width="7.2" height="8.5" rx="2" className="ti-fill" />
      <rect x="3.5" y="5.5" width="7.2" height="8.5" rx="2" />
      <rect x="13.3" y="5.5" width="7.2" height="8.5" rx="2" className="ti-fill" />
      <rect x="13.3" y="5.5" width="7.2" height="8.5" rx="2" />
      <path d="M5.7 11.4 7.1 8l1.4 3.4M6.1 10.5h2" strokeWidth="1.5" />
      <path d="M15.4 9.7h3" strokeWidth="1.6" />
      <path d="M4.5 18h4M10 18h4M15.5 18h4" strokeWidth="1.9" />
    </svg>
  );
}

export function PracticeConfusableIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="3.5" y="5" width="8.5" height="11" rx="2.5" className="ti-fill" />
      <rect x="12" y="8" width="8.5" height="11" rx="2.5" className="ti-fill" />
      <rect x="3.5" y="5" width="8.5" height="11" rx="2.5" />
      <rect x="12" y="8" width="8.5" height="11" rx="2.5" />
      <path d="M6.3 9.5h3M14.8 13.5h3" />
    </svg>
  );
}

export function PracticeProduceIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M18.8 4.8a3.2 3.2 0 0 0-4.5 0L6.6 12.5 5.4 18.6l6.1-1.2 7.3-7.3a3.2 3.2 0 0 0 0-4.5Z" className="ti-fill" />
      <path d="M18.8 4.8a3.2 3.2 0 0 0-4.5 0L6.6 12.5 5.4 18.6l6.1-1.2 7.3-7.3a3.2 3.2 0 0 0 0-4.5Z" />
      <path d="M13 6.6 17.4 11" />
    </svg>
  );
}

/* ======================== 指标卡片图标 ======================== */

export function MetricDueIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="4" y="6.5" width="13.5" height="12" rx="3" className="ti-fill" />
      <rect x="4" y="6.5" width="13.5" height="12" rx="3" />
      <path d="M8.5 6.5V5.2A1.7 1.7 0 0 1 10.2 3.5h8.3a1.7 1.7 0 0 1 1.7 1.7v8.3a1.7 1.7 0 0 1-1.7 1.7h-1" />
    </svg>
  );
}

export function MetricReadIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="8.5" className="ti-fill" />
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.8v4.5l3 1.8" />
    </svg>
  );
}

export function MetricWordsIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M7.5 6.5h9a2 2 0 0 1 2 2v8.2a3.3 3.3 0 0 1-3.3 3.3H8.8a3.3 3.3 0 0 1-3.3-3.3V8.5a2 2 0 0 1 2-2Z" className="ti-fill" />
      <path d="M7.5 6.5h9a2 2 0 0 1 2 2v8.2a3.3 3.3 0 0 1-3.3 3.3H8.8a3.3 3.3 0 0 1-3.3-3.3V8.5a2 2 0 0 1 2-2Z" />
      <path d="M9 3.8h6" />
      <path d="M12 10.2l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MetricStreakIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12.6 3.5c.6 2.8-1.5 4.4-1.5 6.2 0 1 .7 1.8 1.6 1.8 1.3 0 2.1-1.3 2.1-3.1 2.2 1.6 3.7 4 3.7 6.6a6.5 6.5 0 1 1-13 0c0-3.4 2.5-6.6 5.2-8.7.6-.5 1.6-1.6 1.9-2.8Z" className="ti-fill" />
      <path d="M12.6 3.5c.6 2.8-1.5 4.4-1.5 6.2 0 1 .7 1.8 1.6 1.8 1.3 0 2.1-1.3 2.1-3.1 2.2 1.6 3.7 4 3.7 6.6a6.5 6.5 0 1 1-13 0c0-3.4 2.5-6.6 5.2-8.7.6-.5 1.6-1.6 1.9-2.8Z" />
    </svg>
  );
}

export function MetricMasteredIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 3.5 19 6.5v5.6c0 4.4-3 7.5-7 8.9-4-1.4-7-4.5-7-8.9V6.5l7-3Z" className="ti-fill" />
      <path d="M12 3.5 19 6.5v5.6c0 4.4-3 7.5-7 8.9-4-1.4-7-4.5-7-8.9V6.5l7-3Z" />
      <path d="m9.2 12.2 1.9 1.9 3.8-3.8" />
    </svg>
  );
}

/* ======================== 文章类型徽章 ======================== */

function GenreIcon({ genre, book, size = 12 }: { genre: string; book?: boolean; size?: number }) {
  if (book) {
    return (
      <svg {...base(size, { strokeWidth: 2 })}>
        <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v18H7.5A2.5 2.5 0 0 1 5 17.5v-13Z" className="ti-fill" />
        <path d="M5 17.5V4.5A2.5 2.5 0 0 1 7.5 2H19v15H7.5A2.5 2.5 0 0 0 5 19.5Zm0 0A2.5 2.5 0 0 0 7.5 22H19" />
      </svg>
    );
  }
  switch (genre) {
    case 'tech':
      return (
        <svg {...base(size, { strokeWidth: 2 })}>
          <path d="m9 8-4 4 4 4M15 8l4 4-4 4M13.2 6.5l-2.4 11" />
        </svg>
      );
    case 'news':
      return (
        <svg {...base(size, { strokeWidth: 2 })}>
          <rect x="4" y="4.5" width="16" height="15" rx="2.5" className="ti-fill" />
          <rect x="4" y="4.5" width="16" height="15" rx="2.5" />
          <path d="M8 9h8M8 13h5" />
        </svg>
      );
    case 'novel':
    case 'lit':
      return (
        <svg {...base(size, { strokeWidth: 2 })}>
          <path d="M18.5 4.5C12.5 5 8 9 6 15l3 3c6-2 10-6.5 10.5-12.5a1 1 0 0 0-1-1Z" className="ti-fill" />
          <path d="M18.5 4.5C12.5 5 8 9 6 15l3 3c6-2 10-6.5 10.5-12.5a1 1 0 0 0-1-1Z" />
          <path d="m6 15-1.5 4.5L9 18" />
        </svg>
      );
    case 'academic':
      return (
        <svg {...base(size, { strokeWidth: 2 })}>
          <path d="m3.5 9.5 8.5-4 8.5 4-8.5 4-8.5-4Z" className="ti-fill" />
          <path d="m3.5 9.5 8.5-4 8.5 4-8.5 4-8.5-4Z" />
          <path d="M7 11.5v4.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.5" />
        </svg>
      );
    default:
      return (
        <svg {...base(size, { strokeWidth: 2 })}>
          <rect x="4.5" y="4" width="15" height="16" rx="3" className="ti-fill" />
          <rect x="4.5" y="4" width="15" height="16" rx="3" />
          <path d="M8.5 9h7M8.5 13h5" />
        </svg>
      );
  }
}

const GENRE_TONE: Record<string, string> = {
  tech: 'tech',
  news: 'news',
  novel: 'novel',
  lit: 'novel',
  academic: 'academic',
  blog: 'blog',
};

/** 柔性低饱和度的文章类型标签：书架、首页、示例卡通用 */
export function GenreBadge({ genre, book, label }: { genre: string; book?: boolean; label?: string }) {
  const tone = book ? 'novel' : (GENRE_TONE[genre] ?? 'general');
  const text = label ?? (book ? tl('书') : (GENRE_NAMES[genre] ?? genre));
  return (
    <span className={`gbadge g-${tone}`}>
      <GenreIcon genre={genre} book={book} />
      <span>{text}</span>
    </span>
  );
}
