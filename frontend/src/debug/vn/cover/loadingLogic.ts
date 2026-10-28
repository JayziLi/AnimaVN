/** 加载页的纯逻辑(不碰 React,好测):右下那行字、网络慢时进度怎么走。 */

/** 网络慢时进度最多走到这儿(设计稿 kit/loading.js 的 cap:六成) */
export const SLOW_CAP = 0.62;

/**
 * 进度条这一刻画到哪:前一次画到 prev,真实进度 fraction(0–1)。
 * 平时跟着真实进度走;网络慢了(slow)最多只走到六成就停住,但已经走过六成的不往回缩。永远不后退。
 */
export function slowHold(prev: number, fraction: number, slow: boolean): number {
  const f = Math.min(1, Math.max(0, fraction));
  const target = slow ? Math.min(f, SLOW_CAP) : f;
  return Math.max(prev, target);
}

/**
 * 右下角「正在载入 · 名字 · 场景包」的几段。场景包名本身带点(「同居日常 · 星庇所」)时拆开,
 * 和前面用同一种点隔开(星海也是一排等距的点)。名字、场景包都没有的段不写。
 */
export function loadingWhat(charName: string, scenePackName: string | null | undefined): string[] {
  const pack = scenePackName
    ? scenePackName
        .split('·')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return ['正在载入', charName.trim(), ...pack].filter(Boolean);
}
