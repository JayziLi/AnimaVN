import { describe, expect, it } from 'vitest';
import {
  confirmKeyAction,
  faceCropStyle,
  frostImgStyle,
  frostOffset,
  hereOutside,
  placeMenu,
  placeTip,
  popThemeClass,
  rangeFill,
  toastClosable,
  toastLeftAfterPause,
  toastLife,
  toastRole,
  type Rect,
} from './logic';

const rect = (left: number, top: number, w: number, h: number): Rect => ({ left, top, right: left + w, bottom: top + h, width: w });

describe('rangeFill', () => {
  it('按比例算百分比', () => {
    expect(rangeFill(50, 0, 100)).toBe('50%');
    expect(rangeFill(0.75, 0.5, 1)).toBe('50%');
    expect(rangeFill(1 / 3, 0, 1)).toBe('33.33%');
  });
  it('超出范围按两头算,min = max 时是 0', () => {
    expect(rangeFill(-5, 0, 10)).toBe('0%');
    expect(rangeFill(99, 0, 10)).toBe('100%');
    expect(rangeFill(3, 3, 3)).toBe('0%');
  });
});

describe('placeTip', () => {
  const root = { rect: rect(0, 0, 1000, 600), w: 1000, h: 600 };
  it('默认在「?」下面 8px,水平居中', () => {
    const p = placeTip(rect(300, 100, 15, 15), { w: 100, h: 40 }, root);
    expect(p).toEqual({ left: 300 + 7.5 - 50, top: 115 + 8 });
  });
  it('贴边留 8', () => {
    expect(placeTip(rect(0, 100, 15, 15), { w: 100, h: 40 }, root).left).toBe(8);
    expect(placeTip(rect(990, 100, 15, 15), { w: 100, h: 40 }, root).left).toBe(1000 - 100 - 8);
  });
  it('靠近底边翻到上面', () => {
    const p = placeTip(rect(300, 560, 15, 15), { w: 100, h: 40 }, root);
    expect(p.top).toBe(560 - 40 - 8);
  });
  it('画面根被缩小时按倍数换回画面自己的坐标', () => {
    // 画面 1000×600 被缩成一半放在 (100, 50)
    const small = { rect: rect(100, 50, 500, 300), w: 1000, h: 600 };
    const p = placeTip(rect(100 + 100, 50 + 50, 7.5, 7.5), { w: 100, h: 40 }, small);
    expect(p.left).toBe((100 + 3.75) * 2 - 50);
    expect(p.top).toBe(57.5 * 2 + 8);
  });
});

describe('faceCropStyle', () => {
  it('脸高占格子 70%、脸中心在 55% 高度', () => {
    const face = { x: 0.4, y: 0.1, w: 0.2, h: 0.14 };
    const s = faceCropStyle(face, 0.5, 40);
    expect(s.height).toBe(200); // 40 * 0.7 / 0.14
    // 脸的垂直中心 (y + h/2) * height + top = 55% * size
    expect((face.y + face.h / 2) * s.height + s.top).toBeCloseTo(22, 1);
    // 脸的水平中心落在格子正中
    expect((face.x + face.w / 2) * (s.height * 0.5) + s.left).toBeCloseTo(20, 1);
  });
  it('没有脸框用默认位置', () => {
    expect(faceCropStyle(undefined, 1, 40)).toEqual(faceCropStyle({ x: 0.35, y: 0.1, w: 0.3, h: 0.2 }, 1, 40));
  });
});

describe('toastLife', () => {
  it('普通 / 成功 4 秒,出错 8 秒', () => {
    expect(toastLife({})).toBe(4000);
    expect(toastLife({ kind: 'info' })).toBe(4000);
    expect(toastLife({ kind: 'ok' })).toBe(4000);
    expect(toastLife({ kind: 'err' })).toBe(8000);
  });
  it('警告常驻,sticky 能改', () => {
    expect(toastLife({ kind: 'warn' })).toBeNull();
    expect(toastLife({ kind: 'info', sticky: true })).toBeNull();
    expect(toastLife({ kind: 'warn', sticky: false })).toBe(4000);
  });
  it('ms 自定停留时间', () => {
    expect(toastLife({ kind: 'err', ms: 1500 })).toBe(1500);
  });
  it('悬停暂停后至少留 0.9 秒', () => {
    expect(toastLeftAfterPause(4000, 1000, 2500)).toBe(2500);
    expect(toastLeftAfterPause(4000, 1000, 4900)).toBe(900);
  });
  it('常驻的才有 ×', () => {
    expect(toastClosable({ kind: 'warn' })).toBe(true);
    expect(toastClosable({ kind: 'info', sticky: true })).toBe(true);
    expect(toastClosable({ kind: 'warn', sticky: false })).toBe(false);
    expect(toastClosable({ kind: 'err' })).toBe(false);
  });
  it('出错是 alert,其余 status', () => {
    expect(toastRole('err')).toBe('alert');
    expect(toastRole('ok')).toBe('status');
    expect(toastRole()).toBe('status');
  });
});

