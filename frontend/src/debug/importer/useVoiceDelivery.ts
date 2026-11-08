/**
 * 导完以后把新声音的文件送到语音机:读一次声音列表,挑出这次新建的 pending 的,依次 POST /api/voices/{id}/deliver。
 * 状态怎么变见 deliveryModel.ts;关掉页面不影响(第一次念的时候后端还会送)。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { debugApi } from '../lib/api';
import { mark, nextToSend, pendingVoices, retry, startItems, type DeliveryItem } from './deliveryModel';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useVoiceDelivery(voiceIds: readonly string[] | undefined) {
  const [items, setItems] = useState<DeliveryItem[]>([]);
  const key = (voiceIds ?? []).join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) return;
    let alive = true;
    debugApi.listVoices().then(
      (list) => alive && setItems(startItems(pendingVoices(ids, list))),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [key]);

  // 送的请求不随下一次渲染取消(标成「正在送」以后 nextId 就变成 null 了);只在卸载以后不再改状态
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const nextId = nextToSend(items)?.id ?? null;
  useEffect(() => {
    if (!nextId) return;
    setItems((cur) => mark(cur, nextId, 'sending'));
    debugApi.deliverVoice(nextId).then(
      () => mounted.current && setItems((cur) => mark(cur, nextId, 'done')),
      (e) => mounted.current && setItems((cur) => mark(cur, nextId, 'fail', errText(e))),
    );
  }, [nextId]);

  const again = useCallback((id: string) => setItems((cur) => retry(cur, id)), []);
  return { items, retry: again };
}
