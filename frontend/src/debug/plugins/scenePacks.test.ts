import { describe, expect, it } from 'vitest';
import type { SceneAsset } from '../lib/api';
import { mergeSceneAssets } from './cgPacks';
import { mergeBoundScene, sceneUnion } from './scenePacks';

const asset = (id: string, kind: SceneAsset['kind'], over: Partial<SceneAsset> = {}): SceneAsset => ({
  id,
  pack_id: 'A',
  kind,
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
  ...over,
});

// 和后端 /api/scene-packs/{id}/assets 一样按 kind, sort 排好:背景、曲子、CG(差分跟在构图后面)
const listA = [
  asset('a-bg1', 'bg'),
  asset('a-bg2', 'bg', { sort: 1, bgm_id: 'a-m1' }),
  asset('a-m1', 'bgm'),
  asset('a-m2', 'bgm', { sort: 1 }),
  asset('a-cg', 'cg'),
  asset('a-cgv', 'cg', { parent_id: 'a-cg' }),
];
const listB = [asset('b-bg', 'bg', { pack_id: 'B' }), asset('b-m1', 'bgm', { pack_id: 'B' }), asset('b-cg', 'cg', { pack_id: 'B' })];
const cgPackX = [asset('x1', 'cg', { pack_id: 'X', source: 'cg' }), asset('x1v', 'cg', { pack_id: 'X', source: 'cg', parent_id: 'x1' })];
const cgPackY = [asset('y1', 'cg', { pack_id: 'Y', source: 'cg' })];

const ids = (rows: readonly SceneAsset[]) => rows.map((r) => r.id);

describe('mergeBoundScene', () => {
  it('one pack serving both backgrounds and music equals the old single-pack merge (never split)', () => {
    const pack = { id: 'A', cg_pack_id: null };
    for (const cgLists of [[], [cgPackX], [cgPackX, cgPackY]]) {
      expect(mergeBoundScene({ bg: ['A'], bgm: ['A'] }, { A: listA }, [pack], cgLists)).toEqual(
        mergeSceneAssets(listA, pack, cgLists),
      );
    }
  });

  it('one pack serving both equals the old merge once its CG has been split into a CG pack', () => {
    const pack = { id: 'A', cg_pack_id: 'X' };
    for (const cgLists of [[], [cgPackX], [cgPackX, cgPackY]]) {
      expect(mergeBoundScene({ bg: ['A'], bgm: ['A'] }, { A: listA }, [pack], cgLists)).toEqual(
        mergeSceneAssets(listA, pack, cgLists),
      );
    }
  });

  it('a pack missing from the pack list counts as never split, like the old merge with no pack', () => {
    expect(mergeBoundScene({ bg: ['A'], bgm: ['A'] }, { A: listA }, [], [cgPackY])).toEqual(
      mergeSceneAssets(listA, null, [cgPackY]),
    );
  });

  it('backgrounds from the background packs, music from the music packs, unsplit CG from either', () => {
    const packs = [
      { id: 'A', cg_pack_id: null },
      { id: 'B', cg_pack_id: null },
    ];
    expect(ids(mergeBoundScene({ bg: ['A'], bgm: ['B'] }, { A: listA, B: listB }, packs, []))).toEqual([
      'a-bg1',
      'a-bg2',
      'b-m1',
      'a-cg',
      'a-cgv',
      'b-cg',
    ]);
  });

  it('a pack used for music only still gives its CG when never split, but not when split', () => {
    const packs = [
      { id: 'A', cg_pack_id: 'X' },
      { id: 'B', cg_pack_id: null },
    ];
    expect(ids(mergeBoundScene({ bg: ['B'], bgm: ['A'] }, { A: listA, B: listB }, packs, [cgPackX]))).toEqual([
      'b-bg',
      'a-m1',
      'a-m2',
      'b-cg',
      'x1',
      'x1v',
    ]);
  });

  it('several packs on a side go one after another in binding order', () => {
    const packs = [
      { id: 'A', cg_pack_id: 'X' },
      { id: 'B', cg_pack_id: 'Z' },
    ];
    expect(ids(mergeBoundScene({ bg: ['B', 'A'], bgm: ['A', 'B'] }, { A: listA, B: listB }, packs, []))).toEqual([
      'b-bg',
      'a-bg1',
      'a-bg2',
      'a-m1',
      'a-m2',
      'b-m1',
    ]);
  });

  it('a pack whose list has not arrived yet gives nothing', () => {
    expect(ids(mergeBoundScene({ bg: ['A', 'B'], bgm: ['A', 'B'] }, { A: listA }, [], []))).toEqual(ids(listA));
  });

  it('keeps the list order inside a pack even when kinds are interleaved', () => {
    const mixed = [asset('m', 'bgm'), asset('b2', 'bg', { sort: 1 }), asset('b1', 'bg')];
    expect(ids(mergeBoundScene({ bg: ['A'], bgm: ['A'] }, { A: mixed }, [], []))).toEqual(['b2', 'b1', 'm']);
  });

  it('nothing bound: only the CG packs', () => {
    expect(ids(mergeBoundScene({ bg: [], bgm: [] }, { A: listA }, [], [cgPackX, cgPackY]))).toEqual(['x1', 'x1v', 'y1']);
    expect(mergeBoundScene({ bg: [], bgm: [] }, {}, [], [])).toEqual([]);
  });
});

describe('sceneUnion', () => {
  it('background packs first, then the music-only packs in their order, without repeats', () => {
    expect(sceneUnion({ bg: ['A', 'B'], bgm: ['C', 'A', 'D'] })).toEqual(['A', 'B', 'C', 'D']);
    expect(sceneUnion({ bg: [], bgm: ['B'] })).toEqual(['B']);
    expect(sceneUnion({ bg: [], bgm: [] })).toEqual([]);
  });
});
