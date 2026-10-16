/**
 * 资料页 · 预设(PresetView)用到的几样小算法:两个下拉的选项、右栏编辑的是哪一块、绑定那一行的提示。
 * 不碰界面,方便单测。文件名避开 presetView:和 PresetView.tsx 在大小写不敏感的盘上会撞
 */

import {
  orderGroupLabel,
  type PresetOrderEntry,
  type PresetOrderGroup,
  type PresetPrompt,
  type TavernPreset,
} from '../../lib/presetParser';

export interface Choice {
  value: string;
  label: string;
}

/**
 * 「编排」下拉:每组一项「名字 (id) · N 启用」,值是组的下标。
 * 当前这组按 live(带左栏临时开关、还没存的编排)数,别的组按存着的数 —— 和下面列表表头的数对得上
 */
export function groupChoices(
  groups: readonly PresetOrderGroup[],
  activeIndex: number,
  live: readonly PresetOrderEntry[],
): Choice[] {
  return groups.map((g, i) => {
    const order = i === activeIndex ? live : g.order;
    return { value: String(i), label: `${orderGroupLabel(g)} · ${order.filter((o) => o.enabled).length} 启用` };
  });
}

/** 右栏编辑的那一块:没选、没预设、块被删了或者换了预设没有这一块,都是 null(右栏写怎么用) */
export function pickedBlock(preset: TavernPreset | null, identifier: string | null): PresetPrompt | null {
  if (!preset || !identifier) return null;
  return preset.prompts.find((p) => p.identifier === identifier) ?? null;
}

/**
 * 顶上的预设下拉:库里的预设一个一项。当前这套不在库里时(还没选上、库里一个都没有)
 * 最前面补一项,值是 '',显示它的名字 —— 不然下拉会显示成库里第一套,看着像选了别的
 */
export function presetChoices(
  saved: readonly { id: string; name: string }[],
  selectedId: string | null,
  currentName: string | null,
): Choice[] {
  const list = saved.map((p) => ({ value: p.id, label: p.name }));
  if (selectedId && list.some((c) => c.value === selectedId)) return list;
  return [{ value: '', label: currentName ?? '(还没有预设)' }, ...list];
}

/** 绑定那一行下面的小字:这张卡绑的是别的预设、现在临时用着这套时,说一声勾上会改绑 */
export function bindNote(binding: { boundName: string | null; bound: boolean }): string | null {
  if (binding.bound || !binding.boundName) return null;
  return `这张卡绑的是「${binding.boundName}」,现在临时用的这套;勾上就改绑成这套`;
}
