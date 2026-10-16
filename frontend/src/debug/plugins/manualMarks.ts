/**
 * 手改的表情(设计稿 12.2 Q1 = A):玩家在检查器里只改这一句的表情,记在这个分支的 swipe_info[分支].vn.manual,一句一个。
 * 优先级最高,比 Jev 还高;只在这个分支的这一句生效,累计下来的表情不变,后面的句子照旧。
 * 时间线(core/timeline.ts)按它换这句的画面,语音(plugins/voice.ts 的 planVoiceLines)按它念;
 * 存盘照 DebugApp 现有的那个 effect 走(改的是当前对话的条目)。
 */
import type { PackSprite } from '../lib/api';
import type { ChatEntry, SwipeInfo, VnManualMark, VnMarks } from '../lib/chatEntry';
import { BUILTIN_EMOTIONS } from './emotions';

/** 当前分支的手改记号;没有是 undefined。原样给存档里那个数组:时间线按引用认它变没变 */
export function manualOf(entry: ChatEntry): readonly VnManualMark[] | undefined {
  const marks = entry.swipeInfo[entry.swipeIndex]?.vn?.manual;
  return Array.isArray(marks) ? marks : undefined;
}

/** 第 line 句的手改记号;格式不对的不算 */
export function manualAt(marks: readonly VnManualMark[] | undefined, line: number): VnManualMark | undefined {
  return marks?.find((m) => m?.line === line && typeof m.item === 'string' && typeof m.label === 'string');
}

/**
 * 手改的那一项现在叫什么:先按 item(立绘 id)在启用的立绘里找,找不到按 label 找;没配立绘的卡在内置表情里找。
 * 都找不到(立绘删了、停用了)是 null,当没改
 */
export function manualLabel(mark: VnManualMark, sprites: readonly Pick<PackSprite, 'id' | 'label'>[]): string | null {
  if (sprites.length === 0) {
    const builtin = BUILTIN_EMOTIONS.find((e) => e.label === mark.item) ?? BUILTIN_EMOTIONS.find((e) => e.label === mark.label);
    return builtin?.label ?? null;
  }
  return (sprites.find((s) => s.id === mark.item) ?? sprites.find((s) => s.label === mark.label))?.label ?? null;
}

/**
 * 语音用(planVoiceLines 的 manual):第 i 句手改成的表情名,没改的句子是 undefined。
 * 这个分支一个记号都没有时整个是 undefined,语音请求和以前一模一样
 */
export function manualEmotions(
  marks: readonly VnManualMark[] | undefined,
  sprites: readonly Pick<PackSprite, 'id' | 'label'>[],
): ((line: number) => string | undefined) | undefined {
  if (!marks?.length) return undefined;
  return (line) => {
    const m = manualAt(marks, line);
    return (m && manualLabel(m, sprites)) ?? undefined;
  };
}

/**
 * 在当前分支第 line 句记下手改的表情;pick 是 null 删掉这句的记号(本来就没有时原样返回)。
 * 只动当前分支,vn 里别的记号原样留着;一个都不剩时连 manual 这个键也去掉
 */
export function setManual(entry: ChatEntry, line: number, pick: { item: string; label: string } | null): ChatEntry {
  const old = manualOf(entry) ?? [];
  const rest = old.filter((m) => m?.line !== line);
  if (!pick && rest.length === old.length) return entry;
  const manual = pick ? [...rest, { line, item: pick.item, label: pick.label }].sort((a, b) => a.line - b.line) : rest;
  const at = entry.swipeIndex;
  const info = entry.swipeInfo[at] ?? ({} as SwipeInfo);
  const vn: VnMarks = { ...info.vn };
  if (manual.length > 0) vn.manual = manual;
  else delete vn.manual;
  const next: SwipeInfo = { ...info };
  if (Object.keys(vn).length > 0) next.vn = vn;
  else delete next.vn;
  const n = Math.max(entry.swipeInfo.length, at + 1);
  const swipeInfo = Array.from({ length: n }, (_, i) => (i === at ? next : (entry.swipeInfo[i] ?? ({} as SwipeInfo))));
  return { ...entry, swipeInfo };
}
