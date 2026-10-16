/**
 * 状态(素材架构设计 3.5,第 4 期):几张卡是同一个角色的几个状态(比如普通 / 换了衣服),游戏顶栏点一下就切。
 *
 * 用和形态卡带同一个接口(cartridges.ts 的 FormsState、core/timeline.ts 的 FormsLens)接进时间线,规则也一样:
 * - 每句属于哪个状态 = 它之前(含这一句)最近的切换记号;没有记号是主状态。记号存在 swipe_info[分支].vn.state
 *   ({line, card}),按消息算(换分支也算);还没传进存档的旧形态记号由旧形态卡带按状态名换算过来(legacyStateMarks)
 * - 认表情在整组状态卡的立绘里认(主状态的在前):这句生效的表情不属于这句的状态时,换成这个状态的默认图(排第一的)
 * - CG 只在这句状态卡绑着的 CG 包里出;切到没绑这张 CG 的状态时收起,切回来不带回,等下一个 CG 标签
 * - 新回复:{{sprites}}、Jev 只看对话末尾那个状态的立绘和 CG
 * 镜头里的「形态」用状态名(组里的名字不重复)。背景、曲子这一期用主状态的场景包。
 * 纯函数,不碰 React、不碰接口;读接口、拼 FormsState 在 useStates.ts。
 */

import type { FormsLens, Pos } from '../core/timeline';
import type { PackSprite, SceneAsset } from '../lib/api';
import type { ChatEntry, SwipeInfo, VnStateMark } from '../lib/chatEntry';

/** 一个状态:名字和它那张卡的(启用的)立绘、场景素材 */
export interface StateAssets {
  card: string;
  name: string;
  sprites: readonly PackSprite[];
  assets: readonly SceneAsset[];
}

/** 记号:第 entryId 条第 line 句切到了 state(状态名) */
export interface StateSwitch {
  entryId: string;
  line: number;
  state: string;
}

/** 整组的立绘:主状态的在前,其余按状态的顺序接上(编号一样的只留一份) */
export function groupSprites(states: readonly StateAssets[]): PackSprite[] {
  const seen = new Set<string>();
  const out: PackSprite[] = [];
  for (const s of states) {
    for (const sprite of s.sprites) {
      if (seen.has(sprite.id)) continue;
      seen.add(sprite.id);
      out.push(sprite);
    }
  }
  return out;
}

