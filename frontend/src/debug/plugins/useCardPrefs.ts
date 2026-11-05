/**
 * 当前这张卡的按卡设置(合并规则见 cardPrefs.ts):换卡时重新读。
 * 切得快时旧请求可能后到,只收当前这张卡的结果(和 useVoicePlugin 读卡的声音一样)。
 *
 * prefs 是 null = 没选卡、还在读、读失败 —— 这时各插件一律照全局。
 * 写:put(键, 改了的全部字段) 整份换掉这一项(后端不合并),先改本地再写库,写失败照提示、本地不回退
 * (下次换卡重读就对上了)。现在只有这张卡的台词语言(plugin.lang.lang,vn/LangAsk.tsx)在写
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { debugApi, type CardPrefs, type CardPrefValue } from '../lib/api';

type Notify = (kind: 'ok' | 'error', message: string) => void;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface CardPrefsState {
  prefs: CardPrefs | null;
  /** 整份换掉这张卡的一项;没选卡时什么都不做 */
  put: (key: string, value: CardPrefValue) => Promise<boolean>;
}

export function useCardPrefsState(cardId: string | null, notify?: Notify): CardPrefsState {
  // 连同是哪张卡的一起存:刚换卡、新的还没读到的那一下,不会把上一张卡的设置当成这张的
  const [loaded, setLoaded] = useState<{ cardId: string; prefs: CardPrefs } | null>(null);
  const cardRef = useRef<string | null>(null);

  useEffect(() => {
    cardRef.current = cardId;
    if (!cardId) return;
    debugApi
      .cardPrefs(cardId)
      .then((prefs) => {
        if (cardRef.current === cardId) setLoaded({ cardId, prefs });
      })
      .catch((e: unknown) => notify?.('error', `这张卡的插件设置读取失败(先照全局): ${errText(e)}`));
  }, [cardId, notify]);

  const put = useCallback(
    async (key: string, value: CardPrefValue) => {
      if (!cardId) return false;
      setLoaded((prev) =>
        prev && prev.cardId === cardId ? { cardId, prefs: { ...prev.prefs, [key]: value } } : { cardId, prefs: { [key]: value } },
      );
      try {
        await debugApi.putCardPref(cardId, key, value);
        return true;
      } catch (e) {
        notify?.('error', `这张卡的设置没存上: ${errText(e)}`);
        return false;
      }
    },
    [cardId, notify],
  );

  return { prefs: loaded && loaded.cardId === cardId ? loaded.prefs : null, put };
}

export function useCardPrefs(cardId: string | null, notify?: Notify): CardPrefs | null {
  return useCardPrefsState(cardId, notify).prefs;
}
