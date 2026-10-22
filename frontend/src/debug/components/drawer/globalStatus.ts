/**
 * 插件抽屉全局组行尾、页头的状态字(第 2 步 D4)。纯逻辑,画法在 PluginsDrawer.tsx 和 pages/。
 */

import type { JevHealth } from '../../plugins/jev';

/** 一台语音服务这次打开抽屉测出来的样子;还没测完是 'pending' */
export type TtsTest = 'pending' | { ok: true; ms: number } | { ok: false; error: string };

/** 语音服务:没设 / 测试中 / 通了 / 连不上;ok 是 null 时不算好也不算坏(没设、还在测) */
export function ttsSummary(
  connections: readonly { id: string }[],
  tests: Readonly<Record<string, TtsTest | undefined>>,
): { text: string; ok: boolean | null } {
  const n = connections.length;
  if (n === 0) return { text: '没设', ok: null };
  const results = connections.map((c) => tests[c.id]);
  if (results.some((r) => r === undefined || r === 'pending')) return { text: '测试中…', ok: null };
  const good = results.filter((r) => r !== undefined && r !== 'pending' && r.ok).length;
  if (good === n) return { text: n === 1 ? '通了' : `${n} 台都通了`, ok: true };
  if (good === 0) return { text: n === 1 ? '连不上' : `${n} 台都连不上`, ok: false };
  return { text: `${good}/${n} 台通了`, ok: false };
}

/** Jev 的连接状态怎么说(左栏行尾、Jev 页页头) */
export const JEV_HEALTH_TEXT: Record<JevHealth, string> = {
  ok: '已连上',
  missing: '还没填 key',
  error: '上次出错',
  idle: '没在用',
};

/** 等 ms 毫秒还没回就当失败 */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
