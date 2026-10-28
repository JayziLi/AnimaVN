import { describe, expect, it } from 'vitest';
import { typedParts } from './typedParts';

describe('typedParts', () => {
  it('splits at the typed count', () => {
    expect(typedParts('abcdef', 2, false)).toEqual({ shown: 'ab', rest: 'cdef' });
  });
  it('nothing typed yet: the whole line is rest', () => {
    expect(typedParts('abc', 0, false)).toEqual({ shown: '', rest: 'abc' });
  });
  it('all typed: rest is empty', () => {
    expect(typedParts('abc', 3, false)).toEqual({ shown: 'abc', rest: '' });
  });
  it('skipped shows the whole line at once', () => {
    expect(typedParts('abc', 0, true)).toEqual({ shown: 'abc', rest: '' });
  });
});
