/**
 * 背景 / BGM / CG 插件在调试台里的全部状态:三份全局配置(以及当前这张卡实际用的那三份)、
 * 场景包列表、当前这张卡绑的包,以及包里的素材。
 *
 * 配置和立绘一样:先改内存,停手半秒再写库。素材跟着「当前卡绑的包」走,
 * 换卡时重新拉;切得快时旧请求可能后到,只收当前这张卡的结果。
 *
 * 第 4 期起 CG 在 CG 包里、单独绑到卡上(可以叠几个);第 1 步起背景、BGM 分开绑(binding.bg / binding.bgm,
 * 一个包可以两边都出)。assets 是拼好的那张(plugins/scenePacks.ts 的 mergeBoundScene),
 * 游戏、Jev、宏照旧只看它;插件页编辑背景、曲子改的是场景包,编辑 CG 改的是 CG 包。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { debugApi, type CardPrefs, type CgPack, type SceneAsset, type ScenePack } from '../lib/api';
import { effectiveOf } from './cardPrefs';
import { SCENE, normalizeSceneConfig, type SceneKindKey, type ScenePluginConfig } from './scene';
import { EMPTY_SCENE_BINDING, mergeBoundScene, sceneUnion, type SceneBinding } from './scenePacks';
import { usePluginConfig } from './usePluginConfig';

type Notify = (kind: 'ok' | 'error', message: string) => void;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface ScenePluginState {
  /** 三份全局配置:插件抽屉显示、改的是它 */
  configs: Record<SceneKindKey, ScenePluginConfig>;
  /**
   * 当前这张卡实际用的:全局配置叠上这张卡另设的几项(cardPrefs.ts)。管行为的地方
   * (Jev 标哪几类、门槛、标签格式、视觉小说)用它;这张卡没另设时就是 configs 本身
   */
  effective: Record<SceneKindKey, ScenePluginConfig>;
  changeConfig: (kind: SceneKindKey, next: ScenePluginConfig) => void;
  packs: ScenePack[];
  refreshPacks: () => Promise<void>;
  /** 当前卡的背景包、BGM 包,各按顺序(一个包可能两边都在);没选卡时两边都空 */
  binding: SceneBinding;
  /** 整组改当前卡的背景包、BGM 包;存完以后以后端读回来的为准(两边共用一个先后,见 bindings.replace_scene) */
  bindScene: (next: SceneBinding) => Promise<void>;
  /** 重读当前卡的场景包绑定、CG 包绑定和包里的素材(生图收藏、卡编辑器改完用) */
  reloadCard: () => Promise<void>;
  /** 当前卡绑着的每个场景包的完整列表(包 id → 素材,含停用的;卡编辑器的背景栏、BGM 栏用) */
  sceneLists: Record<string, SceneAsset[]>;
  /** 当前卡绑的第一个场景包(背景的在前,只出曲子的接后面);没选卡或没绑时为 null。插件页还在用 */
  packId: string | null;
  /** 游戏用的素材:背景包的背景、BGM 包的曲子、没拆过的场景包的 CG,接上这张卡绑的 CG 包里的 CG(scenePacks.ts) */
  assets: SceneAsset[];
  /** 全部 CG 包 */
  cgPacks: CgPack[];
  refreshCgPacks: () => Promise<void>;
  /** 当前卡绑的 CG 包,按顺序 */
  cgPackIds: string[];
  /** 改当前卡绑哪些 CG 包(整组,按顺序) */
  bindCgPacks: (packIds: string[]) => Promise<void>;
  /** CG 包被删了:如果正绑着它,本地也拿掉 */
  forgetCgPack: (packId: string) => void;
  /** 标题画面放的曲子:BGM 栏第一个包设的封面曲;null = 放排第一的 */
  titleBgmId: string | null;
  /** 改 BGM 栏第一个包的封面曲(null = 回到默认)。只能是那个包里的曲子 */
  setTitleBgm: (bgmId: string | null) => Promise<void>;
  /** 改某个场景包的封面曲(null = 回到默认);曲子要在这个包里 */
  setTitleBgmOf: (packId: string, bgmId: string | null) => Promise<void>;
  /** 旧的一张卡一个场景包的改法:换掉排第一的那个(换上的背景和 BGM 都出;null = 拿掉它),后面叠着的不动 */
  bindPack: (packId: string | null) => Promise<void>;
  /** 抽屉里改完素材后把新列表交回来(场景包或者绑着的 CG 包);别的包的结果丢掉 */
  changeAssets: (packId: string, next: SceneAsset[]) => void;
  /** 包被删了:如果正绑着它,本地也解绑(两边都拿掉) */
  forgetPack: (packId: string) => void;
  /** 当前卡的场景素材列表拿到了(没绑包、读失败也算):游戏的素材等待页据此知道要等哪些图 */
  ready: boolean;
}

