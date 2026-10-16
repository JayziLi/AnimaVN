import { describe, expect, it } from 'vitest';
import { isJaLang } from './lang';
import { sampleLangOf } from './voice';

describe('sampleLangOf:试音的例句用哪种语言', () => {
  it('和念台词时一样用 isJaLang 判断日语:ja、all_ja 都用日文例句', () => {
    expect(sampleLangOf('ja')).toBe('ja');
    expect(sampleLangOf('all_ja')).toBe('ja');
    expect(sampleLangOf(' JA ')).toBe('ja');
  });

  it('其他(中文、自动、粤语……)用中文例句', () => {
    for (const lang of ['zh', 'all_zh', 'auto', 'yue', 'en', '']) expect(sampleLangOf(lang)).toBe('zh');
  });

  it('两处判断不再分家', () => {
    for (const lang of ['ja', 'all_ja', 'zh', 'auto', 'jaa', 'ja_x']) {
      expect(sampleLangOf(lang) === 'ja').toBe(isJaLang(lang));
    }
  });
});
