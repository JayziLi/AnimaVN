import { describe, expect, it } from 'vitest';
import { betaShown, isStagePage, pageEn } from './skinModel';

describe('插件抽屉游戏皮', () => {
  it('有舞台的五页排三栏,别的页排一列', () => {
    for (const id of ['sprite', 'voice', 'bg', 'bgm', 'cg', 'lang']) expect(isStagePage(id)).toBe(true);
    for (const id of ['jev', 'tts', 'imagegen', 'sfx']) expect(isStagePage(id)).toBe(false);
  });

  it('AI 生图游戏里不标 BETA,调试台照旧;别的 BETA 都留着', () => {
    expect(betaShown(true, 'imagegen', true)).toBe(false);
    expect(betaShown(false, 'imagegen', true)).toBe(true);
    expect(betaShown(true, 'sfx', true)).toBe(true);
    expect(betaShown(true, 'sprite', false)).toBe(false);
  });

  it('页头英文小标', () => {
    expect(pageEn('sprite')).toBe('Sprite');
    expect(pageEn('nope')).toBeNull();
  });
});
