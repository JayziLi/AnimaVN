/**
 * 插件抽屉「AI 生图」那一页(第 2 步 D5):设置照旧是 ImageGenSettings 那一套。抽屉里看的是另一张卡时,
 * 这张卡的设置(imagegen.setup:画风、尺寸、连接、模型……)和长相那份(plugin.imagegen)都读写看的那张卡,
 * 不切换调试台当前的卡。画风库、画图连接是全局的,和当前那张卡共用。
 * 相册只跟着调试台当前那张卡(画图、收藏都在那张卡的对话里)。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { debugApi } from '../../lib/api';
import { imagegenApi } from './api';
import { DEFAULT_CARD_PREFS, IMAGEGEN_SETTING_KEY, normalizeCardPrefs, type CardImagePrefs } from './config';
import { drawBlockOf, kindsOf } from './connModel';
import { ImageGenSettings } from './ImageGenSettings';
import { buildTrial } from './request';
import { libraryOf, type StyleLibrary } from './setup';
import { useCardSetup } from './useCardSetup';
import type { ImageGenStore } from './useImageGen';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ConsoleSettings({
  store,
  card,
  place = 'console',
}: {
  store: ImageGenStore;
  card: { id: string; name: string } | null;
  /** 游戏菜单里的插件页用纸面那套(和游戏设置里的 AI 生图同一个样子) */
  place?: 'game' | 'console';
}) {
  const other = card && card.id !== store.cardId ? card : null;
  const otherId = other?.id ?? null;
  const { notify, config: current, changeConfig: changeCurrent } = store;
  // 画风库是全局的:改了交给当前那张卡的 changeConfig(只差画风库那一样,它就只写画风库)
  const library = useMemo(() => libraryOf(current), [current]);
  const changeLibrary = useCallback((lib: StyleLibrary) => changeCurrent({ ...current, ...lib }), [current, changeCurrent]);
  const mine = useCardSetup(otherId, library, changeLibrary, notify);
  const mineReady = mine.setup !== null;
  const [loaded, setLoaded] = useState<{ cardId: string; prefs: CardImagePrefs } | null>(null);
  useEffect(() => {
    // 等 imagegen.setup 读到再读:第一次读 setup 时,后端会把老字段从这里搬走
    if (!otherId || !mineReady) return;
    let live = true;
    debugApi
      .cardPrefs(otherId)
      .then((all) => {
        if (live) setLoaded({ cardId: otherId, prefs: normalizeCardPrefs(all[IMAGEGEN_SETTING_KEY]) });
      })
      .catch((e: unknown) => notify('error', `这张卡的生图设置读取失败: ${errText(e)}`));
    return () => {
      live = false;
    };
  }, [otherId, mineReady, notify]);
  const timer = useRef<number | undefined>(undefined);

  if (!other) return <ImageGenSettings store={store} place={place} />;

  const prefs = loaded?.cardId === other.id ? loaded.prefs : DEFAULT_CARD_PREFS;
  const changePrefs = (next: CardImagePrefs) => {
    // 还没读到这张卡存的那份就别写:不然拿默认值盖掉
    if (loaded?.cardId !== other.id) return;
    setLoaded({ cardId: other.id, prefs: next });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      debugApi
        .putCardPref(other.id, IMAGEGEN_SETTING_KEY, { ...next })
        .catch((e: unknown) => notify('error', `这张卡的生图设置保存失败: ${errText(e)}`));
    }, 500);
  };
  const kinds = kindsOf(store.imageConns);
  const view: ImageGenStore = {
    ...store,
    cardId: other.id,
    cardName: other.name,
    charName: other.name,
    prefs,
    changePrefs,
    config: mine.config,
    changeConfig: mine.changeConfig,
    setup: mine.setup,
    conn: store.imageConns?.find((c) => c.id === mine.setup?.conn) ?? null,
    setConn: (id) => mine.setConn(id, kinds),
    configFor: (id) => mine.configFor(id, kinds),
    drawBlock: drawBlockOf(store.imageConns, mine.setup, true),
    testDraw: (id) =>
      imagegenApi.testConnection(
        id,
        buildTrial(mine.configFor(id, kinds), prefs, { cardId: other.id, charName: other.name, userName: store.userName }, id, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      ),
    deleteConn: async (id) => {
      await mine.flush();
      await store.deleteConn(id);
      mine.reload();
    },
    album: null,
    albumError: `相册跟着调试台当前那张卡${store.cardName ? `(${store.cardName})` : ''};要看${other.name}画过的,先在右栏选它`,
    reloadAlbum: async () => {},
  };
  return <ImageGenSettings store={view} place={place} />;
}
