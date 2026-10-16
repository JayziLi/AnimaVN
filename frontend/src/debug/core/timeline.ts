/**
 * 时间线:对话里每条回复、每一句的状态(显示哪张立绘、背景、音乐、CG),从第一条回复一路累计下来(素材架构设计 1.2)。
 * 规则和视觉小说原来的一样(core/legacyCursor.ts 是原样搬出来的那份,测试和回放检查逐句对照):
 * - 一句的状态 = 这句以前(含这句)的标签依次生效以后的样子;写在回复末尾的标签(-1)这条看不到,下一条开头才生效
 * - 立绘:精确或模型认出来的才切;还在认的、认不出的保持上一个(没有立绘的卡认不出时用原词);路人、玩家台词前的不算
 * - 背景、音乐、CG:scene.applySceneTag;形态开着时 CG 过形态门(ctx.forms)
 * - 玩家在检查器里手改了表情的句子(plugins/manualMarks.ts):只这一句用玩家选的,不做形态换算;累计结果不变,下一句照旧
 * 每条回复按「切好的回复 + 开头的状态 + 输入」缓存,结束状态串成链:流式时只重算正在写的那条。
 */
import type { PackSprite, SceneAsset } from '../lib/api';
import type { VnManualMark } from '../lib/chatEntry';
import type { EmotionContext } from '../plugins/emotionMatch';
import { manualAt, manualLabel, manualOf } from '../plugins/manualMarks';
import { applySceneTag, cgFrameFor, initialScene, type SceneState } from '../plugins/scene';
import { spriteLabelAfter } from '../plugins/voice';
import type { ParsedReply, TagHit } from '../vn/script';
import type { Beat } from './beats';

/** 对话里的一个位置:第几条(在对话里的顺序)、第几句 */
export interface Pos {
  index: number;
  line: number;
}

/**
 * 形态卡带(plugins/forms.ts 拿到的)给时间线的接口:时间线只通过它问形态,不 import 形态的代码。
 * 第 4 期换成「状态」以后,这个接口和形态卡带一起删掉
 */
export interface FormsLens {
  /** 第 entryId 条第 line 句的形态;条目不在这段对话里时是对话末尾的形态 */
  formFor(entryId: string, line: number): string;
  /** 这句生效的表情放到某个形态里看:属于这个形态就不变,不属于就换成它的默认表情 */
  labelIn(label: string | null, form: string): string | null;
  /** 这张 CG 在这个形态里能不能出 */
  cgOk(cg: SceneAsset, form: string): boolean;
  /** from 之后、到 to 为止(含)切到过这张 CG 不能出的形态吗 */
  switchedAway(cg: SceneAsset, from: Pos, to: Pos): boolean;
  /** 位置;条目不在这段对话里时排在最后 */
  pos(entryId: string, line: number): Pos;
}

/** 算时间线要的东西 */
export interface TimelineCtx {
  /** 当前立绘包里启用的立绘,按包里的顺序(排第一的是默认) */
  sprites: readonly PackSprite[];
  /** 场景包里启用的素材,按后端的顺序 */
  sceneAssets: readonly SceneAsset[];
  /** 认表情(精确 / 模型)、没立绘时认不出用原词、认 NPC 用的角色名 */
  emotion: EmotionContext;
  /** 形态切换没开时是 null */
  forms: FormsLens | null;
  /**
   * 表情认法 = 认词记录时 CG 那一帧查配对表(plugins/pairings.ts 的 cgFrameFromPairs);返回 undefined 照旧按名字找。
   * 旧算法时不传
   */
  cgFrame?: (cg: SceneAsset, spriteLabel: string | null) => SceneAsset | undefined;
}

/** 某一句的状态 */
export interface LineState {
  /** 形态换算前的表情名(精确或模型认出来的);CG 差分按它找 */
  spriteLabel: string | null;
  /** 舞台上显示的表情名(形态换算后) */
  shownLabel: string | null;
  /** 这句的形态;形态切换没开、或者还没有任何一条回复时是 null */
  form: string | null;
  /** 背景、音乐、CG 构图 */
  scene: SceneState;
  /** CG 显示的那一帧(差分或构图本身);没有 CG 是 null */
  cgFrame: SceneAsset | null;
}

/** 一路累计到某处的结果(还没放进「这句」的形态里看) */
export interface Fold {
  /** 形态换算前的表情名 */
  spriteLabel: string | null;
  /** 背景、音乐、CG(CG 还没按这句的形态收) */
  scene: SceneState;
  /** 现在这张 CG 是在哪出的:形态门判「这中间切到过不能出的形态吗」用 */
  cgFrom: Pos | null;
}

/** 一条消息的时间线 */
export interface EntryTimeline {
  /** 这条第一句之前:前面各条的标签都生效了(含写在末尾的) */
  start: Fold;
  /** 每句的状态 */
  lines: readonly LineState[];
  /** 一句都没有时(整条只有标签、还在写第一句)光标停在这条看到的;有句子时就是第一句 */
  empty: LineState;
  /** 这条全部标签生效以后(含写在末尾的):下一条的开头 */
  end: Fold;
}

