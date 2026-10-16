import { describe, expect, it } from 'vitest';
import { LABEL_MAX } from '../plugins/common';
import { labelFromFile, uniqueLabel } from './assetNames';

describe('labelFromFile', () => {
  it('drops the extension (only the last one)', () => {
    expect(labelFromFile('微笑.png')).toBe('微笑');
    expect(labelFromFile('joy.v2.webp')).toBe('joy.v2');
    expect(labelFromFile('无扩展名')).toBe('无扩展名');
  });

  it('drops the characters that break the tag templates and trims', () => {
    expect(labelFromFile('【微笑】<1>.png')).toBe('微笑1');
    expect(labelFromFile('  害羞 .png')).toBe('害羞');
  });

  it('cuts to the label length limit', () => {
    const name = labelFromFile(`${'字'.repeat(LABEL_MAX + 10)}.png`);
    expect(name).toBe('字'.repeat(LABEL_MAX));
  });
});

describe('uniqueLabel', () => {
  it('keeps a free name and marks it taken (lower case)', () => {
    const taken = new Set<string>();
    expect(uniqueLabel('Smile', '表情', taken)).toBe('Smile');
    expect(taken.has('smile')).toBe(true);
  });

  it('adds 2, 3… when the name is taken, ignoring case', () => {
    const taken = new Set(['食堂', 'smile']);
    expect(uniqueLabel('食堂', '场景', taken)).toBe('食堂2');
    expect(uniqueLabel('食堂', '场景', taken)).toBe('食堂3');
    expect(uniqueLabel('SMILE', '表情', taken)).toBe('SMILE2');
  });

  it('falls back when the name is empty', () => {
    const taken = new Set(['表情']);
    expect(uniqueLabel('', '表情', taken)).toBe('表情2');
  });
});
