/**
 * 局内菜单「相册」页(MenuAlbum.tsx)的纯逻辑:画过的图按存档(对话)分组、按时间分组,
 * 看大图里「跳到这里」能不能回到画它的那一句。有测试(menuAlbumModel.test.ts)。
 *
 * 相册里每张图记着画它时的 chat_id / entry_id / swipe / line(GeneratedImage),所以:
 * - 同一个对话里、那条回复还在、显示的还是画它的那个分支 → 直接跳到那一句(line 是句子的编号,从 0 数);
 * - 在这张卡别的存档里 → 读那个档,读好了再落到那一句(内核 MenuAlbumContext.jumpToSave;读到的对话里
 *   那条回复没了 / 换了分支就停在最新一句,提示为什么 —— 读完以后的判断也在这里,landingOf);
 * - 对话 / 回复删了、回复换了分支、老图没记位置 → 跳不了,说清楚为什么。
 * 「收藏」以 CG 包为准,和卡编辑器的「AI 生成」一栏是同一份(studioAlbumModel.albumEntries)。
 */

import { parseUtc, two } from '../../lib/time';
import type { SaveLanding } from '../cartridges';
import { saveTitle } from '../../vn/menuLabel';
import type { AlbumEntry } from './studioAlbumModel';

/** 这张卡的一个存档(对话),相册分组用它的名字 */
export interface AlbumSave {
  id: string;
  name: string;
}

/** 相册里的一组:一个存档,或者一天 */
export interface AlbumGroup {
  id: string;
  title: string;
  /** 这组是正在玩的存档 */
  current: boolean;
  /** 能「读这个档」的存档编号;按时间分组、存档找不到的组是 null */
  chatId: string | null;
  items: AlbumEntry[];
}

/** 找不到存档的图(存档删了,或者老图没记) */
export const ORPHAN_GROUP = 'orphan';

/** 创建时间的毫秒数;读不出来是 0(排最后) */
export function createdMs(e: AlbumEntry): number {
  const t = e.image ? parseUtc(e.image.created_at) : 0;
  return Number.isNaN(t) ? 0 : t;
}

