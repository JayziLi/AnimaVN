import { describe, expect, it } from 'vitest';
import {
  bindingWith,
  bindChanges,
  boundLabel,
  deleteNotes,
  duplicateGroups,
  dupeIds,
  filterChips,
  filterItems,
  formatSize,
  headerSummary,
  itemSub,
  jobSummary,
  sortItems,
  storageSummary,
  type LibraryItem,
} from './libraryModel';

const MB = 1_000_000;

let seq = 0;
function item(name: string, over: Partial<LibraryItem> = {}): LibraryItem {
  seq += 1;
  return {
    id: over.id ?? `p${seq}`,
    name,
    count: 10,
    bytes: 10 * MB,
    card_ids: [],
    cover_sha: null,
    content_key: null,
    import_job_id: null,
    created_at: `2026-10-0${(seq % 9) + 1}T08:00:00`,
    updated_at: '2026-10-10T08:00:00',
    ...over,
  };
}

const names = (list: readonly LibraryItem[]) => list.map((i) => i.name);

describe('sortItems', () => {
  const list = [
    item('星绘', { bytes: 15 * MB, created_at: '2026-10-05T10:00:00' }),
    item('刻晴 · 玉衡星', { bytes: 21 * MB, created_at: '2026-10-01T10:00:00' }),
    item('鲸鱼娘 · 女仆', { bytes: 18 * MB, created_at: '2026-10-12T10:00:00' }),
    item('Wikira', { bytes: 10 * MB, created_at: '2026-10-12T09:00:00' }),
  ];

  it('by size: biggest first, without touching the input', () => {
    const before = names(list);
    expect(names(sortItems(list, 'size'))).toEqual(['刻晴 · 玉衡星', '鲸鱼娘 · 女仆', '星绘', 'Wikira']);
    expect(names(list)).toEqual(before);
  });

  it('by size: same size falls back to the name', () => {
    const same = [item('b', { bytes: MB }), item('a', { bytes: MB })];
    expect(names(sortItems(same, 'size'))).toEqual(['a', 'b']);
  });

  it('by name: Chinese by pinyin, numbers in natural order, case ignored', () => {
    expect(names(sortItems([item('星绘'), item('刻晴'), item('爱丽丝')], 'name'))).toEqual(['爱丽丝', '刻晴', '星绘']);
    expect(names(sortItems([item('包 10'), item('包 2')], 'name'))).toEqual(['包 2', '包 10']);
    expect(names(sortItems([item('bob'), item('alice 2'), item('Alice')], 'name'))).toEqual(['Alice', 'alice 2', 'bob']);
  });

  it('by recent: newest first, times without a time zone read as UTC', () => {
    expect(names(sortItems(list, 'recent'))).toEqual(['鲸鱼娘 · 女仆', 'Wikira', '星绘', '刻晴 · 玉衡星']);
    const mixed = [item('old', { created_at: '2026-10-12T09:00:00' }), item('new', { created_at: '2026-10-12T10:00:00+00:00' })];
    expect(names(sortItems(mixed, 'recent'))).toEqual(['new', 'old']);
  });
});

describe('filterItems', () => {
  const a = item('刻晴 · 玉衡星', { card_ids: ['c1'], content_key: 'k1' });
  const b = item('刻晴 · 玉衡星 副本', { content_key: 'k1' });
  const c = item('星绘', { card_ids: ['c2', 'c3'], content_key: 'k2' });
  const d = item('AI 生图 · 星绘', { generated: true, card_ids: ['c2'] });
  const all = [a, b, c, d];

  it('all / bound / unbound', () => {
    expect(filterItems(all, 'all', '')).toEqual(all);
    expect(names(filterItems(all, 'bound', ''))).toEqual(['刻晴 · 玉衡星', '星绘', 'AI 生图 · 星绘']);
    expect(names(filterItems(all, 'unbound', ''))).toEqual(['刻晴 · 玉衡星 副本']);
  });

  it('dupes: every pack that shares its files with another', () => {
    expect(names(filterItems(all, 'dupes', ''))).toEqual(['刻晴 · 玉衡星', '刻晴 · 玉衡星 副本']);
  });

  it('generated / imported (CG)', () => {
    expect(names(filterItems(all, 'generated', ''))).toEqual(['AI 生图 · 星绘']);
    expect(names(filterItems(all, 'imported', ''))).toEqual(['刻晴 · 玉衡星', '刻晴 · 玉衡星 副本', '星绘']);
  });

  it('query: pack name, ignoring case and spaces around', () => {
    expect(names(filterItems(all, 'all', ' 副本 '))).toEqual(['刻晴 · 玉衡星 副本']);
    expect(names(filterItems([item('Alice · Uniform')], 'all', 'uni'))).toEqual(['Alice · Uniform']);
  });

  it('query: also the names of the bound cards and the expression names given', () => {
    const cardNames = new Map([
      ['c1', 'DeepSeek娘(中文)'],
      ['c2', '星庇所'],
    ]);
    expect(names(filterItems(all, 'all', 'deepseek', { cardNames }))).toEqual(['刻晴 · 玉衡星']);
    const labels = new Map([[c.id, ['微笑', '吃惊']]]);
    expect(names(filterItems(all, 'all', '吃惊', { labels }))).toEqual(['星绘']);
    // 条件一起算:未绑定的里面没有
    expect(filterItems(all, 'unbound', '吃惊', { labels })).toEqual([]);
  });
});