export interface Timeline {
  /** 还没有任何回复时 */
  initial: LineState;
  /** 和对话里的条目一一对应(用户消息也有一份,开头 = 结尾) */
  entries: readonly EntryTimeline[];
  /** 整段对话末尾:最后一条的末尾标签也生效了 */
  end: Fold;
}

/** 写在回复末尾的标签按哪一句算形态(和视觉小说原来的一样) */
const END_LINE = Number.MAX_SAFE_INTEGER;

/** CG 出来以后、到 to 为止(含)切到过它不能出的形态:收起 */
function cut(scene: SceneState, from: Pos | null, to: Pos, lens: FormsLens): SceneState {
  const cg = scene.cg;
  return cg && from && lens.switchedAway(cg, from, to) ? { ...scene, cg: null } : scene;
}

/** 一个标签生效 */
function applyHit(fold: Fold, h: TagHit, entryId: string, ctx: TimelineCtx): Fold {
  if (h.kind === 'sprite') {
    const spriteLabel = spriteLabelAfter([h], ctx.emotion, fold.spriteLabel);
    return spriteLabel === fold.spriteLabel ? fold : { ...fold, spriteLabel };
  }
  const lens = ctx.forms;
  if (h.kind === 'cg' && lens) {
    // 形态切换开着时每张 CG 只在它标的形态里出:先按「中间切到过不能出的形态」收起;
    // 新 CG 写在不能出的句子上,整个标签不算
    const ln = h.lineIndex === -1 ? END_LINE : h.lineIndex;
    const at = lens.pos(entryId, ln);
    const scene = cut(fold.scene, fold.cgFrom, at, lens);
    const next = applySceneTag(scene, h, ctx.sceneAssets);
    if (next.cg && next.cg !== scene.cg) {
      if (!lens.cgOk(next.cg, lens.formFor(entryId, ln))) return scene === fold.scene ? fold : { ...fold, scene };
      return { ...fold, scene: next, cgFrom: at };
    }
    return next === fold.scene ? fold : { ...fold, scene: next };
  }
  const scene = applySceneTag(fold.scene, h, ctx.sceneAssets);
  return scene === fold.scene ? fold : { ...fold, scene };
}

/**
 * 累计结果放到第 line 句看:形态换算、按这句收起 CG、挑 CG 那一帧。
 * manual:玩家在检查器里给这句手改的表情(已经认成了立绘的名字);有的话这句就是它,不做形态换算(玩家明说的)
 */
function viewOf(fold: Fold, entryId: string, line: number, ctx: TimelineCtx, manual: string | null = null): LineState {
  const lens = ctx.forms;
  const spriteLabel = manual ?? fold.spriteLabel;
  let scene = fold.scene;
  let form: string | null = null;
  let shownLabel = spriteLabel;
  if (lens) {
    form = lens.formFor(entryId, line);
    if (manual === null) shownLabel = lens.labelIn(fold.spriteLabel, form);
    scene = cut(scene, fold.cgFrom, lens.pos(entryId, line), lens);
    if (scene.cg && !lens.cgOk(scene.cg, form)) scene = { ...scene, cg: null };
  }
  // CG 那一帧跟着这句的表情换(差分的名字是表情名,用形态换算前的);没有对应的用构图本身那张。
  // 表情认法 = 认词记录时先查配对表,表里没有这一格再按名字找
  const cg = scene.cg;
  const cgFrame = cg ? (ctx.cgFrame?.(cg, spriteLabel) ?? cgFrameFor(cg, ctx.sceneAssets, spriteLabel)) : null;
  return { spriteLabel, shownLabel, form, scene, cgFrame };
}

/** 这条里第 0..line 句上的标签依次生效(按出现顺序;写在末尾的不算) */
function foldUpTo(start: Fold, hits: readonly TagHit[], line: number, entryId: string, ctx: TimelineCtx): Fold {
  let fold = start;
  for (const h of hits) if (h.lineIndex !== -1 && h.lineIndex <= line) fold = applyHit(fold, h, entryId, ctx);
  return fold;
}

/** 标签按句子先后排、写在末尾的(-1)都在最后:可以一句一句往下接着累计 */
function inLineOrder(hits: readonly TagHit[]): boolean {
  let last = 0;
  for (const h of hits) {
    const at = h.lineIndex === -1 ? Number.POSITIVE_INFINITY : h.lineIndex;
    if (at < last) return false;
    last = at;
  }
  return true;
}

