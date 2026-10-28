/**
 * 游戏画面四角、对话区用的线条图标,照设计稿 kit/icons.js 抄(24×24、1.5 线宽、圆头、跟字色)。
 * 卡编辑器那套(studio/icons.tsx)是另一套笔画,不混用。
 */

import type { ReactNode } from 'react';

const PATHS = {
  auto: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.4 9.3v5.4l3.4-2.7zM12.6 9.3v5.4l3.4-2.7z" />
    </>
  ),
  skip: (
    <>
      <path d="M6 5.5v13l9.5-6.5z" />
      <path d="M18.5 5.5v13" />
    </>
  ),
  menu: <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />,
  history: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v3.7h3.7" />
      <path d="M12 8v4.3l2.8 1.7" />
    </>
  ),
  model: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
      <path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3" />
    </>
  ),
  imagegen: (
    <>
      <path d="M20 4c-3.3 1.4-7 4.9-9.2 7.8l1.4 1.4C15.1 11 18.6 7.3 20 4z" />
      <path d="M10.3 12.6c-2.2 0-3.9 1.6-4 3.8-.1 1.4-.8 2.5-2.3 3.1 1.3.8 3 1 4.6.6 2.4-.6 3.8-2.7 3.4-5.3z" />
    </>
  ),
  voice: (
    <>
      <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
      <path d="M18 6.7a7.5 7.5 0 0 1 0 10.6" />
    </>
  ),
  retry: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4.3h-4.3" />
    </>
  ),
  hide: (
    <>
      <path d="M4 12s3-5.5 8-5.5c1.5 0 2.8.4 3.9 1M20 12s-3 5.5-8 5.5c-1.5 0-2.8-.4-3.9-1" />
      <path d="M9.9 14.1a3 3 0 0 1 4.2-4.2" />
      <path d="M5 19 19 5" />
    </>
  ),
  send: (
    <>
      <path d="M20.5 3.5 3.5 10.4l7 3.1 3.1 7z" />
      <path d="M20.5 3.5l-10 10" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  // 线上方右边「已思考」前面那支笔、语音面板「音色」的 ▾、右键小菜单的三项(kit/icons.js 同名那几个)
  think: (
    <>
      <path d="M19.5 4.5c-6.5.6-11 5.2-11.6 11.8L6.5 19.5" />
      <path d="M8.2 13.8h5.6c2.8-1.6 4.8-4.8 5.7-9.3" />
    </>
  ),
  down: <path d="M6.5 9.5 12 15l5.5-5.5" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  edit: (
    <>
      <path d="M15.5 5.5l3 3L9 18H6v-3z" />
      <path d="M13.5 7.5l3 3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6h.01" />
    </>
  ),
  'voice-wave': (
    <>
      <path className="b1" d="M6 9.5v5" />
      <path className="b2" d="M10 6.5v11" />
      <path className="b3" d="M14 8.5v7" />
      <path className="b4" d="M18 10.5v3" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type GameIconName = keyof typeof PATHS;

export function GameIcon({ name, size = 20, className }: { name: GameIconName; size?: number; className?: string }) {
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
