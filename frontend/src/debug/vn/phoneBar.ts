/**
 * 手机竖屏输入框的小逻辑(不碰 React,好测)。
 *
 * 点画面这一下是只收输入框,还是翻下一句:
 * - 手机:输入框点开过(键盘弹着)就只收键盘。手指点上去本来是想把键盘收掉,顺手翻走一句读不到;写了字、轮到你也一样
 * - 电脑:点开了、没写字、也不是轮到你才收起;其他照常翻句
 */
export function tapOnlyClosesBar({
  phoneBar,
  barOpen,
  myTurn,
  hasDraft,
}: {
  phoneBar: boolean;
  barOpen: boolean;
  myTurn: boolean;
  hasDraft: boolean;
}): boolean {
  if (!barOpen) return false;
  return phoneBar || (!myTurn && !hasDraft);
}
