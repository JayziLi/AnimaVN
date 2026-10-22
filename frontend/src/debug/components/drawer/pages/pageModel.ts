/**
 * 插件抽屉几页共用的类型和小函数(第 2 步 D5);画法在 shared.tsx。
 */

import type { LibraryKind } from '../../../library/libraryModel';
import type { BlockState, TagMode } from '../../../plugins/common';
import type { SlotKey } from '../../../studio/types';
import type { JevControls } from '../../JevSettings';

/** 一个插件块在当前预设里的状态,以及对它的操作。块的正文就是插件的提示词模板 */
export interface BlockControls {
  state: BlockState;
  onInsert: () => void;
  onToggle: () => void;
  /** 从当前预设里拿掉这一块 */
  onRemove: () => void;
}

/** 当前预设(提示词模板页签里「当前预设里有没有这块」那一组要) */
export interface PresetControls {
  presetName: string | null;
  presetDirty: boolean;
  presetBusy: boolean;
  onSavePreset: () => void;
}

/** 底部链接去哪:卡编辑器的某一栏(看的那张卡)、素材管理的某个页签、游戏设置(只在游戏菜单里有) */
export interface PageLinks {
  studio: (slot: SlotKey) => void;
  library: (tab: LibraryKind) => void;
  gameSettings?: () => void;
}

/** 外面要求打开到「高级」的哪个页签(点预设里的插件块时) */
export type AdvOpen = { tab: string; nonce: number } | null;

/** 页头的「{卡}在用 / 没在用」 */
export const inUseOf = (cardName: string, on: boolean) => ({ on, text: on ? `${cardName}在用` : `${cardName}没在用` });

/** 选了 Jev 标,但这次用不上 Jev(没填 key、后端是旧版):页头下面写一行 */
export const jevKeyMissing = (mode: TagMode, jev: JevControls): boolean =>
  mode === 'jev' && (jev.defaults === null || (jev.keyStatus !== null && !jev.keyStatus.has_key));
