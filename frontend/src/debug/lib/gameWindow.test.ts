import { describe, expect, it } from 'vitest';
import { gameWindowApi, sizeName } from './gameWindow';

describe('gameWindowApi', () => {
  it('浏览器里没有', () => {
    expect(gameWindowApi({})).toBeNull();
    expect(gameWindowApi({ pywebview: { api: { toggle_fullscreen: () => null } } })).toBeNull();
  });

  it('游戏窗口里有', () => {
    const api = { get_display: async () => null, set_display: async () => null };
    expect(gameWindowApi({ pywebview: { api } })).toBe(api);
  });
});

describe('sizeName', () => {
  it('写成 1920 × 1080', () => {
    expect(sizeName('1920x1080')).toBe('1920 × 1080');
  });
});
