/**
 * 拖放落点:哪个元素算「拖到这张卡上」「拖到素材页的这一栏」。元素上挂三个 data 属性,
 * 拖放层(DropLayer)拖动时从指针下面的元素往上找最近的一个:
 *
 *   data-drop-card  卡的 id(必有)
 *   data-drop-name  卡名(遮罩上「松手:给刻晴加素材」用)
 *   data-drop-kind  sprite / bg / bgm / cg:这一栏的类型,导入时全部按它认(声音、AI 生成那两栏不给)
 *
 * 用法:<button {...dropTarget(card.id, card.name)}>、<div {...dropTarget(cardId, name, 'bg')}>
 */

import type { ImportKind } from '../lib/api';
import { SLOT_NAMES } from '../studio/slotSummary';
import type { SlotKey } from '../studio/types';

/** 拖到哪:哪张卡、素材页的哪一栏;都没有 = 不带目标的导入 */
export interface ImportTarget {
  cardId: string | null;
  cardName: string | null;
  kind: ImportKind | null;
}

export const NO_TARGET: ImportTarget = { cardId: null, cardName: null, kind: null };

/** 找落点用的选择器 */
export const DROP_SELECTOR = '[data-drop-card]';

const KINDS: readonly ImportKind[] = ['sprite', 'bg', 'bgm', 'cg'];

/** 素材页的一栏拖进来按什么类型导入;声音、AI 生成两栏不能拖文件进来,拖到那里只算「给这张卡」 */
export function slotKind(slot: SlotKey): ImportKind | null {
  return KINDS.find((k) => k === slot) ?? null;
}

export function dropTarget(cardId: string, name: string, kind?: ImportKind | null): Record<string, string> {
  return {
    'data-drop-card': cardId,
    'data-drop-name': name,
    ...(kind ? { 'data-drop-kind': kind } : {}),
  };
}

export function readDropTarget(el: { getAttribute(name: string): string | null } | null): ImportTarget {
  const cardId = el?.getAttribute('data-drop-card') || null;
  if (!el || !cardId) return NO_TARGET;
  const kind = el.getAttribute('data-drop-kind');
  return {
    cardId,
    cardName: el.getAttribute('data-drop-name')?.trim() || null,
    kind: KINDS.find((k) => k === kind) ?? null,
  };
}

/** 遮罩上那句话:松手会怎样 */
export function dropLabel(t: ImportTarget): string {
  if (!t.cardId) return '松手就导入';
  const who = t.cardName ?? '这张卡';
  if (!t.kind) return `松手:给${who}加素材`;
  // 中文和英文之间空一格:「都当 BGM」
  const word = SLOT_NAMES[t.kind];
  return `松手:都当${/^[A-Za-z]/.test(word) ? ` ${word}` : word},加给${who}`;
}
