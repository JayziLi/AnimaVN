import { describe, expect, it } from 'vitest';
import type { PackSprite, SceneAsset } from '../lib/api';
import type { ChatEntry } from '../lib/chatEntry';
import {
  groupAssets,
  groupSprites,
  makeStatesLens,
  markState,
  mergeStateSwitches,
  stateAt,
  switchesFromEntries,
  type StateAssets,
} from './states';

const sprite = (id: string, label: string, pack = 'p1'): PackSprite =>
  ({ id, pack_id: pack, label, aliases: [], description: '', has_image: true, image_version: 0, sort: 0, enabled: true, face_scan: null }) as PackSprite;
const asset = (id: string, kind: SceneAsset['kind'], over: Partial<SceneAsset> = {}): SceneAsset =>
  ({ id, pack_id: 's', kind, label: id, aliases: [], description: '', has_file: true, mime: 'image/png', size: 1, file_version: 0, focus_x: 50, bgm_id: null, sort: 0, enabled: true, ...over }) as SceneAsset;
const entry = (id: string, vn?: ChatEntry['swipeInfo'][number]['vn'], swipes = 1): ChatEntry =>
  ({ id, role: 'assistant', swipes: Array(swipes).fill('x'), swipeIndex: 0, swipeInfo: vn ? [{ sendDate: '', vn }] : [] }) as unknown as ChatEntry;

const main: StateAssets = {
  card: 'kMain',
  name: '普通',
  sprites: [sprite('n1', '微笑'), sprite('n2', '害羞')],
  assets: [asset('bg1', 'bg'), asset('free', 'cg')],
};
const other: StateAssets = {
  card: 'kOther',
  name: '私服',
  sprites: [sprite('o1', '私服·微笑', 'p2'), sprite('o2', '私服·开心', 'p2')],
  assets: [asset('bg1', 'bg'), asset('free', 'cg'), asset('only', 'cg'), asset('only_v', 'cg', { parent_id: 'only' })],
};

describe('group lists', () => {
  it('puts the main state first and keeps one copy of each', () => {
    expect(groupSprites([main, other]).map((s) => s.id)).toEqual(['n1', 'n2', 'o1', 'o2']);
    expect(groupAssets([main, other]).map((a) => a.id)).toEqual(['bg1', 'free', 'only', 'only_v']);
    expect(groupAssets([])).toEqual([]);
  });
});

describe('switches', () => {
  const order = new Map([
    ['a', 0],
    ['b', 1],
  ]);
  const switches = [{ entryId: 'a', line: 2, state: '私服' }];

  it('finds the state at a position', () => {
    expect(stateAt(switches, order, 0, 1, '普通')).toBe('普通');
    expect(stateAt(switches, order, 0, 2, '普通')).toBe('私服');
    expect(stateAt(switches, order, 1, 0, '普通')).toBe('私服');
    expect(stateAt([{ entryId: 'gone', line: 0, state: '私服' }], order, 1, 0, '普通')).toBe('普通');
  });

  it('reads marks from every branch and names the cards; state marks win over legacy ones', () => {
    const entries = [entry('a', { state: [{ line: 2, card: 'kOther' }] }), entry('b', { state: [{ line: 0, card: 'deleted' }] })];
    const names = (card: string) => (card === 'kOther' ? '私服' : '普通');
    const saved = switchesFromEntries(entries, names);
    expect(saved).toEqual([
      { entryId: 'a', line: 2, state: '私服' },
      { entryId: 'b', line: 0, state: '普通' },
    ]);
    const legacy = [
      { entryId: 'a', line: 2, state: '普通' },
      { entryId: 'b', line: 5, state: '私服' },
    ];
    expect(mergeStateSwitches(saved, legacy)).toEqual([...saved, { entryId: 'b', line: 5, state: '私服' }]);
  });

  it('writes a mark into every branch, replacing one on the same line', () => {
    const e = { ...entry('a', { state: [{ line: 2, card: 'x' }], forms: [{ line: 1, form: 'h' }] }), swipes: ['1', '2'] };
    const next = markState(e, 2, 'kOther');
    expect(next.swipeInfo.map((i) => i.vn?.state)).toEqual([[{ line: 2, card: 'kOther' }], [{ line: 2, card: 'kOther' }]]);
    expect(next.swipeInfo[0].vn?.forms).toEqual([{ line: 1, form: 'h' }]);
  });
});

describe('makeStatesLens', () => {
  const order = new Map([
    ['a', 0],
    ['b', 1],
  ]);
  const lens = makeStatesLens({
    states: [main, other],
    switches: [{ entryId: 'b', line: 1, state: '私服' }],
    order,
    current: '私服',
  });

  it('gives each line its state; entries outside the chat use the current one', () => {
    expect(lens.formFor('a', 3)).toBe('普通');
    expect(lens.formFor('b', 1)).toBe('私服');
    expect(lens.formFor('elsewhere', 0)).toBe('私服');
  });

  it('keeps a label that belongs to the state, otherwise uses the state default', () => {
    expect(lens.labelIn('害羞', '普通')).toBe('害羞');
    expect(lens.labelIn('害羞', '私服')).toBe('私服·微笑');
    expect(lens.labelIn(null, '普通')).toBe('微笑');
  });

  it('lets a CG show only in states whose card has it, and closes it when switching away', () => {
    const only = asset('only', 'cg');
    expect(lens.cgOk(only, '私服')).toBe(true);
    expect(lens.cgOk(only, '普通')).toBe(false);
    expect(lens.cgOk(asset('free', 'cg'), '普通')).toBe(true);
    const back = makeStatesLens({
      states: [main, other],
      switches: [
        { entryId: 'a', line: 0, state: '私服' },
        { entryId: 'a', line: 3, state: '普通' },
      ],
      order,
      current: '普通',
    });
    expect(back.switchedAway(only, { index: 0, line: 1 }, { index: 0, line: 2 })).toBe(false);
    expect(back.switchedAway(only, { index: 0, line: 1 }, { index: 0, line: 3 })).toBe(true);
  });
});
