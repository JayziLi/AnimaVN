/**
 * 插件页「认词记录」「配对表」两组的纯函数(素材架构设计 1.4、1.6.6、1.6.8,第 1d 期):
 * 排序、来源和小标的大白话、整列同一段、语气行里哪些是版本、被几张卡用、建议清单怎么写、CG 哪些构图要配。
 * 组件在 components/WordRecordsGroup.tsx、PairingGroup.tsx。
 * 只 import 类型(运行时 import api.ts 会读 location,node 里的测试跑不了)。
 */
import type {
  PairingCellOut,
  PairingFillOut,
  PairingFollower,
  PairingSuggestion,
  PairingTableOut,
  SceneAsset,
  WordRecordOut,
} from '../lib/api';
import { RECORD_SOURCE_NAME } from './emotionMatch';
import { cgsOf, cgVariantsOf } from './scene';

// ---- 认词记录 ----

/** 认词记录的来源;认不得的(后端以后加的)原样显示 */
export const recordSourceName = (source: string): string =>
  (RECORD_SOURCE_NAME as Record<string, string>)[source] ?? source;

/** 一条认词记录的小标 */
export function recordFlags(r: Pick<WordRecordOut, 'guessed' | 'unstable'>): string[] {
  const out: string[] = [];
  if (r.guessed) out.push('模型猜的');
  if (r.unstable) out.push('今天本来就不稳定');
  return out;
}

/**
 * 认词记录页的顺序:「模型猜的」排前面(猜错的一眼能看见),其次「今天本来就不稳定」,别的照后端的顺序(按词)。
 * 设计稿还说按出现次数排,插件页拿不到对话,这一期不排
 */
