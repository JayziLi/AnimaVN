import { describe, expect, it } from 'vitest';
import { FX_BUBBLES, FX_MOTIONS, FX_SOUNDS, MOTION_FRAMES, TYPE_SOUNDS, normalizeEffect } from './spriteFx';

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
