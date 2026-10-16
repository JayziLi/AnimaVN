/**
 * 状态组在调试台里的状态(plugins/states.ts 的规则):这张卡在状态组里时,读组里每张状态卡的立绘和场景素材,
 * 拼成整组的列表,交出和形态卡带一样的 FormsState(时间线、视觉小说、存档缩略图、Jev、宏照旧只认它)。
 * 不在组里、组里只有一张、或者还在读时 enabled 是 false,调试台照旧用形态卡带那份。
 *
 * 当前这张卡的立绘、场景素材用调试台手里那份(插件页改了马上跟着变),别的状态卡的另外读。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { debugApi, type PackSprite, type SceneAsset, type StateGroup } from '../lib/api';
import type { ChatEntry } from '../lib/chatEntry';
import type { FormsCg, FormsState, NamedSprite } from './cartridges';
import { legacyStateMarks } from './forms';
import { mergeBoundScene, sceneUnion } from './scenePacks';
import {
  groupAssets,
  groupSprites,
  makeStatesLens,
  markState,
  mergeStateSwitches,
  stateAt,
  switchesFromEntries,
  type StateAssets,
} from './states';

export interface StatesState extends FormsState {
  /** 整组的立绘、场景素材(启用的;主状态在前);enabled 是 false 时是空的 */
  sprites: PackSprite[];
  assets: SceneAsset[];
  /** 各状态的名字,按顺序(顶栏按钮用) */
  stateNames: string[];
  /** 读完了(不在组里也算) */
  ready: boolean;
}

interface StatesInput {
  cardId: string | null;
  chatId: string | null;
  entries: readonly ChatEntry[];
  /** 当前这张卡的立绘、场景素材(启用的) */
  sprites: readonly PackSprite[];
  assets: readonly SceneAsset[];
  patchEntry: (id: string, fn: (e: ChatEntry) => ChatEntry) => void;
}

const enabled = <T extends { enabled: boolean }>(xs: readonly T[]) => xs.filter((x) => x.enabled);

/** 一张状态卡游戏里用的立绘和场景素材(和 useSpritePacks、useScenePlugin 读的一样) */
async function loadState(card: string): Promise<{ sprites: PackSprite[]; assets: SceneAsset[] }> {
  const [sprites, binding, cgIds] = await Promise.all([
    debugApi.listCardSprites(card),
    debugApi.getCardScenePacks(card),
    debugApi.getCardCgPacks(card).catch(() => [] as string[]),
  ]);
  const sceneIds = sceneUnion(binding);
  const [packs, sceneLists, cgLists] = await Promise.all([
    debugApi.listScenePacks(),
    Promise.all(sceneIds.map((id) => debugApi.listSceneAssets(id))),
    Promise.all(cgIds.map((id) => debugApi.listCgAssets(id))),
  ]);
  const lists = Object.fromEntries(sceneIds.map((id, i) => [id, sceneLists[i]]));
  return { sprites: enabled(sprites), assets: enabled(mergeBoundScene(binding, lists, packs, cgLists)) };
}

const NO_GROUP: StateGroup = { group_id: null, main_card_id: null, states: [] };

