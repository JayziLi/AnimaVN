/**
 * 卡编辑器「素材」页的背景栏(照 V4AttachBg):顶上一行「用哪个场景包」的下拉框 +「⋯」,
 * 下面是选中那个包的背景编辑器(BackgroundPackEditor)。
 *
 * 卡相关的东西在这里算好交给编辑器:
 *   默认 BGM 下拉 = 这张卡 BGM 那一边用的曲子(游戏里切背景只会换成这里面的)
 *   「叠上立绘」= 当前服装排第一的、没停用的差分(默认差分),摆法和立绘栏、游戏里一样
 */

import { useMemo } from 'react';
import { spriteImageUrl, type PackSprite, type SpriteLayout } from '../../lib/api';
import { facesByCanvas, type SpriteStage } from '../../plugins/spriteLayout';
import { BackgroundPackEditor } from '../editors/BackgroundPackEditor';
import { bgmChoicesOf } from '../editors/sceneEdit';
import type { StagePreviewSprite } from '../preview/StagePreview';
import type { Notify, PackSync } from '../types';
import { ScenePackSlot, type SceneSlotState } from './ScenePackSlot';

export interface BackgroundSlotProps {
  cardName: string;
  scene: SceneSlotState;
  /** 当前服装的全部差分(useSpritePacks 的 sprites,含停用的) */
  sprites: readonly PackSprite[];
  /** 当前服装的摆法(useSpriteLayout 的 layout)、所有角色共用的构图(stage) */
  layout: SpriteLayout;
  stage: SpriteStage;
  sync: PackSync;
  notify: Notify;
}

export function BackgroundSlot({ cardName, scene, sprites, layout, stage, sync, notify }: BackgroundSlotProps) {
  const { binding, packs, sceneLists } = scene;

  const overlay = useMemo<StagePreviewSprite | null>(() => {
    // 默认差分:排第一的、没停用的;它没图就往后找一张有图的
    const usable = sprites.filter((s) => s.enabled && s.has_image);
    const s = usable[0];
    const src = s ? spriteImageUrl(s) : null;
    if (!s || !src) return null;
    return { src, face: facesByCanvas(sprites).get(s.id) ?? null, layout, stage };
  }, [sprites, layout, stage]);

  const choices = useMemo(() => bgmChoicesOf(binding.bgm, packs, sceneLists), [binding.bgm, packs, sceneLists]);
  const note =
    binding.bgm.length === 0
      ? '这张卡「BGM」那一栏还没选曲子,现在只能选「不换」'
      : '可选「BGM」那一栏用的曲子,或「不换(沿用之前的音乐)」';

  return (
    <ScenePackSlot
      side="bg"
      cardName={cardName}
      scene={scene}
      sync={sync}
      notify={notify}
      renderEditor={(ctx) => (
        <BackgroundPackEditor
          packId={ctx.packId}
          header={ctx.header}
          bgmChoices={choices}
          bgmNote={note}
          sprite={overlay}
          cardCount={ctx.cardCount}
          sync={sync}
          notify={notify}
          incoming={ctx.incoming}
          onIncomingTaken={ctx.onIncomingTaken}
        />
      )}
    />
  );
}