describe('popThemeClass', () => {
  it('white → .av-day,black → .av-night,glass → .av-night.is-glass,别的当 white', () => {
    expect(popThemeClass('white')).toBe('av-day');
    expect(popThemeClass('black')).toBe('av-night');
    expect(popThemeClass('glass')).toBe('av-night is-glass');
    expect(popThemeClass('purple')).toBe('av-day');
    // 压在另一张卡上的小菜单:玻璃时用实心那档,别的主题没区别
    expect(popThemeClass('glass', true)).toBe('av-night is-glass is-solid');
    expect(popThemeClass('white', true)).toBe('av-day');
    expect(popThemeClass('black', true)).toBe('av-night');
    expect(popThemeClass(undefined)).toBe('av-day');
  });
});

describe('confirmKeyAction', () => {
  it('Esc = 留着(reason esc)', () => {
    expect(confirmKeyAction('Escape', false, 1, 2)).toEqual({ type: 'close', reason: 'esc' });
  });
  it('Tab 只在两个按钮之间转', () => {
    expect(confirmKeyAction('Tab', false, 0, 2)).toEqual({ type: 'focus', index: 1 });
    expect(confirmKeyAction('Tab', false, 1, 2)).toEqual({ type: 'focus', index: 0 });
    expect(confirmKeyAction('Tab', true, 0, 2)).toEqual({ type: 'focus', index: 1 });
    expect(confirmKeyAction('Tab', true, 1, 2)).toEqual({ type: 'focus', index: 0 });
  });
  it('焦点不在按钮上时 Tab 进第一个、Shift+Tab 进最后一个', () => {
    expect(confirmKeyAction('Tab', false, -1, 2)).toEqual({ type: 'focus', index: 0 });
    expect(confirmKeyAction('Tab', true, -1, 2)).toEqual({ type: 'focus', index: 1 });
  });
  it('回车、空格不拦(默认焦点在「留着」,按下去就是留着)', () => {
    expect(confirmKeyAction('Enter', false, 1, 2)).toBeNull();
    expect(confirmKeyAction(' ', false, 1, 2)).toBeNull();
  });
});

describe('毛玻璃对齐', () => {
  it('偏移是沿 offsetParent 一路加起来', () => {
    expect(frostOffset([{ offsetLeft: 10, offsetTop: 20 }, { offsetLeft: 5, offsetTop: 7 }])).toEqual({ x: 15, y: 27 });
    expect(frostOffset([])).toEqual({ x: 0, y: 0 });
  });
  it('背景图按画面根大小铺,再往左上挪回框的位置', () => {
    expect(frostImgStyle({ w: 1440, h: 810 }, { x: 15, y: 27 })).toEqual({ width: 1440, height: 810, left: -15, top: -27 });
  });
});

describe('hereOutside(删存档就地确认收到按下)', () => {
  it('在确认框里的不管', () => {
    expect(hereOutside(true, true)).toBe('ignore');
  });
  it('在这一格别处 / 别的格子上:收起并吞掉点击(不读档)', () => {
    expect(hereOutside(false, true)).toBe('close-swallow');
  });
  it('在存档页以外:只收起', () => {
    expect(hereOutside(false, false)).toBe('close');
  });
});

describe('placeMenu', () => {
  const size = { w: 176, h: 92 };
  const bounds = { w: 1000, h: 600 };
  it('放得下就贴着光标', () => {
    expect(placeMenu({ x: 300, y: 200 }, size, bounds)).toEqual({ left: 300, top: 200 });
  });
  it('右边、下边放不下就往回挪,留 8', () => {
    expect(placeMenu({ x: 990, y: 590 }, size, bounds)).toEqual({ left: 816, top: 500 });
  });
  it('光标在左上角外也不出界', () => {
    expect(placeMenu({ x: -5, y: 0 }, size, bounds)).toEqual({ left: 8, top: 8 });
  });
});
