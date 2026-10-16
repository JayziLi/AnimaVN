/**
 * 导入器的纯逻辑:确认框每一行写什么、重复的那几行给哪些选择、默认选什么、发给 apply 的请求体,
 * 导完以后提示条的字、打开素材页的哪一栏(没有卡时打开素材管理页的哪一页、选中哪个包)、出错时的一句话。
 *
 * 确认框照画布 Confirms 第一个(10-15 定):拖到卡上先问「给「刻晴」挂上这些素材?」,逐行列要建的东西;
 * 和库里一样的默认「另存一份(推荐)」;卡重复问「是同一张,更新它 / 另存一张」;
 * 拖到原有的卡上带了立绘时有「挂上以后直接换成这套」;认不出的文件这里就能选类型。
 */

import type {
  ClassifyKind,
  ImportApplyBody,
  ImportDecision,
  ImportGroup,
  ImportKind,
  ImportPlan,
  ImportResult,
  ScenePack,
} from '../lib/api';
import type { LibraryRoute } from '../library/libraryModel';
import type { ImportNotice, SlotKey } from '../studio/types';
import type { ImportTarget } from './dropTarget';

/** 拖到的那张卡现在挂着几套立绘、当前那套叫什么(确认框说「现在用的那套不变」用);读不到时是 null */
export interface TargetSprites {
  count: number;
  current: string | null;
}

export interface ChoiceOption {
  value: ImportDecision;
  label: string;
  note: string;
}

/** 重复的那一行要选一个 */
export interface RowChoice {
  /** 「「刻晴 · 玉衡星」库里已经有一模一样的」 */
  lead: string;
  options: ChoiceOption[];
  initial: ImportDecision;
}

export type RowIcon = 'card' | 'sprite' | 'bg' | 'bgm' | 'scene' | 'cg';

export interface ConfirmRow {
  key: string;
  icon: RowIcon;
  /** 「立绘包「刻晴 · 新衣服」· 16 张」 */
  title: string;
  /** 会怎样:「挂成刻晴的立绘,算再挂一套;现在用的那套不变」;重复的卡由选项说,这里是空的 */
  effect: string;
  choice: RowChoice | null;
}

export interface UnknownRow {
  path: string;
  name: string;
  /** 在哪个文件夹里(暂存路径去掉文件名);在最上层是空串 */
  folder: string;
}

export interface ConfirmModel {
  title: string;
  confirmLabel: string;
  rows: ConfirmRow[];
  /** 「挂上以后直接换成这套」:拖到原有的卡上、带了立绘、那张卡已经有立绘(或者读不到)时才有;key = 勾选框放在哪一行下面 */
  makeCurrent: { key: string; label: string } | null;
  unknown: UnknownRow[];
  skipped: string[];
}

/** 认不出的文件能选的类型(确认框、提示条的「查看」都用);不选 = 先放着 */
export const CLASSIFY_CHOICES: readonly { value: ClassifyKind; label: string }[] = [
  { value: 'sprite', label: '立绘' },
  { value: 'bg', label: '背景' },
  { value: 'bgm', label: 'BGM' },
  { value: 'cg', label: 'CG' },
  { value: 'skip', label: '不要' },
];

export const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

const folderOf = (path: string) => path.split(/[\\/]/).slice(0, -1).join('/');

/** 「两张卡」「3 张卡」:画布上的说法 */
const cards = (n: number) => (n === 2 ? '两张卡' : `${n} 张卡`);

function sceneWhat(g: ImportGroup): { icon: RowIcon; word: string } {
  const bg = g.bg_count ?? 0;
  const bgm = g.bgm_count ?? 0;
  if (bg > 0 && bgm > 0) return { icon: 'scene', word: '背景和 BGM' };
  return bgm > 0 ? { icon: 'bgm', word: 'BGM' } : { icon: 'bg', word: '背景' };
}

function titleOf(g: ImportGroup): { icon: RowIcon; title: string } {
  switch (g.type) {
    case 'card':
      return { icon: 'card', title: `角色卡「${g.name}」` };
    case 'sprite_pack':
      return { icon: 'sprite', title: `立绘包「${g.name}」· ${g.count} 张` };
    case 'scene_pack': {
      const { icon, word } = sceneWhat(g);
      const bg = g.bg_count ?? 0;
      const bgm = g.bgm_count ?? 0;
      const title =
        icon === 'scene'
          ? `${word}「${g.name}」· 背景 ${bg} 张 · BGM ${bgm} 首`
          : icon === 'bgm'
            ? `BGM「${g.name}」· ${bgm} 首`
            : `背景「${g.name}」· ${bg} 张`;
      return { icon, title };
    }
    case 'cg_pack': {
      const v = g.variant_count ?? 0;
      return { icon: 'cg', title: `CG 包「${g.name}」· ${g.count} 张构图${v > 0 ? ` · 差分 ${v} 张` : ''}` };
    }
  }
}

/** 拖到的卡上要挂的立绘包(按计划里的先后);make_current 换成的是第一套 */
const targetSprites = (plan: ImportPlan) => plan.groups.filter((g) => g.type === 'sprite_pack' && g.owner === 'target');

