/**
 * 画出来的图挂在消息上:swipe_info[分支].vn.images,一张一个记号 {line, until?, id, sha, hidden?}。纯函数,有测试。
 *
 * 显示规则:这条回复里,第 line 句显示「在这句或之前、最近的那一张」,到它的结束句(until,指导模型判的:
 * 地点、动作、衣服、在场的人一变就结束;没写的挂 hold.fallback 句)或者下一张为止,最少挂 hold.min 句
 * (10-12 用户:原来一直挂到回复结束;后来又要「最小持续时间」,指导模型判早了也挂够)。
 * 那一张收起了(hidden)或者已经过了结束句就什么都不显示(更早的那张不会冒回来)。同一句画了新的,新的顶掉旧的(旧的还在相册里)。
 */

import type { ChatEntry, SwipeInfo, VnImageMark, VnMarks } from '../../lib/chatEntry';

const valid = (m: unknown): m is VnImageMark =>
  m !== null &&
  typeof m === 'object' &&
  typeof (m as VnImageMark).line === 'number' &&
  typeof (m as VnImageMark).id === 'string' &&
  typeof (m as VnImageMark).sha === 'string';

/** 这个分支的图记号(格式不对的不算),按句号排 */
export function imagesOf(entry: ChatEntry, swipe = entry.swipeIndex): VnImageMark[] {
  const raw = entry.swipeInfo[swipe]?.vn?.images;
  return Array.isArray(raw) ? raw.filter(valid).sort((a, b) => a.line - b.line) : [];
}

/** 一张图挂几句(都含画的那句):min 至少几句;fallback 指导模型没写结束句时挂几句。设置里能改 */
export interface Hold {
  min: number;
  fallback: number;
}
export const DEFAULT_HOLD: Hold = { min: 3, fallback: 4 };

/** 这张图显示到第几句(含) */
export function endOf(m: VnImageMark, hold: Hold = DEFAULT_HOLD): number {
  const judged = typeof m.until === 'number' && m.until >= m.line ? m.until : m.line + hold.fallback - 1;
  return Math.max(judged, m.line + hold.min - 1);
}

/** 当前分支第 line 句显示的那张;没有、收起了、过了结束句是 null */
export function markAt(entry: ChatEntry, line: number, hold: Hold = DEFAULT_HOLD): VnImageMark | null {
  let found: VnImageMark | null = null;
  for (const m of imagesOf(entry)) if (m.line <= line) found = m;
  return found && !found.hidden && line <= endOf(found, hold) ? found : null;
}

function withImages(entry: ChatEntry, swipe: number, images: VnImageMark[]): ChatEntry {
  const info = entry.swipeInfo[swipe] ?? ({} as SwipeInfo);
  const vn: VnMarks = { ...info.vn };
  if (images.length) vn.images = images;
  else delete vn.images;
  const next: SwipeInfo = { ...info };
  if (Object.keys(vn).length) next.vn = vn;
  else delete next.vn;
  const n = Math.max(entry.swipeInfo.length, swipe + 1);
  const swipeInfo = Array.from({ length: n }, (_, i) => (i === swipe ? next : (entry.swipeInfo[i] ?? ({} as SwipeInfo))));
  return { ...entry, swipeInfo };
}

/** 在第 swipe 个分支的 mark.line 句挂一张;同一句已有的被顶掉 */
export function addImage(entry: ChatEntry, swipe: number, mark: VnImageMark): ChatEntry {
  const rest = imagesOf(entry, swipe).filter((m) => m.line !== mark.line);
  const added: VnImageMark = { line: mark.line, id: mark.id, sha: mark.sha };
  if (typeof mark.until === 'number' && mark.until >= mark.line) added.until = mark.until;
  return withImages(entry, swipe, [...rest, added].sort((a, b) => a.line - b.line));
}

/** 改第 swipe 个分支里编号是 id 的那张(收起、换成新画的);找不到原样返回 */
export function patchImage(
  entry: ChatEntry,
  swipe: number,
  id: string,
  fn: (m: VnImageMark) => VnImageMark,
): ChatEntry {
  const list = imagesOf(entry, swipe);
  if (!list.some((m) => m.id === id)) return entry;
  return withImages(
    entry,
    swipe,
    list.map((m) => (m.id === id ? fn(m) : m)),
  );
}

/**
 * 自动出图的冷却:第 index 条(这条回复)之前,上一张图(不管是自动还是手动画的、收没收起)在几条回复以前。
 * 上一条回复就有图是 1;这段对话还没出过图是 null。只看各条当前的分支
 */
export function repliesSinceImage(entries: readonly ChatEntry[], index: number): number | null {
  let n = 0;
  for (let i = index - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.role !== 'assistant') continue;
    n += 1;
    if (imagesOf(e).length) return n;
  }
  return null;
}

/** 冷却挡不挡:出过图以后中间至少隔 cooldown 条回复;重要度 3(第一次到某地、第一次身体接触……)不挡 */
export const blockedByCooldown = (since: number | null, cooldown: number, importance: number) =>
  since !== null && since <= cooldown && importance < 3;
