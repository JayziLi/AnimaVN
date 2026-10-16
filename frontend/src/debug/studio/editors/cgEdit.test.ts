import { describe, expect, it } from 'vitest';
import type { SceneAsset } from '../../lib/api';
import {
  cgCounts,
  cgNarration,
  cgPackSub,
  coverOf,
  freeEmotions,
  generatedBoundCount,
  groupCgs,
  importedCgPackIds,
  orderCgs,
  replaceRows,
  resolvePick,
  stageFrameOf,
  takenNames,
  variantCountLabel,
  variantPromptLabel,
  variantReachable,
  withoutCg,
} from './cgEdit';

const cg = (id: string, over: Partial<SceneAsset> = {}): SceneAsset => ({
  id,
  pack_id: 'p',
  kind: 'cg',
  label: id,
  aliases: [],
  description: '',
  has_file: true,
  mime: 'image/png',
  size: 1,
  file_version: 0,
  focus_x: 50,
  bgm_id: null,
  sort: 0,
  enabled: true,
  parent_id: null,
  source: 'cg',
  ...over,
});
const variant = (id: string, parent: string, over: Partial<SceneAsset> = {}) => cg(id, { parent_id: parent, ...over });
const ids = (list: readonly { id: string }[]) => list.map((a) => a.id);

// 后端的顺序:按 sort,构图和差分混着
const LIST = [cg('rain'), variant('rain-smile', 'rain', { label: '微笑' }), cg('beach'), variant('rain-shy', 'rain', { label: '害羞', aliases: ['脸红'] }), cg('night')];

describe('importedCgPackIds', () => {
  const packs = [
    { id: 'a', generated: false },
    { id: 'ai', generated: true },
    { id: 'b', generated: false },
  ];

  it('keeps the bound imported packs in binding order and leaves AI-generated ones to their own tab', () => {
    expect(importedCgPackIds(['b', 'ai', 'a'], packs)).toEqual(['b', 'a']);
    expect(generatedBoundCount(['b', 'ai', 'a'], packs)).toBe(1);
  });

  it('only shows packs missing from the list when this tab just created them', () => {
    expect(importedCgPackIds(['a', 'new', 'gone'], packs)).toEqual(['a']);
    expect(importedCgPackIds(['a', 'new', 'gone'], packs, new Set(['new']))).toEqual(['a', 'new']);
    expect(generatedBoundCount(['new'], packs)).toBe(0);
  });
});

describe('groupCgs / cgCounts', () => {
  it('lists compositions in list order, each with its own variants', () => {
    const groups = groupCgs(LIST);
    expect(groups.map((g) => g.cg.id)).toEqual(['rain', 'beach', 'night']);
    expect(ids(groups[0].variants)).toEqual(['rain-smile', 'rain-shy']);
    expect(groups[1].variants).toEqual([]);
  });

  it('counts compositions and variants apart', () => {
    expect(cgCounts(LIST)).toEqual({ cgs: 3, variants: 2 });
    expect(cgPackSub(cgCounts(LIST))).toBe('3 个构图 · 2 张差分');
    expect(cgPackSub({ cgs: 4, variants: 0 })).toBe('4 个构图');
    expect(variantCountLabel(3)).toBe('3 张差分');
    expect(variantCountLabel(0)).toBe('没有差分');
  });
});

describe('coverOf', () => {
  it('is the first enabled composition with a picture, never a variant', () => {
    expect(coverOf([variant('v', 'x'), cg('x', { has_file: false }), cg('off', { enabled: false }), cg('ok')])?.id).toBe('ok');
    expect(coverOf([cg('off', { enabled: false })])?.id).toBe('off');
    expect(coverOf([cg('x', { has_file: false })])).toBeNull();
  });
});

describe('resolvePick / stageFrameOf', () => {
  it('finds the picked composition and variant', () => {
    const got = resolvePick(LIST, { cgId: 'rain', variantId: 'rain-shy' });
    expect(got?.cg.id).toBe('rain');
    expect(got?.variant?.id).toBe('rain-shy');
    expect(stageFrameOf(LIST, got!.cg, got!.variant).id).toBe('rain-shy');
  });

  it('falls back to the first composition, and to the composition itself when the variant is gone', () => {
    expect(resolvePick(LIST, null)?.cg.id).toBe('rain');
    expect(resolvePick(LIST, { cgId: 'deleted', variantId: 'rain-shy' })).toEqual({ cg: LIST[0], variant: null });
    expect(resolvePick(LIST, { cgId: 'beach', variantId: 'rain-shy' })).toEqual({ cg: LIST[2], variant: null });
    expect(resolvePick(LIST, { cgId: 'rain', variantId: 'deleted' })).toEqual({ cg: LIST[0], variant: null });
    expect(resolvePick([variant('v', 'x')], null)).toBeNull();
  });

  it('shows the first variant with a picture when the composition has none (like the game)', () => {
    const list = [cg('c', { has_file: false }), variant('v1', 'c', { has_file: false }), variant('v2', 'c')];
    expect(stageFrameOf(list, list[0], null).id).toBe('v2');
    expect(stageFrameOf(LIST, LIST[0], null).id).toBe('rain');
  });
});

