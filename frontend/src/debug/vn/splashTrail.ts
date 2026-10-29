/**
 * 开屏 logo 入场:彗星沿 logo 里那道彗星轨走(PlaySplash.tsx)。
 * 轨迹、露在外面的几段、星的位置都是从定稿图里拆出来的(docs/design/splash/split_trail.py → splashTrail.json),
 * 坐标是占 logo(lockup-text.png / lockup-trail.png)宽高的比例。
 */

import data from './splashTrail.json';

export interface SplashTrail {
  /** 中心线上的点,从起点(图形右上)到星 */
  line: [number, number][];
  /** 彗星轨露在外面的几段 [x 起, x 止];段与段之间藏在 a、V、N 后面 */
  visible: [number, number][];
  star: [number, number];
  star_size: [number, number];
  /** logo 图的像素大小(算宽高比) */
  size: [number, number];
}

export const TRAIL = data as SplashTrail;

const ASPECT = TRAIL.size[0] / TRAIL.size[1];
// 每个点离起点多远(按弧长,x 按宽高比换算 —— 彗星匀速走,不会在平的地方变快)
const CUM = TRAIL.line.reduce<number[]>((acc, [x, y], i) => {
  if (i === 0) return [0];
  const [px, py] = TRAIL.line[i - 1];
  return [...acc, acc[i - 1] + Math.hypot((x - px) * ASPECT, y - py)];
}, []);

/** 走到全程的 f(0–1)时在哪 */
export function along(f: number): [number, number] {
  const want = Math.min(1, Math.max(0, f)) * CUM[CUM.length - 1];
  let i = 1;
  while (i < CUM.length - 1 && CUM[i] < want) i++;
  const t = (want - CUM[i - 1]) / (CUM[i] - CUM[i - 1] || 1);
  const [x0, y0] = TRAIL.line[i - 1];
  const [x1, y1] = TRAIL.line[i];
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
}

/** 彗星头走到 x 时是不是藏在字母后面(起头那一小截还没进第一段,算露着) */
export function behindLetters(x: number): boolean {
  const [first] = TRAIL.visible;
  if (x < first[0]) return false;
  return !TRAIL.visible.some(([a, b]) => x >= a - 0.003 && x <= b + 0.003);
}
