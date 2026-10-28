/**
 * 共用小组件里「不碰 DOM 的那部分」:键盘、定位、计时、裁头像、滑块填充。
 * 项目里没有 DOM 测试环境(没有 jsdom),所以这些逻辑单独放在这,组件只是把它们接到 React 上。
 * 数值、规则都照设计稿 kit 的 components.js(AV.tips / AV.face / AV.toaster / AV.confirm / AV.popTheme / AV.frost)。
 */

// ───────── 滑块 ─────────

/** 滑块填充到哪:写进 --p。超出范围按两头算,min = max 时是 0 */
export function rangeFill(value: number, min: number, max: number): string {
  if (!(max > min)) return '0%';
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return `${+(t * 100).toFixed(2)}%`;
}

// ───────── 「?」浮层 ─────────

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
}

/**
 * 浮层放哪(相对画面根左上角,画面根自己的坐标系里的 px):
 * 水平居中在「?」上,贴边留 8;默认在下面 8px,放不下(离底边不到 6)就翻到上面。
 * scale = 画面根被缩放的倍数(预览舞台缩小时 getBoundingClientRect 比 offsetWidth 小)。
 */
export function placeTip(
  anchor: Rect,
  box: { w: number; h: number },
  root: { rect: Rect; w: number; h: number },
): { left: number; top: number } {
  const k = root.w ? root.rect.width / root.w || 1 : 1;
  const x = (anchor.left + anchor.width / 2 - root.rect.left) / k;
  const left = Math.min(root.w - box.w - 8, Math.max(8, x - box.w / 2));
  let top = (anchor.bottom - root.rect.top) / k + 8;
  if (top + box.h > root.h - 6) top = (anchor.top - root.rect.top) / k - box.h - 8;
  return { left, top };
}

// ───────── 按脸裁头像 ─────────

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEFAULT_FACE: FaceBox = { x: 0.35, y: 0.1, w: 0.3, h: 0.2 };

/**
 * 脸高占格子 70%、脸中心放在 55% 的高度(头顶留一点):和封面、选角页的小头像同一个裁法。
 * imgAspect = 原图宽 / 高;face 是 0–1 的比例框;size 是格子边长 px。返回 <img> 的绝对定位样式
 */
export function faceCropStyle(face: FaceBox | undefined, imgAspect: number, size: number) {
  const f = face ?? DEFAULT_FACE;
  const height = (size * 0.7) / f.h;
  const width = height * imgAspect;
  return {
    height: +height.toFixed(1),
    left: +(size / 2 - (f.x + f.w / 2) * width).toFixed(1),
    top: +(size * 0.55 - (f.y + f.h / 2) * height).toFixed(1),
  };
}

// ───────── 提示条 ─────────

export type ToastKind = 'info' | 'ok' | 'warn' | 'err';

/** 停多久(毫秒)。null = 常驻要手动收:警告默认常驻;ms 自定停留时间;出错 8 秒,其余 4 秒 */
export function toastLife(t: { kind?: ToastKind; sticky?: boolean; ms?: number }): number | null {
  const sticky = t.sticky ?? t.kind === 'warn';
  if (sticky) return null;
  return t.ms || (t.kind === 'err' ? 8000 : 4000);
}

/** 悬停暂停后还剩多久:扣掉已经过去的,但至少留 0.9 秒 */
export function toastLeftAfterPause(left: number, startedAt: number, now: number): number {
  return Math.max(900, left - (now - startedAt));
}

/** 提示条右边要不要有「×」:常驻的(警告默认常驻、或明确 sticky)才有 */
export function toastClosable(t: { kind?: ToastKind; sticky?: boolean }): boolean {
  return !!t.sticky || (t.kind === 'warn' && t.sticky !== false);
}

/** 提示条的读屏角色:出错是 alert,其余 status */
export const toastRole = (kind?: ToastKind) => (kind === 'err' ? 'alert' : 'status');

// ───────── 主题 ─────────

