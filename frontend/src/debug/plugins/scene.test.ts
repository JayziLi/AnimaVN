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
const tense = asset('bgm', '紧张');
const hut = asset('bg', '草庵', { bgm_id: daily.id });
const beach = asset('bg', '海边');
const fireworks = asset('cg', '海边烟花', { bgm_id: tense.id });
const nap = asset('cg', '午睡');
const laugh = asset('cg', '开心·大笑', { parent_id: fireworks.id });
const shy = asset('cg', '脸红·害羞', { parent_id: fireworks.id, aliases: ['害羞'] });
const ASSETS = [daily, tense, hut, beach, fireworks, nap, laugh, shy];

const apply = (state: SceneState, ...tags: [string, string][]) =>
  tags.reduce((s, [kind, label]) => applySceneTag(s, { kind, label }, ASSETS), state);

describe('CG state', () => {
  it('starts without a CG and only lists the set-ups, not the variants', () => {
    expect(initialScene(ASSETS)).toMatchObject({ bg: hut, bgm: daily, cg: null });
    expect(cgsOf(ASSETS).map((a) => a.label)).toEqual(['海边烟花', '午睡']);
  });

  it('shows and puts away a CG without touching the music', () => {
    // 旧数据里 CG 还挂着曲子:也不换
    const on = apply(initialScene(ASSETS), ['cg', '海边烟花']);
    expect(on).toMatchObject({ cg: fireworks, bgm: daily, bgmFrom: 'initial' });
    // 再写一次同一张:什么都不变
    expect(apply(on, ['cg', '海边烟花'])).toBe(on);
    const off = apply(apply(on, ['bgm', '紧张']), ['cg', '无']);
    expect(off).toMatchObject({ cg: null, bgm: tense, bgmFrom: 'tag' });
  });

  it('keeps the CG when the scene changes, and ignores unknown names', () => {
    const s = apply(initialScene(ASSETS), ['cg', '午睡'], ['bg', '海边']);
    expect(s).toMatchObject({ bg: beach, cg: nap });
    const none = apply(s, ['cg', '无']);
    expect(apply(none, ['cg', '不存在的CG']).cg).toBeNull();
    // 变体名不是 CG 名:点不到
    expect(apply(none, ['cg', '开心·大笑']).cg).toBeNull();
  });

  it('accepts a few ways of saying "no CG"', () => {
    for (const w of ['无', '无CG', 'none', ' OFF ', '不显示']) expect(isCgOff(w)).toBe(true);
    expect(isCgOff('午睡')).toBe(false);
  });
});

describe('cgFrameFor', () => {
  it('follows the face: the variant named after the expression, else the set-up itself', () => {
    expect(cgFrameFor(fireworks, ASSETS, '开心·大笑')).toBe(laugh);
    expect(cgFrameFor(fireworks, ASSETS, '害羞')).toBe(shy);
    expect(cgFrameFor(fireworks, ASSETS, '微笑')).toBe(fireworks);
    expect(cgFrameFor(fireworks, ASSETS, null)).toBe(fireworks);
  });

  it('falls back to a variant with a picture when the set-up has none', () => {
    const bare = { ...fireworks, has_file: false };
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
    const m = sceneMacros(configs, true, ASSETS, apply(initialScene(ASSETS), ['cg', '午睡']));
    expect(m.cgs).toBe('- 海边烟花\n- 午睡');
    expect(m.cg_tag).toBe('[CG=CG名]');
    expect(m.cg_off_tag).toBe('[CG=无]');
    expect(m.current_cg).toBe('午睡');
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
  const chat = [reply('a', '<cg:午睡>「嗯」'), reply('b', '<bg:海边>「走吧」'), reply('c', '「到了」')];

  it('keeps the CG across replies and scene changes', () => {
    expect(sceneAtEnd(chat, kinds, ASSETS)).toMatchObject({ bg: beach, cg: nap });
  });
});
