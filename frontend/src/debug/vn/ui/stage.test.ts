import { describe, expect, it } from 'vitest';
import { guideTop } from './Stage';

describe('guideTop', () => {
  it('虚线 = 立绘舞台起点(横屏 7%)+ faceTop 占立绘舞台高度的比例', () => {
    expect(guideTop(0)).toBeCloseTo(0.07);
    expect(guideTop(0.12)).toBeCloseTo(0.07 + 0.12 * 0.93);
    expect(guideTop(0.35)).toBeCloseTo(0.07 + 0.35 * 0.93);
  });
  it('竖屏从 11% 起,超出 0–1 的按两头算', () => {
    expect(guideTop(0.2, 'tall')).toBeCloseTo(0.11 + 0.2 * 0.89);
    expect(guideTop(-1)).toBeCloseTo(0.07);
    expect(guideTop(9)).toBeCloseTo(1);
  });
});
