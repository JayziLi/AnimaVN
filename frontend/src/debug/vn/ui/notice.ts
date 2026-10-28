/**
 * 调试台的 notify(kind, message) 怎么变成游戏里的纸卡提示条:走哪条、怎么拆标题和英文原文、放在哪。
 * 不碰 DOM,好单独测。
 */
import type { ToastItem } from './PaperToast';

/** 游戏开着由游戏画纸卡,关着照旧画调试台自己的条 */
export const routeNotice = (gameOpen: boolean): 'game' | 'console' => (gameOpen ? 'game' : 'console');

/** 标题最长这么多字才算「短标题」;更长的当整句话,不拆 */
const TITLE_MAX = 16;

/**
 * 调试台的出错话都是「保存失败: <后端原文>」这个形状:冒号前是短标题,冒号后是英文原文(等宽小字另起一行)。
 * 拆不出来(没有冒号、前半太长、后半是空的)就整句当正文。
 */
export function noticeToToast(kind: 'ok' | 'error', message: string): Omit<ToastItem, 'id'> {
  if (kind === 'ok') return { kind: 'ok', text: message };
  const m = /^([^:：\n]{1,16})[:：]\s*([\s\S]+)$/.exec(message.trim());
  if (m && m[1].trim().length <= TITLE_MAX && m[2].trim()) return { kind: 'err', text: m[1].trim(), code: m[2].trim() };
  return { kind: 'err', text: message };
}

/** 存档的回执(设计稿整合版):「已存档 · 夜路 · 33 条」;这一幕没有背景名时只写条数 */
export function saveReceipt(place: string | null, count: number): string {
  return ['已存档', place?.trim() || null, `${count} 条`].filter(Boolean).join(' · ');
}

/**
 * 提示条放哪:平时在右上、让开那排按钮和历史那一格(整合版 top 130);
 * 开着菜单 / 小窗口 / 选角色时右上角是别的东西,挪到底下正中。
 */
export function toastPlace(low: boolean): { pos: 'tr' | 'bc'; offset: { top?: number; bottom?: number } } {
  return low ? { pos: 'bc', offset: { bottom: 22 } } : { pos: 'tr', offset: { top: 130 } };
}