/** 整组的场景素材:主状态的全部(背景、曲子、它的 CG),再接上别的状态才有的 CG(编号一样的只留一份) */
export function groupAssets(states: readonly StateAssets[]): SceneAsset[] {
  const [main, ...rest] = states;
  if (!main) return [];
  const out = [...main.assets];
  const seen = new Set(out.map((a) => a.id));
  for (const s of rest) {
    for (const a of s.assets) {
      if (a.kind !== 'cg' || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}

/** (第几条, 第几句)的状态:它之前(含同一句)最近的那个记号;对话里已经没有的条目的记号不算;没有记号是 fallback */
export function stateAt(
  switches: readonly StateSwitch[],
  order: ReadonlyMap<string, number>,
  index: number,
  line: number,
  fallback: string,
): string {
  let best: { index: number; line: number; state: string } | null = null;
  for (const s of switches) {
    const i = order.get(s.entryId);
    if (i === undefined) continue;
    if (i > index || (i === index && s.line > line)) continue;
    if (!best || i > best.index || (i === best.index && s.line >= best.line)) best = { index: i, line: s.line, state: s.state };
  }
  return best?.state ?? fallback;
}

/** from 之后、到 to 为止(含 to)切到过 ok 不认的状态吗(CG 切到没绑它的状态时收起) */
export function switchedAway(
  switches: readonly StateSwitch[],
  order: ReadonlyMap<string, number>,
  from: Pos,
  to: Pos,
  ok: (state: string) => boolean,
): boolean {
  const after = (a: Pos, b: Pos) => a.index > b.index || (a.index === b.index && a.line > b.line);
  return switches.some((s) => {
    const index = order.get(s.entryId);
    if (index === undefined || ok(s.state)) return false;
    const at = { index, line: s.line };
    return after(at, from) && !after(at, to);
  });
}

function marksOf(info: SwipeInfo | undefined): readonly VnStateMark[] {
  const marks = info?.vn?.state;
  return Array.isArray(marks) ? marks : [];
}

/**
 * 对话里存着的状态记号(按消息算,几个分支都读,同一句以正在看的分支为准),状态卡编号换成名字;
 * 指向的卡不在组里了(删了)按主状态算
 */
export function switchesFromEntries(entries: readonly ChatEntry[], nameOf: (card: string) => string): StateSwitch[] {
  const out: StateSwitch[] = [];
  for (const e of entries) {
    const seen = new Set<number>();
    const infos = [e.swipeInfo[e.swipeIndex], ...e.swipeInfo.filter((_, i) => i !== e.swipeIndex)];
    for (const info of infos) {
      for (const m of marksOf(info)) {
        if (typeof m?.line !== 'number' || typeof m.card !== 'string' || seen.has(m.line)) continue;
        seen.add(m.line);
        out.push({ entryId: e.id, line: m.line, state: nameOf(m.card) });
      }
    }
  }
  return out;
}

/** 状态记号为主,旧形态记号里同一个位置没有状态记号的补上 */
export function mergeStateSwitches(saved: readonly StateSwitch[], legacy: readonly StateSwitch[]): StateSwitch[] {
  const key = (s: StateSwitch) => `${s.entryId}\n${s.line}`;
  const have = new Set(saved.map(key));
  return [...saved, ...legacy.filter((s) => !have.has(key(s)))];
}

/** 在这条消息的第 line 句记「切到 card 这张状态卡」:写进每个分支(swipe_info 比分支少的补上),同一句上原来的换掉 */
export function markState(entry: ChatEntry, line: number, card: string): ChatEntry {
  const n = Math.max(entry.swipes.length, entry.swipeInfo.length);
  const swipeInfo = Array.from({ length: n }, (_, i): SwipeInfo => {
    const info = entry.swipeInfo[i] ?? ({} as SwipeInfo);
    const state = [...marksOf(info).filter((m) => m.line !== line), { line, card }].sort((a, b) => a.line - b.line);
    return { ...info, vn: { ...info.vn, state } };
  });
  return { ...entry, swipeInfo };
}

/** 状态给时间线的接口(和形态的 FormsLens 一样);states[0] 是主状态 */
export function makeStatesLens(o: {
  states: readonly StateAssets[];
  switches: readonly StateSwitch[];
  order: ReadonlyMap<string, number>;
  /** 对话末尾的状态(条目不在这段对话里时用它) */
  current: string;
}): FormsLens {
  const { states, switches, order, current } = o;
  const byName = new Map(states.map((s) => [s.name, s]));
  const labels = new Map(states.map((s) => [s.name, new Set(s.sprites.map((x) => x.label))]));
  const cgs = new Map(states.map((s) => [s.name, new Set(s.assets.filter((a) => a.kind === 'cg').map((a) => a.id))]));
  const main = states[0]?.name ?? '';
  return {
    formFor: (entryId, line) => {
      const index = order.get(entryId);
      return index === undefined ? current : stateAt(switches, order, index, line, main);
    },
    labelIn: (label, state) => {
      if (label !== null && labels.get(state)?.has(label)) return label;
      return byName.get(state)?.sprites[0]?.label ?? label;
    },
    cgOk: (cg, state) => cgs.get(state)?.has(cg.id) ?? true,
    switchedAway: (cg, from, to) => switchedAway(switches, order, from, to, (s) => cgs.get(s)?.has(cg.id) ?? true),
    pos: (entryId, line) => ({ index: order.get(entryId) ?? Number.MAX_SAFE_INTEGER, line }),
  };
}
