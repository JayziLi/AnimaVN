import { describe, expect, it } from 'vitest';
import { loadingWhat, slowHold, SLOW_CAP } from './loadingLogic';
import { skyShapes } from './loadingSky';
import { LOAD_TIPS, nextTip, tipsFor } from './loadingTips';

describe('slowHold:网络慢时进度停在六成', () => {
  it('平时跟着真实进度走,只增不减', () => {
    expect(slowHold(0, 0.3, false)).toBe(0.3);
    expect(slowHold(0.5, 0.3, false)).toBe(0.5);
    expect(slowHold(0.5, 1.4, false)).toBe(1);
  });
  it('慢了最多走到六成', () => {
    expect(slowHold(0.4, 0.9, true)).toBe(SLOW_CAP);
    expect(slowHold(0, 0.3, true)).toBe(0.3);
  });
  it('已经走过六成的不往回缩', () => {
    expect(slowHold(0.8, 0.85, true)).toBe(0.8);
  });
});

describe('loadingWhat:右下「正在载入 · 名字 · 场景包」', () => {
  it('场景包名里本来带点的拆开', () => {
    expect(loadingWhat('星绘', '同居日常 · 星庇所')).toEqual(['正在载入', '星绘', '同居日常', '星庇所']);
  });
  it('没有场景包只写名字;不写作品名', () => {
    expect(loadingWhat('测试角色', null)).toEqual(['正在载入', '测试角色']);
    expect(loadingWhat('  ', undefined)).toEqual(['正在载入']);
  });
});

describe('小贴士', () => {
  it('电脑 8 条轮换,手机不出电脑专用的', () => {
    expect(tipsFor(false)).toHaveLength(8);
    expect(tipsFor(true).every((t) => !t.pc)).toBe(true);
    expect(tipsFor(false).every((t) => !t.phone)).toBe(true);
  });
  it('每条一句话、不长;不提已经没有的功能', () => {
    for (const t of LOAD_TIPS) {
      expect(t.t.length).toBeLessThanOrEqual(26);
      expect(t.t).not.toMatch(/右上角的语音|语音标签|封面样式|海报|电影/);
    }
  });
  it('每出一次换下一条,绕一圈回来', () => {
    const n = tipsFor(false).length;
    const seen = Array.from({ length: n }, () => nextTip(false));
    expect(new Set(seen).size).toBe(n);
    expect(nextTip(false)).toBe(seen[0]);
  });
});

describe('右上角的装饰', () => {
  it('固定种子:两次画出来一模一样', () => {
    expect(skyShapes(false)).toEqual(skyShapes(false));
    expect(skyShapes(true)).toEqual(skyShapes(true));
  });
  it('电脑 1440×810、手机 390×844;小星点数量照设计稿(14 / 10)', () => {
    const d = skyShapes(false);
    const p = skyShapes(true);
    expect([d.w, d.h, d.dots.length]).toEqual([1440, 810, 14]);
    expect([p.w, p.h, p.dots.length]).toEqual([390, 844, 10]);
    // 点都落在设计稿给的那块区域里
    expect(d.dots.every((s) => s.cx >= 640 && s.cx <= 1400 && s.cy >= 10 && s.cy <= 190)).toBe(true);
  });
  it('轨道上那颗小点在实线上(离圆心刚好一个半径)', () => {
    const { orbit: o } = skyShapes(false);
    expect(Math.hypot(o.px - o.cx, o.py - o.cy)).toBeCloseTo(o.r, 0);
  });
});