/** prefs:当前这张卡的按卡设置(useCardPrefs);null = 没选卡、还没读到,一律照全局 */
export function useScenePlugin(cardId: string | null, notify: Notify, prefs: CardPrefs | null): ScenePluginState {
  // 三份配置各读各写(开机读一次,改了停手半秒再写库),见 usePluginConfig
  const bg = usePluginConfig(SCENE.bg.settingKey, (v) => normalizeSceneConfig('bg', v), SCENE.bg.defaults, notify);
  const bgm = usePluginConfig(SCENE.bgm.settingKey, (v) => normalizeSceneConfig('bgm', v), SCENE.bgm.defaults, notify);
  const cg = usePluginConfig(SCENE.cg.settingKey, (v) => normalizeSceneConfig('cg', v), SCENE.cg.defaults, notify);
  // 拼成一份交出去;只有哪一份真的变了才换新对象(调试台里好几个 useMemo 跟着它算)
  const configs = useMemo<Record<SceneKindKey, ScenePluginConfig>>(
    () => ({ bg: bg.config, bgm: bgm.config, cg: cg.config }),
    [bg.config, bgm.config, cg.config],
  );
  // 这张卡实际用的三份。三份都没另设时交出 configs 本身,跟着它算的 useMemo 和没有按卡设置时一样
  const effective = useMemo<Record<SceneKindKey, ScenePluginConfig>>(() => {
    const of = (kind: SceneKindKey) =>
      effectiveOf(configs[kind], prefs, SCENE[kind].settingKey, (v) => normalizeSceneConfig(kind, v));
    const next = { bg: of('bg'), bgm: of('bgm'), cg: of('cg') };
    return next.bg === configs.bg && next.bgm === configs.bgm && next.cg === configs.cg ? configs : next;
  }, [configs, prefs]);

  const changeConfig = (kind: SceneKindKey, next: ScenePluginConfig) => {
    ({ bg, bgm, cg })[kind].change(next);
  };

  const [packs, setPacks] = useState<ScenePack[]>([]);
  const refreshPacks = useCallback(async () => {
    try {
      setPacks(await debugApi.listScenePacks());
    } catch (e) {
      notify('error', `场景包列表读取失败: ${errText(e)}`);
    }
  }, [notify]);

  const [cgPacks, setCgPacks] = useState<CgPack[]>([]);
  const refreshCgPacks = useCallback(async () => {
    try {
      setCgPacks(await debugApi.listCgPacks());
    } catch {
      // 旧后端没有 CG 包
      setCgPacks([]);
    }
  }, []);

  const [binding, setBinding] = useState<SceneBinding>(EMPTY_SCENE_BINDING);
  const [sceneLists, setSceneLists] = useState<Record<string, SceneAsset[]>>({});
  const [cgPackIds, setCgPackIds] = useState<string[]>([]);
  const [cgLists, setCgLists] = useState<Record<string, SceneAsset[]>>({});
  // 哪张卡的场景包、CG 包列表已经拿到了
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [cgLoadedFor, setCgLoadedFor] = useState<string | null>(null);
  const cardRef = useRef<string | null>(null);
  const bindingRef = useRef<SceneBinding>(EMPTY_SCENE_BINDING);
  // 每读一次场景包内容加一:同一张卡连着改绑定时,只收最后那次的结果
  const sceneSeq = useRef(0);
  const cgRef = useRef<string[]>([]);

  const loadCg = useCallback(
    async (forCard: string, ids: string[]) => {
      cgRef.current = ids;
      setCgPackIds(ids);
      try {
        const lists = await Promise.all(ids.map((id) => debugApi.listCgAssets(id)));
        if (cardRef.current === forCard && cgRef.current === ids) {
          setCgLists(Object.fromEntries(ids.map((id, i) => [id, lists[i]])));
        }
      } catch (e) {
        notify('error', `CG 读取失败: ${errText(e)}`);
      }
      if (cardRef.current === forCard) setCgLoadedFor(forCard);
    },
    [notify],
  );

  /** 换上新的绑定并拉每个包的列表。读的时候旧列表先留着(还绑着的包不闪),拿到了整份换掉 */
  const loadScene = useCallback(
    async (forCard: string, next: SceneBinding) => {
      const seq = ++sceneSeq.current;
      bindingRef.current = next;
      setBinding(next);
      const ids = sceneUnion(next);
      const current = () => cardRef.current === forCard && sceneSeq.current === seq;
      try {
        if (ids.length === 0) {
          if (current()) setSceneLists({});
        } else {
          // 包的列表顺手刷一下:封面音乐记在包上
          const [lists] = await Promise.all([Promise.all(ids.map((id) => debugApi.listSceneAssets(id))), refreshPacks()]);
          if (current()) setSceneLists(Object.fromEntries(ids.map((id, i) => [id, lists[i]])));
        }
      } catch (e) {
        notify('error', `场景素材读取失败: ${errText(e)}`);
      }
      if (cardRef.current === forCard) setLoadedFor(forCard);
    },
    [notify, refreshPacks],
  );

  /** 读一张卡的场景包绑定、CG 包绑定和包里的素材(切卡、reloadCard 都走这里) */
  const loadCard = useCallback(
    async (forCard: string) => {
      const scene = debugApi
        .getCardScenePacks(forCard)
        .then(async (b) => {
          if (cardRef.current === forCard) await loadScene(forCard, b);
        })
        .catch((e: unknown) => {
          notify('error', `场景包绑定读取失败: ${errText(e)}`);
          if (cardRef.current === forCard) setLoadedFor(forCard);
        });
      const cgs = debugApi
        .getCardCgPacks(forCard)
        // 旧后端没有 CG 包:当作一个都没绑(场景包里的 CG 照旧用)
        .catch(() => [] as string[])
        .then(async (ids) => {
          if (cardRef.current === forCard) await loadCg(forCard, ids);
        });
      await Promise.all([scene, cgs]);
    },
    [loadScene, loadCg, notify],
  );

  // 包的列表(素材直接换的下拉框要用)不跟着卡走,打开抽屉就拉一次;没有绑定的卡本来也不会顺手刷新它
  useEffect(() => {
    void refreshPacks();
    void refreshCgPacks();
  }, [refreshPacks, refreshCgPacks]);

  useEffect(() => {
    cardRef.current = cardId;
    sceneSeq.current += 1;
    bindingRef.current = EMPTY_SCENE_BINDING;
    cgRef.current = [];
    setBinding(EMPTY_SCENE_BINDING);
    setSceneLists({});
    setCgPackIds([]);
    setCgLists({});
    setLoadedFor(null);
    setCgLoadedFor(null);
    if (!cardId) return;
    void loadCard(cardId);
  }, [cardId, loadCard]);

  const reloadCard = useCallback(async () => {
    const forCard = cardRef.current;
    if (forCard) await loadCard(forCard);
  }, [loadCard]);

  const bindScene = async (next: SceneBinding) => {
    const forCard = cardRef.current;
    if (!forCard) return;
    try {
      // 用读回来的:两边共用一个先后,存进去的顺序不一定原样回来
      const saved = await debugApi.setCardScenePacks(forCard, next);
      if (cardRef.current === forCard) await loadScene(forCard, saved);
    } catch (e) {
      notify('error', `绑定场景包失败: ${errText(e)}`);
    }
    // 包上的「被几张卡用」跟着变
    await refreshPacks();
  };

  const bindCgPacks = async (ids: string[]) => {
    if (!cardId) return;
    try {
      await debugApi.setCardCgPacks(cardId, ids);
      await loadCg(cardId, ids);
    } catch (e) {
      notify('error', `绑定 CG 包失败: ${errText(e)}`);
    }
    await refreshCgPacks();
  };

  const forgetCgPack = (pid: string) => {
    if (cgRef.current.includes(pid)) {
      const ids = cgRef.current.filter((id) => id !== pid);
      cgRef.current = ids;
      setCgPackIds(ids);
    }
  };

  const bindPack = async (pid: string | null) => {
    if (!cardId) return;
    try {
      await debugApi.setCardScenePack(cardId, pid);
      await reloadCard();
    } catch (e) {
      notify('error', `绑定场景包失败: ${errText(e)}`);
    }
    await refreshPacks();
  };

  const changeAssets = (pid: string, next: SceneAsset[]) => {
    if (sceneUnion(bindingRef.current).includes(pid)) setSceneLists((lists) => ({ ...lists, [pid]: next }));
    if (cgRef.current.includes(pid)) setCgLists((lists) => ({ ...lists, [pid]: next }));
  };

  const assets = useMemo(
    () => mergeBoundScene(binding, sceneLists, packs, cgPackIds.map((id) => cgLists[id] ?? [])),
    [binding, sceneLists, packs, cgPackIds, cgLists],
  );

  const packId = sceneUnion(binding)[0] ?? null;
  const titleBgmId = packs.find((p) => p.id === binding.bgm[0])?.title_bgm_id ?? null;

  const setTitleBgmOf = useCallback(
    async (pid: string, bgmId: string | null) => {
      // 先改本地,下拉框马上跟手;写库失败再以库里的为准
      setPacks((ps) => ps.map((p) => (p.id === pid ? { ...p, title_bgm_id: bgmId } : p)));
      try {
        const saved = await debugApi.updateScenePack(pid, { title_bgm_id: bgmId });
        setPacks((ps) => ps.map((p) => (p.id === pid ? saved : p)));
      } catch (e) {
        notify('error', `封面音乐保存失败: ${errText(e)}`);
        await refreshPacks();
      }
    },
    [notify, refreshPacks],
  );

  const setTitleBgm = async (bgmId: string | null) => {
    const pid = bindingRef.current.bgm[0];
    if (pid) await setTitleBgmOf(pid, bgmId);
  };

  const forgetPack = (pid: string) => {
    const b = bindingRef.current;
    if (!b.bg.includes(pid) && !b.bgm.includes(pid)) return;
    const next = { bg: b.bg.filter((id) => id !== pid), bgm: b.bgm.filter((id) => id !== pid) };
    bindingRef.current = next;
    setBinding(next);
    setSceneLists((lists) => Object.fromEntries(Object.entries(lists).filter(([id]) => id !== pid)));
  };

  return {
    configs,
    effective,
    changeConfig,
    packs,
    refreshPacks,
    binding,
    bindScene,
    reloadCard,
    sceneLists,
    packId,
    assets,
    cgPacks,
    refreshCgPacks,
    cgPackIds,
    bindCgPacks,
    forgetCgPack,
    titleBgmId,
    setTitleBgm,
    setTitleBgmOf,
    bindPack,
    changeAssets,
    forgetPack,
    ready: cardId === null || (loadedFor === cardId && cgLoadedFor === cardId),
  };
}
