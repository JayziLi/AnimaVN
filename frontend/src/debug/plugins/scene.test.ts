import { describe, expect, it } from 'vitest';
import type { SceneAsset } from '../lib/api';
import type { ChatEntry } from '../lib/chatEntry';
import {
  SCENE,
  applySceneTag,
  cgFrameFor,
  cgsOf,
  initialScene,
  isCgOff,
  sceneAtEnd,
  sceneMacros,
  sceneTagKind,
  type SceneState,
} from './scene';

let n = 0;
function asset(kind: SceneAsset['kind'], label: string, more: Partial<SceneAsset> = {}): SceneAsset {
  n += 1;
  return {
    id: `a${n}`,
    pack_id: 'p',
    kind,
    label,
    aliases: [],
    description: '',
    has_file: true,
    mime: 'image/png',
    size: 1,
    file_version: 1,
    focus_x: 50,
    bgm_id: null,
    sort: n,
    enabled: true,
    parent_id: null,
    ...more,
  };
}

const daily = asset('bgm', '日常');
const cozy = asset('bgm', '温馨');
const hut = asset('bg', '草庵', { bgm_id: daily.id });
const spring = asset('bg', '温泉');
const walk = asset('cg', '温泉散步', { bgm_id: cozy.id });
const nap = asset('cg', '同衾');
const laugh = asset('cg', '开心·大笑', { parent_id: walk.id });
const shy = asset('cg', '开心·害羞', { parent_id: walk.id, aliases: ['害羞'] });
const ASSETS = [daily, cozy, hut, spring, walk, nap, laugh, shy];

const apply = (state: SceneState, ...tags: [string, string][]) =>
  tags.reduce((s, [kind, label]) => applySceneTag(s, { kind, label }, ASSETS), state);

describe('CG state', () => {
  it('starts without a CG and only lists the set-ups, not the variants', () => {
    expect(initialScene(ASSETS)).toMatchObject({ bg: hut, bgm: daily, cg: null });
    expect(cgsOf(ASSETS).map((a) => a.label)).toEqual(['温泉散步', '同衾']);
  });

  it('shows and puts away a CG without touching the music', () => {
    // 旧数据里 CG 还挂着曲子:也不换
    const on = apply(initialScene(ASSETS), ['cg', '温泉散步']);
    expect(on).toMatchObject({ cg: walk, bgm: daily, bgmFrom: 'initial' });
    // 再写一次同一张:什么都不变
    expect(apply(on, ['cg', '温泉散步'])).toBe(on);
    const off = apply(apply(on, ['bgm', '温馨']), ['cg', '无']);
    expect(off).toMatchObject({ cg: null, bgm: cozy, bgmFrom: 'tag' });
  });

  it('keeps the CG when the scene changes, and ignores unknown names', () => {
    const s = apply(initialScene(ASSETS), ['cg', '同衾'], ['bg', '温泉']);
    expect(s).toMatchObject({ bg: spring, cg: nap });
    const none = apply(s, ['cg', '无']);
    expect(apply(none, ['cg', '不存在的CG']).cg).toBeNull();
    // 变体名不是 CG 名:点不到
    expect(apply(none, ['cg', '开心·大笑']).cg).toBeNull();
  });

  it('accepts a few ways of saying "no CG"', () => {
    for (const w of ['无', '无CG', 'none', ' OFF ', '不显示']) expect(isCgOff(w)).toBe(true);
    expect(isCgOff('同衾')).toBe(false);
  });
});

describe('cgFrameFor', () => {
  it('follows the face: the variant named after the expression, else the set-up itself', () => {
    expect(cgFrameFor(walk, ASSETS, '开心·大笑')).toBe(laugh);
    expect(cgFrameFor(walk, ASSETS, '害羞')).toBe(shy);
    expect(cgFrameFor(walk, ASSETS, '微笑')).toBe(walk);
    expect(cgFrameFor(walk, ASSETS, null)).toBe(walk);
  });

  it('falls back to a variant with a picture when the set-up has none', () => {
    const bare = { ...walk, has_file: false };
    expect(cgFrameFor(bare, ASSETS, '微笑')).toBe(laugh);
  });
});

describe('CG macros', () => {
  it('lists the CGs and writes the put-away tag with the current template', () => {
    const configs = {
      bg: SCENE.bg.defaults,
      bgm: SCENE.bgm.defaults,
      cg: { ...SCENE.cg.defaults, tagTemplate: '[CG={CG}]' },
    };
    const m = sceneMacros(configs, true, ASSETS, apply(initialScene(ASSETS), ['cg', '同衾']));
    expect(m.cgs).toBe('- 温泉散步\n- 同衾');
    expect(m.cg_tag).toBe('[CG=CG名]');
    expect(m.cg_off_tag).toBe('[CG=无]');
    expect(m.current_cg).toBe('同衾');
  });

  it('lists only the CGs the current form allows', () => {
    const configs = { bg: SCENE.bg.defaults, bgm: SCENE.bgm.defaults, cg: SCENE.cg.defaults };
    const state = apply(initialScene(ASSETS), ['cg', '同衾']);
    const some = sceneMacros(configs, true, ASSETS, state, (cg) => cg.label === '温泉散步');
    expect(some.cgs).toBe('- 温泉散步');
    expect(some.current_cg).toBe('(没有 CG，显示立绘和背景)');
    const none = sceneMacros(configs, true, ASSETS, state, () => false);
    expect(none.cgs).toBe('(现在不显示 CG，不要写 CG 标签)');
  });
});

describe('CG at the end of a chat', () => {
  const kinds = [sceneTagKind('bg', '<bg:{场景}>'), sceneTagKind('cg', '<cg:{CG}>')];
  const reply = (id: string, text: string): ChatEntry => ({
    id,
    role: 'assistant',
    swipes: [text],
    swipeIndex: 0,
    swipeInfo: [{ sendDate: '' }],
    overswipe: 'regenerate',
  });
  const chat = [reply('a', '<cg:同衾>「嗯」'), reply('b', '<bg:温泉>「走吧」'), reply('c', '「到了」')];

  it('keeps the CG across replies and scene changes', () => {
    expect(sceneAtEnd(chat, kinds, ASSETS)).toMatchObject({ bg: spring, cg: nap });
  });

  it('skips CGs the form there does not allow and puts the CG away on the way', () => {
    // 第 1 条起是 CG 不能出的形态:走到那里就收起,之后不带回
    const okUntil = (last: number) => (_cg: SceneAsset, i: number) => i <= last;
    expect(sceneAtEnd(chat, kinds, ASSETS, okUntil(0)).cg).toBeNull();
    const back = (_cg: SceneAsset, i: number) => i !== 1;
    expect(sceneAtEnd(chat, kinds, ASSETS, back).cg).toBeNull();
    // 能出的形态里来了新的 CG 标签:照常出;不能出的那张不算
    const more = [...chat, reply('d', '<cg:温泉散步>「♡」')];
    expect(sceneAtEnd(more, kinds, ASSETS, back).cg).toBe(walk);
    expect(sceneAtEnd(more, kinds, ASSETS, (cg) => cg !== walk).cg).toBe(nap);
  });
});
