import type { MarkerSource } from '../../lib/cardFields';
import type { TavernCard } from '../../lib/cardParser';
import type { PresetPrompt, PromptRole } from '../../lib/presetParser';

/**
 * 预设块编辑的草稿 —— 「正在改的样子」,和怎么从它拼出写回去的补丁。
 *
 * 两个地方用:
 *   块编辑弹窗(components/BlockEditorModal)—— 手里攥一份草稿,点「确定」才整块写回;
 *   资料页右栏(BlockEditorSide)—— 没有「确定」,改一下就把变了的字段写回内存里的预设
 *     (预设标脏,点左上「存」才进库),草稿每次都从块现在的样子现算。
 * 判断改没改、拼补丁都走这里,编辑区(BlockEditorPane)只管画。
 */

/** 只有这两块有对应的角色卡字段;别的块显示「禁止覆盖」纯属误导 */
export const OVERRIDABLE: ReadonlySet<string> = new Set(['main', 'jailbreak']);

export const ROLES: readonly PromptRole[] = ['system', 'user', 'assistant'];

export interface BlockDraft {
  name: string;
  role: PromptRole;
  content: string;
  forbidOverrides: boolean;
  /** 位置选的是「绝对深度」(injection_position = 1) */
  absolute: boolean;
  /** 深度 / 顺序两个数字框里的原样文字 —— 打到一半可能是空串、非数字 */
  depth: string;
  order: string;
  /** 卡填的 marker 才用得上 —— 它编辑的是卡的字段,不是块 */
  cardValue: string;
}

export function draftOf(prompt: PresetPrompt, markerSource: MarkerSource | null): BlockDraft {
  return {
    name: prompt.name,
    role: prompt.role,
    content: prompt.content,
    forbidOverrides: prompt.forbidOverrides,
    absolute: prompt.injectionPosition === 1,
    depth: String(prompt.injectionDepth),
    order: String(prompt.injectionOrder),
    cardValue: markerSource?.kind === 'card' ? markerSource.value : '',
  };
}

/** 数字框里打到一半是空串 / 非数字 / 负数,按原值算 —— 别让「确定」在半路亮起来 */
export function parseCount(text: string, fallback: number): number {
  const n = Math.floor(Number(text));
  return text.trim() && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** 卡填的 marker 改了卡的字段 */
function cardChanged(markerSource: MarkerSource | null, draft: BlockDraft): boolean {
  return markerSource?.kind === 'card' && draft.cardValue !== markerSource.value;
}

export function isDraftDirty(
  prompt: PresetPrompt,
  markerSource: MarkerSource | null,
  draft: BlockDraft,
): boolean {
  if (prompt.marker) return draft.name !== prompt.name || cardChanged(markerSource, draft);
  return (
    draft.name !== prompt.name ||
    draft.role !== prompt.role ||
    draft.content !== prompt.content ||
    draft.forbidOverrides !== prompt.forbidOverrides ||
    draft.absolute !== (prompt.injectionPosition === 1) ||
    parseCount(draft.depth, prompt.injectionDepth) !== prompt.injectionDepth ||
    parseCount(draft.order, prompt.injectionOrder) !== prompt.injectionOrder
  );
}

/**
 * 「确定」时写回块的补丁。
 *
 * marker 块自己只有名字能改 —— role/content 由组装器决定,写回去只会污染数据;
 * 名字没改就是 null,什么都不写。文本块整块写回,没改的字段写的是原值。
 */
export function blockPatchOf(prompt: PresetPrompt, draft: BlockDraft): Partial<PresetPrompt> | null {
  if (prompt.marker) return draft.name !== prompt.name ? { name: draft.name } : null;
  return {
    name: draft.name,
    role: draft.role,
    content: draft.content,
    forbidOverrides: draft.forbidOverrides,
    injectionPosition: draft.absolute ? 1 : 0,
    injectionDepth: parseCount(draft.depth, prompt.injectionDepth),
    injectionOrder: parseCount(draft.order, prompt.injectionOrder),
  };
}

/**
 * 行内编辑写回块的补丁:只挑和块现在不一样的字段,都一样就是 null。
 * marker 同样只认名字。数字框打到一半(空串)按原值算,不写。
 */
export function changedFields(prompt: PresetPrompt, draft: BlockDraft): Partial<PresetPrompt> | null {
  const patch: Partial<PresetPrompt> = {};
  if (draft.name !== prompt.name) patch.name = draft.name;
  if (!prompt.marker) {
    if (draft.role !== prompt.role) patch.role = draft.role;
    if (draft.content !== prompt.content) patch.content = draft.content;
    if (draft.forbidOverrides !== prompt.forbidOverrides) patch.forbidOverrides = draft.forbidOverrides;
    const position = draft.absolute ? 1 : 0;
    if (position !== (prompt.injectionPosition === 1 ? 1 : 0)) patch.injectionPosition = position;
    const depth = parseCount(draft.depth, prompt.injectionDepth);
    if (depth !== prompt.injectionDepth) patch.injectionDepth = depth;
    const order = parseCount(draft.order, prompt.injectionOrder);
    if (order !== prompt.injectionOrder) patch.injectionOrder = order;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * 行内编辑时数字框该显示什么。框里的字换算出来和块里的数对得上(包括打到一半的空串),
 * 就照旧显示框里的字;对不上说明块被外面改了(恢复、换了预设),改显示块里的数。
 */
export function shownCount(text: string, value: number): string {
  return parseCount(text, value) === value ? text : String(value);
}

/** marker 块改了卡的字段时写回角色卡的补丁;没改、或者不是卡填的 marker 时为 null */
export function cardPatchOf(
  prompt: PresetPrompt,
  markerSource: MarkerSource | null,
  draft: BlockDraft,
): Partial<TavernCard> | null {
  if (!prompt.marker || markerSource?.kind !== 'card') return null;
  if (draft.cardValue === markerSource.value) return null;
  return { [markerSource.def.key]: draft.cardValue } as Partial<TavernCard>;
}

/**
 * 只有用户自建的块能删,规则同酒馆(PromptManager.js 的 isUserPrompt):
 * marker 是组装器认 identifier 的占位符,删了就再也填不回来;
 * 内置块(main / nsfw / jailbreak / enhanceDefinitions)关掉已经等于不发了。
 */
export function canDeleteBlock(prompt: PresetPrompt): boolean {
  return !prompt.marker && !prompt.systemPrompt;
}