/** 确认框要先读哪张卡的立绘(说「现在用的那套不变」):有立绘要挂到拖到的卡上时才读 */
export function spritesToCheck(plan: ImportPlan, target: ImportTarget): string | null {
  return target.cardId && targetSprites(plan).length > 0 ? target.cardId : null;
}

function packChoice(g: ImportGroup): RowChoice {
  const dup = g.duplicate_of!;
  const n = dup.card_count;
  const lead = `「${dup.name}」库里已经有一模一样的`;
  const SAVE = '另存一份(推荐)';
  if (g.owner === null) {
    return {
      lead,
      initial: 'new',
      options: [
        { value: 'new', label: SAVE, note: '以后改这份不影响已有的那份' },
        { value: 'share', label: '不导这份', note: '库里已经有了,这次不再建' },
      ],
    };
  }
  const saveNote =
    n === 1 ? '两张卡各用各的,以后改这份不影响另一张' : n && n > 1 ? `各用各的,以后改这份不影响另外 ${n} 张卡` : '以后改这份不影响已有的那份';
  const shareNote =
    n === undefined ? '改一处,用它的卡一起变' : n === 0 ? '现在没有卡在用' : `现在被 ${n} 张卡用;改一处,${cards(n + 1)}一起变`;
  return {
    lead,
    initial: 'new',
    options: [
      { value: 'new', label: SAVE, note: saveNote },
      { value: 'share', label: '共用已有的那份', note: shareNote },
    ],
  };
}

function cardChoice(g: ImportGroup): RowChoice {
  return {
    lead: `「${g.duplicate_of!.name}」库里已经有一张一样的`,
    initial: 'new',
    options: [
      { value: 'update', label: '是同一张,更新它', note: '对话、存档、挂的素材都留着' },
      { value: 'new', label: '另存一张', note: '两张卡各用各的' },
    ],
  };
}

export function confirmModel(
  plan: ImportPlan,
  target: ImportTarget,
  sprites: TargetSprites | null,
  makeCurrent: boolean,
): ConfirmModel {
  const who = target.cardName ?? '这张卡';
  const cardName = (key: string) => plan.groups.find((g) => g.key === key)?.name ?? '新卡';
  const mine = targetSprites(plan);
  const first = mine[0]?.key;
  const canSwitch = target.cardId !== null && mine.length > 0 && (sprites === null || sprites.count > 0);

  const spriteEffect = (g: ImportGroup) => {
    const base = `挂成${who}的立绘`;
    if (sprites && sprites.count === 0 && g.key === first) return `${base}(${who}还没有立绘,这套直接用上)`;
    const more = `${base},算再挂一套`;
    if (g.key === first && makeCurrent && canSwitch) return `${more};挂上以后直接换成这套`;
    if (!sprites || sprites.count === 0) return more;
    return `${more};现在用的${sprites.current ? `「${sprites.current}」` : '那套'}不变`;
  };

  const effectOf = (g: ImportGroup): string => {
    if (g.type === 'card') {
      if (g.duplicate_of) return '';
      const owns = plan.groups.some((x) => x.owner === g.key);
      return owns ? '新建一张卡,一起拖进来的素材挂到它上面' : '新建一张卡';
    }
    if (g.owner === null) return '先放进素材库,不绑到卡上';
    if (g.owner !== 'target') return `跟着角色卡「${cardName(g.owner)}」一起挂上`;
    if (g.type === 'sprite_pack') return spriteEffect(g);
    if (g.type === 'scene_pack') {
      const { word } = sceneWhat(g);
      // 中文和英文之间空一格:「挂成刻晴的 BGM」
      return `挂成${who}的${/^[A-Za-z]/.test(word) ? ' ' : ''}${word},接在已有的后面`;
    }
    return `挂成${who}的 CG,接在已有的后面`;
  };

  const rows = plan.groups.map((g): ConfirmRow => ({
    key: g.key,
    ...titleOf(g),
    effect: effectOf(g),
    choice: g.duplicate_of ? (g.type === 'card' ? cardChoice(g) : packChoice(g)) : null,
  }));

  return {
    title: target.cardId ? `给「${who}」挂上这些素材?` : '导入这些素材?',
    confirmLabel: target.cardId ? '确定挂上' : '导入',
    rows,
    makeCurrent: canSwitch
      ? { key: mine[0].key, label: mine.length > 1 ? `挂上以后直接换成第一套「${mine[0].name}」` : '挂上以后直接换成这套' }
      : null,
    unknown: plan.unknown.map((path) => ({ path, name: fileName(path), folder: folderOf(path) })),
    skipped: plan.skipped,
  };
}

/** 重复的那几组一律先选「另存一份 / 另存一张」(10-15 定:重复导入默认另存一份) */
export function defaultDecisions(plan: ImportPlan): Record<string, ImportDecision> {
  return Object.fromEntries(plan.groups.filter((g) => g.duplicate_of).map((g) => [g.key, 'new' as const]));
}

