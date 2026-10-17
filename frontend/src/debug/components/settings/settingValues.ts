/** SettingRow 用的常量和小函数(放在组件文件外面,热更新才不会整页刷新) */

/** 能在哪一层设:全局(所有卡)/ 这张卡 / 这台设备 */
export type SettingScope = 'global' | 'card' | 'device';

export const SCOPE_NAME: Record<SettingScope, string> = { global: '全局', card: '这张卡', device: '这台设备' };

/** 值和默认不一样吗(滑条的小数按 1e-9 比) */
export function differsFromDefault(value: unknown, def: unknown): boolean {
  if (def === undefined) return false;
  if (typeof value === 'number' && typeof def === 'number') return Math.abs(value - def) > 1e-9;
  return value !== def;
}
