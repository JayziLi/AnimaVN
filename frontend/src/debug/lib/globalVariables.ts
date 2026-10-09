/**
 * 全局变量({{setglobalvar}} / {{getglobalvar}})的持久化。
 * 所有对话共用,存在这台机器的 localStorage 里。局部变量不在这儿 —— 它跟着对话存在库里。
 */

import type { VarValue } from './macros';

const KEY = 'debug.globalVariables';

export function loadGlobalVariables(): Record<string, VarValue> {
  let raw: unknown;
  try {
    const text = window.localStorage.getItem(KEY);
    if (text === null) return {};
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, VarValue> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'number') out[name] = value;
  }
  return out;
}

export function saveGlobalVariables(value: Record<string, VarValue>): void {
  window.localStorage.setItem(KEY, JSON.stringify(value));
}
