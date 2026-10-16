/**
 * 卡编辑器 / 素材管理用的图标:24 格、描边,和画布第四版的图一模一样(v4_boards.py 的 I / PLAY / DOTS / STAR)。
 * 颜色跟着文字走(currentColor),大小、描边粗细可调;play、pause、dots 默认是实心的,star 实心 = ★、描边 = ☆。
 */

import type { ReactNode } from 'react';

const PATHS = {
  back: <path d="M15 18l-6-6 6-6" />,
  person: (
    <>
      <circle cx="12" cy="7.5" r="3.8" />
      <path d="M4.5 21v-1.5a7.5 7.5 0 0 1 15 0V21" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </>
  ),
  scene: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M3 16l5-4.5 4 3.5 3-2.5 6 5" />
      <circle cx="16" cy="9" r="1.6" />
    </>
  ),
  cg: (
    <>
      <path d="M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2L12 18.5l-2.2-5.3L4.5 11l5.3-2.2z" />
      <path d="M19 17v4M17 19h4" />
    </>
  ),
  preset: (
    <>
      <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="17" r="2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.6 18.4a6.2 6.2 0 0 1 10.8 0" />
    </>
  ),
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  check_circle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.8 2.8L16.5 9.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4.5M12 17.2h.01" />
    </>
  ),
  chev: <path d="M7 10l5 5 5-5" />,
  chev_r: <path d="M10 7l5 5-5 5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  upload: (
    <>
      <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <circle cx="9" cy="9" r="1.8" />
      <path d="M20.5 15.5l-5-5-9.5 9.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  move: <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />,
  spark: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4-4" />
    </>
  ),
  export: (
    <>
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  flame: (
    <path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.3 2.6-5 3.6-8.4 2 1.6 2.6 3.4 2.6 5 1-.6 1.7-1.7 2-3 1.7 1.6 3.8 3.6 3.8 6.4 0 3.2-2.4 5.6-6 5.6z" />
  ),
  music: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  drag: (
    <>
      <circle cx="9" cy="6" r="1.2" />
      <circle cx="15" cy="6" r="1.2" />
      <circle cx="9" cy="12" r="1.2" />
      <circle cx="15" cy="12" r="1.2" />
      <circle cx="9" cy="18" r="1.2" />
      <circle cx="15" cy="18" r="1.2" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  pause: <path d="M7.5 5.5h3.2v13H7.5zM13.3 5.5h3.2v13h-3.2z" />,
  dots: (
    <>
      <circle cx="5.5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18.5" cy="12" r="1.6" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/** 这几个画出来就是实心的 */
const SOLID: ReadonlySet<IconName> = new Set<IconName>(['play', 'pause', 'dots']);

interface IconProps {
  name: IconName;
  size?: number;
  /** 实心;不给时 play、pause、dots 是实心,其余描边 */
  fill?: boolean;
  /** 描边粗细,默认 1.8 */
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 16, fill, strokeWidth = 1.8, className }: IconProps) {
  const solid = fill ?? SOLID.has(name);
  return (
    <svg
      className={className ? `st-icon ${className}` : 'st-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      {...(solid
        ? { fill: 'currentColor' }
        : {
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth,
            strokeLinecap: 'round' as const,
            strokeLinejoin: 'round' as const,
          })}
    >
      {PATHS[name]}
    </svg>
  );
}
