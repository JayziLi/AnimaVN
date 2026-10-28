/**
 * 加载页右上角的装饰:一道实线轨道弧 + 外面一圈点线、几颗小星点和两颗四角小星(设计稿 kit/loading.js 的 skyHTML)。
 * 固定种子,每次画出来一模一样(截图、回归都稳);很淡、不发光,CSS 里再从右上角往外淡掉。
 */

export interface SkyShapes {
  /** viewBox 的宽高 */
  w: number;
  h: number;
  orbit: { cx: number; cy: number; r: number; gap: number; px: number; py: number };
  dots: { cx: number; cy: number; r: number; o: number }[];
  sparks: { x: number; y: number; s: number; o: number }[];
}

/** 设计稿 kit/loading.js 的 rnd:同一个种子永远出同一串数 */
export const seeded = (seed: number) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
};

function dots(x0: number, y0: number, w: number, h: number, n: number, seed: number): SkyShapes['dots'] {
  const R = seeded(seed);
  const out: SkyShapes['dots'] = [];
  for (let i = 0; i < n; i++) {
    const cx = x0 + R() * w;
    const cy = y0 + R() * h;
    const r = 0.6 + R() * 0.8;
    const o = 0.25 + R() * 0.5;
    out.push({ cx: +cx.toFixed(1), cy: +cy.toFixed(1), r: +r.toFixed(2), o: +o.toFixed(2) });
  }
  return out;
}

/** 轨道弧:圆心、半径、外圈离多远、实线上那颗小点在几度 */
function orbit(cx: number, cy: number, r: number, gap: number, deg: number): SkyShapes['orbit'] {
  const a = (deg * Math.PI) / 180;
  return { cx, cy, r, gap, px: +(cx + r * Math.cos(a)).toFixed(1), py: +(cy + r * Math.sin(a)).toFixed(1) };
}

export function skyShapes(phone: boolean): SkyShapes {
  return phone
    ? {
        w: 390,
        h: 844,
        orbit: orbit(470, -80, 250, 14, 121),
        dots: dots(40, 64, 330, 190, 10, 29),
        sparks: [
          { x: 298, y: 112, s: 6, o: 0.8 },
          { x: 150, y: 76, s: 4, o: 0.55 },
        ],
      }
    : {
        w: 1440,
        h: 810,
        orbit: orbit(1560, -170, 430, 22, 128),
        dots: dots(640, 10, 760, 180, 14, 53),
        sparks: [
          { x: 1120, y: 118, s: 7, o: 0.8 },
          { x: 782, y: 58, s: 4.5, o: 0.55 },
        ],
      };
}
