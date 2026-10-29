/**
 * 从启动器打开的游戏(debug.html?play=1):先黑屏放 AnimaVN 的 logo,把封面要的图(角色头像小图、
 * 默认背景)下好,再出「点击进入游戏」,点了进没选角色的封面(vn/PlaySplash.tsx)。
 * 不带这个参数(调试台直接打开)照旧。
 */
export function wantsPlayMode(search: string): boolean {
  return new URLSearchParams(search).has('play');
}
