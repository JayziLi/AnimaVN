/**
 * 世界书全局设置的持久化。存在这台机器的 localStorage 里,不入库。
 * 默认值是酒馆的出厂值,读的时候逐字段校验,坏值退回默认。
 */

import { DEFAULT_WORLD_INFO_SETTINGS, type WorldInfoSettings } from './worldInfo';

const KEY = 'debug.worldInfoSettings';

/** 设置页上每个数字框的范围,和酒馆界面上的滑块一致 */
export const WORLD_INFO_LIMITS = {
  scanDepth: { min: 0, max: 1000 },
  budgetPercent: { min: 1, max: 100 },
  budgetCap: { min: 0, max: 65536 },
  maxRecursionSteps: { min: 0, max: 10 },
  minActivations: { min: 0, max: 100 },
  minActivationsDepthMax: { min: 0, max: 1000 },
} as const;

type NumberKey = keyof typeof WORLD_INFO_LIMITS;

export function clampWorldInfoNumber(key: NumberKey, raw: unknown): number {
  const { min, max } = WORLD_INFO_LIMITS[key];
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_WORLD_INFO_SETTINGS[key];
  return Math.min(max, Math.max(min, n));
}

export function isDefaultWorldInfoSettings(s: WorldInfoSettings): boolean {
  return (Object.keys(DEFAULT_WORLD_INFO_SETTINGS) as (keyof WorldInfoSettings)[]).every(
    (k) => s[k] === DEFAULT_WORLD_INFO_SETTINGS[k],
  );
}

export function loadWorldInfoSettings(): WorldInfoSettings {
  let raw: unknown;
  try {
    const text = window.localStorage.getItem(KEY);
    if (text === null) return DEFAULT_WORLD_INFO_SETTINGS;
    raw = JSON.parse(text);
  } catch {
    return DEFAULT_WORLD_INFO_SETTINGS;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_WORLD_INFO_SETTINGS;
  const o = raw as Partial<Record<keyof WorldInfoSettings, unknown>>;

  const flag = (k: keyof WorldInfoSettings) =>
    typeof o[k] === 'boolean' ? (o[k] as boolean) : (DEFAULT_WORLD_INFO_SETTINGS[k] as boolean);
  const number = (k: NumberKey) =>
    o[k] === undefined ? DEFAULT_WORLD_INFO_SETTINGS[k] : clampWorldInfoNumber(k, o[k]);

  return {
    scanDepth: number('scanDepth'),
    budgetPercent: number('budgetPercent'),
    budgetCap: number('budgetCap'),
    includeNames: flag('includeNames'),
    recursive: flag('recursive'),
    caseSensitive: flag('caseSensitive'),
    matchWholeWords: flag('matchWholeWords'),
    useGroupScoring: flag('useGroupScoring'),
    maxRecursionSteps: number('maxRecursionSteps'),
    minActivations: number('minActivations'),
    minActivationsDepthMax: number('minActivationsDepthMax'),
  };
}

export function saveWorldInfoSettings(value: WorldInfoSettings): void {
  window.localStorage.setItem(KEY, JSON.stringify(value));
}
