import type { AssemblyResult } from '../../lib/assembler';
import type { TavernCard } from '../../lib/cardParser';
import { PROMPT_FIELDS, type PromptFieldDef } from '../../lib/cardFields';
import type { PresetOrderEntry, TavernPreset } from '../../lib/presetParser';
import { formatTokens } from '../../lib/tokens';

/**
 * 角色卡每个「进提示词」字段的状态 + 目录顺序。
 *
 * 资料页的目录和字段区共用这一份:字段会不会发出去、排第几、占多少 token,
 * 全从下一次请求真正的组装结果(AssemblyResult)里读,不重算。
 */

export type FieldStatus =
  /** 生效,已进提示词 */
  | 'active'
  /** 字段是空的 */
  | 'empty'
  /** 有内容,但这块在编排里被关了 */
  | 'disabled'
  /** 有内容,但预设里压根没这块 */
  | 'missing'
  /** 有内容,但这块标了 forbid_overrides,覆盖不了 */
  | 'forbidden'
  /** 有内容、块也开着,但一条消息都没产出(示例拆不出说话人、被预算丢掉……) */
  | 'silent'
  /** 还没选预设,算不出来 */
  | 'unknown';

export interface FieldState {
  def: PromptFieldDef;
  value: string;
  status: FieldStatus;
  /** 在最终消息列表里的下标,未生效时为 null */
  seq: number | null;
  tokens: number;
  /** 这个字段最终产生的消息,预览就是它 */
  produced: { role: string; content: string }[];
  /** 目录排序用:编排里的位置,找不到就是 100 + def.fallback */
  sortKey: number;
  /** 不生效时给用户看的那句话 */
  note: string;
}

export const STATUS_NOTE: Record<Exclude<FieldStatus, 'active' | 'empty'>, string> = {
  disabled: '这块在当前编排里被关掉了 —— 填了也不会发出去',
  missing: '当前预设里没有这个块 —— 填了也不会发出去',
  forbidden: '这块标了 forbid_overrides —— 预设不允许角色卡覆盖它',
  unknown: '还没选预设,算不出装配位置',
  silent: '这块开着,但没产出任何消息 —— 填了也不会发出去',
};

/** 块开着却一条消息都没出:说清是哪种情况,别笼统地说「被关掉了」 */
export function silentNote(target: string, result: AssemblyResult, charName: string): string {
  if (target !== 'dialogueExamples') return STATUS_NOTE.silent;
  if (result.skipped.some((s) => s.identifier === target && s.reason === '超出 token 预算')) {
    return '上下文预算不够,示例对话整段被丢了 —— 这次不会发出去';
  }
  // 照酒馆:只认「{{user}}:」「{{char}}:」开头的行来分句,一行都没有就整段不发
  return `没有一行以「{{char}}:」(${charName}:)或「{{user}}:」开头 —— 酒馆靠这个拆句,一句都拆不出来,整段不会发出去`;
}

/** 每个进提示词的字段算一遍状态。顺序和 PROMPT_FIELDS 一样,要目录顺序再过一遍 tocOrder */
export function fieldStates(
  card: TavernCard,
  preset: TavernPreset | null,
  order: PresetOrderEntry[],
  result: AssemblyResult,
): FieldState[] {
  const orderIndex = new Map(order.map((e, i) => [e.identifier, i]));

  return PROMPT_FIELDS.map((def): FieldState => {
    const value = card[def.key];
    const produced = result.messages.filter(
      (m) =>
        m.sourceIdentifier === def.target &&
        // 覆盖类的块即使卡不填也会出消息(用的是预设原文),那不算这个字段的产出
        (def.mode === 'marker' || m.part === 'card'),
    );
    const block = preset?.prompts.find((p) => p.identifier === def.target);
    const entry = order.find((e) => e.identifier === def.target);

    let status: FieldStatus;
    if (!preset) status = 'unknown';
    else if (!value.trim()) status = 'empty';
    else if (!block) status = 'missing';
    else if (!entry?.enabled) status = 'disabled';
    else if (def.mode === 'override' && block.forbidOverrides) status = 'forbidden';
    else if (produced.length > 0) status = 'active';
    else status = 'silent';

    const first = produced[0];
    return {
      def,
      value,
      status,
      seq: first ? result.messages.indexOf(first) : null,
      tokens: produced.reduce((n, m) => n + m.tokens, 0),
      produced: produced.map((m) => ({ role: m.role, content: m.content })),
      sortKey: orderIndex.get(def.target) ?? 100 + def.fallback,
      note:
        status === 'silent'
          ? silentNote(def.target, result, card.name)
          : status === 'active' || status === 'empty'
            ? ''
            : STATUS_NOTE[status],
    };
  });
}

/**
 * 空字段的预先提醒:这块在预设里压根发不出去(没这块 / 编排里关了 / 不许覆盖),
 * 填了也白填 —— 资料页在空字段上就说出来,别等填完才发现。发得出去、或还没选预设时是 ''
 */
export function blockedNote(
  def: Pick<PromptFieldDef, 'target' | 'mode'>,
  preset: TavernPreset | null,
  order: PresetOrderEntry[],
): string {
  if (!preset) return '';
  const block = preset.prompts.find((p) => p.identifier === def.target);
  if (!block) return STATUS_NOTE.missing;
  if (!order.find((e) => e.identifier === def.target)?.enabled) return STATUS_NOTE.disabled;
  if (def.mode === 'override' && block.forbidOverrides) return STATUS_NOTE.forbidden;
  return '';
}

/** 目录顺序:按预设编排里的真实位置排,编排里没有的按兜底排在后面。返回新数组 */
export function tocOrder(fields: readonly FieldState[]): FieldState[] {
  return [...fields].sort((a, b) => a.sortKey - b.sortKey);
}

/** 填了也发不出去的那几种 —— 要提醒用户的 */
export function isUnsent(status: FieldStatus): boolean {
  return status === 'disabled' || status === 'missing' || status === 'forbidden' || status === 'silent';
}

/** 序号牌:「#03」;没进提示词是「—」 */
export function seqLabel(seq: number | null): string {
  return seq !== null ? `#${String(seq).padStart(2, '0')}` : '—';
}

/** 目录每行右边那一格:空 = 没填;token 数 = 生效;! = 填了也发不出去(或算不出来) */
export function tocBadge(field: Pick<FieldState, 'status' | 'tokens'>): string {
  if (field.status === 'empty') return '空';
  if (field.status === 'active') return formatTokens(field.tokens);
  return '!';
}
