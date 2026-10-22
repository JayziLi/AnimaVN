/**
 * 画出来的图挂在消息上:swipe_info[分支].vn.images,一张一个记号 {line, until?, id, sha, hidden?}。纯函数,有测试。
 *
 * 显示规则:这条回复里,第 line 句起显示,到它的结束句(until,指导模型判的:地点、动作、衣服、在场的人一变就结束;
 * 没写的就是画的那句)为止;另外从玩家第一次看到它的那句算起,至少挂「最少显示」那么多句(含那句),
 * 这次新画好、还没显示过的那张,玩家已经读过它那句了也照样显示(10-17 用户:图画好时玩家早读过去了,刚出来就跳过)。
 * 同时有几张能显示时显示新的那张:这次画的比以前的新,后画的比先画的新,同样以前的看句号靠后的。
 * 收起(hidden)的那张不显示,它之前的也不冒回来。同一句画了新的,新的顶掉旧的(旧的还在相册里)。
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

/** 最少显示几句(从玩家第一次看到它的那句算,含那句);设置里能改 */
export const DEFAULT_HOLD_LINES = 3;

/** 这次打开以来的显示记录(只在内存里,不写库):哪张什么时候画好、第一次显示在第几句 */
export interface ShowLog {
  drawn: Map<string, number>;
  shown: Map<string, number>;
}
export const newShowLog = (): ShowLog => ({ drawn: new Map(), shown: new Map() });

/** 这张图按句号显示到第几句(含) */
export const endOf = (m: VnImageMark): number => (typeof m.until === 'number' && m.until >= m.line ? m.until : m.line);

/**
 * 当前分支第 line 句显示的那张;没有是 null。传了 log 就按上面的规则算并记下「第一次显示在第几句」,
 * 不传只看句号(没有最少句数、新画的这些)
 */
export function markAt(
  entry: ChatEntry,
  line: number,
  holdLines = DEFAULT_HOLD_LINES,
  log?: ShowLog,
): VnImageMark | null {
  const reached = imagesOf(entry).filter((m) => m.line <= line);
  let from = 0;
  reached.forEach((m, i) => {
    if (m.hidden) from = i + 1;
  });
  const live = (m: VnImageMark) => {
    if (line <= endOf(m)) return true;
    if (!log) return false;
    const shown = log.shown.get(m.id);
    if (shown === undefined) return log.drawn.has(m.id);
    return line - shown < holdLines;
  };
  let best: VnImageMark | null = null;
  const newer = (a: VnImageMark, b: VnImageMark) => {
    const da = log?.drawn.get(a.id) ?? -1;
    const db = log?.drawn.get(b.id) ?? -1;
    return da !== db ? da > db : a.line > b.line;
  };
  for (const m of reached.slice(from)) if (live(m) && (!best || newer(m, best))) best = m;
  if (best && log && !log.shown.has(best.id)) log.shown.set(best.id, line);
  return best;
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

/** 第 index 条之前最近的那张图(上一条有图的回复里句号最靠后的那张);没有是 null。给指导模型说「上一张画的是什么」 */
export function lastImageBefore(entries: readonly ChatEntry[], index: number): VnImageMark | null {
  for (let i = index - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.role !== 'assistant') continue;
    const list = imagesOf(e);
    if (list.length) return list[list.length - 1];
  }
  return null;
}

/** 冷却挡不挡:出过图以后中间至少隔 cooldown 条回复;重要度 3(第一次到某地、第一次身体接触……)不挡 */
export const blockedByCooldown = (since: number | null, cooldown: number, importance: number) =>
  since !== null && since <= cooldown && importance < 3;
