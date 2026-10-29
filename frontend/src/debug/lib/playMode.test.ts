import { describe, expect, it } from 'vitest';
import { wantsPlayMode } from './playMode';

describe('play mode', () => {
  it('reads the flag the launcher puts in the address', () => {
    expect(wantsPlayMode('?play=1')).toBe(true);
    expect(wantsPlayMode('?debug=1&play=1')).toBe(true);
    expect(wantsPlayMode('')).toBe(false);
    expect(wantsPlayMode('?debug=1')).toBe(false);
  });
});
