import { describe, expect, it } from 'vitest';
import { along, behindLetters, TRAIL } from './splashTrail';

describe('along', () => {
  it('从起点走到星', () => {
    expect(along(0)).toEqual(TRAIL.line[0]);
    expect(along(1)).toEqual(TRAIL.line[TRAIL.line.length - 1]);
  });

  it('越走越往右下', () => {
    const xs = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => along(f)[0]);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(along(0.9)[1]).toBeGreaterThan(along(0.1)[1]);
  });
});

describe('behindLetters', () => {
  it('露着的几段不藏,段与段之间藏', () => {
    for (const [a, b] of TRAIL.visible) expect(behindLetters((a + b) / 2)).toBe(false);
    for (let i = 1; i < TRAIL.visible.length; i++) {
      const gap = (TRAIL.visible[i - 1][1] + TRAIL.visible[i][0]) / 2;
      expect(behindLetters(gap)).toBe(true);
    }
  });

  it('星在最后一段的右边', () => {
    expect(TRAIL.star[0]).toBeGreaterThan(TRAIL.visible[TRAIL.visible.length - 1][1]);
  });
});