export function sortRecords(records: readonly WordRecordOut[]): WordRecordOut[] {
  const rank = (r: WordRecordOut) => (r.guessed ? 0 : 2) + (r.unstable ? 0 : 1);
  return records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

// ---- 配对表的格子 ----

/**
 * 配对表一格的来源,叫法照设计 1.6.6。插件页配对表和句检查器(vn/inspectorText.ts)都用这一份,别处不要再写一遍
 */
export const PAIRING_SOURCE_NAME: Readonly<Record<string, string>> = {
  migrated: '旧结果',
  name: '同名',
  chat: '聊天模型配的',
  jev: 'Jev 配的',
  local: '本地模型配的',
  player: '你改的',
};

/**
 * 配对表一格的来源;认不得的原样显示。CG 的 local 不是模型挑的:名字对不上,先用构图本身(后端补配时记 local,
 * 那一格配的是空 = 构图本身)
 */
export const pairingSourceName = (source: string, follower: PairingFollower = 'voice'): string =>
  follower === 'cg' && source === 'local' ? '名字对不上' : (PAIRING_SOURCE_NAME[source] ?? source);

/** 配对表一格的小标(句检查器也用这一份) */
export function cellFlags(c: Pick<PairingCellOut, 'guessed' | 'pending' | 'unstable'>): string[] {
  const out: string[] = [];
  if (c.guessed) out.push('模型猜的');
  if (c.unstable) out.push('今天本来就不稳定');
  if (c.pending) out.push('待重配');
  return out;
}

/** 后端改好的一格放回这张表:同一项换掉,没有就加在后面。返回新的表,原来的不动 */
export function withCell(table: PairingTableOut, cell: PairingCellOut): PairingTableOut {
  const i = table.cells.findIndex((c) => c.item === cell.item);
  const cells = i === -1 ? [...table.cells, cell] : table.cells.with(i, cell);
  return { ...table, cells };
}

/** 名单里表上还没有格子的项(还没有表就是全部) */
export function missingItems<T extends { key: string }>(
  items: readonly T[],
  cells: readonly Pick<PairingCellOut, 'item'>[] | null,
): T[] {
  const have = new Set((cells ?? []).map((c) => c.item));
  return items.filter((i) => !have.has(i.key));
}

/**
 * 整列都配到同一段(比如借来的声音只有一段):表头写「全部同一段,建议换声音」。
 * 至少两格、都是同一个非空的值才算
 */
export function allSameRow(cells: readonly Pick<PairingCellOut, 'value'>[]): boolean {
  if (cells.length < 2) return false;
  const first = cells[0].value;
  return first !== null && cells.every((c) => c.value === first);
}

const TONE_SEP = '·';

/**
 * 去掉声线版本,剩下基础的语气(顺序不变)。和后端 app/pairing/fill.py 的 base_rows 同一条规则:
 * 「X·后缀」、X 也是这个声音的一行,而且同一个后缀至少挂在两行上,才算 X 的版本;
 * 只挂一行的(比如只有一行带「嘴硬」)是一段单独的语气。名字只去首尾空白
 */
export function baseRows<T extends { id: string; label: string }>(rows: readonly T[]): T[] {
  const labels = new Set(rows.map((r) => r.label.trim()));
  const bySuffix = new Map<string, string[]>();
  for (const r of rows) {
    const label = r.label.trim();
    const at = label.lastIndexOf(TONE_SEP);
    if (at === -1) continue;
    const head = label.slice(0, at);
    const suffix = label.slice(at + TONE_SEP.length);
    if (!suffix || !labels.has(head)) continue;
    bySuffix.set(suffix, [...(bySuffix.get(suffix) ?? []), r.id]);
  }
  const versions = new Set([...bySuffix.values()].filter((ids) => ids.length >= 2).flat());
  return rows.filter((r) => !versions.has(r.id));
}

/** 下拉的一项:value 是语气行 / 差分的 id,CG 的 null = 构图本身 */
export interface Choice {
  value: string | null;
  label: string;
}

/**
 * 一行的下拉选项:现在配的不在选项里(迁移时配到的版本行、删掉的那段)就加在后面,下拉才显示得对;
 * 还没有格子(undefined)不加
 */
export function rowChoices(
  choices: readonly Choice[],
  current: string | null | undefined,
  nameOf: (value: string | null) => string,
): Choice[] {
  if (current === undefined || choices.some((c) => c.value === current)) return [...choices];
  return [...choices, { value: current, label: nameOf(current) }];
}

/**
 * 「补上缺的」回来以后那句话:补了几格、怎么补的、哪些没补上。
 * 语音对不上名字的由本地模型挑一段;CG 对不上的用构图本身(后端都记 local、标待重配)
 */
export function fillSummary(follower: PairingFollower, r: PairingFillOut): string {
  if (r.added.length === 0 && r.skipped.length === 0) return '没有缺的格子。';
  const parts: string[] = [];
  if (r.added.length > 0) {
    const byName = r.added.filter((c) => c.source === 'name').length;
    const rest = r.added.length - byName;
    const how: string[] = [];
    if (byName > 0) how.push(`名字对上 ${byName} 格`);
    if (rest > 0) how.push(follower === 'cg' ? `对不上的 ${rest} 格先用构图本身(标了待重配)` : `本地模型挑了 ${rest} 格(标了待重配)`);
    parts.push(`补上了 ${r.added.length} 格:${how.join(',')}。`);
  }
  if (r.skipped.length > 0) {
    const reasons = [...new Set(r.skipped.map((s) => s.reason))];
    parts.push(`${r.skipped.length} 格没补上:${reasons.join(';')}。`);
  }
  return parts.join('');
}

// ---- 被几张卡用 ----

/** 表头:被几张卡用 */
export const usedByText = (cards: readonly string[]): string =>
  cards.length === 0 ? '现在没有卡用' : `被 ${cards.length} 张卡用`;

const MAX_CARD_NAMES = 4;

/** 改共用的表之前问的那句;只有一张卡用(或者没有)不用问,是 null。卡名找不到时写 id */
export function sharedEditWarning(cards: readonly string[], names: ReadonlyMap<string, string>): string | null {
  if (cards.length <= 1) return null;
  const shown = cards.slice(0, MAX_CARD_NAMES).map((id) => names.get(id) || id);
  const more = cards.length > MAX_CARD_NAMES ? ' 等' : '';
  return `这张表被 ${cards.length} 张卡用(${shown.join('、')}${more}),改了它们都变`;
}

// ---- 建议清单 ----

/**
 * 还没采纳的建议:表里现在已经是建议的那个(采纳过、自己改过去的)不列;
 * 「现在」和「是不是新加」按表里现在的写(模型回来以后表可能又改过、补过)
 */
export function openSuggestions(
  suggestions: readonly PairingSuggestion[],
  cells: readonly Pick<PairingCellOut, 'item' | 'value'>[],
): PairingSuggestion[] {
  const now = new Map(cells.map((c) => [c.item, c.value]));
  return suggestions
    .filter((s) => !(now.has(s.item) && now.get(s.item) === s.suggested))
    .map((s) => ({ ...s, current: now.get(s.item) ?? null, new: !now.has(s.item) }));
}

export interface SuggestionRow {
  item: string;
  /** 立绘名 */
  name: string;
  /** 现在配的(表里还没有这一格写「还没配」) */
  from: string;
  /** 模型建议的 */
  to: string;
  current: string | null;
  suggested: string | null;
}

/** 建议清单的每一行「现在 → 建议」。valueName(null) 由调用方定(CG 是「构图本身」) */
export function suggestionRows(
  suggestions: readonly PairingSuggestion[],
  itemName: (item: string) => string,
  valueName: (value: string | null) => string,
): SuggestionRow[] {
  return suggestions.map((s) => ({
    item: s.item,
    name: itemName(s.item),
    from: s.new ? '还没配' : valueName(s.current),
    to: valueName(s.suggested),
    current: s.current,
    suggested: s.suggested,
  }));
}

// ---- CG ----

export interface CgGroup {
  cg: SceneAsset;
  /** 启用、传了图的差分,按顺序 */
  variants: SceneAsset[];
}

/**
 * 要配的构图:启用的构图里,至少有一张启用、传了图的差分的(和后端补配、重配认的差分一样)。
 * 没有差分的构图不用配(设计 1.6.1)
 */
export function pairableCgs(assets: readonly SceneAsset[]): CgGroup[] {
  return cgsOf(assets)
    .filter((cg) => cg.enabled)
    .map((cg) => ({ cg, variants: cgVariantsOf(assets, cg.id).filter((v) => v.enabled && v.has_file) }))
    .filter((g) => g.variants.length > 0);
}

export interface VariantWords {
  /** 差分的名字 */
  label: string;
  /** 别名(去掉空的、和名字一样的、重复的) */
  aliases: string[];
  /** 几个构图里有这样的差分 */
  count: number;
}

/** 「差分自己认的词」:名字和别名一样的差分合成一行,数在几个构图里有;按第一次出现的顺序 */
export function variantWordRows(groups: readonly CgGroup[]): VariantWords[] {
  const rows = new Map<string, VariantWords>();
  for (const g of groups) {
    const seen = new Set<string>();
    for (const v of g.variants) {
      const label = v.label.trim();
      const aliases = [...new Set(v.aliases.map((a) => a.trim()))].filter((a) => a && a !== label);
      const key = [label, ...aliases].join('\u0001');
      if (seen.has(key)) continue;
      seen.add(key);
      const row = rows.get(key);
      if (row) row.count += 1;
      else rows.set(key, { label, aliases, count: 1 });
    }
  }
  return [...rows.values()];
}
