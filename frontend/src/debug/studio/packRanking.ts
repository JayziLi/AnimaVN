/**
 * 「从素材库选」弹窗里包的排法:和这张卡同名、名字里有同一个词的排前面,标「可能想用」。
 * 词按「·」和空格切(「刻晴 · 玉衡星」→ 刻晴、玉衡星);一个字的词(「爱弥斯 B」的 B)不算。
 */

export interface RankedPack<T> {
  item: T;
  /** 名字像这张卡的(排在前面、标「可能想用」) */
  hint: boolean;
}

const words = (name: string) =>
  name
    .toLowerCase()
    .split(/[·・\s()（）]+/)
    .filter((w) => w.length >= 2);

/** 像这张卡的排前面,两组里各自保持原来的先后 */
export function rankForCard<T extends { name: string }>(items: readonly T[], cardName: string): RankedPack<T>[] {
  const card = cardName.trim().toLowerCase();
  const cardWords = new Set(words(card));
  const like = (name: string) => {
    if (!card) return false;
    const n = name.toLowerCase();
    return n.includes(card) || words(n).some((w) => cardWords.has(w));
  };
  const ranked = items.map((item) => ({ item, hint: like(item.name) }));
  return [...ranked.filter((r) => r.hint), ...ranked.filter((r) => !r.hint)];
}

/** 搜索框:名字里有这段字(不分大小写);空的全要 */
export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
}