export type PopTheme = 'white' | 'black' | 'glass';

/**
 * 弹层的纸:white → .av-day(夜里也是白纸)、black → .av-night、glass → .av-night.is-glass(颜色在 glass.css)。
 * 别的值当 white。solid:压在另一张卡上面的小菜单、「看详细」,玻璃时用实心那档(.is-solid),别的主题没区别。
 */
export function popThemeClass(theme?: string | null, solid = false): string {
  const t: PopTheme = theme === 'black' || theme === 'glass' ? theme : 'white';
  return t === 'white' ? 'av-day' : t === 'glass' ? `av-night is-glass${solid ? ' is-solid' : ''}` : 'av-night';
}

// ───────── 确认框 ─────────

export type ConfirmReason = 'delete' | 'keep' | 'esc' | 'outside';

/** 确认框收到的按键:Esc = 留着;Tab 只在框里转(返回下一个该聚焦的下标);别的不管 */
export function confirmKeyAction(
  key: string,
  shift: boolean,
  active: number,
  count: number,
): { type: 'close'; reason: ConfirmReason } | { type: 'focus'; index: number } | null {
  if (key === 'Escape') return { type: 'close', reason: 'esc' };
  if (key === 'Tab' && count > 0) {
    // active = -1 表示焦点不在框里的按钮上:Tab 进第一个、Shift+Tab 进最后一个
    const next = shift ? (active <= 0 ? count - 1 : active - 1) : (active + 1) % count;
    return { type: 'focus', index: next };
  }
  return null;
}

// ───────── 只糊背景的毛玻璃 ─────────

/** 框相对画面根的偏移 = 沿 offsetParent 一路往上把 offsetLeft / offsetTop 加起来 */
export function frostOffset(chain: readonly { offsetLeft: number; offsetTop: number }[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const n of chain) {
    x += n.offsetLeft;
    y += n.offsetTop;
  }
  return { x, y };
}

/** 垫在框里的那张模糊背景图:按画面根的大小铺,再往左上挪回框的位置,这样和框后面的背景对齐 */
export function frostImgStyle(stage: { w: number; h: number }, offset: { x: number; y: number }) {
  return { width: stage.w, height: stage.h, left: -offset.x, top: -offset.y };
}

// ───────── 按钮 ─────────

export type PaperButtonKind = 'normal' | 'primary' | 'ghost' | 'danger';

/** 按钮的 class:主(墨底纸字,一屏一个)/ 普通(细边)/ 淡(无边)/ 危险(红字);sm 是小号;armed 是「再点一下」那一下的红底 */
export function paperButtonClass(kind: PaperButtonKind = 'normal', sm = false, armed = false): string {
  return ['av-btn', kind === 'normal' ? '' : kind, sm ? 'sm' : '', armed ? 'is-armed' : ''].filter(Boolean).join(' ');
}

// ───────── 就地确认 ─────────

/**
 * 就地确认(删存档那一格上翻出的「删除 / 留着」)收到一次按下:
 * 在确认框里的不管;在这一格别处、或淡下去的别的格子上:收起确认,并把随后那一下点击吞掉(不读档、不开别的);
 * 在别处(菜单别的地方):只收起,点击照常。
 */
export function hereOutside(inBox: boolean, inScope: boolean): 'ignore' | 'close' | 'close-swallow' {
  if (inBox) return 'ignore';
  return inScope ? 'close-swallow' : 'close';
}

// ───────── 右键小菜单 ─────────

/** 小菜单放哪:左上角在光标上,放不下就往回挪,离边至少 8(坐标都是画面根自己的 px) */
export function placeMenu(
  at: { x: number; y: number },
  size: { w: number; h: number },
  bounds: { w: number; h: number },
): { left: number; top: number } {
  const left = Math.max(8, Math.min(at.x, bounds.w - size.w - 8));
  const top = Math.max(8, Math.min(at.y, bounds.h - size.h - 8));
  return { left, top };
}
