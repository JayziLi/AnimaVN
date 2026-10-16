/**
 * 立绘编辑器里的几样小算法:默认差分是哪张、拖动排序换成什么顺序、删掉一张以后选中谁、
 * 入场动效改一样以后变成什么。
 * 默认差分没有单独的标记:排在最前面、没停用的那张就是(和插件页、游戏里一样)。
 */

import type { SpriteEffect } from '../../lib/api';
import { FX_BUBBLES, normalizeEffect } from '../../plugins/spriteFx';

/** 默认差分:排在最前面、没停用的那张;一张能用的都没有是 null */
export function defaultSpriteId(list: readonly { id: string; enabled: boolean }[]): string | null {
  return list.find((s) => s.enabled)?.id ?? null;
}

/** 把 dragId 拖到 targetId 的前面 / 后面,返回新顺序;没动(放回原处、拖到自己上)是 null */
export function moveId(
  ids: readonly string[],
  dragId: string,
  targetId: string,
  place: 'before' | 'after',
): string[] | null {
  if (dragId === targetId || !ids.includes(dragId) || !ids.includes(targetId)) return null;
  const rest = ids.filter((id) => id !== dragId);
  const at = rest.indexOf(targetId) + (place === 'after' ? 1 : 0);
  const next = [...rest.slice(0, at), dragId, ...rest.slice(at)];
  return next.every((id, i) => id === ids[i]) ? null : next;
}

/** 删掉一张以后选中谁:顶上它位置的那张,删的是最后一张就选前一张;删光了是 null */
export function selectAfterDelete(ids: readonly string[], deletedId: string): string | null {
  const at = ids.indexOf(deletedId);
  const rest = ids.filter((id) => id !== deletedId);
  if (rest.length === 0) return null;
  return rest[Math.min(Math.max(at, 0), rest.length - 1)];
}

const EMPTY_FX: SpriteEffect = { motion: null, bubble: null, sound: null };
const bubbleSound = (id: string | null) => FX_BUBBLES.find((b) => b.id === id)?.sound ?? null;

/**
 * 入场动效改一样(动作 / 漫符 / 音效)以后的样子:选了漫符,音效换成和它配对的那个;
 * 漫符改成「无」时,配对的音效也一起去掉(单独选的音效留着)。三样都空了是 null
 */
export function nextEffect(current: SpriteEffect | null | undefined, patch: Partial<SpriteEffect>): SpriteEffect | null {
  const cur = normalizeEffect(current) ?? EMPTY_FX;
  const next = { ...cur, ...patch };
  if ('bubble' in patch) {
    if (patch.bubble) next.sound = bubbleSound(patch.bubble) ?? next.sound;
    else if (cur.sound && cur.sound === bubbleSound(cur.bubble)) next.sound = null;
  }
  return normalizeEffect(next);
}
