/**
 * 当前这张卡的按卡设置(合并规则见 cardPrefs.ts):换卡时重新读。
 * 切得快时旧请求可能后到,只收当前这张卡的结果(和 useVoicePlugin 读卡的声音一样)。
 *
 * 返回 null = 没选卡、还在读、读失败 —— 这时各插件一律照全局。
 * 这一期还没有「这张卡另设」的开关(第 2 期下半整理插件设置时做),所以只读不写。
 */

import { useEffect, useRef, useState } from 'react';
import { debugApi, type CardPrefs } from '../lib/api';

type Notify = (kind: 'ok' | 'error', message: string) => void;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useCardPrefs(cardId: string | null, notify?: Notify): CardPrefs | null {
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

  return loaded && loaded.cardId === cardId ? loaded.prefs : null;
}
