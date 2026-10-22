/**
 * 隐藏前文日语(10-18 用户要的):外语插件关掉以后,前面聊过的回复还是一行日语一行中文,
 * 模型看着前文会接着写日语。玩家点一下「隐藏前文日语」,当时已有的每条带日语的回复记一个记号
 * (swipe_info[分支].vn.jaHidden,那一刻已有的分支都记上;之后新生成的不带):
 *   - 发给模型的历史里摘掉日语行(lang.ts 的 stripJa,DebugApp 拼历史时)
 *   - 视觉小说的对话框、历史页、选项里不显示日语小字;历史页「显示原文」照样能看到
 *   - 语音不变:日语声音照念日语
 * 原文一个字不改,「恢复」就是把记号去掉。用程序认日语(和画面上挂日语的是同一套规则),不调 AI
 */
import type { ChatEntry, SwipeInfo } from '../lib/chatEntry';
import { jevText } from './jevNotes';
import { stripJa } from './lang';
import type { TagKind } from '../vn/script';

/** 当前分支的日语藏起来了 */
export const jaHiddenOf = (entry: ChatEntry): boolean => entry.swipeInfo[entry.swipeIndex]?.vn?.jaHidden === true;

/** 发给模型的这条历史:原文 + Jev 的标注;藏了日语的摘掉日语行 */
export function historyText(entry: ChatEntry, kinds: readonly TagKind[]): string {
  const text = jevText(entry, kinds);
  return entry.role === 'assistant' && jaHiddenOf(entry) ? stripJa(text, kinds) : text;
}

/** 这条回复(任一分支)有没有能藏的日语 */
const hasJa = (entry: ChatEntry, kinds: readonly TagKind[]) =>
  entry.swipes.some((_, i) => {
    const view = jevText({ ...entry, swipeIndex: i }, kinds);
    return stripJa(view, kinds) !== view;
  });

/** 一条回复的每个分支都记上 / 都去掉记号;没变化原样返回 */
function markAll(entry: ChatEntry, hidden: boolean): ChatEntry {
  const n = Math.max(entry.swipeInfo.length, entry.swipes.length);
  let changed = false;
  const swipeInfo = Array.from({ length: n }, (_, i): SwipeInfo => {
    const info = entry.swipeInfo[i] ?? ({} as SwipeInfo);
    if ((info.vn?.jaHidden === true) === hidden) return info;
    changed = true;
    const vn = { ...info.vn };
    if (hidden) vn.jaHidden = true;
    else delete vn.jaHidden;
    const next: SwipeInfo = { ...info };
    if (Object.keys(vn).length > 0) next.vn = vn;
    else delete next.vn;
    return next;
  });
  return changed ? { ...entry, swipeInfo } : entry;
}

/** 藏起来:现在还在写的那条不动,没有日语的不记 */
export const hideJa = (entry: ChatEntry, kinds: readonly TagKind[]): ChatEntry =>
  entry.role !== 'assistant' || entry.streaming || !hasJa(entry, kinds) ? entry : markAll(entry, true);

export const showJaAgain = (entry: ChatEntry): ChatEntry => (entry.role === 'assistant' ? markAll(entry, false) : entry);

/** 有几条回复藏了日语(按每条有没有分支带记号算) */
export const hiddenJaCount = (entries: readonly ChatEntry[]): number =>
  entries.filter((e) => e.swipeInfo.some((s) => s?.vn?.jaHidden === true)).length;

/** 给外语插件页和视觉小说设置页的按钮 */
export interface JaHideControls {
  /** 现在有几条回复藏了日语 */
  hidden: number;
  /** 把当前对话里已有的日语都藏起来 */
  hide: () => void;
  /** 全部恢复 */
  show: () => void;
}
