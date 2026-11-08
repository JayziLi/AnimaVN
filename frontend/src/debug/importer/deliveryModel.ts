/**
 * 导完自动把声音文件送到语音机(Task 5):导完页对这次新建的、files_at 还是 pending 的声音依次调 POST /api/voices/{id}/deliver。
 * 每个声音一行:「正在送到语音机…」→「送好了」,失败写后端原文和「重试」。关掉不影响(第一次念的时候还会送)。
 * 这里只放状态怎么变和每行写什么;请求和画在 useVoiceDelivery / VoiceDelivery。
 */

import type { VoiceProfile } from '../lib/api';

export type DeliveryStep = 'wait' | 'sending' | 'done' | 'fail';

export interface DeliveryItem {
  id: string;
  name: string;
  step: DeliveryStep;
  /** 失败时后端的原话 */
  error?: string;
}

/** 这次新建的声音里还没送过去的(files_at = pending),按新建的先后 */
export function pendingVoices(
  created: readonly string[] | undefined,
  profiles: readonly Pick<VoiceProfile, 'id' | 'name' | 'files_at'>[],
): { id: string; name: string }[] {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return (created ?? []).flatMap((id) => {
    const p = byId.get(id);
    return p && p.files_at === 'pending' ? [{ id, name: p.name }] : [];
  });
}

export const startItems = (list: readonly { id: string; name: string }[]): DeliveryItem[] =>
  list.map((v) => ({ ...v, step: 'wait' as const }));

/** 一次只送一个:没有正在送的,就轮到第一个等着的 */
export function nextToSend(items: readonly DeliveryItem[]): DeliveryItem | null {
  if (items.some((i) => i.step === 'sending')) return null;
  return items.find((i) => i.step === 'wait') ?? null;
}

export function mark(items: readonly DeliveryItem[], id: string, step: DeliveryStep, error?: string): DeliveryItem[] {
  return items.map((i) => (i.id === id ? { id: i.id, name: i.name, step, ...(error !== undefined ? { error } : {}) } : i));
}

/** 重试:失败的那个回到排队 */
export const retry = (items: readonly DeliveryItem[], id: string) =>
  items.map((i) => (i.id === id && i.step === 'fail' ? { id: i.id, name: i.name, step: 'wait' as const } : i));

export function deliveryText(i: DeliveryItem): string {
  switch (i.step) {
    case 'wait':
      return '等一下再送…';
    case 'sending':
      return '正在送到语音机…';
    case 'done':
      return '送好了';
    case 'fail':
      return i.error || '没送成';
  }
}
