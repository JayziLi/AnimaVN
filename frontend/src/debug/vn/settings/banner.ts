/**
 * 设置页顶上的场景横幅(设计稿 kit/banner.js 的 cfgScene):用这张卡场景包里「另一张」背景,
 * 不和她现在待的场景重复(也不和页里的实机预览重复);白天的场景配白天的、夜里的配夜里的。
 * 设计稿给星绘定的是白天书桌、夜里星空;游戏里没有「白天 / 夜里」的标记,按场景名认夜景(夜 / 星空)。
 */

export interface BannerScene {
  label: string;
  src: string;
  /** 竖屏时对准横图的哪儿(0–100);不给 = 居中 */
  focus?: number;
}

/** 这张背景是不是夜景:名字里带「夜」「星空」 */
export const isNightLabel = (label: string): boolean => /夜|星空|night/i.test(label);

/**
 * 横幅用哪张:场景包里和现在这张不一样、昼夜一样的第一张;没有就换成和现在不一样的第一张;
 * 包里只有一张就是它自己;一张都没有是 null(不放横幅)。
 */
export function pickBannerScene(scenes: readonly BannerScene[], currentLabel: string | null): BannerScene | null {
  if (scenes.length === 0) return null;
  const cur = scenes.find((s) => s.label === currentLabel) ?? null;
  const night = currentLabel ? isNightLabel(currentLabel) : false;
  const others = scenes.filter((s) => s !== cur);
  return others.find((s) => isNightLabel(s.label) === night) ?? others[0] ?? cur ?? scenes[0];
}