describe('duplicateGroups / dupeIds', () => {
  it('groups packs with the same non-empty content key, in list order', () => {
    const a = item('A', { content_key: 'x' });
    const b = item('B', { content_key: 'y' });
    const c = item('C', { content_key: 'x' });
    const d = item('D', { content_key: null });
    const e = item('E', { content_key: null });
    expect(duplicateGroups([a, b, c, d, e]).map(names)).toEqual([['A', 'C']]);
    expect([...dupeIds([a, b, c, d, e])]).toEqual([a.id, c.id]);
  });
});

describe('filterChips', () => {
  it('sprite: all / bound / unbound with counts; dupes only when there are some', () => {
    const list = [item('a', { card_ids: ['c'] }), item('b')];
    expect(filterChips('sprite', list)).toEqual([
      { key: 'all', label: '全部', count: 2 },
      { key: 'bound', label: '已绑定', count: 1 },
      { key: 'unbound', label: '未绑定', count: 1 },
    ]);
    const dup = [...list, item('c', { content_key: 'k' }), item('d', { content_key: 'k' })];
    expect(filterChips('sprite', dup).map((c) => c.key)).toEqual(['all', 'bound', 'unbound', 'dupes']);
    expect(filterChips('sprite', dup).find((c) => c.key === 'dupes')?.count).toBe(2);
  });

  it('cg: imported / AI 生成 only when there are generated packs', () => {
    const list = [item('a'), item('b', { generated: true })];
    expect(filterChips('cg', list).map((c) => c.label)).toEqual(['全部', '已绑定', '未绑定', '导入的', 'AI 生成']);
    expect(filterChips('cg', [item('a')]).map((c) => c.key)).toEqual(['all', 'bound', 'unbound']);
  });
});

describe('storageSummary', () => {
  it('total from the store, this kind counted once per duplicate group, share capped at 1', () => {
    const list = [
      item('A', { bytes: 30 * MB, content_key: 'x' }),
      item('A 副本', { bytes: 30 * MB, content_key: 'x' }),
      item('B', { bytes: 20 * MB }),
      item('C', { bytes: 10 * MB }),
    ];
    const s = storageSummary(list, { bytes: 200 * MB, files: 900, trash_bytes: 5 * MB });
    expect(s).toEqual({ total: 200 * MB, files: 900, kindBytes: 60 * MB, share: 0.3, dupes: 2, trash: 5 * MB });
    expect(storageSummary(list, { bytes: 40 * MB, files: 1, trash_bytes: 0 }).share).toBe(1);
  });

  it('without the store status: no total, share 0', () => {
    const s = storageSummary([item('A', { bytes: MB })], null);
    expect(s.total).toBeNull();
    expect(s.share).toBe(0);
    expect(s.kindBytes).toBe(MB);
  });
});

describe('formatSize', () => {
  it('MB like the data page (1 MB = 1,000,000 bytes), whole numbers from 10 MB', () => {
    expect(formatSize(0)).toBe('0 MB');
    expect(formatSize(20_000)).toBe('<0.1 MB');
    expect(formatSize(400_000)).toBe('0.4 MB');
    expect(formatSize(3_000_000)).toBe('3 MB');
    expect(formatSize(3_450_000)).toBe('3.5 MB');
    expect(formatSize(17_500_000)).toBe('18 MB');
    expect(formatSize(476_200_000)).toBe('476 MB');
    expect(formatSize(1_234_000_000)).toBe('1.2 GB');
  });
});

describe('labels', () => {
  it('list row: count and size; voices have no size', () => {
    expect(itemSub('sprite', item('a', { count: 22, bytes: 58 * MB }))).toBe('22 张 · 58 MB');
    expect(itemSub('bgm', item('a', { count: 8, bytes: 40 * MB }))).toBe('8 首 · 40 MB');
    expect(itemSub('voice', item('a', { count: 12, bytes: 0 }))).toBe('12 种情绪');
  });

  it('bound label', () => {
    expect(boundLabel(item('a', { card_ids: ['x', 'y'] }))).toBe('2 张卡');
    expect(boundLabel(item('a'))).toBe('未绑定');
  });

  it('header: count with the long unit and size', () => {
    expect(headerSummary('sprite', item('a', { count: 16, bytes: 17.5 * MB }))).toBe('16 张差分 · 18 MB');
    expect(headerSummary('bg', item('a', { count: 12, bytes: 9 * MB }))).toBe('12 张背景 · 9 MB');
    expect(headerSummary('cg', item('a', { count: 4, bytes: 9 * MB }))).toBe('4 张 CG · 9 MB');
    expect(headerSummary('voice', item('a', { count: 9, bytes: 0 }))).toBe('9 种情绪');
  });
});

