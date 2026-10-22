/**
 * 示例场景包「示例 · 校园」:背景来自 Ren'Py 示例游戏(MIT),音乐是 Kevin MacLeod 的曲子(CC BY 4.0),
 * 出处见 public/vn/CREDITS.txt。一张卡还没绑背景 / BGM 时,背景页和 BGM 页可以一键载入它先试效果
 * (以前在旧插件抽屉的场景包那一栏里,第 2 步拆掉那一栏后搬到这里)。
 */

import { debugApi } from '../../lib/api';

export const SAMPLE_SCENE_PACK = {
  name: '示例 · 校园',
  description: '随仓库附带的免费授权素材,可以先用来试效果',
  bgms: [
    { file: 'bgm/carefree.mp3', label: '日常', aliases: ['daily'], description: '轻快的日常曲（Carefree）' },
    { file: 'bgm/wallpaper.mp3', label: '温馨', aliases: ['warm'], description: '温暖、放松（Wallpaper）' },
    { file: 'bgm/investigations.mp3', label: '紧张', aliases: ['tense'], description: '悬疑、紧张、有点不安（Investigations）' },
    { file: 'bgm/sad-trio.mp3', label: '伤感', aliases: ['sad'], description: '安静的伤感、回忆（Sad Trio）' },
  ],
  bgs: [
    { file: 'bg/uni.jpg', label: '校园', aliases: ['campus'], description: '大学校园的林荫道，白天', bgm: '日常', focus: 50 },
    { file: 'bg/lecturehall.jpg', label: '教室', aliases: ['classroom'], description: '阶梯教室', bgm: '日常', focus: 50 },
    { file: 'bg/club.jpg', label: '活动室', aliases: ['club'], description: '社团活动室，室内', bgm: '温馨', focus: 50 },
    { file: 'bg/meadow.jpg', label: '草地', aliases: ['meadow'], description: '郊外开阔的草地，安静', bgm: '温馨', focus: 50 },
  ],
};

/** 把示例场景包(没有就先建一个)同时当背景和 BGM 绑到这张卡上;回一句给玩家看的话 */
export async function loadSampleScene(cardId: string): Promise<string> {
  const pack = SAMPLE_SCENE_PACK;
  const [packs, bound] = await Promise.all([debugApi.listScenePacks(), debugApi.getCardScenePacks(cardId)]);
  const existing = packs.find((p) => p.name === pack.name);
  let packId = existing?.id;
  if (!packId) {
    const created = await debugApi.createScenePack(pack.name, pack.description);
    const bgmIds = new Map<string, string>();
    for (const m of pack.bgms) {
      const res = await fetch(`/vn/${m.file}`);
      if (!res.ok) throw new Error(`示例音乐 ${m.file} 下载失败`);
      const a = await debugApi.createSceneAsset(created.id, {
        kind: 'bgm',
        label: m.label,
        aliases: m.aliases,
        description: m.description,
      });
      await debugApi.uploadSceneFile(created.id, a.id, await res.blob());
      bgmIds.set(m.label, a.id);
    }
    for (const b of pack.bgs) {
      const res = await fetch(`/vn/${b.file}`);
      if (!res.ok) throw new Error(`示例背景 ${b.file} 下载失败`);
      const a = await debugApi.createSceneAsset(created.id, {
        kind: 'bg',
        label: b.label,
        aliases: b.aliases,
        description: b.description,
      });
      await debugApi.uploadSceneFile(created.id, a.id, await res.blob());
      await debugApi.updateSceneAsset(created.id, a.id, { bgm_id: bgmIds.get(b.bgm) ?? null, focus_x: b.focus });
    }
    packId = created.id;
  }
  const id = packId;
  const add = (ids: readonly string[]) => (ids.includes(id) ? [...ids] : [...ids, id]);
  await debugApi.setCardScenePacks(cardId, { bg: add(bound.bg), bgm: add(bound.bgm) });
  return existing
    ? `「${pack.name}」已经有了,已绑定到这张卡`
    : `已载入示例场景包:${pack.bgs.length} 个场景、${pack.bgms.length} 首音乐`;
}
