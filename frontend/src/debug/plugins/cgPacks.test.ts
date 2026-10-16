import { describe, expect, it } from 'vitest';
import type { SceneAsset } from '../lib/api';
import { mergeSceneAssets } from './cgPacks';

const asset = (id: string, kind: SceneAsset['kind'], over: Partial<SceneAsset> = {}): SceneAsset => ({
  id,
  pack_id: 'p',
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

describe('mergeSceneAssets', () => {
  const scene = [asset('bg1', 'bg'), asset('m1', 'bgm'), asset('cg-old', 'cg')];

  it('takes CG from the bound CG packs once the scene pack has been split', () => {
    const a = [asset('c1', 'cg', { source: 'cg' }), asset('c1v', 'cg', { source: 'cg', parent_id: 'c1' })];
    const b = [asset('c2', 'cg', { source: 'cg' })];
    expect(mergeSceneAssets(scene, { cg_pack_id: 'x' }, [a, b]).map((r) => r.id)).toEqual(['bg1', 'm1', 'c1', 'c1v', 'c2']);
    // 没绑 CG 包:拆过的场景包也不出 CG(Wikira 借星庇所当背景的情形)
    expect(mergeSceneAssets(scene, { cg_pack_id: 'x' }, []).map((r) => r.id)).toEqual(['bg1', 'm1']);
  });

  it('keeps the scene pack CG when it was never split (old backend or old database)', () => {
    expect(mergeSceneAssets(scene, null, []).map((r) => r.id)).toEqual(['bg1', 'm1', 'cg-old']);
    expect(mergeSceneAssets(scene, { cg_pack_id: null }, [[asset('c9', 'cg')]]).map((r) => r.id)).toEqual([
      'bg1',
      'm1',
      'cg-old',
      'c9',
    ]);
  });
});
