/**
 * 选角页每张卡要的东西:卡的内容、默认立绘(和它的脸)、第一张背景、立绘张数和几个小头像。进来时按需去拉,拉过的记在模块里,
 * 下次进来直接有;给某张卡导入了素材以后 forgetPickDetail 让它下次重拉(从 VNPick.tsx 拆出来,导入器要用)。
 * 右边「场景 / 声音 / 预设 / 人设」那几条会随时被改,不放在这里缓存,每次进选角页另拉(vn/pick/pickBind.ts)。
 */

import { debugApi, sceneThumbUrl, type PackSprite, type StoredCard } from '../lib/api';
import { facesByCanvas, type FaceBox } from '../plugins/spriteLayout';
import { spriteForMood } from './titleArt';

/** 「立绘」那一条里的小头像:前几个表情,按脸裁 */
export interface PickHead {
  sprite: PackSprite;
  face: FaceBox | null;
}

export interface PickDetail {
  card: StoredCard | null;
  sprite: PackSprite | null;
  face: FaceBox | null;
  bg: string | null;
  /** 启用的、有图的立绘共几张(「立绘包名 · N 张」用) */
  spriteCount: number;
  /** 最多三个表情的小头像 */
  heads: PickHead[];
}

/** 小头像最多放几个 */
export const PICK_HEADS = 3;

const cache = new Map<string, PickDetail>();
const pending = new Map<string, Promise<PickDetail>>();
// 每张卡忘过几次:忘之前发出去的请求回来时不再记进缓存
const generation = new Map<string, number>();

/** 已经拉过的(选角页一打开就能画的那些) */
export const cachedPickDetails = () => new Map(cache);

export const hasPickDetail = (id: string) => cache.has(id);

/** 这张卡的立绘、背景、内容变了(导入了素材、更新了卡):下次进选角页重拉 */
export function forgetPickDetail(id: string): void {
  cache.delete(id);
  pending.delete(id);
  generation.set(id, (generation.get(id) ?? 0) + 1);
}

export async function loadPickDetail(id: string): Promise<PickDetail> {
  const hit = cache.get(id);
  if (hit) return hit;
  let p = pending.get(id);
  if (!p) {
    const gen = generation.get(id) ?? 0;
    p = (async () => {
      const [card, sprites, bg] = await Promise.all([
        debugApi.getCard(id).catch(() => null),
        debugApi.listCardSprites(id).catch(() => [] as PackSprite[]),
        (async () => {
          // 背景栏的包依次找,第一张能用的背景(和游戏里拼出来的列表排第一的那张一样)
          const { bg: packs } = await debugApi.getCardScenePacks(id).catch(() => ({ bg: [] as string[] }));
          for (const pack of packs) {
            const assets = await debugApi.listSceneAssets(pack).catch(() => []);
            const first = assets.find((a) => a.kind === 'bg' && a.enabled && a.has_file);
            if (first) return sceneThumbUrl(first, 1024);
          }
          return null;
        })(),
      ]);
      const usable = sprites.filter((s) => s.enabled && s.has_image);
      const sprite = spriteForMood(usable, 'idle') ?? usable[0] ?? null;
      const face = sprite ? (facesByCanvas([sprite]).get(sprite.id) ?? null) : null;
      const headSprites = usable.slice(0, PICK_HEADS);
      const headFaces = facesByCanvas(headSprites);
      const heads = headSprites.map((h) => ({ sprite: h, face: headFaces.get(h.id) ?? null }));
      const d: PickDetail = { card, sprite, face, bg, spriteCount: usable.length, heads };
      // 半路被忘掉了(刚导入了素材):这份是旧的,不记
      if ((generation.get(id) ?? 0) !== gen) return d;
      // 卡没读到(网络断了、后端在重启)不记下来:不然这次打开页面里再也不会重试
      if (card) cache.set(id, d);
      pending.delete(id);
      return d;
    })();
    pending.set(id, p);
  }
  return p;
}
