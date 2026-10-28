/**
 * 插件抽屉的「游戏皮」(界面统一计划 U24):抽屉在调试台、卡编辑器、游戏菜单里三处共用,只有游戏菜单那份换成
 * 纸面三栏(左栏图标导航 | 中间名字 + 实机预览舞台 | 右边常用和高级);调试台和卡编辑器 10-25 定了先不改。
 *
 * 拆成三个文件:skinModel.ts(纯函数和常量)、skinContext.ts(给页用的 context)、skin.tsx(换页淡入的小组件)。
 *
 * PluginsDrawer 用 DrawerSkinContext(skinContext.ts) 告诉里面的页:
 *   game   现在是不是游戏皮;不是就照老样子画(每个页的 DOM 和以前一样)
 *   page   现在是哪一页(插件总表的 id、全局页、卡带的 key)
 *   power  这一页的插件开关(游戏皮把它从左栏挪到了页头名字旁;没有开关的页是 null)
 */

export interface PagePower {
  on: boolean;
  /** 读屏念的名字,如「立绘开关」 */
  label: string;
  onToggle: () => void;
}

/** 有实机预览舞台的页:游戏皮下排成三栏;别的页(外语、Jev、语音服务…)排成一列放在纸面里 */
export const STAGE_PAGES: readonly string[] = ['sprite', 'voice', 'bg', 'bgm', 'cg', 'lang'];
export const isStagePage = (id: string): boolean => STAGE_PAGES.includes(id);

/** 页头名字后面的斜体英文小标 */
const PAGE_EN: Record<string, string> = {
  sprite: 'Sprite',
  voice: 'Voice',
  bg: 'Background',
  bgm: 'Music',
  cg: 'Event CG',
  lang: 'Language',
  imagegen: 'Illustration',
  jev: 'Jev',
  tts: 'Voice server',
  autofill: 'Auto-fill',
  engine: 'Matching',
  sfx: 'Onomatopoeia',
  tone: 'Voice tone',
};
export const pageEn = (id: string): string | null => PAGE_EN[id] ?? null;

/** AI 生图 10-25 转正式版:游戏皮的左栏和页头不标 BETA(卡带自己的 beta 标记不动,调试台照旧) */
const FORMAL_IN_GAME: readonly string[] = ['imagegen'];
export const betaShown = (game: boolean, id: string, beta: boolean): boolean => beta && !(game && FORMAL_IN_GAME.includes(id));
