/** 插件抽屉几页共用的小工具:跑一个改后端数据的操作、报错、刷新列表 */

import { useRef, useState } from 'react';

export type Notify = (kind: 'ok' | 'error', message: string) => void;

export type Runner = (label: string, fn: () => Promise<void>) => Promise<boolean>;

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** 跑一个操作,完了刷新列表。返回操作本身有没有成功 */
export function useRunner(notify: Notify, reload: () => Promise<void>): [string | null, Runner] {
  const [busy, setBusy] = useState<string | null>(null);
  // 同时跑着几个(上传还没完又点了别的):先完的那个不能把转圈提前关掉
  const running = useRef(0);
  const run = async (label: string, fn: () => Promise<void>) => {
    running.current += 1;
    setBusy(label);
    let ok = false;
    try {
      await fn();
      ok = true;
    } catch (e) {
      notify('error', errText(e));
    } finally {
      try {
        await reload();
      } catch (e) {
        // 操作失败时上面已经报过错了,保留旧列表就行;操作成功了却刷新不出来,得说一声
        if (ok) notify('error', `已完成,但列表刷新失败:${errText(e)}`);
      }
      running.current -= 1;
      if (running.current === 0) setBusy(null);
    }
    return ok;
  };
  return [busy, run];
}
