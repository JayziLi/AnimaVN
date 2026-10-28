/**
 * 逐字显示时把一句话分成两截:已经打出来的(shown)和还没打出来的(rest)。
 * rest 要透明地占着位置(.vn-type-rest),整句一开始就按最后的样子排好 —— 打字时框不长高、字不挪行。
 * skipped(整句直接出)时 rest 是空的
 */
export function typedParts(text: string, n: number, skipped: boolean): { shown: string; rest: string } {
  if (skipped) return { shown: text, rest: '' };
  return { shown: text.slice(0, n), rest: text.slice(n) };
}
