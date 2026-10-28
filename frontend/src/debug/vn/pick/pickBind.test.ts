import { describe, expect, it } from 'vitest';
import type { DebugPersona, ScenePack, SpritePack, StoredPreset, VoiceProfile } from '../../lib/api';
import { buildPickBind, type PickGlobals } from './pickBind';

const g = (over: Partial<PickGlobals> = {}): PickGlobals => ({
  spritePacks: [{ id: 'sp1', name: '示例 · Sylvie', description: '', sprite_count: 14, card_count: 1 } as SpritePack],
  scenePacks: [
    { id: 'sc1', name: '示例场景', description: '', bg_count: 4, bgm_count: 1, cg_count: 2, card_count: 1, title_bgm_id: null } as ScenePack,
    { id: 'sc2', name: '另一包', description: '', bg_count: 3, bgm_count: 0, card_count: 1, title_bgm_id: null } as ScenePack,
  ],
  voices: [{ id: 'v1', name: '刻晴(日语)' } as VoiceProfile],
  presets: [{ id: 'p1', name: '爱丽丝 DeepSeek' } as StoredPreset],
  personas: [{ id: 'u1', name: '前辈' } as DebugPersona, { id: 'u2', name: '默认的你' } as DebugPersona],
  presetBind: { cards: { c1: 'p1' } },
  personaBind: { default: 'u2', cards: { c1: 'u1' } },
  ...over,
});

const raw = (over = {}) => ({
  cardId: 'c1',
  spritePacks: { card_id: 'c1', pack_ids: ['sp1'], current: 'sp1' },
  scenePacks: { bg: ['sc1'], bgm: ['sc1'] },
  voices: { main: 'v1', extras: [] },
  lastChat: null,
  ...over,
});

describe('buildPickBind:右边那几条用的名字都是库里真有的', () => {
  it('立绘包、场景包(带张数)、声音、预设、人设', () => {
    const b = buildPickBind(raw(), g());
    expect(b.spritePack).toBe('示例 · Sylvie');
    expect(b.scene).toEqual({ name: '示例场景', bg: 4, bgm: 1, cg: 2 });
    expect(b.voice).toBe('刻晴(日语)');
    expect(b.preset).toBe('爱丽丝 DeepSeek');
    expect(b.persona).toBe('前辈');
  });
  it('没绑预设的卡不写预设;没绑人设就用默认人设', () => {
    const b = buildPickBind(raw({ cardId: 'c2' }), g());
    expect(b.preset).toBeNull();
    expect(b.persona).toBe('默认的你');
  });
  it('绑的东西已经删了(库里找不到)就当没绑,不显示 id', () => {
    const b = buildPickBind(
      raw({ spritePacks: { card_id: 'c1', pack_ids: ['gone'], current: 'gone' }, scenePacks: { bg: ['gone'], bgm: [] }, voices: { main: 'gone', extras: [] } }),
      g(),
    );
    expect(b.spritePack).toBeNull();
    expect(b.scene).toBeNull();
    expect(b.voice).toBeNull();
  });
  it('背景、曲子在不同的包:名字用出背景的,张数各算各的;几个包写「第一个 等 N 个」', () => {
    const b = buildPickBind(raw({ scenePacks: { bg: ['sc1', 'sc2'], bgm: ['sc1'] } }), g());
    expect(b.scene).toEqual({ name: '示例场景 等 2 个', bg: 7, bgm: 1, cg: 2 });
    const onlyBgm = buildPickBind(raw({ scenePacks: { bg: [], bgm: ['sc2'] } }), g());
    expect(onlyBgm.scene).toEqual({ name: '另一包', bg: 0, bgm: 0, cg: 0 });
  });
  it('哪一项没拉到(旧后端、网络抖)就是空,不挡着别的', () => {
    const b = buildPickBind(raw({ spritePacks: null, scenePacks: null, voices: null }), g());
    expect(b).toMatchObject({ spritePack: null, scene: null, voice: null, preset: '爱丽丝 DeepSeek' });
  });
  it('上次对话:什么时候改的、几条', () => {
    const b = buildPickBind(raw({ lastChat: { id: 'x', updated_at: '2026-10-20T10:00:00', message_count: 12 } }), g());
    expect(b.lastChat).toEqual({ at: '2026-10-20T10:00:00', count: 12 });
  });
});