describe('bindingWith', () => {
  it('sprite / cg: add at the end once, remove', () => {
    expect(bindingWith('sprite', ['a'], 'b', true)).toEqual(['a', 'b']);
    expect(bindingWith('sprite', ['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    expect(bindingWith('cg', ['a', 'b'], 'a', false)).toEqual(['b']);
  });

  it('bg / bgm: only that side', () => {
    expect(bindingWith('bg', { bg: ['a'], bgm: ['a'] }, 'b', true)).toEqual({ bg: ['a', 'b'], bgm: ['a'] });
    expect(bindingWith('bgm', { bg: ['a'], bgm: ['a', 'b'] }, 'a', false)).toEqual({ bg: ['a'], bgm: ['b'] });
  });

  it('voice: main if the card has none, otherwise a backup; removing the main leaves no main', () => {
    expect(bindingWith('voice', { main: null, extras: ['x'] }, 'v', true)).toEqual({ main: 'v', extras: ['x'] });
    expect(bindingWith('voice', { main: 'm', extras: [] }, 'v', true)).toEqual({ main: 'm', extras: ['v'] });
    expect(bindingWith('voice', { main: 'm', extras: ['v'] }, 'v', true)).toEqual({ main: 'm', extras: ['v'] });
    expect(bindingWith('voice', { main: 'v', extras: ['x'] }, 'v', false)).toEqual({ main: null, extras: ['x'] });
    expect(bindingWith('voice', { main: 'm', extras: ['v', 'x'] }, 'v', false)).toEqual({ main: 'm', extras: ['x'] });
  });
});

describe('bindChanges', () => {
  it('cards to add and to remove, in the order of the card list', () => {
    expect(bindChanges(['c1', 'c2', 'c3', 'c4'], ['c2', 'c3'], new Set(['c1', 'c3']))).toEqual({
      add: ['c1'],
      remove: ['c2'],
    });
  });
});

describe('deleteNotes', () => {
  it('sprite: images and size; a duplicate frees nothing', () => {
    const usage = { cards: [], files: 14, bytes: 21 * MB, by_kind: { sprite: { files: 14, bytes: 21 * MB } }, other_kinds: [] };
    expect(deleteNotes('sprite', usage, [])).toEqual(['14 张图、21 MB 会一起删掉,删了就找不回来。']);
    expect(deleteNotes('sprite', usage, ['刻晴 · 玉衡星'])).toEqual([
      '14 张图会一起删掉,删了就找不回来。',
      '图和「刻晴 · 玉衡星」是同一份文件,删了不会腾出空间。',
    ]);
  });

  it('background tab: the whole scene pack goes, music too', () => {
    const usage = {
      cards: [],
      files: 20,
      bytes: 50 * MB,
      by_kind: { bg: { files: 12, bytes: 20 * MB }, bgm: { files: 8, bytes: 30 * MB } },
      other_kinds: ['bgm'],
    };
    expect(deleteNotes('bg', usage, [])).toEqual([
      '12 张背景、20 MB 会一起删掉,删了就找不回来。',
      '背景和 BGM 在同一个场景包里:包里的 8 首曲子(30 MB)也会一起删掉。',
    ]);
    const cg = { ...usage, by_kind: { ...usage.by_kind, cg: { files: 3, bytes: MB } }, other_kinds: ['bgm', 'cg'] };
    expect(deleteNotes('bgm', { ...cg, other_kinds: ['bg', 'cg'] }, [])[1]).toBe(
      '背景和 BGM 在同一个场景包里:包里的 12 张背景(20 MB)、3 张 CG(1 MB)也会一起删掉。',
    );
  });

  it('voice: the emotion settings, not the reference audio', () => {
    const usage = { cards: [], files: 9, bytes: 0, by_kind: {}, other_kinds: [] };
    expect(deleteNotes('voice', usage, [])).toEqual([
      '9 种情绪的设置会一起删掉,删了就找不回来(参考音频在语音机上,不会删)。',
    ]);
  });

  it('an empty pack', () => {
    const usage = { cards: [], files: 0, bytes: 0, by_kind: {}, other_kinds: [] };
    expect(deleteNotes('cg', usage, [])).toEqual(['包里还没有东西。']);
  });
});

describe('jobSummary', () => {
  it('lists what the import made, skipping zeros', () => {
    expect(
      jobSummary({ cards: 1, sprite_packs: 2, scene_packs: 1, cg_packs: 0, bound: 3, updated_cards: 1, unknown: 2 }),
    ).toBe('1 张卡 · 2 套立绘 · 1 个场景包 · 绑定 3 处 · 改了 1 张卡的资料 · 2 个文件没认出来');
    expect(
      jobSummary({ cards: 0, sprite_packs: 0, scene_packs: 0, cg_packs: 1, bound: 0, updated_cards: 0, unknown: 0 }),
    ).toBe('1 个 CG 包');
    expect(
      jobSummary({ cards: 0, sprite_packs: 0, scene_packs: 0, cg_packs: 0, bound: 0, updated_cards: 0, unknown: 0 }),
    ).toBe('没有新建东西');
  });
});
