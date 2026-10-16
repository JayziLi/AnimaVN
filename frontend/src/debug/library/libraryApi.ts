/**
 * 素材管理页要的接口(后端 app/api/library.py、各包的「复制」)。
 * 地址和出错时的消息和 debugApi 一样(apiRequest / apiUrl)。导入记录(列表、撤销)和导入器共用 lib/api.ts 那一份
 * (debugApi.importJobs / importUndoPreview / importUndo)。
 *
 * 改卡的绑定:读出来改一处再写回去(libraryModel.bindingWith);当前这张卡由 DebugApp 换成走 hook 的写法
 * (游戏里马上生效),见 CardBindingWriter。
 */

import { apiRequest, apiUrl, debugApi, type CardSceneParts, type CardVoices, type SceneAsset, type ScenePack } from '../lib/api';
import type { BindingOf, LibraryItem, LibraryKind, LibraryUsage } from './libraryModel';

/** 复制出来的包:只用得到编号和名字(各 router 的列表形状) */
interface CopiedPack {
  id: string;
  name: string;
}

/** 复制、删除走的那个 router:背景 / BGM 都是场景包 */
const PACK_ROUTE: Record<Exclude<LibraryKind, 'voice'>, string> = {
  sprite: 'sprite-packs',
  bg: 'scene-packs',
  bgm: 'scene-packs',
  cg: 'cg-packs',
};

export const libraryApi = {
  list: (kind: LibraryKind) => apiRequest<LibraryItem[]>(`/api/library/${kind}`),

  usage: (kind: LibraryKind, id: string) => apiRequest<LibraryUsage>(`/api/library/${kind}/${id}/usage`),

  /** 创建副本:不给名字后端起「X 副本」(撞了自己加数字);给了名字撞了是 409。声音不能复制 */
  duplicate: (kind: Exclude<LibraryKind, 'voice'>, id: string, name?: string) =>
    apiRequest<CopiedPack>(`/api/${PACK_ROUTE[kind]}/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ name: name ?? null }),
    }),

  /** 删掉整个包(背景 / BGM 页删的是整个场景包)或声音 */
  remove: (kind: LibraryKind, id: string) =>
    apiRequest<void>(kind === 'voice' ? `/api/voices/${id}` : `/api/${PACK_ROUTE[kind]}/${id}`, { method: 'DELETE' }),
};

/** 文件仓库里的图按指纹取,缩到 w 宽(和 lib/api.ts 的 blobUrl 一样) */
export function blobThumbUrl(sha: string, w: number): string {
  return apiUrl(`/api/blobs/${sha}?w=${w}`);
}

// ---------------------------------------------------------------- 卡的绑定

/** 写一张卡某一类的绑定。DebugApp 给的版本:当前这张卡走 hook(游戏里马上换),别的卡直接写库 */
export interface CardBindingWriter {
  sprite: (cardId: string, packIds: string[]) => Promise<void>;
  scene: (cardId: string, parts: CardSceneParts) => Promise<void>;
  cg: (cardId: string, packIds: string[]) => Promise<void>;
  voice: (cardId: string, v: CardVoices) => Promise<void>;
}

/** 直接写库的版本(没有当前卡的时候、演示页里用) */
export const directBindings: CardBindingWriter = {
  sprite: async (cardId, packIds) => {
    await debugApi.setCardSpritePacks(cardId, packIds);
  },
  scene: async (cardId, parts) => {
    await debugApi.setCardScenePacks(cardId, parts);
  },
  cg: async (cardId, packIds) => {
    await debugApi.setCardCgPacks(cardId, packIds);
  },
  voice: async (cardId, v) => {
    await debugApi.setCardVoices(cardId, v);
  },
};

/** 读一张卡这一类现在的绑定 */
export async function readBinding<K extends LibraryKind>(kind: K, cardId: string): Promise<BindingOf[K]>;
export async function readBinding(kind: LibraryKind, cardId: string): Promise<BindingOf[LibraryKind]> {
  if (kind === 'sprite') return (await debugApi.getCardSpritePacks(cardId)).pack_ids;
  if (kind === 'cg') return debugApi.getCardCgPacks(cardId);
  if (kind === 'voice') return debugApi.getCardVoices(cardId);
  return debugApi.getCardScenePacks(cardId);
}

/** 写回去 */
export function writeBinding<K extends LibraryKind>(
  writer: CardBindingWriter,
  kind: K,
  cardId: string,
  value: BindingOf[K],
): Promise<void>;
export function writeBinding(
  writer: CardBindingWriter,
  kind: LibraryKind,
  cardId: string,
  value: BindingOf[LibraryKind],
): Promise<void> {
  if (kind === 'sprite') return writer.sprite(cardId, value as string[]);
  if (kind === 'cg') return writer.cg(cardId, value as string[]);
  if (kind === 'voice') return writer.voice(cardId, value as CardVoices);
  return writer.scene(cardId, value as CardSceneParts);
}

// ---------------------------------------------------------------- 编辑器旁边要的几样(整页共用,读一次)

/** 一张卡能拿来当立绘预览背景的:第一个出背景的场景包里没停用、有图的。按卡记住,换包不重读 */
const cardBackgrounds = new Map<string, Promise<SceneAsset[]>>();

export function backgroundsOfCard(cardId: string): Promise<SceneAsset[]> {
  let p = cardBackgrounds.get(cardId);
  if (!p) {
    p = (async () => {
      const parts = await debugApi.getCardScenePacks(cardId);
      const first = parts.bg[0];
      if (!first) return [];
      const list = await debugApi.listSceneAssets(first);
      return list.filter((a) => a.kind === 'bg' && a.enabled && a.has_file);
    })();
    // 读失败了下次再试
    p.catch(() => cardBackgrounds.delete(cardId));
    cardBackgrounds.set(cardId, p);
  }
  return p;
}

/** 卡的绑定改过了:立绘预览背景下次重读(不给 = 全部) */
export function forgetCardBackgrounds(cardIds?: readonly string[]) {
  if (!cardIds) cardBackgrounds.clear();
  else for (const id of cardIds) cardBackgrounds.delete(id);
}

/** 场景包列表(BGM 页的封面曲记在包上) */
let scenePacks: Promise<ScenePack[]> | null = null;

export function scenePacksOnce(): Promise<ScenePack[]> {
  if (!scenePacks) {
    const p = debugApi.listScenePacks();
    p.catch(() => {
      if (scenePacks === p) scenePacks = null;
    });
    scenePacks = p;
  }
  return scenePacks;
}

/** 场景包改过(封面曲、名字)、删了:下次再读 */
export function forgetScenePacks() {
  scenePacks = null;
}