/** 发给 apply 的:只带有选择的那几组、选了类型的文件;没给「换成这套」那个勾选框时不换 */
export function applyBody(
  model: ConfirmModel,
  decisions: Readonly<Record<string, ImportDecision>>,
  classify: Readonly<Record<string, ClassifyKind | null>>,
  makeCurrent: boolean,
): ImportApplyBody {
  const choosable = new Set(model.rows.filter((r) => r.choice).map((r) => r.key));
  return {
    decisions: Object.fromEntries(Object.entries(decisions).filter(([k]) => choosable.has(k))),
    classify: Object.fromEntries(
      Object.entries(classify).filter((e): e is [string, ClassifyKind] => e[1] !== null),
    ),
    make_current: makeCurrent && model.makeCurrent !== null,
  };
}

/** 要不要先弹确认框:计划说要(拖到卡上、有重复),或者什么都没认出来、只剩认不出的文件 */
export function shouldConfirm(plan: ImportPlan): boolean {
  return plan.needs_confirm || (plan.groups.length === 0 && plan.unknown.length > 0);
}

/** 一样都没认出来(全是无关文件):不用执行 */
export function nothingToImport(plan: ImportPlan): boolean {
  return plan.groups.length === 0 && plan.unknown.length === 0;
}

/** 导完打开素材页的哪一栏:拖到哪一栏就开哪一栏;否则按立绘、背景、BGM、CG 的先后开第一种进来了的 */
export function slotAfterImport(plan: ImportPlan, kind: ImportKind | null): SlotKey {
  if (kind) return kind;
  const has = (pred: (g: ImportGroup) => boolean) => plan.groups.some(pred);
  if (has((g) => g.type === 'sprite_pack')) return 'sprite';
  if (has((g) => g.type === 'scene_pack' && (g.bg_count ?? 0) > 0)) return 'bg';
  if (has((g) => g.type === 'scene_pack' && (g.bgm_count ?? 0) > 0)) return 'bgm';
  if (has((g) => g.type === 'cg_pack')) return 'cg';
  return 'sprite';
}

/** 卡编辑器素材页 / 素材管理页顶上那条提示 */
export function noticeOf(result: ImportResult): ImportNotice {
  return { ...result.notice, jobId: result.job_id, report: result.report };
}

/** 场景包有几张背景、几首曲子(lib/api 的 ScenePack 里这几样就够) */
export type SceneSides = Pick<ScenePack, 'id' | 'bg_count' | 'bgm_count'>;

/** 场景包开在哪一页:有背景开「背景」,只有曲子开「BGM」;两边都空、读不到也开「背景」(空包两边都列) */
function sceneTab(id: string, packs: readonly SceneSides[] | null): 'bg' | 'bgm' {
  const p = packs?.find((x) => x.id === id);
  return p && p.bg_count === 0 && p.bgm_count > 0 ? 'bgm' : 'bg';
}

/**
 * 没有卡可开(只导了包、没拖到卡上)时素材管理页开在哪:
 * 1. 第一个新建的包 —— 按立绘、场景包、CG 的先后(和 slotAfterImport 一样),选中它;
 * 2. 什么都没新建、选了「不导这份」(库里有一模一样的):开计划里第一个这样的包那一类,选中库里那份;
 * 3. 都不是(只剩认不出的文件、后端是旧版没给 created):开「导入记录」,标出这一次。
 * scenePacks:新建的场景包有没有背景(读不到给 null)
 */
export function libraryRouteAfterImport(
  result: ImportResult,
  plan: ImportPlan,
  body: ImportApplyBody,
  scenePacks: readonly SceneSides[] | null,
): LibraryRoute {
  const c = result.created;
  if (c?.sprite_packs[0]) return { tab: 'sprite', id: c.sprite_packs[0] };
  if (c?.scene_packs[0]) return { tab: sceneTab(c.scene_packs[0], scenePacks), id: c.scene_packs[0] };
  if (c?.cg_packs[0]) return { tab: 'cg', id: c.cg_packs[0] };
  const shared = plan.groups.find((g) => g.type !== 'card' && g.duplicate_of && body.decisions?.[g.key] === 'share');
  if (shared?.duplicate_of) {
    const id = shared.duplicate_of.id;
    if (shared.type === 'sprite_pack') return { tab: 'sprite', id };
    if (shared.type === 'cg_pack') return { tab: 'cg', id };
    return { tab: (shared.bg_count ?? 0) === 0 && (shared.bgm_count ?? 0) > 0 ? 'bgm' : 'bg', id };
  }
  return { tab: 'jobs', id: result.job_id };
}

/** 出错时的一句话。后端的话已经说清楚的(文件太大、「导入失败,库里什么都没改……」)原样用 */
export function importErrorText(e: unknown, prefix = '导入失败'): string {
  const message = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 413 || message.startsWith(prefix)) return message;
  return `${prefix}:${message}`;
}

/** 上传中途点了取消(DOMException 在老浏览器里不算 Error,按名字认) */
export const isAbort = (e: unknown) => (e as { name?: unknown } | null)?.name === 'AbortError';
