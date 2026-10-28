/**
 * 游戏皮的实机预览舞台要的那点数据(立绘页、语音页、背景页、CG 页共用):
 *   usePackLayout  看的那张卡当前立绘包的摆法(缩放、偏移);插件页只是看,读不到用默认
 *   spriteForRow   语音的一行语气配哪张立绘:名字(或别名)对上的,对不上用默认表情
 */

import { useEffect, useState } from 'react';
import { debugApi, type PackSprite, type SpriteLayout } from '../../../lib/api';

export const DEFAULT_LAYOUT: SpriteLayout = { auto: true, zoom: 1, dx: 0, dy: 0 };

export function usePackLayout(packId: string | null): SpriteLayout {
  const [got, setGot] = useState<{ packId: string; layout: SpriteLayout } | null>(null);
  useEffect(() => {
    if (!packId) return;
    let live = true;
    debugApi
      .getSpriteLayout(packId)
      .then((layout) => {
        if (live) setGot({ packId, layout });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [packId]);
  return got && got.packId === packId ? got.layout : DEFAULT_LAYOUT;
}

/** 这一行语气对应的立绘:名字或别名一样的;没有就 null(调用方用默认表情) */
export function spriteForRow(sprites: readonly PackSprite[], row: { label: string; aliases?: readonly string[] }): PackSprite | null {
  const names = [row.label, ...(row.aliases ?? [])].map((n) => n.trim().toLowerCase());
  return sprites.find((s) => [s.label, ...s.aliases].some((n) => names.includes(n.trim().toLowerCase()))) ?? null;
}
