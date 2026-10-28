import { describe, expect, it } from 'vitest';
import { echoHoldMs, playerSaid } from './echo';

describe('发出去那句浮一下', () => {
  it('不显示「——」开头的提示行,整句台词去掉引号', () => {
    expect(playerSaid('——场景切换为图书馆\n「我们去图书馆吧」')).toBe('我们去图书馆吧');
  });
  it('只有提示行时什么都不浮', () => {
    expect(playerSaid('——时间跳到第二天早上')).toBe('');
  });
  it('字少停 1.8s,字多停久一点,最多 3.2s', () => {
    expect(echoHoldMs('好')).toBe(1800);
    expect(echoHoldMs('一'.repeat(15))).toBe(2100);
    expect(echoHoldMs('一'.repeat(100))).toBe(3200);
  });
});
