import { describe, expect, it } from 'vitest';
import { accentCssVars } from './accent';
import { TITLE_DEFAULT_ACCENT, VN_ACCENT_MONO, VN_ACCENT_PINK } from './fallbacks';
import { accentFromHue } from './titleArt';

const lightness = (hsl: string) => Number(/(\d+)%\)$/.exec(hsl)![1]);

describe('accentFromHue', () => {
  it('四格亮度是 72 / 36 / 13 / 94', () => {
    const a = accentFromHue(210, 0.6);
    expect(a.acc).toMatch(/^rgb\(\d+ \d+ \d+\)$/);
    expect(lightness(a.deep)).toBe(36);
    expect(lightness(a.ink)).toBe(13);
    expect(lightness(a.soft)).toBe(94);
  });

  it('soft 和 ink 同饱和度,饱和度夹在各自范围里', () => {
    const sat = (hsl: string) => Number(/ (\d+)% \d+%\)$/.exec(hsl)![1]);
    const hot = accentFromHue(30, 1);
    expect(sat(hot.soft)).toBe(sat(hot.ink));
    expect(sat(hot.soft)).toBe(50);
    expect(sat(hot.deep)).toBe(62);
    const gray = accentFromHue(30, 0);
    expect(sat(gray.soft)).toBe(30);
    expect(sat(gray.deep)).toBe(35);
  });

  it('rgb 和 acc 是同一个颜色', () => {
    const a = accentFromHue(335, 0.5);
    expect(a.acc).toBe(`rgb(${a.rgb.split(', ').join(' ')})`);
  });
});

describe('主题色兜底', () => {
  it('灰白、粉色六格齐全', () => {
    for (const v of [VN_ACCENT_MONO, VN_ACCENT_PINK]) {
      for (const k of ['accent', 'ink', 'rgb', 'deep', 'soft', 'nameInk'] as const) {
        expect(v[k]).toBeTruthy();
      }
    }
  });

  it('灰白、粉色原来的三格没变(画面不变)', () => {
    expect(VN_ACCENT_MONO).toMatchObject({ accent: '#e4e4ea', ink: '#17181f', rgb: '228, 228, 234' });
    expect(VN_ACCENT_PINK).toMatchObject({ accent: '#f4a9c4', ink: '#2b1420', rgb: '244, 169, 196' });
  });

  it('封面默认点缀色带上 soft,deep 不变', () => {
    expect(TITLE_DEFAULT_ACCENT.soft).toBe('#fbe8ef');
    expect(TITLE_DEFAULT_ACCENT.deep).toBe('hsl(335 40% 38%)');
  });
});

describe('accentCssVars', () => {
  it('写 8 个变量,--vn-accent-ink 是名牌字色', () => {
    const vars = accentCssVars({ ...VN_ACCENT_PINK, nameInk: '#fff' });
    expect(Object.keys(vars).sort()).toEqual(
      [
        '--av-acc',
        '--av-acc-deep',
        '--av-acc-ink',
        '--av-acc-soft',
        '--av-name-ink',
        '--vn-accent',
        '--vn-accent-ink',
        '--vn-accent-rgb',
      ].sort(),
    );
    expect(vars['--vn-accent-ink']).toBe('#fff');
    expect(vars['--av-name-ink']).toBe('#fff');
    expect(vars['--av-acc-ink']).toBe(VN_ACCENT_PINK.ink);
    expect(vars['--av-acc-deep']).toBe('#b0466f');
  });

  it('三种主题色里 --vn-accent-ink 都等于 ink(旧画面的值)', () => {
    for (const v of [VN_ACCENT_MONO, VN_ACCENT_PINK]) {
      expect(accentCssVars(v)['--vn-accent-ink']).toBe(v.ink);
    }
  });
});
