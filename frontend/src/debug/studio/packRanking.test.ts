import { describe, expect, it } from 'vitest';
import { matchesQuery, rankForCard } from './packRanking';

const packs = (...names: string[]) => names.map((name, i) => ({ id: String(i), name }));

describe('rankForCard', () => {
  it('puts packs named after the card first, keeping the order inside each group', () => {
    const ranked = rankForCard(packs('鲸鱼娘 · 女仆', '刻晴 · 玉衡星', '星绘', '刻晴 · 玉衡星(平涂)'), '刻晴');
    expect(ranked.map((r) => r.item.name)).toEqual(['刻晴 · 玉衡星', '刻晴 · 玉衡星(平涂)', '鲸鱼娘 · 女仆', '星绘']);
    expect(ranked.map((r) => r.hint)).toEqual([true, true, false, false]);
  });

  it('also counts a shared word (split by · or spaces), ignoring case', () => {
    const ranked = rankForCard(packs('其他', '爱弥斯 · 和服', 'Alice · Uniform'), '爱弥斯 B');
    expect(ranked[0].item.name).toBe('爱弥斯 · 和服');
    expect(ranked[0].hint).toBe(true);
    expect(rankForCard(packs('alice · uniform'), 'ALICE (日语)')[0].hint).toBe(true);
  });

  it('ignores one-letter words and an empty card name', () => {
    expect(rankForCard(packs('B · 什么'), '爱弥斯 B')[0].hint).toBe(false);
    expect(rankForCard(packs('刻晴'), '  ').every((r) => !r.hint)).toBe(true);
  });
});

describe('matchesQuery', () => {
  it('matches part of the name, ignoring case and spaces around', () => {
    expect(matchesQuery('刻晴 · 玉衡星', ' 玉衡 ')).toBe(true);
    expect(matchesQuery('Alice · Uniform', 'uni')).toBe(true);
    expect(matchesQuery('星绘', '刻晴')).toBe(false);
    expect(matchesQuery('星绘', '')).toBe(true);
  });
});
