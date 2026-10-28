/**
 * 选角色页用的线条图标,照设计稿 kit/icons.js 抄(24×24、1.5 线宽、圆头、跟字色);
 * 不用字符当图标(「‹」「＋」「›」「▶」)。GameIcon 那套只有游戏画面用的几个,这里补选角色要的。
 */

import type { ReactNode } from 'react';

const PATHS = {
  back: <path d="M14.5 6 8.5 12l6 6" />,
  forward: <path d="M9.5 6l6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6h.01" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5v-11M7.5 9 12 4.5 16.5 9" />
      <path d="M4.5 19.5h15" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type PickIconName = keyof typeof PATHS;

export function PickIcon({ name, size = 16, className }: { name: PickIconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `av-ic ${className}` : 'av-ic'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
