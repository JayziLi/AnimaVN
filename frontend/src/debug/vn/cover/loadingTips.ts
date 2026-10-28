/**
 * 加载页左下角的小贴士(设计稿 kit/loading.js 的 AV.LOAD_TIPS,U32):一句话、短、不解释。
 * 每一条都对着游戏里现在真有的操作写(VNScreen.tsx 的快捷键、右键、右下那排、长按台词的小菜单),不写没有的功能。
 *   pc    = 只有电脑上有(快捷键、右键、滚轮),手机不出
 *   phone = 只有手机上有(触屏的叫法)
 * 电脑 8 条轮换;手机把电脑专用的换成触屏的说法。
 */

export interface LoadTip {
  t: string;
  pc?: boolean;
  phone?: boolean;
}

export const LOAD_TIPS: readonly LoadTip[] = [
  { t: '空白处点右键,可以隐藏界面,看清立绘和背景。', pc: true },
  { t: '按住 Ctrl 快进,按 A 自动播放。', pc: true },
  { t: '滚轮往上,打开历史。', pc: true },
  { t: 'Esc 打开菜单,存档和设置都在里面。', pc: true },
  { t: '她说话的时候,也能直接打字插话。' },
  { t: '翻回你说过的一句,能从那里分出新的故事线。' },
  { t: '右下角的「重来」,会重新生成她的最后一条回复。' },
  { t: '对着台词点右键,能复制这一句、看它的详情。', pc: true },
  { t: '长按台词,能复制这一句、看它的详情。', phone: true },
  { t: '右上角的菜单里有存档和设置。', phone: true },
  { t: '右上角的「历史」那一格,能翻回看过的台词。', phone: true },
];

/** 这块屏上出哪些:手机不出电脑专用的,电脑不出手机专用的 */
export const tipsFor = (phone: boolean): LoadTip[] => LOAD_TIPS.filter((x) => (phone ? !x.pc : !x.phone));

/** 每出一次换下一条;第一次从哪条开始随机,不然每次打开游戏看到的都是同一句 */
const turn = { pc: Math.floor(Math.random() * 8), phone: Math.floor(Math.random() * 6) };

export function nextTip(phone: boolean): string {
  const list = tipsFor(phone);
  const k = phone ? 'phone' : 'pc';
  const t = list[turn[k] % list.length].t;
  turn[k]++;
  return t;
}