describe('cgNarration', () => {
  it('uses the first part of the description, without a short heading', () => {
    expect(cgNarration(cg('c', { description: '场面:雨夜的车站,两人共撑一把伞|在做什么:等末班车|不算:白天' }))).toBe(
      '雨夜的车站,两人共撑一把伞',
    );
    expect(cgNarration(cg('c', { description: '\n  星空下,她侧头靠在你的肩上。\n第二行' }))).toBe('星空下,她侧头靠在你的肩上。');
    // 冒号前太长的不是小标题
    expect(cgNarration(cg('c', { description: '那天放学后我们一起去了海边:风很大' }))).toBe('那天放学后我们一起去了海边:风很大');
  });

  it('falls back to the name and cuts long text with an ellipsis', () => {
    expect(cgNarration(cg('海边的约定', { description: '  ' }))).toBe('海边的约定');
    expect(cgNarration(cg('c', { description: '场面: | 第二段' }))).toBe('第二段');
    const long = '一'.repeat(60);
    expect(cgNarration(cg('c', { description: long }))).toBe(`${'一'.repeat(39)}…`);
    expect(cgNarration(cg('c', { description: long }), 10)).toHaveLength(10);
  });
});

describe('orderCgs / replaceRows / withoutCg', () => {
  it('puts compositions in the new order with their variants right behind', () => {
    expect(ids(orderCgs(LIST, ['night', 'rain', 'beach']))).toEqual(['night', 'rain', 'rain-smile', 'rain-shy', 'beach']);
  });

  it('never drops a composition missing from the ids', () => {
    expect(ids(orderCgs(LIST, ['beach']))).toEqual(['beach', 'rain', 'rain-smile', 'rain-shy', 'night']);
  });

  it('swaps in rows from the server by id', () => {
    const next = replaceRows(LIST, [cg('beach', { sort: 9 }), cg('stranger')]);
    expect(next.find((a) => a.id === 'beach')?.sort).toBe(9);
    expect(ids(next)).toEqual(ids(LIST));
  });

  it('removes a composition together with its variants', () => {
    expect(ids(withoutCg(LIST, 'rain'))).toEqual(['beach', 'night']);
    expect(ids(withoutCg(LIST, 'rain-shy'))).toEqual(['rain', 'rain-smile', 'beach', 'night']);
  });
});

describe('variants against the outfit', () => {
  const emotions = ['微笑', '害羞', '生气', '难过'];

  it('a variant is reachable when an outfit expression matches its name or alias', () => {
    expect(variantReachable({ label: '微笑', aliases: [] }, emotions)).toBe(true);
    expect(variantReachable({ label: 'blush', aliases: ['害羞'] }, emotions)).toBe(true);
    expect(variantReachable({ label: '得意', aliases: [] }, emotions)).toBe(false);
    // 不知道差分名:不提示
    expect(variantReachable({ label: '得意', aliases: [] }, [])).toBe(true);
  });

  it('lists expressions that have no variant yet, in outfit order', () => {
    expect(freeEmotions(emotions, [{ label: '微笑', aliases: [] }, { label: 'x', aliases: ['生气'] }])).toEqual(['害羞', '难过']);
    expect(variantPromptLabel(['害羞', '难过'])).toBe('表情名(还没配差分的:害羞、难过)');
    expect(variantPromptLabel(['1', '2', '3', '4', '5', '6', '7'])).toBe('表情名(还没配差分的:1、2、3、4、5、6 等 7 个)');
    expect(variantPromptLabel([])).toContain('和立绘的差分名一样');
  });
});

describe('takenNames', () => {
  it('compares compositions with compositions and variants within one composition (like the backend)', () => {
    expect(takenNames(LIST, null)).toEqual(new Set(['rain', 'beach', 'night']));
    expect(takenNames(LIST, 'rain')).toEqual(new Set(['微笑', '害羞', '脸红']));
    expect(takenNames(LIST, 'beach')).toEqual(new Set());
  });
});
