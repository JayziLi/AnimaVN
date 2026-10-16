import type { AssemblyResult } from '../../lib/assembler';
import type { PromptFieldKey } from '../../lib/cardFields';
import type { PresetOrderEntry, TavernPreset } from '../../lib/presetParser';
import { STATUS_NOTE, tocBadge, type FieldState, type FieldStatus } from './fieldStatus';

/**
 * 资料页左栏的目录(照 V4CardInfo.png):
 *
 *   进入提示词   卡的六个字段 + 玩家人设,按这张卡绑定的预设里的真实顺序排;世界书殿后
 *   不进提示词   开场白 N 条、创作者注释、标签 / 元数据
 *   预设         预设名 启用数/总数
 *
 * 状态、token 全从下一次请求真正的组装结果里读(和 fieldStatus 一样),不重算。
 */

/** 玩家人设落在预设的这一块 */
export const PERSONA_BLOCK = 'personaDescription';

/** 编排里没有人设块时的排序兜底:酒馆默认编排里它在情景之后、示例对话之前(字段兜底是 100 + 0…5) */
const PERSONA_FALLBACK = 103.5;

/** 资料页里能去的地方:卡的字段、人设、世界书、不进提示词的三节、预设 */
export type ProfileKey = PromptFieldKey | 'persona' | 'book' | 'greetings' | 'notes' | 'meta' | 'preset';

export interface TocRow {
  key: ProfileKey;
  label: string;
  /** 右边那一格:token 数 / 空 / ! / 3 条 / 12/12 */
  badge: string;
  /** 「!」:填了也发不出去(或算不出来),标黄 */
  warn: boolean;
}

export interface PersonaState {
  status: FieldStatus;
  tokens: number;
  sortKey: number;
  /** 不生效时给用户看的那句话 */
  note: string;
}

/** 当前人设的描述会不会发出去、占多少:和卡的字段同一套判法(人设块是 marker,没有覆盖一说) */
export function personaState(
  description: string,
  preset: TavernPreset | null,
  order: PresetOrderEntry[],
  result: AssemblyResult,
): PersonaState {
  const produced = result.messages.filter((m) => m.sourceIdentifier === PERSONA_BLOCK);
  const block = preset?.prompts.find((p) => p.identifier === PERSONA_BLOCK);
  const at = order.findIndex((e) => e.identifier === PERSONA_BLOCK);

  let status: FieldStatus;
  if (!preset) status = 'unknown';
  else if (!description.trim()) status = 'empty';
  else if (!block) status = 'missing';
  else if (!order[at]?.enabled) status = 'disabled';
  else if (produced.length > 0) status = 'active';
  else status = 'silent';

  return {
    status,
    tokens: produced.reduce((n, m) => n + m.tokens, 0),
    sortKey: at >= 0 ? at : PERSONA_FALLBACK,
    note: status === 'active' || status === 'empty' ? '' : STATUS_NOTE[status],
  };
}

/** 一个字段在目录里的名字:「角色描述 · Description」只留中文那半 */
export const shortLabel = (label: string) => label.split(' · ')[0];

/**
 * 「进入提示词」那一组:字段和人设按编排位置排(位置一样时字段在前,排序是稳定的),世界书殿后。
 * fields 是 fieldStates 的结果,什么顺序都行
 */
export function promptToc(
  fields: readonly FieldState[],
  persona: PersonaState & { name: string },
  book: { placed: number; total: number },
): TocRow[] {
  const rows: { row: TocRow; sortKey: number }[] = fields.map((f) => {
    const badge = tocBadge(f);
    return { row: { key: f.def.key, label: shortLabel(f.def.label), badge, warn: badge === '!' }, sortKey: f.sortKey };
  });
  const personaBadge = tocBadge(persona);
  rows.push({
    row: {
      key: 'persona',
      label: persona.name ? `玩家人设 · ${persona.name}` : '玩家人设',
      badge: personaBadge,
      warn: personaBadge === '!',
    },
    sortKey: persona.sortKey,
  });
  const sorted = rows.sort((a, b) => a.sortKey - b.sortKey).map((r) => r.row);
  sorted.push({
    key: 'book',
    label: '世界书',
    badge: book.total === 0 ? '空' : `${book.placed}/${book.total}`,
    warn: false,
  });
  return sorted;
}

/** 「不进提示词」那一组;greetings 是开场白条数(主开场白 + 其他开场) */
export function otherToc(greetings: number): TocRow[] {
  return [
    { key: 'greetings', label: '开场白', badge: `${greetings} 条`, warn: false },
    { key: 'notes', label: '创作者注释', badge: '', warn: false },
    { key: 'meta', label: '标签 / 元数据', badge: '', warn: false },
  ];
}

/** 「预设」那一行:名字 + 当前编排里开着几块 / 一共几块 */
export function presetToc(name: string | null, order: readonly PresetOrderEntry[]): TocRow {
  return {
    key: 'preset',
    label: name ?? '还没有预设',
    badge: order.length ? `${order.filter((e) => e.enabled).length}/${order.length}` : '',
    warn: false,
  };
}
