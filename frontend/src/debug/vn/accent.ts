/**
 * 视觉小说的主题色:按钮、名牌、滑块、选中项用的那一个颜色(--vn-accent 一组变量)。
 *
 * 跟角色(默认):从这张卡的立绘里取主色,和封面(VNTitle)是同一个取色函数、同一张立绘,颜色一致。
 *   原来的一片粉色和大多数立绘撞色,用户觉得突兀;试过灰白和跟角色,用户选了跟角色(2026-09-27)。
 * 灰白:不抢立绘和背景的颜色;跟角色取不到颜色(没立绘、读不出像素)时也用它。
 * 粉色:原来的样子。
 * 设置存在 vnSettings(按设备记住)。
 */

import { useEffect, useState } from 'react';
import { spriteImageUrl, type PackSprite } from '../lib/api';
import { VN_ACCENT_MONO, VN_ACCENT_PINK } from './fallbacks';
import { accentOf, spriteForMood, type Accent } from './titleArt';

export type VNAccent = 'mono' | 'character' | 'pink';

export const VN_ACCENTS: { value: VNAccent; name: string }[] = [
  { value: 'character', name: '跟角色' },
  { value: 'mono', name: '灰白' },
  { value: 'pink', name: '粉色' },
];

/**
 * 写到 .vn-root 上的主题色:颜色本身、很深的角色色(13%)、给半透明底色用的「r, g, b」,
 * 加纸面用的深色(deep)、淡底(soft),和压在 accent 上的字色(nameInk)。
 * ink 和 nameInk 别弄混:ink 是角色色的深档,nameInk 是名牌 / 按钮上的字色(现在三种主题色里两者相等,画面不变)
 */
export interface AccentVars {
  accent: string;
  ink: string;
  rgb: string;
  deep: string;
  soft: string;
  nameInk: string;
}

const fromAccent = (a: Accent): AccentVars => ({
  accent: a.acc,
  ink: a.ink,
  rgb: a.rgb,
  deep: a.deep,
  soft: a.soft,
  nameInk: a.ink,
});

/** 要写到 .vn-root 上的变量:旧的 --vn-accent* 三个 + 底稿的 --av-acc* 四个(--av-ctl 由 theme.css 按 deep 算) */
export function accentCssVars(a: AccentVars): Record<string, string> {
  return {
    '--vn-accent': a.accent,
    '--vn-accent-ink': a.nameInk,
    '--vn-accent-rgb': a.rgb,
    '--av-acc': a.accent,
    '--av-acc-deep': a.deep,
    '--av-acc-ink': a.ink,
    '--av-acc-soft': a.soft,
    '--av-name-ink': a.nameInk,
  };
}

/** 选的主题色 → 这一刻要用的颜色。跟角色时还没取到(或者立绘读不出像素)先用灰白 */
export function useVNAccent(mode: VNAccent, sprites: readonly PackSprite[]): AccentVars {
  const idle = mode === 'character' ? spriteForMood(sprites, 'idle') : null;
  const src = idle ? spriteImageUrl(idle) : null;
  // 换卡时先留着上一张的颜色,取到新的再换,免得闪一下灰白
  const [got, setGot] = useState<Accent | null>(null);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    void accentOf(src).then((a) => {
      if (alive) setGot(a);
    });
    return () => {
      alive = false;
    };
  }, [src]);
  if (mode === 'pink') return VN_ACCENT_PINK;
  if (mode === 'character' && src && got) return fromAccent(got);
  return VN_ACCENT_MONO;
}
