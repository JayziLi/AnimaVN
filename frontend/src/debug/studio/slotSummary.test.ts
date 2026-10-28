import { describe, expect, it } from 'vitest';
import { outfitOf, summarizeSlots, type SlotSummaryInput } from './slotSummary';

/** 什么都没绑的一张卡;各个用例只改自己那一栏 */
const base = (over: Partial<SlotSummaryInput> = {}): SlotSummaryInput => ({
  sprite: { packs: [], bound: [], current: null },
  voice: { profiles: [], binding: { main: null, extras: [] } },
  scene: { packs: [], binding: { bg: [], bgm: [] } },
  cg: { packs: [], bound: [] },
  ...over,
});

const rowOf = (input: SlotSummaryInput, key: string) => {
  const row = summarizeSlots(input).find((r) => r.key === key);
  if (!row) throw new Error(`no row ${key}`);
  return row;
};

const scenePacks = [
  { id: 'ly', name: '原神 · 璃月', bg_count: 16, bgm_count: 7 },
  { id: 'xs', name: '星庇所', bg_count: 5, bgm_count: 0 },
  { id: 'mu', name: '鸣潮 · BGM', bg_count: 0, bgm_count: 3 },
];

describe('summarizeSlots', () => {
  it('lists the slots in a fixed order and leaves out ai without the image cartridge', () => {
    expect(summarizeSlots(base()).map((r) => r.key)).toEqual(['sprite', 'voice', 'bg', 'bgm', 'cg']);
    expect(summarizeSlots(base()).map((r) => r.name)).toEqual(['立绘', '声音', '背景', 'BGM', 'CG']);
  });

  it('marks every unbound slot as empty', () => {
    for (const row of summarizeSlots(base())) {
      expect(row).toMatchObject({ sub: '还没有', state: 'empty' });
    }
  });

  it('sprite: outfit count and the outfit name of the current pack', () => {
    const sprite = {
      packs: [
        { id: 'a', name: '刻晴 · 玉衡星', sprite_count: 14 },
        { id: 'b', name: '刻晴 · 玉衡星(平涂)', sprite_count: 15 },
      ],
      bound: ['a', 'b'],
      current: 'a',
    };
    expect(rowOf(base({ sprite }), 'sprite')).toEqual({ key: 'sprite', name: '立绘', sub: '2 套服装 · 玉衡星', state: 'ok' });
    expect(rowOf(base({ sprite: { ...sprite, current: 'b' } }), 'sprite').sub).toBe('2 套服装 · 玉衡星(平涂)');
    // 包名没有「角色 · 服装」那一段:整个名字就是服装名
    expect(rowOf(base({ sprite: { packs: [{ id: 'x', name: '星绘', sprite_count: 14 }], bound: ['x'], current: 'x' } }), 'sprite').sub).toBe(
      '1 套服装 · 星绘',
    );
  });

  it('voice: the voice name and emotion count; leftover backup voices are not shown', () => {
    const profiles = [
      { id: 'zh', name: '刻晴(中文)', emotions: new Array(12).fill(null) },
      { id: 'ja', name: '刻晴(日语)', emotions: [null, null] },
    ];
    expect(rowOf(base({ voice: { profiles, binding: { main: 'zh', extras: [] } } }), 'voice')).toEqual({
      key: 'voice',
      name: '声音',
      sub: '刻晴(中文) · 12 种情绪',
      state: 'ok',
    });
    // 卡里存着的备用声音界面上不显示:一张卡只用一个音色
    expect(rowOf(base({ voice: { profiles, binding: { main: 'zh', extras: ['ja'] } } }), 'voice').sub).toBe(
      '刻晴(中文) · 12 种情绪',
    );
    expect(rowOf(base({ voice: { profiles, binding: { main: null, extras: ['ja'] } } }), 'voice')).toMatchObject({
      sub: '还没有',
      state: 'empty',
    });
  });

  it('background and BGM: pack names joined with 、 and the counts of their own kind', () => {
    const scene = { packs: scenePacks, binding: { bg: ['ly', 'xs'], bgm: ['ly', 'mu'] } };
    expect(rowOf(base({ scene }), 'bg')).toEqual({ key: 'bg', name: '背景', sub: '原神 · 璃月、星庇所 · 21 张', state: 'ok' });
    expect(rowOf(base({ scene }), 'bgm')).toEqual({ key: 'bgm', name: 'BGM', sub: '原神 · 璃月、鸣潮 · BGM · 10 首', state: 'ok' });
  });

  it('background and BGM are bound separately', () => {
    const scene = { packs: scenePacks, binding: { bg: [], bgm: ['mu'] } };
    expect(rowOf(base({ scene }), 'bg')).toMatchObject({ sub: '还没有', state: 'empty' });
    expect(rowOf(base({ scene }), 'bgm')).toMatchObject({ sub: '鸣潮 · BGM · 3 首', state: 'ok' });
  });

  it('counts from the loaded asset lists when there are any (the pack list is refreshed later)', () => {
    const lists = {
      ly: [
        { kind: 'bg' as const, parent_id: null },
        { kind: 'bg' as const },
        { kind: 'bgm' as const, parent_id: null },
        { kind: 'cg' as const, parent_id: null },
        { kind: 'cg' as const, parent_id: 'c1' },
      ],
    };
    const scene = { packs: scenePacks, binding: { bg: ['ly'], bgm: ['ly'] }, lists };
    expect(rowOf(base({ scene }), 'bg').sub).toBe('原神 · 璃月 · 2 张');
    expect(rowOf(base({ scene }), 'bgm').sub).toBe('原神 · 璃月 · 1 首');
  });

  it('CG: only the imported packs count; AI-generated packs belong to the ai slot', () => {
    const packs = [
      { id: 'c1', name: '爱弥斯 · CG', cg_count: 30, generated: false },
      { id: 'c2', name: '星绘 · CG', cg_count: 13 },
      { id: 'g', name: 'AI 生图 · 刻晴', cg_count: 2, generated: true },
    ];
    expect(rowOf(base({ cg: { packs, bound: ['c1', 'g', 'c2'] } }), 'cg')).toEqual({
      key: 'cg',
      name: 'CG',
      sub: '2 个包 · 43 个构图',
      state: 'ok',
    });
    expect(rowOf(base({ cg: { packs, bound: ['g', 'c1'] } }), 'cg').sub).toBe('爱弥斯 · CG · 30 个构图');
    expect(rowOf(base({ cg: { packs, bound: ['g'] } }), 'cg')).toMatchObject({ sub: '还没有', state: 'empty' });
  });

  it('ai: album size and kept count when the image cartridge is installed', () => {
    const rows = summarizeSlots(base({ ai: { name: 'AI 生成', counts: { total: 7, kept: 2 } } }));
    expect(rows.map((r) => r.key)).toEqual(['sprite', 'voice', 'bg', 'bgm', 'cg', 'ai']);
    expect(rows[5]).toEqual({ key: 'ai', name: 'AI 生成', sub: '相册 7 张 · 收藏 2', state: 'ok' });
    expect(rowOf(base({ ai: { name: 'AI 生成', counts: { total: 0, kept: 0 } } }), 'ai')).toMatchObject({
      sub: '相册还是空的',
      state: 'empty',
    });
    // 相册还没读到
    expect(rowOf(base({ ai: { name: 'AI 生成', counts: null } }), 'ai')).toMatchObject({ sub: '…', state: 'empty' });
    expect(summarizeSlots(base({ ai: null })).some((r) => r.key === 'ai')).toBe(false);
  });

  it('shows … for packs that are bound but not in the loaded lists yet', () => {
    expect(rowOf(base({ sprite: { packs: [], bound: ['a'], current: 'a' } }), 'sprite').sub).toBe('1 套服装 · …');
    expect(rowOf(base({ voice: { profiles: [], binding: { main: 'zh', extras: [] } } }), 'voice').sub).toBe('… · 0 种情绪');
  });
});

describe('outfitOf', () => {
  it('takes what comes after the character name', () => {
    expect(outfitOf('刻晴 · 玉衡星')).toBe('玉衡星');
    expect(outfitOf('纱由美・浴衣')).toBe('浴衣');
    expect(outfitOf('A · B · C')).toBe('B · C');
    expect(outfitOf('星绘')).toBe('星绘');
    expect(outfitOf('  ')).toBe('');
  });
});
