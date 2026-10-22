/**
 * 插件抽屉「AI 生图」那一页(第 2 步 D5):设置照旧是 ImageGenSettings 那一套;抽屉里看的是另一张卡时,
 * 标着「这张卡」的那几项(长相、画风另选、只画全年龄、这张卡不自动出图、参考图)读写看的那张卡,
 * 不切换调试台当前的卡。相册只跟着调试台当前那张卡(画图、收藏都在那张卡的对话里)。
 */

import { useEffect, useRef, useState } from 'react';
import { debugApi } from '../../lib/api';
import { DEFAULT_CARD_PREFS, IMAGEGEN_SETTING_KEY, normalizeCardPrefs, type CardImagePrefs } from './config';
import { ImageGenSettings } from './ImageGenSettings';
import type { ImageGenStore } from './useImageGen';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ConsoleSettings({ store, card }: { store: ImageGenStore; card: { id: string; name: string } | null }) {
  const other = card && card.id !== store.cardId ? card : null;
  const otherId = other?.id ?? null;
  const { notify } = store;
  const [loaded, setLoaded] = useState<{ cardId: string; prefs: CardImagePrefs } | null>(null);
  useEffect(() => {
    if (!otherId) return;
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
  }, [otherId, notify]);
  const timer = useRef<number | undefined>(undefined);

  if (!other) return <ImageGenSettings store={store} place="console" />;

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
  const view: ImageGenStore = {
    ...store,
    cardId: other.id,
    cardName: other.name,
    prefs,
    changePrefs,
    album: null,
    albumError: `相册跟着调试台当前那张卡${store.cardName ? `(${store.cardName})` : ''};要看${other.name}画过的,先在右栏选它`,
    reloadAlbum: async () => {},
  };
  return <ImageGenSettings store={view} place="console" />;
}
