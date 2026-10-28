/**
 * 兜底:素材没有、还没加载出来、取不到颜色时垫上去的那一样。
 *
 * 原来散在好几个文件里各写一份(默认背景三份、默认头像两份),收到这里,改一处就都改了。
 * 用途不同的各留各的名字(比如游戏里的主题色和封面的点缀色取不到时一个退回灰白、一个退回粉色),
 * 只是都从这里取。
 */

import type { AccentVars } from './accent';
import type { Accent } from './titleArt';

/**
 * 背景没加载出来 / 这张卡没背景时垫的默认背景(白昼:白到淡紫的渐变 + 星图线,10-04 定稿)。
 * 卡没绑场景包、或者包里的背景还没传图时也是它。视觉小说的背景层、读档页的缩略图、选角色页的卡面都用它
 */
export const FALLBACK_BACKGROUND = '/vn/bg/default.svg';

/** 立绘位置编辑器(插件页):这张卡没背景时垫在立绘后面当参照的那张 */
export const POSITION_EDITOR_BACKGROUND = '/vn/bg/uni.jpg';

/**
 * 没设头像时的兜底(frontend/public/assets),酒馆那边同样是给个灰人占位。
 * 聊天消息里人设的头像、角色列表每行的头像是同一个
 */
export const DEFAULT_AVATAR = '/assets/default-avatar.jpg';

/**
 * 视觉小说主题色(accent.ts)的「灰白」:不抢立绘和背景的颜色;
 * 跟角色取不到颜色(没立绘、读不出像素)时也用它
 */
export const VN_ACCENT_MONO: AccentVars = {
  accent: '#e4e4ea',
  ink: '#17181f',
  rgb: '228, 228, 234',
  deep: '#55565f',
  soft: '#ececf0',
  nameInk: '#17181f',
};

/** 视觉小说主题色(accent.ts)的「粉色」:原来的样子 */
export const VN_ACCENT_PINK: AccentVars = {
  accent: '#f4a9c4',
  ink: '#2b1420',
  rgb: '244, 169, 196',
  deep: '#b0466f',
  soft: '#fbe8ef',
  nameInk: '#2b1420',
};

/** 封面(VNTitle)的点缀色:从立绘里取不到颜色(没立绘、读不出像素)时用的粉色 */
export const TITLE_DEFAULT_ACCENT: Accent = {
  acc: '#f4a9c4',
  deep: 'hsl(335 40% 38%)',
  ink: '#2b1420',
  soft: '#fbe8ef',
  rgb: '244, 169, 196',
};
