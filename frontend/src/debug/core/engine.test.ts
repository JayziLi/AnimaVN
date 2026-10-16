import { describe, expect, it } from 'vitest';
import { normalizeTimelineConfig } from './engine';

describe('normalizeTimelineConfig', () => {
  it('没存过、存坏了都是旧算法', () => {
    expect(normalizeTimelineConfig(null)).toEqual({ engine: 'legacy' });
    expect(normalizeTimelineConfig({ engine: 'what' })).toEqual({ engine: 'legacy' });
    expect(normalizeTimelineConfig('records')).toEqual({ engine: 'legacy' });
    expect(normalizeTimelineConfig({ engine: 'records' })).toEqual({ engine: 'records' });
  });
});
