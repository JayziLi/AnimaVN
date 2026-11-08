/**
 * 衬线字体的生僻字那一份(vnFonts.css 里 unicode-range 是 U+4E00-9FFF 的 nss-extra,1.6 MB)平时要等页面上
 * 出现了常用字那份里没有的字才去下载,下完在主线程上解析:慢电脑上那一下卡 0.8 秒,撞上什么算什么 ——
 * 10-30 实测多半是第一次点开存档页,或者正在出字的时候。进游戏以后趁空闲先载好。一个页面只做一次
 */
let warmed = false;

export function warmExtraFonts(): void {
  if (warmed || typeof document === 'undefined' || !document.fonts) return;
  warmed = true;
  const run = () =>
    document.fonts.forEach((face) => {
      const extra = face.family.replace(/['"]/g, '') === 'AnimaSerif' && face.unicodeRange.toUpperCase().includes('4E00');
      if (extra && face.status === 'unloaded') face.load().catch(() => {});
    });
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 4000 });
  else window.setTimeout(run, 1500);
}
