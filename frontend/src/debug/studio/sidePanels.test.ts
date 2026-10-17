import { describe, expect, it } from 'vitest';
import { DEFAULT_PANELS, dragWidth, fitWidths, parsePanels, PANEL_LIMITS, RAIL_WIDTH, type PanelPrefs } from './sidePanels';

const prefs = (p: Partial<PanelPrefs> = {}): PanelPrefs => ({ ...DEFAULT_PANELS, ...p });

describe('fitWidths', () => {
  it('窗口够宽:照存的宽度画', () => {
    expect(fitWidths(prefs({ left: 300, right: 400 }), 1600)).toEqual({ left: 300, right: 400 });
  });

  it('存的宽度超出上下限的先夹回去', () => {
    const { left, right } = fitWidths(prefs({ left: 50, right: 5000 }), 2400);
    expect(left).toBe(PANEL_LIMITS.left.min);
    expect(right).toBe(PANEL_LIMITS.right.max);
  });

  it('装不下:两栏按占比一起收,中间至少留 MIDDLE_MIN', () => {
    const { left, right } = fitWidths(prefs({ left: 264, right: 340 }), 1000);
    expect(left + right).toBeLessThanOrEqual(1000 - PANEL_LIMITS.middleMin);
    // 按占比收:左右的比例大致不变
    expect(left / right).toBeCloseTo(264 / 340, 1);
  });

  it('窄到收到下限也装不下:停在下限(中间就窄一点)', () => {
    const { left, right } = fitWidths(prefs({ left: 264, right: 340 }), 600);
    expect(left).toBe(PANEL_LIMITS.left.min);
    expect(right).toBe(PANEL_LIMITS.right.min);
  });

  it('收起的那栏算竖条宽,另一栏能用的地方就多了', () => {
    const both = fitWidths(prefs({ left: 400, right: 500 }), 1100);
    const leftClosed = fitWidths(prefs({ left: 400, right: 500, leftOpen: false }), 1100);
    expect(leftClosed.left).toBe(RAIL_WIDTH);
    expect(leftClosed.right).toBeGreaterThan(both.right);
    expect(leftClosed.right).toBeLessThanOrEqual(1100 - PANEL_LIMITS.middleMin - RAIL_WIDTH);
  });

  it('两栏都收起:两条竖条', () => {
    expect(fitWidths(prefs({ leftOpen: false, rightOpen: false }), 1200)).toEqual({ left: RAIL_WIDTH, right: RAIL_WIDTH });
  });
});

describe('dragWidth', () => {
  it('往里拖变宽、往外拖变窄,夹在上下限之间', () => {
    expect(dragWidth('left', 264, 40, 340, 1800)).toBe(304);
    expect(dragWidth('left', 264, -500, 340, 1800)).toBe(PANEL_LIMITS.left.min);
    expect(dragWidth('right', 340, 9999, 264, 3000)).toBe(PANEL_LIMITS.right.max);
  });

  it('拖宽不能把中间挤到 MIDDLE_MIN 以下', () => {
    // 窗口 1100、右栏 340:左栏最多 1100 - 420 - 340 = 340
    expect(dragWidth('left', 300, 200, 340, 1100)).toBe(1100 - PANEL_LIMITS.middleMin - 340);
  });

  it('本来就挤(窗口很窄)时拖不动也不会变得比下限还窄', () => {
    expect(dragWidth('left', PANEL_LIMITS.left.min, 50, 400, 700)).toBe(PANEL_LIMITS.left.min);
  });
});

describe('parsePanels', () => {
  it('读不到 / 坏了用默认', () => {
    expect(parsePanels(null)).toEqual(DEFAULT_PANELS);
    expect(parsePanels('{oops')).toEqual(DEFAULT_PANELS);
    expect(parsePanels('[1,2]')).toEqual(DEFAULT_PANELS);
  });

  it('只认对的字段,缺的用默认', () => {
    expect(parsePanels(JSON.stringify({ left: 320, rightOpen: false, junk: 1 }))).toEqual({
      ...DEFAULT_PANELS,
      left: 320,
      rightOpen: false,
    });
    expect(parsePanels(JSON.stringify({ left: 'wide', leftOpen: 'no' }))).toEqual(DEFAULT_PANELS);
  });
});