export function useStates(o: StatesInput): StatesState {
  const { cardId, chatId, entries, sprites, assets, patchEntry } = o;
  const [group, setGroup] = useState<{ card: string | null; group: StateGroup }>({ card: null, group: NO_GROUP });
  const [others, setOthers] = useState<{ card: string | null; data: Record<string, { sprites: PackSprite[]; assets: SceneAsset[] }> }>({
    card: null,
    data: {},
  });

  useEffect(() => {
    let live = true;
    if (!cardId) {
      setGroup({ card: null, group: NO_GROUP });
      return;
    }
    debugApi
      .cardStates(cardId)
      // 旧后端没有状态
      .catch(() => NO_GROUP)
      .then(async (g) => {
        if (!live) return;
        setGroup({ card: cardId, group: g });
        const rest = g.states.filter((s) => s.card_id !== cardId);
        const loaded = await Promise.all(rest.map((s) => loadState(s.card_id).catch(() => null)));
        if (!live) return;
        const data: Record<string, { sprites: PackSprite[]; assets: SceneAsset[] }> = {};
        rest.forEach((s, i) => {
          const got = loaded[i];
          if (got) data[s.card_id] = got;
        });
        setOthers({ card: cardId, data });
      });
    return () => {
      live = false;
    };
  }, [cardId]);

  const g = group.card === cardId ? group.group : NO_GROUP;
  const loadedOthers = others.card === cardId;
  const states = useMemo<StateAssets[]>(() => {
    if (g.states.length < 2 || !loadedOthers) return [];
    const ordered = [...g.states].sort((a, b) => a.sort - b.sort);
    const out: StateAssets[] = [];
    for (const s of ordered) {
      const data = s.card_id === cardId ? { sprites, assets } : others.data[s.card_id];
      if (!data) return []; // 有一张没读到:先不开,照旧用形态卡带那份
      out.push({ card: s.card_id, name: s.name, sprites: data.sprites, assets: data.assets });
    }
    return out;
  }, [g, loadedOthers, others, cardId, sprites, assets]);
  const on = states.length >= 2;

  const nameOf = useCallback(
    (card: string) => states.find((s) => s.card === card)?.name ?? states[0]?.name ?? '',
    [states],
  );
  // 存档里的状态记号 + 以前的形态记号(旧形态卡带换算的)。流式时 entries 每个字都变:按内容比
  const switchesJson = useMemo(
    () => (on ? JSON.stringify(mergeStateSwitches(switchesFromEntries(entries, nameOf), legacyStateMarks(chatId, entries))) : '[]'),
    [on, entries, nameOf, chatId],
  );
  const switches = useMemo(() => JSON.parse(switchesJson) as ReturnType<typeof switchesFromEntries>, [switchesJson]);
  const idsKey = entries.map((e) => e.id).join('\n');
  const order = useMemo(
    () => new Map(idsKey ? idsKey.split('\n').map((id, i) => [id, i] as const) : []),
    [idsKey],
  );
  const main = states[0]?.name ?? '';
  const current = on ? stateAt(switches, order, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, main) : null;
  const lens = useMemo(
    () => (on && current !== null ? makeStatesLens({ states, switches, order, current }) : null),
    [on, states, switches, order, current],
  );
  const byName = useMemo(() => new Map(states.map((s) => [s.name, s])), [states]);

  // 新回复:{{sprites}}、Jev 只看对话末尾那个状态的立绘
  const spritesNow = useCallback(
    <T extends NamedSprite>(list: readonly T[]): readonly T[] => {
      const st = current !== null ? byName.get(current) : undefined;
      if (!st) return list;
      const ids = new Set(st.sprites.map((s) => s.id));
      return list.filter((s) => ids.has((s as unknown as { id?: string }).id ?? ''));
    },
    [current, byName],
  );
  const cgIn = useCallback(
    (cg: FormsCg, state: string) => !cg.id || !!byName.get(state)?.assets.some((a) => a.id === cg.id),
    [byName],
  );
  const cgOkAt = useMemo(
    () => (on ? (cg: FormsCg, i: number) => cgIn(cg, stateAt(switches, order, i, Number.MAX_SAFE_INTEGER, main)) : undefined),
    [on, cgIn, switches, order, main],
  );
  const cgOkNow = useMemo(
    () => (on && current !== null ? (cg: FormsCg) => cgIn(cg, current) : undefined),
    [on, cgIn, current],
  );
  const lensFor = useCallback(
    (id: string, list: readonly ChatEntry[]) => {
      if (!on) return null;
      const all = mergeStateSwitches(switchesFromEntries(list, nameOf), legacyStateMarks(id, list));
      const at = new Map(list.map((e, i) => [e.id, i] as const));
      return makeStatesLens({ states, switches: all, order: at, current: stateAt(all, at, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, main) });
    },
    [on, nameOf, states, main],
  );
  const switchAt = useCallback(
    (entryId: string, line: number, state: string) => {
      const card = byName.get(state)?.card;
      if (card) patchEntry(entryId, (e) => markState(e, line, card));
    },
    [byName, patchEntry],
  );

  const unionSprites = useMemo(() => groupSprites(states), [states]);
  const unionAssets = useMemo(() => groupAssets(states), [states]);
  return {
    enabled: on,
    current,
    lens,
    spritesNow,
    cgOkAt,
    cgOkNow,
    lensFor,
    switchAt,
    sprites: unionSprites,
    assets: unionAssets,
    stateNames: states.map((s) => s.name),
    ready: !cardId || (group.card === cardId && (g.states.length < 2 || loadedOthers)),
  };
}
