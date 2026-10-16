/**
 * 背景 / BGM 分开绑(素材架构第 1 步):一张卡可以有几个「出背景的」场景包和几个「出曲子的」场景包,
 * 一个包可以两边都出(以前一张卡一个场景包就是这样)。
 *
 * 游戏、Jev、{{backgrounds}} / {{bgms}} / {{cgs}}、配对表都照旧吃「一张场景素材列表」,这里把它拼出来,
 * 拼法和后端回放导出(AnimaBackend/app/replay/export.py 的 _scene)一样:
 *   背景包依次出背景 → BGM 包依次出曲子 → 两边并集里没拆过的场景包依次出 CG → 再接这张卡绑的 CG 包(cgPacks.ts)
 * 每个包里照列表原来的顺序(接口按 kind, sort 排好)。一个包两边都出时,结果和以前的 mergeSceneAssets 一模一样。
 * 几个包里重名时排前面的先被找到。
 */

import type { CardSceneParts, SceneAsset, ScenePack } from '../lib/api';

/** 这张卡的场景包分两栏,各按顺序(GET /api/tavern/cards/{id}/scene-packs) */
export type SceneBinding = CardSceneParts;

export const EMPTY_SCENE_BINDING: SceneBinding = { bg: [], bgm: [] };

/** 两栏的并集:背景的在前,只出曲子的按 BGM 栏的顺序接在后面(和后端绑定行的先后一样) */
export function sceneUnion(binding: Readonly<SceneBinding>): string[] {
  return [...new Set([...binding.bg, ...binding.bgm])];
}

export function mergeBoundScene(
  binding: Readonly<SceneBinding>,
  lists: Readonly<Record<string, readonly SceneAsset[]>>,
  packs: readonly Pick<ScenePack, 'id' | 'cg_pack_id'>[],
  cgLists: readonly (readonly SceneAsset[])[],
): SceneAsset[] {
  const rows = (packId: string, kind: SceneAsset['kind']) => (lists[packId] ?? []).filter((a) => a.kind === kind);
  // 场景包里的 CG 拆过(有 CG 包从它拆出来)就不用它的那份;列表里找不到这个包当没拆过(还没读到包列表、旧后端)
  const split = (packId: string) => Boolean(packs.find((p) => p.id === packId)?.cg_pack_id);
  return [
    ...binding.bg.flatMap((id) => rows(id, 'bg')),
    ...binding.bgm.flatMap((id) => rows(id, 'bgm')),
    ...sceneUnion(binding).flatMap((id) => (split(id) ? [] : rows(id, 'cg'))),
    ...cgLists.flat(),
  ];
}
