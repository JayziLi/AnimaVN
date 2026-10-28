/**
 * 主题「玻璃」的颜色(设计稿 kit/glass.js 的 glassVars,只留染色那一种):
 * 色相照这一幕的场景,饱和度限在 16–40%,亮度 10%,字一直是白的;场景越亮压得越深(白字对比度 ≥ 4.5)。
 * 算出来的 --gl-* 写在游戏根(.vn-root)上,提示条、确认框、报错纸卡这些玻璃卡读它;
 * 没写的地方(DebugApp 里的确认框)用 glass.css 里 :root 的默认深色。
 */

export type Rgb = readonly [number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function rgbHsl([r0, g0, b0]: Rgb): [number, number, number] {
  const r = r0 / 255;
  const g = g0 / 255;
  const b = b0 / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const rgba = (c: readonly number[], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a.toFixed(3)})`;

/** 这一幕的色调:平均色(0–255)和亮度(0–1) */
export interface SceneTone {
  avg: Rgb;
  lum: number;
}

/** 取不到场景色调(没背景、图读不出像素)时用的:中灰、中等亮度,算出来是一层偏冷的深灰玻璃 */
export const NEUTRAL_TONE: SceneTone = { avg: [128, 128, 128], lum: 0.5 };

/** 要写到 .vn-root 上的 --gl-* 变量;gl-bg 另外写(要图片地址) */
export function glassVars(tone: SceneTone | null): Record<string, string> {
  const t = tone ?? NEUTRAL_TONE;
  const [h, s] = rgbHsl(t.avg);
  // 色相照场景;饱和度限在 16–40%(客厅这种发灰的图只带一点暖,夜路这种蓝的接近游戏里的深蓝),亮度 10%
  const base = hslRgb(h, clamp(s * 1.1 + 0.08, 0.16, 0.4), 0.1);
  // 夜路(lum 0.13)约 0.61,客厅(0.59)约 0.77,书桌(0.72)约 0.81
  const total = clamp(0.57 + 0.34 * t.lum, 0.6, 0.84);
  const veilA = 0.24;
  const railTotal = Math.min(0.9, total + 0.1);
  // 面板 / 左边那条压在 veil 上面:各自再补到 total
  const over = (a: number) => 1 - (1 - a) / (1 - veilA);
  const mix = [26, 28, 40];
  const solid = base.map((v, i) => Math.round(v * 0.55 + mix[i] * 0.45));
  return {
    '--gl-base': base.join(', '),
    '--gl-total': rgba(base, total),
    '--gl-veil': rgba(base, veilA),
    '--gl-panel': rgba(base, over(total)),
    '--gl-rail': rgba(base, over(railTotal)),
    '--gl-solid': `rgb(${solid.join(', ')})`,
    '--gl-btn': rgba(solid, 0.8),
    '--gl-a': total.toFixed(3),
  };
}
