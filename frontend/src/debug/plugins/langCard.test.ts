import { describe, expect, it } from 'vitest';
import { langAskFor, normalizeLangConfig, writesJa } from './lang';

describe('这张卡的台词语言(11-05 和声音拆开)', () => {
  it('normalize 认 auto / ja / zh,别的退回 auto', () => {
    expect(normalizeLangConfig({}).lang).toBe('auto');
    expect(normalizeLangConfig({ lang: 'ja' }).lang).toBe('ja');
    expect(normalizeLangConfig({ lang: 'zh' }).lang).toBe('zh');
    expect(normalizeLangConfig({ lang: 'en' }).lang).toBe('auto');
  });

  it('设过就照设的;没设过跟着主声音(没有主声音 = 不写日语)', () => {
    expect(writesJa('ja', null)).toBe(true);
    expect(writesJa('ja', 'zh')).toBe(true);
    expect(writesJa('zh', 'ja')).toBe(false);
    expect(writesJa('auto', 'ja')).toBe(true);
    expect(writesJa('auto', 'all_ja')).toBe(true);
    expect(writesJa('auto', 'zh')).toBe(false);
    expect(writesJa('auto', null)).toBe(false);
  });

  it('换成日语声音、这张卡还写中文:问「切换为日语」,先把现在的中文记下', () => {
    expect(langAskFor('auto', 'zh', 'ja')).toEqual({ keep: 'zh', toJa: true });
    expect(langAskFor('zh', 'ja', 'ja')).toEqual({ keep: 'zh', toJa: true });
    expect(langAskFor('auto', null, 'ja')).toEqual({ keep: 'zh', toJa: true });
  });

  it('换成中文声音、这张卡写日语:问「切换为中文」,先把现在的日语记下', () => {
    expect(langAskFor('auto', 'ja', 'zh')).toEqual({ keep: 'ja', toJa: false });
    expect(langAskFor('ja', null, 'zh')).toEqual({ keep: 'ja', toJa: false });
  });

  it('语言本来就对得上就不问', () => {
    expect(langAskFor('auto', 'ja', 'ja')).toBeNull();
    expect(langAskFor('ja', 'zh', 'ja')).toBeNull();
    expect(langAskFor('zh', 'ja', 'zh')).toBeNull();
    expect(langAskFor('auto', 'zh', 'zh')).toBeNull();
  });
});
