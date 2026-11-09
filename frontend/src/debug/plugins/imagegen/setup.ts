/**
 * 每张卡自己的生图设置(后端 imagegen.setup,设计 docs/superpowers/specs/2026-11-07-imagegen-backends-design.md 第 3 节)
 * 和设置页一直在用的 ImageGenConfig 之间怎么来回换。纯函数,有测试(setup.test.ts)。
 *
 * - 页面看到的 config = 全局 plugin.imagegen 里的画风库(styles、stylesVersion)+ setup 外层 + setup.byConn[setup.conn]
 * - 改了拆回去:只写改过的那几项。外层 / 跟连接走的划分和后端 setup.py 的 COMMON / PER_CONN 一样
 *   (外层多一个 artists:以前在卡上的画师串,后端升级时搬进了外层)
 * - 这边不认识的字段原样留着(以后几份加的 loras、promptStyle、template 这些),不会被存掉
 */

import { normalizeImageGenConfig, type ImageGenConfig, type ImageStyle } from './config';

/** 这张卡所有连接共用的(setup 外层),换连接不变 */
export const SETUP_COMMON: readonly (keyof ImageGenConfig)[] = [
  'styleId',
  'artists',
  'size',
  'res',
  'custom',
  'seed',
  'holdLines',
  'place',
  'auto',
  'camera',
  'player',
  'writer',
];

/** 这张卡在每条连接下各存一份的(setup.byConn[连接编号]) */
export const SETUP_PER_CONN: readonly (keyof ImageGenConfig)[] = [
  'model',
  'steps',
  'scale',
  'sampler',
  'scheduler',
  'loras',
  'noise',
  'rescale',
  'variety',
  'quality',
  'ucPreset',
  'uc',
  'allowPaid',
  'skills',
];

export interface ImageSetup {
  v: number;
  /** 这张卡用哪条画图连接;没选、被删了是 null */
  conn: string | null;
  /** 连接编号 → 这张卡在那条连接下的那份 */
  byConn: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/** 全局 plugin.imagegen 11-07 起只存这两样 */
export interface StyleLibrary {
  styles: ImageStyle[];
  stylesVersion: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const blankSetup = (): ImageSetup => ({ v: 1, conn: null, byConn: {} });

/** 后端回的那份整理一下(后端只搬字段、不看结构):conn 不是字符串当没选,byConn 里不是对象的扔掉,别的原样留着 */
export function normalizeSetup(raw: unknown): ImageSetup {
  if (!isObj(raw)) return blankSetup();
  const byConn: ImageSetup['byConn'] = {};
  if (isObj(raw.byConn)) {
    for (const [id, v] of Object.entries(raw.byConn)) if (isObj(v)) byConn[id] = { ...v };
  }
  return {
    ...raw,
    v: typeof raw.v === 'number' ? raw.v : 1,
    conn: typeof raw.conn === 'string' && raw.conn ? raw.conn : null,
    byConn,
  };
}

/** 全局 plugin.imagegen → 画风库。11-07 以前那份里的别的字段不看:后端升级时已经拆到每张卡了 */
export function normalizeLibrary(raw: unknown): StyleLibrary {
  const c = normalizeImageGenConfig(isObj(raw) ? { styles: raw.styles, stylesVersion: raw.stylesVersion } : undefined);
  return { styles: c.styles, stylesVersion: c.stylesVersion };
}

export const DEFAULT_LIBRARY: StyleLibrary = normalizeLibrary(undefined);

/** 页面那份里的画风库(插件抽屉看另一张卡时,画风库还是全局那一份) */
export const libraryOf = (c: Pick<ImageGenConfig, 'styles' | 'stylesVersion'>): StyleLibrary => ({
  styles: c.styles,
  stylesVersion: c.stylesVersion,
});

/** 页面用的那份:画风库 + 外层 + 这张卡在选的那条连接下的那份;还没读到(null)就是默认值 */
export function mergeSetup(library: StyleLibrary, setup: ImageSetup | null): ImageGenConfig {
  const s = setup ?? blankSetup();
  const raw: Record<string, unknown> = {};
  for (const k of SETUP_COMMON) if (k in s) raw[k] = s[k];
  const mine = s.conn ? s.byConn[s.conn] : undefined;
  if (mine) for (const k of SETUP_PER_CONN) if (k in mine) raw[k] = mine[k];
  return normalizeImageGenConfig({ ...raw, styles: library.styles, stylesVersion: library.stylesVersion });
}

/**
 * 页面改了 config:拆回 setup(只写改过的项,外层的写外层,跟连接走的写进这条连接那份)和画风库(改了才给)。
 * 还没选连接时,跟连接走的那几项没地方存,不写(画面页这时只让选连接)
 */
export function applyConfig(
  setup: ImageSetup,
  before: ImageGenConfig,
  after: ImageGenConfig,
): { setup: ImageSetup; library: StyleLibrary | null } {
  const next: ImageSetup = { ...setup, byConn: { ...setup.byConn } };
  for (const k of SETUP_COMMON) if (!same(before[k], after[k])) next[k] = after[k];
  if (setup.conn) {
    const mine: Record<string, unknown> = { ...(setup.byConn[setup.conn] ?? {}) };
    let changed = false;
    for (const k of SETUP_PER_CONN) {
      if (same(before[k], after[k])) continue;
      mine[k] = after[k];
      changed = true;
    }
    // 只存了 uc、没存预设的那份,读的时候会当成 10-12 以前的旧写法(预设算「不用」)
    if ('uc' in mine && !('ucPreset' in mine)) mine.ucPreset = after.ucPreset;
    if (changed) next.byConn[setup.conn] = mine;
  }
  const library =
    same(before.styles, after.styles) && before.stylesVersion === after.stylesVersion ? null : libraryOf(after);
  return { setup: next, library };
}

/**
 * 换这张卡用的连接(kinds:连接编号 → 类型)。这张卡在新连接下没存过:
 * 和原来那条是同一种(比如两个 NovelAI 号)就抄一份原来那条的,不然从默认开始
 */
export function withConn(setup: ImageSetup, id: string | null, kinds: Readonly<Record<string, string>>): ImageSetup {
  if (id === setup.conn) return setup;
  const next: ImageSetup = { ...setup, conn: id, byConn: { ...setup.byConn } };
  const from = setup.conn ? setup.byConn[setup.conn] : undefined;
  const sameKind = id !== null && setup.conn !== null && kinds[id] !== undefined && kinds[id] === kinds[setup.conn];
  if (id && from && !next.byConn[id] && sameKind) next.byConn[id] = JSON.parse(JSON.stringify(from)) as Record<string, unknown>;
  return next;
}
