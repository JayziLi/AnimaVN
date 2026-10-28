import { describe, expect, it } from 'vitest';
import { NEUTRAL_TONE, glassVars } from './glass';

describe('glassVars(主题 · 玻璃的颜色)', () => {
  it('场景越亮压得越深,夹在 0.60–0.84', () => {
    const a = (lum: number) => Number(glassVars({ avg: [40, 50, 90], lum })['--gl-a']);
    expect(a(0.13)).toBeCloseTo(0.614, 3); // 夜路
    expect(a(0.59)).toBeCloseTo(0.771, 3); // 客厅
    expect(a(0)).toBe(0.6);
    expect(a(1)).toBe(0.84);
  });

  it('底色按场景的色相走,亮度 10%、饱和度限在 16–40%', () => {
    const blue = glassVars({ avg: [30, 40, 120], lum: 0.2 })['--gl-base'].split(', ').map(Number);
    // 蓝的:b 最大、整体很深
    expect(blue[2]).toBeGreaterThan(blue[0]);
    expect(Math.max(...blue)).toBeLessThan(60);
    // 灰的场景也只带一点点色,不会变成纯灰黑
    const grey = glassVars({ avg: [128, 128, 128], lum: 0.5 })['--gl-base'].split(', ').map(Number);
    expect(Math.max(...grey) - Math.min(...grey)).toBeGreaterThan(3);
  });

  it('面板 / 左边条压在 veil 上再补到 total:叠起来的不透明度对得上', () => {
    const v = glassVars({ avg: [40, 50, 90], lum: 0.3 });
    const alpha = (s: string) => Number(/, ([\d.]+)\)$/.exec(s)![1]);
    const total = Number(v['--gl-a']);
    const veil = alpha(v['--gl-veil']);
    const panel = alpha(v['--gl-panel']);
    expect(1 - (1 - veil) * (1 - panel)).toBeCloseTo(total, 2);
    expect(alpha(v['--gl-rail'])).toBeGreaterThan(panel);
  });

  it('取不到场景色调(null)时用中性灰,不报错', () => {
    expect(glassVars(null)).toEqual(glassVars(NEUTRAL_TONE));
    expect(glassVars(null)['--gl-solid']).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });
});
