import { describe, expect, it } from 'vitest';
import { isNightLabel, pickBannerScene, type BannerScene } from './banner';

const sc = (label: string): BannerScene => ({ label, src: `/img/${label}.webp` });

describe('设置页横幅挑哪张场景', () => {
  const pack = [sc('夜路'), sc('客厅'), sc('书桌'), sc('星空'), sc('客厅夜')];

  it('认夜景:名字里带夜 / 星空', () => {
    expect(isNightLabel('夜路')).toBe(true);
    expect(isNightLabel('星空')).toBe(true);
    expect(isNightLabel('客厅夜')).toBe(true);
    expect(isNightLabel('书桌')).toBe(false);
  });

  it('她在白天的场景:挑另一张白天的;在夜里的场景:挑另一张夜景', () => {
    expect(pickBannerScene(pack, '客厅')?.label).toBe('书桌');
    expect(pickBannerScene(pack, '夜路')?.label).toBe('星空');
  });

  it('不和现在这张重复', () => {
    for (const s of pack) expect(pickBannerScene(pack, s.label)?.label).not.toBe(s.label);
  });

  it('昼夜一样的没有时,换成别的一张', () => {
    expect(pickBannerScene([sc('客厅'), sc('夜路')], '客厅')?.label).toBe('夜路');
  });

  it('包里只有一张就用它;一张都没有不放横幅;现在的场景不在包里取第一张昼夜对的', () => {
    expect(pickBannerScene([sc('客厅')], '客厅')?.label).toBe('客厅');
    expect(pickBannerScene([], '客厅')).toBeNull();
    expect(pickBannerScene(pack, null)?.label).toBe('客厅');
    expect(pickBannerScene(pack, '不存在的场景')?.label).toBe('客厅');
  });
});
