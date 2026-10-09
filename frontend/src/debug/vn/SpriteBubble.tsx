/**
 * 立绘头顶冒的气泡(立绘切换特效的一部分,清单在 plugins/spriteFx.ts)。
 * 照碧蓝档案的样子自己画的 SVG:！？…这类放在白底圆泡里,爱心、汗滴、怒筋这类直接浮在头边。
 */

import type { CSSProperties, ReactNode } from 'react';

const INK = '#2d2f3a';

/** 白底圆泡,尾巴朝左下(气泡在头的右上方) */
function Balloon({ children }: { children: ReactNode }) {
  return (
    <>
      <path
        d="M50 8c23 0 41 15 41 34S73 76 50 76c-5 0-10-.7-14-2L16 88l7-18C14 63 9 53 9 42 9 23 27 8 50 8z"
        fill="#fff"
        stroke={INK}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {children}
    </>
  );
}

const bang = (x: number, color: string) => (
  <g fill={color} stroke={INK} strokeWidth="2.5">
    <path d={`M${x - 6} 20h12l-3 30h-6z`} strokeLinejoin="round" />
    <circle cx={x} cy="60" r="5.5" />
  </g>
);

const QUESTION = 'M-12 -4c0-10 6-17 15-17 9 0 15 6 15 13 0 7-4 10-9 13-3 2-4 4-4 7v2h-8v-3c0-5 2-8 6-11 4-3 6-4 6-8 0-3-3-6-6-6-4 0-6 3-7 7z';

const question = (x: number, color: string) => (
  <g transform={`translate(${x} 41)`} fill={color} stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
    <path d={QUESTION} />
    <circle cx="0" cy="22" r="5" />
  </g>
);

const SHAPES: Record<string, ReactNode> = {
  exclaim: <Balloon>{bang(50, '#ff8a3d')}</Balloon>,
  surprise: (
    <Balloon>
      {bang(37, '#ff8a3d')}
      {question(62, '#4aa3ff')}
    </Balloon>
  ),
  question: <Balloon>{question(50, '#4aa3ff')}</Balloon>,
  heart: (
    <g>
      <path
        d="M50 86C24 66 10 52 10 34 10 21 20 12 32 12c8 0 14 4 18 11 4-7 10-11 18-11 12 0 22 9 22 22 0 18-14 32-40 52z"
        fill="#ff5d8f"
        stroke="#fff"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <ellipse cx="30" cy="30" rx="7" ry="4.5" fill="#fff" opacity=".75" transform="rotate(-35 30 30)" />
    </g>
  ),
  shy: (
    <g stroke="#ff6f9c" strokeWidth="7" strokeLinecap="round">
      <path d="M22 70L40 30M44 70L62 30M66 70L84 30" />
    </g>
  ),
  angry: (
    <g fill="none" stroke="#ff3b3b" strokeWidth="9" strokeLinecap="round">
      <path d="M40 16c0 14-6 22-22 22" />
      <path d="M60 16c0 14 6 22 22 22" />
      <path d="M40 84c0-14-6-22-22-22" />
      <path d="M60 84c0-14 6-22 22-22" />
    </g>
  ),
  steam: (
    <g fill="#fff" stroke={INK} strokeWidth="3.5" strokeLinejoin="round">
      <path d="M18 70c-9 0-12-12-4-16-2-10 10-15 15-8 4-8 17-6 16 4 9 1 10 15 0 18-3 6-12 7-16 2-4 3-9 3-11 0z" />
      <path d="M58 44c-7 0-9-10-3-13-1-8 8-12 12-6 3-6 13-5 12 3 7 1 8 12 0 14-2 5-9 5-12 2-3 2-7 2-9 0z" />
    </g>
  ),
  upset: (
    <Balloon>
      <path
        d="M24 46c6-14 18 8 24-6s-16-12-8 2 22 10 22-6-20-6-12 8 20 12 22-4"
        fill="none"
        stroke={INK}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Balloon>
  ),
  sweat: (
    <g>
      <path d="M50 10C42 30 30 44 30 60a20 20 0 0040 0c0-16-12-30-20-50z" fill="#6cc4ff" stroke="#fff" strokeWidth="5" strokeLinejoin="round" />
      <ellipse cx="42" cy="58" rx="4.5" ry="9" fill="#fff" opacity=".8" />
    </g>
  ),
  tear: (
    <g fill="#5fb0ff" stroke="#fff" strokeWidth="4" strokeLinejoin="round">
      <path d="M36 16C30 30 22 40 22 50a14 14 0 0028 0c0-10-8-20-14-34z" />
      <path d="M68 40C63 51 57 58 57 66a11 11 0 0022 0c0-8-6-15-11-26z" />
    </g>
  ),
  sad: (
    <g stroke="#7b6fd6" strokeWidth="6" strokeLinecap="round">
      <path d="M28 18v44M50 14v62M72 18v44" />
    </g>
  ),
  sigh: (
    <g fill="#fff" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round">
      <path d="M14 58c0-12 12-18 22-12 4-10 20-10 24 0 10-4 22 4 18 16-2 8-12 10-18 6-6 6-18 6-24 0-10 4-22 0-22-10z" />
      <path d="M70 44c6-8 2-16-6-16" fill="none" />
    </g>
  ),
  bulb: (
    <g strokeLinecap="round">
      <g stroke="#ffc928" strokeWidth="5">
        <path d="M50 4v8M20 16l6 6M80 16l-6 6M10 42h8M82 42h8" />
      </g>
      <path
        d="M50 18c-14 0-24 10-24 23 0 9 5 14 10 19 3 3 4 6 4 10h20c0-4 1-7 4-10 5-5 10-10 10-19 0-13-10-23-24-23z"
        fill="#ffe066"
        stroke={INK}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path d="M40 78h20M42 86h16" stroke={INK} strokeWidth="4" />
    </g>
  ),
};

export function SpriteBubble({ kind, style }: { kind: string; style?: CSSProperties }) {
  const shape = SHAPES[kind];
  if (!shape) return null;
  return (
    <svg className={`vn-bubble vn-bubble-${kind}`} viewBox="0 0 100 100" style={style} aria-hidden="true">
      {shape}
    </svg>
  );
}
