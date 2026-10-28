/**
 * 卡编辑器「素材」页的 BGM 栏(没有画图,照背景栏的格局):顶上一行「用哪个场景包」的下拉框 +「⋯」,
 * 下面是选中那个包的曲目编辑器(BgmPackEditor)。
 *
 * 卡相关的东西在这里接上:
 *   封面曲走 useScenePlugin 的 setTitleBgmOf(标题画面马上跟着换)
 *   「这些背景切过来时放它」看这张卡背景那一边用的包(背景的默认 BGM 可以指向别的包里的曲子)
 *   删了一首:后端把所有背景上指向它的默认 BGM 清掉了,这张卡别的包的列表照着改(游戏里同步)
 */

import { useMemo } from 'react';
import { BgmPackEditor } from '../editors/BgmPackEditor';
import { clearBgmRefs } from '../editors/sceneEdit';
import type { Notify, PackSync } from '../types';
import { ScenePackSlot, type SceneSlotState } from './ScenePackSlot';

export interface BgmSlotProps {
  cardName: string;
  scene: SceneSlotState;
  sync: PackSync;
  notify: Notify;
}

export function BgmSlot({ cardName, scene, sync, notify }: BgmSlotProps) {
  const { binding, packs, sceneLists } = scene;

  const backgrounds = useMemo(
    () =>
      binding.bg.map((pid) => ({
        packName: packs.find((p) => p.id === pid)?.name ?? '…',
        list: sceneLists[pid] ?? [],
      })),
    [binding.bg, packs, sceneLists],
  );

  return (
    <ScenePackSlot
      side="bgm"
      cardName={cardName}
      scene={scene}
      sync={sync}
      notify={notify}
      renderEditor={(ctx) => (
        <BgmPackEditor
          packId={ctx.packId}
          packName={ctx.packName}
          header={ctx.header}
          titleBgmId={packs.find((p) => p.id === ctx.packId)?.title_bgm_id ?? null}
          onTitleBgm={(id) => void scene.setTitleBgmOf(ctx.packId, id)}
          backgrounds={backgrounds}
          cardCount={ctx.cardCount}
          sync={sync}
          notify={notify}
          incoming={ctx.incoming}
          onIncomingTaken={ctx.onIncomingTaken}
          onRemoved={(trackId) => {
            // 编辑器自己的包它已经改过、交过了(这里手上的那份可能还是旧的),别的包照着后端清掉引用
            for (const [pid, list] of Object.entries(sceneLists)) {
              if (pid === ctx.packId) continue;
              const next = clearBgmRefs(list, trackId);
              if (next !== list) sync.scene(pid, next);
            }
          }}
        />
      )}
    />
  );
}