function computeEntry(beat: Beat, start: Fold, ctx: TimelineCtx): EntryTimeline {
  const id = beat.entry.id;
  const p = beat.parsed;
  if (!p) return { start, lines: [], empty: viewOf(start, id, 0, ctx), end: start };
  const { hits } = p;
  // 这个分支里手改了表情的句子:找不到那张立绘(删了、停用了)的当没改
  const marks = manualOf(beat.entry);
  const manual = (i: number): string | null => {
    const m = manualAt(marks, i);
    return m ? manualLabel(m, ctx.sprites) : null;
  };
  const lines: LineState[] = [];
  if (inLineOrder(hits)) {
    let fold = start;
    let k = 0;
    for (let i = 0; i < p.lines.length; i++) {
      while (k < hits.length && hits[k].lineIndex === i) fold = applyHit(fold, hits[k++], id, ctx);
      lines.push(viewOf(fold, id, i, ctx, manual(i)));
    }
  } else {
    // 顺序乱了(很少见):每句都从这条开头重新累计,和视觉小说原来的算法一样
    for (let i = 0; i < p.lines.length; i++) lines.push(viewOf(foldUpTo(start, hits, i, id, ctx), id, i, ctx, manual(i)));
  }
  const empty = lines[0] ?? viewOf(foldUpTo(start, hits, 0, id, ctx), id, 0, ctx);
  let end = start;
  for (const h of hits) end = applyHit(end, h, id, ctx);
  return { start, lines, empty, end };
}

interface CachedEntry {
  id: string;
  start: Fold;
  ctx: TimelineCtx;
  /** 这个分支的手改记号(存档里那个数组) */
  manual: readonly VnManualMark[] | undefined;
  out: EntryTimeline;
}
/**
 * 切好的回复(切句缓存里没变就是同一个对象)→ 上次算的结果。条目、开头、输入、手改记号都是同一个对象就直接用:
 * 前一条没变,它的结尾就还是同一个对象,一路接下去;流式时只有正在写的那条要重算。
 * 只改了 swipe_info.vn 时切句缓存给的还是同一个切好的回复,所以手改记号要单独比(按引用)
 */
const entryCache = new WeakMap<ParsedReply, CachedEntry>();

/** 一条消息的时间线:start 是上一条的结尾(换个分支看,也从这一条原来的 start 接着算) */
export function entryTimeline(beat: Beat, start: Fold, ctx: TimelineCtx): EntryTimeline {
  const p = beat.parsed;
  if (!p) return computeEntry(beat, start, ctx);
  const manual = manualOf(beat.entry);
  const hit = entryCache.get(p);
  const same = hit !== undefined && hit.id === beat.entry.id && hit.start === start && hit.ctx === ctx;
  if (same && hit.manual === manual) return hit.out;
  let out = computeEntry(beat, start, ctx);
  // 只是手改记号变了:手改不进累计结果,结尾用原来那个对象,后面各条的缓存还接得上
  if (same) out = { ...out, end: hit.out.end };
  entryCache.set(p, { id: beat.entry.id, start, ctx, manual, out });
  return out;
}

/** 每份输入一个开头:同一份输入给同一个对象,第一条的缓存才接得上 */
const initials = new WeakMap<TimelineCtx, { fold: Fold; state: LineState }>();

function initialOf(ctx: TimelineCtx): { fold: Fold; state: LineState } {
  let hit = initials.get(ctx);
  if (!hit) {
    const label = ctx.sprites[0]?.label ?? null;
    const fold: Fold = { spriteLabel: label, scene: initialScene(ctx.sceneAssets), cgFrom: null };
    // 还没有任何回复:不看形态(视觉小说原来就是这样)
    hit = { fold, state: { spriteLabel: label, shownLabel: label, form: null, scene: fold.scene, cgFrame: null } };
    initials.set(ctx, hit);
  }
  return hit;
}

/** 整段对话的时间线 */
export function buildTimeline(beats: readonly Beat[], ctx: TimelineCtx): Timeline {
  const first = initialOf(ctx);
  let fold = first.fold;
  const entries = beats.map((b) => {
    const e = entryTimeline(b, fold, ctx);
    fold = e.end;
    return e;
  });
  return { initial: first.state, entries, end: fold };
}

/** 光标停在第 index 条第 line 句时的状态:还没有回复(index 是 -1)时是 initial;line 夹在 0 到句数 - 1 之间 */
export function stateAt(tl: Timeline, index: number, line: number): LineState {
  if (index < 0) return tl.initial;
  const e = tl.entries[index];
  if (e.lines.length === 0) return e.empty;
  return e.lines[Math.max(0, Math.min(line, e.lines.length - 1))];
}

/**
 * 对话停在最后一条回复最后一句时舞台上的样子(存档缩略图,签字清单第 4 条):那条回复末尾的标签不算,和舞台一样;
 * 还没有回复时是 initial
 */
export function stateAtEnd(tl: Timeline, beats: readonly Beat[]): LineState {
  for (let i = beats.length - 1; i >= 0; i--) if (beats[i].parsed) return stateAt(tl, i, Number.MAX_SAFE_INTEGER);
  return tl.initial;
}

/**
 * 新回复开头生效的表情(Jev 的起始表情,签字清单第 10 条):和舞台在这条回复第 0 句、还没有任何标签时一样 ——
 * 之前各条的标签都生效了(含写在末尾的),再放进这条第 0 句的形态里看。舞台上什么都没有时(没有立绘的卡、
 * 还没出现过表情)给 fallback
 */
export function emotionAtStart(tl: Timeline, ctx: TimelineCtx, targetId: string, fallback: string | null): string | null {
  const label = tl.end.spriteLabel;
  const shown = ctx.forms ? ctx.forms.labelIn(label, ctx.forms.formFor(targetId, 0)) : label;
  return shown ?? fallback;
}
