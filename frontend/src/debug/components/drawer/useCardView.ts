/**
 * 插件抽屉「看哪张卡」(第 2 步 D3):按卡单独去读这张卡的立绘、场景包、CG 包、声音和按卡设置,
 * 不切换调试台当前的卡。cardId 变了就重读;同一张卡 30 秒内重开抽屉不重读(reload 强制)。
 * 读法照 lib/api.ts 已有的接口;旧后端没有的(CG 包、按卡设置)当没有。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { debugApi, type PackSprite, type SceneAsset, type SpritePack, type VoiceProfile } from '../../lib/api';
import { enabledOnly } from '../../plugins/common';
import { backgroundsOf, bgmsOf, cgsOf } from '../../plugins/scene';
import { mergeBoundScene, sceneUnion } from '../../plugins/scenePacks';
import { cardFacts, type CardViewRaw, type DrawerCardFacts } from './cardView';

/** 读回来的、除了声音列表以外的那些(声音列表跟着调试台走,外面传进来) */
type Loaded = Omit<CardViewRaw, 'profiles' | 'card' | 'spritePacks'> & { spritePacks: SpritePack[] };

const FRESH_MS = 30_000;
/** 这一页打开期间按卡记着读过的;抽屉关了再开、在几张卡之间来回看都不重读 */
const cache = new Map<string, { at: number; data: Loaded }>();

async function load(cardId: string): Promise<Loaded> {
  const [packs, sprites, spritePacks, sceneParts, scenePacks, cgPackIds, cgPacks, voices, prefs] = await Promise.all([
    debugApi.getCardSpritePacks(cardId),
    debugApi.listCardSprites(cardId),
    debugApi.listSpritePacks(),
    debugApi.getCardScenePacks(cardId),
    debugApi.listScenePacks(),
    // 旧后端没有 CG 包、没有按卡设置
    debugApi.getCardCgPacks(cardId).catch(() => [] as string[]),
    debugApi.listCgPacks().catch(() => []),
    debugApi.getCardVoices(cardId),
    debugApi.cardPrefs(cardId).catch(() => ({})),
  ]);
  const [sceneLists, cgLists] = await Promise.all([
    Promise.all(sceneUnion(sceneParts).map((id) => debugApi.listSceneAssets(id))),
    Promise.all(cgPackIds.map((id) => debugApi.listCgAssets(id).catch(() => [] as SceneAsset[]))),
  ]);
  return {
    packs,
    spritePacks,
    sprites,
    sceneParts,
    sceneAssets: sceneLists.flat(),
    scenePacks,
    cgPackIds,
    cgAssets: cgLists.flat(),
    cgPacks,
    voices,
    prefs,
  };
}

export interface CardView {
  facts: DrawerCardFacts | null;
  /** 启用的立绘 */
  sprites: PackSprite[];
  /** 当前立绘包里的全部立绘(含停用的;认词记录要拿停用的名字) */
  allSprites: PackSprite[];
  /** 当前立绘包(包名、几张卡在用);没挂包是 null */
  spritePack: SpritePack | null;
  /** 启用的背景、BGM、CG 构图(拼法和游戏一样) */
  bgs: SceneAsset[];
  bgms: SceneAsset[];
  cgs: SceneAsset[];
  /** 这张卡全部启用的场景素材(含 CG 差分;配对表要) */
  assets: SceneAsset[];
  loading: boolean;
  /** 读不到的原因 */
  error: string | null;
  reload: () => void;
}

export function useCardView(card: { id: string; name: string } | null, profiles: readonly VoiceProfile[]): CardView {
  const cardId = card?.id ?? null;
  const [state, setState] = useState<{ cardId: string; data: Loaded } | null>(() => {
    const hit = cardId ? cache.get(cardId) : undefined;
    return cardId && hit ? { cardId, data: hit.data } : null;
  });
  const [error, setError] = useState<{ cardId: string; text: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!cardId) return;
    const hit = cache.get(cardId);
    if (hit && Date.now() - hit.at < FRESH_MS) {
      setState({ cardId, data: hit.data });
      return;
    }
    let live = true;
    load(cardId)
      .then((data) => {
        cache.set(cardId, { at: Date.now(), data });
        if (live) {
          setState({ cardId, data });
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (live) setError({ cardId, text: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [cardId, tick]);

  const reload = useCallback(() => {
    if (cardId) cache.delete(cardId);
    setTick((t) => t + 1);
  }, [cardId]);

  const data = state && state.cardId === cardId ? state.data : null;
  const name = card?.name ?? '';
  return useMemo<CardView>(() => {
    const err = error && error.cardId === cardId ? error.text : null;
    if (!cardId || !data) {
      return {
        facts: null,
        sprites: [],
        allSprites: [],
        spritePack: null,
        bgs: [],
        bgms: [],
        cgs: [],
        assets: [],
        loading: cardId !== null && !err,
        error: err,
        reload,
      };
    }
    const lists: Record<string, SceneAsset[]> = {};
    for (const a of data.sceneAssets) (lists[a.pack_id] ??= []).push(a);
    const assets = enabledOnly(mergeBoundScene(data.sceneParts, lists, data.scenePacks ?? [], [data.cgAssets]));
    return {
      facts: cardFacts({ ...data, card: { id: cardId, name }, profiles }),
      sprites: enabledOnly(data.sprites),
      allSprites: [...data.sprites],
      spritePack: data.spritePacks.find((p) => p.id === data.packs.current) ?? null,
      bgs: backgroundsOf(assets),
      bgms: bgmsOf(assets),
      cgs: cgsOf(assets),
      assets,
      loading: false,
      error: err,
      reload,
    };
  }, [cardId, name, data, profiles, error, reload]);
}
