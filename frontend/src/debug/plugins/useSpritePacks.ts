/**
 * 立绘包在调试台里的状态:全部立绘包、当前这张卡挂着哪些包、哪个是当前,以及当前包里的立绘。
 *
 * 当前包存在后端(卡和包的绑定表上),换包 = 写一下绑定再拉那个包的立绘,这张卡所有对话、
 * 存档都跟着换。AI 那边不知道换过:{{sprites}} 只是换成了新包的表情名。
 * 切得快时旧请求可能后到 —— 只收当前卡、当前包的结果。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { debugApi, type CardSpritePacks, type PackSprite, type SpritePack } from '../lib/api';

type Notify = (kind: 'ok' | 'error', message: string) => void;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface SpritePackState {
  /** 全部立绘包(插件页「加一个已有的包」、角色页的包名都从这里取) */
  packs: SpritePack[];
  refreshPacks: () => Promise<void>;
  /** 这张卡挂着的包,按顺序 */
  packIds: string[];
  /** 游戏里正在用的包;没选卡、没挂包时是 null */
  packId: string | null;
  /** 当前包里的立绘(含禁用的),排第一的是默认表情 */
  sprites: PackSprite[];
  /** 插件页改完立绘后把新列表交回来;不是当前包的结果丢掉 */
  changeSprites: (packId: string, next: PackSprite[]) => void;
  /** 换一套立绘 */
  switchPack: (packId: string) => Promise<void>;
  /** 整组改这张卡挂哪些包;current 不给 = 当前包还挂着就不变,拿掉了换成它后面的下一个 */
  setPacks: (packIds: string[], current?: string) => Promise<void>;
  /** 包被删了:重新读这张卡的绑定(当前包可能顺延到了下一个) */
  reload: () => Promise<void>;
  /** 这张卡的当前包和它的立绘都拿到了:游戏的素材等待页据此知道要等哪些图 */
  ready: boolean;
}

const NO_PACK = { packId: null as string | null, sprites: [] as PackSprite[] };

export function useSpritePacks(cardId: string | null, notify: Notify): SpritePackState {
  const [packs, setPackList] = useState<SpritePack[]>([]);
  const refreshPacks = useCallback(async () => {
    try {
      setPackList(await debugApi.listSpritePacks());
    } catch (e) {
      notify('error', `立绘包列表读取失败: ${errText(e)}`);
    }
  }, [notify]);
  useEffect(() => {
    void refreshPacks();
  }, [refreshPacks]);

  const [bound, setBound] = useState<CardSpritePacks | null>(null);
  // 包 id 和它的立绘一起换:换包时新图到了才换,中间不会空一下
  const [current, setCurrent] = useState(NO_PACK);
  const cardRef = useRef<string | null>(null);
  const packRef = useRef<string | null>(null);

  /** 收下一份绑定;当前包变了就去拉新包的立绘 */
  const apply = useCallback(
    async (b: CardSpritePacks) => {
      if (cardRef.current !== b.card_id) return;
      setBound(b);
      const pid = b.current;
      if (packRef.current === pid) return;
      packRef.current = pid;
      if (!pid) {
        setCurrent(NO_PACK);
        return;
      }
      try {
        const list = await debugApi.listSprites(pid);
        if (cardRef.current === b.card_id && packRef.current === pid) setCurrent({ packId: pid, sprites: list });
      } catch (e) {
        notify('error', `立绘读取失败: ${errText(e)}`);
      }
    },
    [notify],
  );

  const reload = useCallback(async () => {
    const cid = cardRef.current;
    if (!cid) return;
    try {
      await apply(await debugApi.getCardSpritePacks(cid));
    } catch (e) {
      notify('error', `立绘包绑定读取失败: ${errText(e)}`);
    }
    await refreshPacks();
  }, [apply, notify, refreshPacks]);

  useEffect(() => {
    cardRef.current = cardId;
    packRef.current = null;
    setBound(null);
    setCurrent(NO_PACK);
    if (!cardId) return;
    debugApi
      .getCardSpritePacks(cardId)
      .then(apply)
      .catch((e: unknown) => notify('error', `立绘包绑定读取失败: ${errText(e)}`));
  }, [cardId, apply, notify]);

  const switchPack = async (pid: string) => {
    if (!cardId) return;
    try {
      await apply(await debugApi.setCardCurrentSpritePack(cardId, pid));
    } catch (e) {
      notify('error', `换立绘包失败: ${errText(e)}`);
    }
  };

  const setPacks = async (ids: string[], currentId?: string) => {
    if (!cardId) return;
    try {
      await apply(await debugApi.setCardSpritePacks(cardId, ids, currentId));
    } catch (e) {
      notify('error', `改立绘包失败: ${errText(e)}`);
    }
    // 在用的卡数变了
    await refreshPacks();
  };

  const changeSprites = (pid: string, next: PackSprite[]) => {
    if (packRef.current === pid) setCurrent({ packId: pid, sprites: next });
  };

  return {
    packs,
    refreshPacks,
    packIds: bound?.pack_ids ?? [],
    packId: current.packId,
    sprites: current.sprites,
    changeSprites,
    switchPack,
    setPacks,
    reload,
    ready:
      cardId === null ||
      (bound?.card_id === cardId && (bound.current === null || current.packId === bound.current)),
  };
}