/** 新的在前;同一时刻的保持原来的顺序 */
function newestFirst(items: readonly AlbumEntry[]): AlbumEntry[] {
  return items
    .map((e, i) => ({ e, i, t: createdMs(e) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.e);
}

/** 相册页只列画过的图(只在 CG 包里、相册里没有记录的那些没有位置可跳,留给卡编辑器) */
export const drawnOnly = (entries: readonly AlbumEntry[]): AlbumEntry[] => entries.filter((e) => e.image !== null);

/**
 * 按存档分组:每组里新的在前;组按各自最新的一张排,新的在前;
 * 存档找不到的图合成最后一组。空的组不出
 */
export function groupBySave(
  entries: readonly AlbumEntry[],
  saves: readonly AlbumSave[],
  currentChatId: string | null,
): AlbumGroup[] {
  const known = new Map(saves.map((s) => [s.id, s]));
  const byChat = new Map<string, AlbumEntry[]>();
  const orphans: AlbumEntry[] = [];
  for (const e of entries) {
    const id = e.image?.chat_id ?? null;
    if (id !== null && known.has(id)) byChat.set(id, [...(byChat.get(id) ?? []), e]);
    else orphans.push(e);
  }
  const groups: AlbumGroup[] = [...byChat].map(([id, items]) => ({
    id,
    title: saveTitle(known.get(id)?.name ?? ''),
    current: id === currentChatId,
    chatId: id,
    items: newestFirst(items),
  }));
  groups.sort((a, b) => createdMs(b.items[0]) - createdMs(a.items[0]));
  if (orphans.length > 0) {
    groups.push({ id: ORPHAN_GROUP, title: '找不到存档的图', current: false, chatId: null, items: newestFirst(orphans) });
  }
  return groups;
}

/** 「10-18」;读不出来是空串。按本机时区的日子分 */
export function dayText(iso: string): string {
  const t = parseUtc(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** 「06:56」;读不出来是空串 */
export function clockText(iso: string): string {
  const t = parseUtc(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** 按时间分组:一天一组,新的在前(组头是日期) */
export function groupByDay(entries: readonly AlbumEntry[]): AlbumGroup[] {
  const sorted = newestFirst(entries);
  const out: AlbumGroup[] = [];
  for (const e of sorted) {
    const day = (e.image && dayText(e.image.created_at)) || '时间不详';
    const last = out[out.length - 1];
    if (last && last.id === day) last.items.push(e);
    else out.push({ id: day, title: day, current: false, chatId: null, items: [e] });
  }
  return out;
}

/** 「第 12 句」;没记位置是空串。line 从 0 数,给人看的从 1 数 */
export function lineText(line: number | null | undefined): string {
  return typeof line === 'number' && line >= 0 ? `第 ${line + 1} 句` : '';
}

/** 格子 / 大图下面那行:「06:56 · 第 12 句」 */
export function whereLine(e: AlbumEntry): string {
  if (!e.image) return '';
  return [clockText(e.image.created_at), lineText(e.image.line)].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- 跳到这里

/** 现在这场对话的样子:相册只问「这条回复还在不在、显示的是第几个分支」 */
export interface JumpWorld {
  currentChatId: string | null;
  /** 这张卡的存档编号 */
  saveIds: ReadonlySet<string>;
  /** 当前对话里第 entryId 条回复现在显示第几个分支;这条回复不在当前对话里是 null */
  swipeOf: (entryId: string) => number | null;
}

export type JumpTarget =
  /** 就在这场对话里,跳到 entryId 的第 line 句 */
  | { kind: 'jump'; entryId: string; line: number }
  /** 在这张卡的另一个存档里:先读那个档,读好了再落到 entryId 的第 line 句(落不落得上读完才知道,landingOf) */
  | { kind: 'load'; chatId: string; entryId: string; line: number; why: string }
  /** 跳不了 */
  | { kind: 'none'; why: string };

/** 一张图的「跳到这里」该做什么,做不了时为什么 */
export function jumpTargetOf(e: AlbumEntry, world: JumpWorld): JumpTarget {
  const img = e.image;
  if (!img) return { kind: 'none', why: '相册里没有这张图的记录' };
  const chatId = img.chat_id;
  if (chatId === null || img.entry_id === null || img.line === null) {
    return { kind: 'none', why: '这张图没记下画在哪一句(老版本画的)' };
  }
  if (chatId !== world.currentChatId) {
    return world.saveIds.has(chatId)
      ? { kind: 'load', chatId, entryId: img.entry_id, line: img.line, why: '它在另一个存档里,会先读那个档' }
      : { kind: 'none', why: '画它的那个存档已经删了' };
  }
  const swipe = world.swipeOf(img.entry_id);
  if (swipe === null) return { kind: 'none', why: '画它的那条回复已经删了' };
  if (img.swipe !== null && img.swipe !== swipe) return { kind: 'none', why: '画它的那一版回复已经换掉了' };
  return { kind: 'jump', entryId: img.entry_id, line: img.line };
}

/**
 * 跨存档跳转读完那个档以后落在哪(MenuAlbumContext.jumpToSave 的 land):swipeOf 问的是刚读到的对话。
 * 能跳就是那一句;那条回复没了、换了分支(或者读到的根本不是画它的存档)就停在最新一句,note 说为什么
 */
export function landingOf(e: AlbumEntry, chatId: string, swipeOf: JumpWorld['swipeOf']): SaveLanding {
  const stay = (why: string): SaveLanding => ({ note: `${why},停在这个存档最新一句` });
  if (e.image?.chat_id !== chatId) return stay('读到的不是画它的那个存档');
  const t = jumpTargetOf(e, { currentChatId: chatId, saveIds: new Set([chatId]), swipeOf });
  return t.kind === 'jump' ? { entryId: t.entryId, line: t.line } : stay(t.why);
}
