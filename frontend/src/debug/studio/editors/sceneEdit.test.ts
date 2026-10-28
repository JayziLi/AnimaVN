import { describe, expect, it } from 'vitest';
import type { SceneAsset } from '../../lib/api';
import {
  FOREIGN_BGM_LABEL,
  NO_BGM_LABEL,
  bgmChoicesOf,
  bgmTag,
  bindSide,
  clearBgmRefs,
  coverTrack,
  defaultBgmOptions,
  defaultBgmUsers,
  formatDuration,
  sharedDeleteNote,
  sideCount,
  replaceSide,
  unbindSide,
  withKindOrder,
} from './sceneEdit';

const asset = (id: string, kind: SceneAsset['kind'], over: Partial<SceneAsset> = {}): SceneAsset => ({
  id,
  pack_id: 'A',
  kind,
  label: id,
  aliases: [],
  description: '',
  has_file: true,
  mime: kind === 'bgm' ? 'audio/mpeg' : 'image/png',
  size: 1,
  file_version: 0,
  focus_x: 50,
  bgm_id: null,
  sort: 0,
  enabled: true,
  ...over,
});

// 两个包:A 有背景和曲子,B 只有曲子
const listA = [
  asset('a-bg1', 'bg', { label: '房间', bgm_id: 'a-m1' }),
  asset('a-bg2', 'bg', { label: '茶馆', bgm_id: 'b-m1' }),
  asset('a-m1', 'bgm', { label: '日常' }),
  asset('a-m2', 'bgm', { label: '伤感', enabled: false }),
  asset('a-cg', 'cg'),
];
const listB = [
  asset('b-bg', 'bg', { pack_id: 'B', label: '港口', bgm_id: 'b-m1' }),
  asset('b-m1', 'bgm', { pack_id: 'B', label: '甜蜜' }),
];
const packs = [
  { id: 'A', name: '原神 · 璃月' },
  { id: 'B', name: '原神 · 节日' },
];
const lists = { A: listA, B: listB };

