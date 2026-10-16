import { describe, expect, it } from 'vitest';
import { TYPE_SOUNDS } from '../vn/typeSound';
import { FX_BUBBLES, FX_MOTIONS, FX_SOUNDS, MOTION_FRAMES, fxStep, normalizeEffect } from './spriteFx';

describe('normalizeEffect', () => {
  it('keeps known ids and treats unknown ones as not set', () => {
    expect(normalizeEffect({ motion: 'hop', bubble: 'heart', sound: 'emo-heart' })).toEqual({
      motion: 'hop',
      bubble: 'heart',
      sound: 'emo-heart',
    });
    expect(normalizeEffect({ motion: 'spin', bubble: 'heart', sound: 'nope' })).toEqual({
      motion: null,
      bubble: 'heart',
      sound: null,
    });
  });

  it('is null when nothing usable is left', () => {
    expect(normalizeEffect(null)).toBeNull();
    expect(normalizeEffect(undefined)).toBeNull();
    expect(normalizeEffect({ motion: null, bubble: null, sound: null })).toBeNull();
    expect(normalizeEffect({ motion: 'x', bubble: 'y', sound: 'z' })).toBeNull();
  });
});

describe('catalogs', () => {
  it('every motion has keyframes', () => {
    for (const m of FX_MOTIONS) expect(MOTION_FRAMES[m.id], m.id).toBeDefined();
  });

  it('every bubble pairs with a sound in the list', () => {
    const sounds = new Set(FX_SOUNDS.map((s) => s.id));
    for (const b of FX_BUBBLES) expect(sounds.has(b.sound), b.id).toBe(true);
  });

  it('ids are unique and never collide with the "off" setting', () => {
    for (const list of [FX_MOTIONS, FX_BUBBLES, FX_SOUNDS, TYPE_SOUNDS]) {
      const ids = list.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(TYPE_SOUNDS.some((t) => t.id === 'off')).toBe(false);
  });
});

describe('fxStep:立绘层什么时候放切换特效', () => {
  const cue = { id: 3, target: 'smile:1' };

  it('要的那张图换上来了、没被盖住:放', () => {
    expect(fxStep(cue, 2, 'smile:1', false)).toBe('play');
  });

  it('没有要放的、这次已经处理过、图还没换上来:等', () => {
    expect(fxStep(null, 0, 'smile:1', false)).toBe('wait');
    expect(fxStep(cue, 3, 'smile:1', false)).toBe('wait');
    expect(fxStep(cue, 2, 'idle:1', false)).toBe('wait');
    // 盖着也一样先等:图没换上来之前还轮不到它
    expect(fxStep(cue, 2, 'idle:1', true)).toBe('wait');
  });

  it('这句有 CG 盖着立绘:轮到了也不放(动作、气泡、音效都不放)', () => {
    expect(fxStep(cue, 2, 'smile:1', true)).toBe('skip');
    // 跳过的那次算处理过了,CG 收起以后不补放
    expect(fxStep(cue, 3, 'smile:1', false)).toBe('wait');
  });
});
