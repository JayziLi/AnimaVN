/**
 * CG 包(素材架构设计 3.4,第 4 期):CG 从场景包里搬出来,单独绑到卡上,可以叠几个。
 *
 * 游戏、Jev、{{cgs}}、配对表都照旧吃「一张场景素材列表」:这里把场景包的背景、曲子和这张卡绑的 CG 包里的 CG
 * 拼成一张,顺序和后端回放导出(AnimaBackend/app/replay/export.py 的 _scene)一样 —— 场景包按 kind, sort 排,
 * 背景、曲子在前;CG 按绑定顺序一个包一个包接在后面(每个包里按 sort)。几个包里构图重名时排前面的先被找到。
 * 场景包里的 CG 拆过(有 CG 包从它拆出来,ScenePack.cg_pack_id)就不用它的那份;没拆过的照旧用(还没升级的库)。
 *
 * 第 1 步起背景、BGM 分开绑,运行时改用 scenePacks.ts 的 mergeBoundScene;这里留着一张卡一个场景包时的拼法,
 * 测试拿它对照(一个包两边都出时两者必须一模一样)。
 */

import type { SceneAsset, ScenePack } from '../lib/api';

export function mergeSceneAssets(
  sceneAssets: readonly SceneAsset[],
  scenePack: Pick<ScenePack, 'cg_pack_id'> | null,
  cgLists: readonly (readonly SceneAsset[])[],
): SceneAsset[] {
  const split = Boolean(scenePack?.cg_pack_id);
  const base = split ? sceneAssets.filter((a) => a.kind !== 'cg') : [...sceneAssets];
  return cgLists.length ? [...base, ...cgLists.flat()] : base;
}
