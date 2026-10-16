/**
 * 插件开关 —— 插件页右上角的小开关,关掉立绘 / 背景 / 音乐 / CG / AI 出图(10-12 用户要的)。
 *
 * 关掉的那一路:画面上不显示,也不干活 —— 提示词里它的块不发、标签摘掉(core/assembly.ts 的 offKinds),
 * Jev 不问这道题,AI 出图不画。预设和插件设置都不动,打开就照旧。
 * 全局一份,存在后端 plugin.switches;玩家台词、外语、语音不归这里管(语音有自己的开关)。
 */

import { objectOf } from './common';
import type { JevKinds } from './jev';

export const SWITCH_SETTING_KEY = 'plugin.switches';

export type SwitchKind = 'sprite' | 'bg' | 'bgm' | 'cg' | 'illustrations';

/** true = 开着 */
export type PluginSwitches = Record<SwitchKind, boolean>;

export const DEFAULT_SWITCHES: PluginSwitches = { sprite: true, bg: true, bgm: true, cg: true, illustrations: true };

export function normalizeSwitches(raw: unknown): PluginSwitches {
  const r = objectOf(raw);
  return Object.fromEntries(
    Object.entries(DEFAULT_SWITCHES).map(([kind, on]) => [kind, typeof r[kind] === 'boolean' ? r[kind] : on]),
  ) as PluginSwitches;
}

/** 关掉的那几路(给组装用;玩家台词不归这里管) */
export const offKindsOf = (s: PluginSwitches): JevKinds => ({
  sprite: !s.sprite,
  bg: !s.bg,
  bgm: !s.bgm,
  cg: !s.cg,
  player: false,
});
