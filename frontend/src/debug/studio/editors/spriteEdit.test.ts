import { describe, expect, it } from 'vitest';
import { defaultSpriteId, moveId, nextEffect, selectAfterDelete } from './spriteEdit';

describe('nextEffect', () => {
  it('picks the matching sound when a manpu is chosen, replacing the old sound', () => {
    expect(nextEffect(null, { bubble: 'exclaim' })).toEqual({ motion: null, bubble: 'exclaim', sound: 'emo-exclaim' });
    expect(nextEffect({ motion: 'hop', bubble: null, sound: 'appear-1' }, { bubble: 'heart' })).toEqual({
      motion: 'hop',
      bubble: 'heart',
      sound: 'emo-heart',
    });
  });

  it('drops the matching sound with the manpu, keeps a sound picked on its own', () => {
    expect(nextEffect({ motion: 'hop', bubble: 'heart', sound: 'emo-heart' }, { bubble: null })).toEqual({
      motion: 'hop',
      bubble: null,
      sound: null,
    });
    expect(nextEffect({ motion: null, bubble: 'heart', sound: 'appear-2' }, { bubble: null })).toEqual({
      motion: null,
      bubble: null,
      sound: 'appear-2',
    });
  });

  it('changes one part alone, and is null when nothing is left', () => {
    expect(nextEffect({ motion: 'hop', bubble: 'heart', sound: 'emo-heart' }, { sound: 'deflate' })).toEqual({
      motion: 'hop',
      bubble: 'heart',
      sound: 'deflate',
    });
    expect(nextEffect({ motion: 'hop', bubble: null, sound: null }, { motion: null })).toBeNull();
    expect(nextEffect({ motion: 'unknown', bubble: null, sound: null }, {})).toBeNull();
  });
});

describe('defaultSpriteId', () => {
  it('is the first enabled sprite', () => {
    expect(defaultSpriteId([{ id: 'a', enabled: false }, { id: 'b', enabled: true }, { id: 'c', enabled: true }])).toBe('b');
    expect(defaultSpriteId([{ id: 'a', enabled: false }])).toBeNull();
    expect(defaultSpriteId([])).toBeNull();
  });
});

describe('moveId', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('drops before or after the target', () => {
    expect(moveId(ids, 'd', 'a', 'before')).toEqual(['d', 'a', 'b', 'c']);
    expect(moveId(ids, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveId(ids, 'a', 'd', 'after')).toEqual(['b', 'c', 'd', 'a']);
    expect(moveId(ids, 'c', 'b', 'before')).toEqual(['a', 'c', 'b', 'd']);
  });

  it('returns null when nothing moves', () => {
    expect(moveId(ids, 'b', 'b', 'before')).toBeNull();
    expect(moveId(ids, 'b', 'c', 'before')).toBeNull();
    expect(moveId(ids, 'c', 'b', 'after')).toBeNull();
    expect(moveId(ids, 'x', 'b', 'after')).toBeNull();
  });
});

describe('selectAfterDelete', () => {
  it('selects the one that takes its place, or the one before at the end', () => {
    expect(selectAfterDelete(['a', 'b', 'c'], 'b')).toBe('c');
    expect(selectAfterDelete(['a', 'b', 'c'], 'c')).toBe('b');
    expect(selectAfterDelete(['a'], 'a')).toBeNull();
  });
});
