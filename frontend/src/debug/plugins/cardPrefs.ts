/**
 * 按卡设置(素材架构设计 2.9、第 2 期):一张卡在全局插件设置之上另外改的几项。
 *
 * 后端只存取(card_prefs 表,接口见 lib/api.ts 的 cardPrefs / putCardPref / deleteCardPref),不看里面的结构;
 * 哪些字段能按卡设、怎么和全局合并都在这里。存的只是这张卡改了的那几个字段,比如 plugin.cg 存
 * {"jev": {"threshold": 0.75}};没改的字段照用全局 —— 全局改了,这张卡没另设的字段跟着变。
 *
 * 合并在 normalize 之前做:全局的原样叠上覆盖,再交给各插件自己的 normalize,类型不对、超出范围的
 * 和全局一样退回默认。调试台手里的全局配置是 normalize 过的,再过一遍 normalize 结果不变,当原样用就行。
 *
 * 纯函数,不碰 React、不碰接口;读当前这张卡的设置见 useCardPrefs.ts。
 * 「这张卡另设」的开关放到第 2 期下半整理插件设置时做;这一期只有存取和合并,今天没有卡另设过,行为不变。
 */

import type { CardPrefs } from '../lib/api';
import { PLUGIN } from './registry';

/**
 * 能按卡设的字段:设置的键 → 字段路径(点分隔)。没列在这里的键、字段,库里存了也不合并。
 *   背景 / 音乐 / CG   AI 写标签还是 Jev 标(mode)、Jev 换的门槛(jev.threshold)
 *   立绘、玩家台词      AI 写标签还是 Jev 标(mode)
 * 路径照各自的 normalize 写(scene.ts normalizeSceneConfig、sprite.ts normalizeSpriteConfig、
 * player.ts normalizePlayerConfig);那边改了字段名这里跟着改,cardPrefs.test.ts 会查对不对得上
 */
export const CARD_PREF_FIELDS: Readonly<Record<string, readonly string[]>> = {
  [PLUGIN.sprite.settingKey]: ['mode'],
  [PLUGIN.bg.settingKey]: ['mode', 'jev.threshold'],
  [PLUGIN.bgm.settingKey]: ['mode', 'jev.threshold'],
  [PLUGIN.cg.settingKey]: ['mode', 'jev.threshold'],
  [PLUGIN.player.settingKey]: ['mode'],
  [PLUGIN.lang.settingKey]: ['autoFill'],
};

/** 这个键能按卡设的字段;不能按卡设的键是 null(用 hasOwn:库里来的键可能叫 constructor 这类) */
export const cardPrefFieldsOf = (key: string): readonly string[] | null =>
  Object.hasOwn(CARD_PREF_FIELDS, key) ? CARD_PREF_FIELDS[key] : null;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** 按路径取值;路径上哪一层不是对象就是 undefined */
function getPath(obj: unknown, path: readonly string[]): unknown {
  let cur = obj;
  for (const k of path) {
    if (!isObject(cur) || !Object.hasOwn(cur, k)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** 按路径写值,返回新对象:一路上的对象各复制一层,原来的不动(全局配置还在 state 里用着) */
function setPath(obj: unknown, path: readonly string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path;
  const base = isObject(obj) ? obj : {};
  return { ...base, [head]: rest.length === 0 ? value : setPath(base[head], rest, value) };
}

/**
 * 全局的原样叠上这张卡对这一项的覆盖,返回的还是原样(交给插件自己的 normalize)。
 * 只合并 fields 里声明过的字段,同一层没另设的字段照用全局(按路径深合并,不是整块换掉 jev);
 * 覆盖里没写的字段照用全局。一个能合并的字段都没有时原样返回 globalRaw 本身(同一个对象)
 */
export function effectiveConfig(globalRaw: unknown, override: unknown, fields: readonly string[]): unknown {
  if (!isObject(override)) return globalRaw;
  let out = globalRaw;
  for (const field of fields) {
    const path = field.split('.');
    const value = getPath(override, path);
    if (value !== undefined) out = setPath(out, path, value);
  }
  return out;
}

/**
 * 这张卡实际用的配置:全局配置叠上这张卡对 key 的覆盖,再 normalize 一遍。
 * 没选卡、还没读到、这张卡没另设这一项(或者另设的全是不能按卡设的字段)时原样返回全局那份
 * (同一个对象,跟着它算的 useMemo 不会白算)
 */
export function effectiveOf<T>(
  global: T,
  prefs: CardPrefs | null | undefined,
  key: string,
  normalize: (raw: unknown) => T,
): T {
  const fields = cardPrefFieldsOf(key);
  if (!fields || !isObject(prefs)) return global;
  const raw = effectiveConfig(global, prefs[key], fields);
  return raw === global ? global : normalize(raw);
}

/**
 * 回放检查用:全部设置(键 → 库里的原样)换成这张卡实际用的那份。只动这张卡另设过、能按卡设的键,
 * 别的原样;一项都没动时返回 settings 本身
 */
export function settingsForCard(
  settings: Record<string, unknown>,
  prefs: CardPrefs | null | undefined,
): Record<string, unknown> {
  if (!isObject(prefs)) return settings;
  let out = settings;
  for (const [key, override] of Object.entries(prefs)) {
    const fields = cardPrefFieldsOf(key);
    if (!fields) continue;
    const raw = effectiveConfig(settings[key], override, fields);
    if (raw !== settings[key]) out = { ...out, [key]: raw };
  }
  return out;
}