describe('formatDuration', () => {
  it('is m:ss under an hour and h:mm:ss above, rounded to the second', () => {
    expect(formatDuration(0.4)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(125.6)).toBe('2:06');
    expect(formatDuration(600)).toBe('10:00');
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('is empty until the player knows the length', () => {
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
    expect(formatDuration(Infinity)).toBe('');
    expect(formatDuration(-1)).toBe('');
  });
});

describe('bgmChoicesOf', () => {
  it('lists the tracks of every BGM pack in binding order, with the pack name', () => {
    const choices = bgmChoicesOf(['B', 'A'], packs, lists);
    expect(choices.map((c) => [c.asset.id, c.packName])).toEqual([
      ['b-m1', '原神 · 节日'],
      ['a-m1', '原神 · 璃月'],
      ['a-m2', '原神 · 璃月'],
    ]);
  });

  it('skips packs whose list is not read yet and names unknown packs with an ellipsis', () => {
    expect(bgmChoicesOf(['A', 'C'], packs, { A: listA }).map((c) => c.asset.id)).toEqual(['a-m1', 'a-m2']);
    expect(bgmChoicesOf(['C'], [], { C: [asset('c-m', 'bgm', { pack_id: 'C' })] })[0].packName).toBe('…');
  });

  it('lists a track once even when two bound packs report it', () => {
    expect(bgmChoicesOf(['A', 'A'], packs, lists).map((c) => c.asset.id)).toEqual(['a-m1', 'a-m2']);
  });
});

describe('defaultBgmOptions', () => {
  const choices = bgmChoicesOf(['A', 'B'], packs, lists);

  it('starts with 不换 and lists every bound track with its pack name; a disabled one says so', () => {
    expect(defaultBgmOptions(choices, null)).toEqual([
      { value: '', label: NO_BGM_LABEL },
      { value: 'a-m1', label: '日常', sub: '原神 · 璃月' },
      { value: 'a-m2', label: '伤感(已停用)', sub: '原神 · 璃月' },
      { value: 'b-m1', label: '甜蜜', sub: '原神 · 节日' },
    ]);
  });

  it('keeps a track from a pack this card did not bind as its own option so the select can show it', () => {
    const opts = defaultBgmOptions(choices, 'z-m9');
    expect(opts).toHaveLength(5);
    expect(opts[4]).toEqual({ value: 'z-m9', label: FOREIGN_BGM_LABEL });
    // 知道曲名(比如就在这个背景自己的包里)时写在右边
    expect(defaultBgmOptions(choices, 'z-m9', '雨夜')[4]).toEqual({ value: 'z-m9', label: FOREIGN_BGM_LABEL, sub: '雨夜' });
  });

  it('does not add the foreign row when the current track is bound', () => {
    expect(defaultBgmOptions(choices, 'b-m1')).toHaveLength(4);
  });
});

describe('bgmTag', () => {
  const choices = bgmChoicesOf(['A'], packs, lists);

  it('says what plays when the game switches to this background', () => {
    expect(bgmTag(listA[0], choices)).toEqual({ state: 'ok', text: '日常', choice: choices[0] });
    expect(bgmTag(asset('x', 'bg'), choices)).toEqual({ state: 'none', text: '不换', choice: null });
  });

  it('a disabled track or one from a pack the card did not use does not play (same as the game)', () => {
    expect(bgmTag(asset('x', 'bg', { bgm_id: 'a-m2' }), choices)).toMatchObject({ state: 'off', text: '伤感' });
    expect(bgmTag(listA[1], choices)).toEqual({ state: 'foreign', text: '没用的曲子', choice: null });
  });

  it('a track without a file does not play either', () => {
    const silent = bgmChoicesOf(['A'], packs, { A: [asset('a-m1', 'bgm', { label: '日常', has_file: false })] });
    expect(bgmTag(listA[0], silent)).toMatchObject({ state: 'off', text: '日常' });
  });
});

describe('defaultBgmUsers', () => {
  it('maps each track to the backgrounds that switch to it, across packs, each background once', () => {
    const users = defaultBgmUsers([
      { packName: '原神 · 璃月', list: listA },
      { packName: '原神 · 节日', list: listB },
      // 同一个包从两个来源报上来(编辑器自己的列表 + 卡上的)
      { packName: '原神 · 节日', list: listB },
    ]);
    expect(users.get('b-m1')?.map((u) => [u.id, u.label, u.packName])).toEqual([
      ['a-bg2', '茶馆', '原神 · 璃月'],
      ['b-bg', '港口', '原神 · 节日'],
    ]);
    expect(users.get('a-m1')?.map((u) => u.id)).toEqual(['a-bg1']);
    expect(users.has('a-m2')).toBe(false);
  });
});

describe('coverTrack', () => {
  const tracks = [asset('m1', 'bgm', { enabled: false }), asset('m2', 'bgm'), asset('m3', 'bgm')];

  it('is the chosen track while it is still there and enabled', () => {
    expect(coverTrack(tracks, 'm3')).toEqual({ id: 'm3', explicit: true });
  });

  it('falls back to the first enabled track (what the title screen plays)', () => {
    expect(coverTrack(tracks, null)).toEqual({ id: 'm2', explicit: false });
    expect(coverTrack(tracks, 'm1')).toEqual({ id: 'm2', explicit: false });
    expect(coverTrack(tracks, 'gone')).toEqual({ id: 'm2', explicit: false });
    expect(coverTrack([tracks[0]], null)).toBeNull();
  });
});

describe('replaceSide', () => {
  const b = { bg: ['A', 'B'], bgm: ['A'] };

  it('swaps one side for the single pack and leaves the other side alone', () => {
    expect(replaceSide(b, 'bg', 'C')).toEqual({ bg: ['C'], bgm: ['A'] });
    expect(replaceSide(b, 'bgm', 'B')).toEqual({ bg: ['A', 'B'], bgm: ['B'] });
  });

  it('cleans up the extra packs an old card still has, even when the pick is one of them', () => {
    expect(replaceSide(b, 'bg', 'A')).toEqual({ bg: ['A'], bgm: ['A'] });
  });

  it('returns the same object when that side is already just this pack', () => {
    expect(replaceSide(b, 'bgm', 'A')).toBe(b);
  });
});

describe('bindSide / unbindSide', () => {
  const b = { bg: ['A'], bgm: ['A', 'B'] };

  it('adds a pack to one side only, at the end', () => {
    expect(bindSide(b, 'bg', 'C')).toEqual({ bg: ['A', 'C'], bgm: ['A', 'B'] });
    expect(bindSide(b, 'bgm', 'C')).toEqual({ bg: ['A'], bgm: ['A', 'B', 'C'] });
    expect(bindSide(b, 'bgm', 'B')).toBe(b);
  });

  it('removes a pack from one side, the other side keeps it', () => {
    expect(unbindSide(b, 'bg', 'A')).toEqual({ bg: [], bgm: ['A', 'B'] });
    expect(unbindSide(b, 'bgm', 'A')).toEqual({ bg: ['A'], bgm: ['B'] });
  });
});

describe('clearBgmRefs', () => {
  it('drops a deleted track from every background that used it as the default', () => {
    const next = clearBgmRefs(listB, 'b-m1');
    expect(next.find((a) => a.id === 'b-bg')?.bgm_id).toBeNull();
    expect(next).toHaveLength(listB.length);
  });

  it('returns the same list when nothing pointed at it', () => {
    expect(clearBgmRefs(listB, 'a-m1')).toBe(listB);
  });
});

describe('withKindOrder', () => {
  it('puts the reordered rows back into the slots of that kind, other kinds untouched', () => {
    const next = withKindOrder(listA, 'bg', [listA[1], listA[0]]);
    expect(next.map((a) => a.id)).toEqual(['a-bg2', 'a-bg1', 'a-m1', 'a-m2', 'a-cg']);
    expect(withKindOrder(listA, 'bgm', [listA[3], listA[2]]).map((a) => a.id)).toEqual([
      'a-bg1',
      'a-bg2',
      'a-m2',
      'a-m1',
      'a-cg',
    ]);
  });

  it('leaves the list alone when the server answer does not fit', () => {
    expect(withKindOrder(listA, 'bg', [listA[0]])).toBe(listA);
  });
});

describe('sideCount', () => {
  it('counts from the loaded list, else from the pack summary', () => {
    expect(sideCount('bg', listA, { bg_count: 9, bgm_count: 9 })).toBe(2);
    expect(sideCount('bgm', listA, { bg_count: 9, bgm_count: 9 })).toBe(2);
    expect(sideCount('bgm', undefined, { bg_count: 9, bgm_count: 7 })).toBe(7);
    expect(sideCount('bg', undefined, undefined)).toBe(0);
  });
});

describe('sharedDeleteNote', () => {
  it('warns only when other cards use the pack too', () => {
    expect(sharedDeleteNote(undefined, '张')).toBeNull();
    expect(sharedDeleteNote(1, '张')).toBeNull();
    expect(sharedDeleteNote(3, '张')).toBe('这个包被 3 张卡用,删了它们都没有这张了');
    expect(sharedDeleteNote(2, '首')).toBe('这个包被 2 张卡用,删了它们都没有这首了');
  });
});
