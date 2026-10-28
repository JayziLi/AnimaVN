import { describe, expect, it } from 'vitest';
import type { JevKeyStatus } from '../../lib/api';
import { connIcon, connSub, elapsed, jevLine, THINK_OPTIONS } from './connModel';

describe('connIcon', () => {
  it('取名字前两个字,括号后面的不要,拉丁字母大写', () => {
    expect(connIcon('Openrouter')).toBe('OP');
    expect(connIcon('Mock（本地测试）')).toBe('MO');
    expect(connIcon('硅基流动')).toBe('硅基');
    expect(connIcon('')).toBe('?');
    expect(connIcon('（只有括号）')).toBe('?');
  });
});

describe('connSub', () => {
  it('类型 · 模型名,没设模型写「未设模型」', () => {
    expect(connSub({ api_type: 'openai_compatible', model: 'deepseek-v4-pro' })).toBe('OpenAI 兼容 · deepseek-v4-pro');
    expect(connSub({ api_type: 'anthropic', model: '' })).toBe('Anthropic · 未设模型');
    expect(connSub({ api_type: 'mock', model: 'mock' })).toBe('Mock · mock');
    expect(connSub({ api_type: 'x', model: 'm' })).toBe('x · m');
  });
});

describe('jevLine', () => {
  const st = (p: Partial<JevKeyStatus>): JevKeyStatus => ({ has_key: false, source: null, ...p });
  it('还在问后端 / 没填 / 已填 / 走中转', () => {
    expect(jevLine(null)).toEqual({ tone: 'wait', text: '正在问后端…' });
    expect(jevLine(st({}))).toEqual({ tone: 'missing', text: '还没填 key' });
    expect(jevLine(st({ has_key: true, source: 'settings' }))).toEqual({ tone: 'ok', text: '已填 key' });
    expect(jevLine(st({ has_key: true, url_source: 'default' }))).toEqual({ tone: 'ok', text: '已填 key' });
    expect(jevLine(st({ has_key: true, url_source: 'settings' }))).toEqual({ tone: 'ok', text: '已填 key · 走中转' });
  });
});

describe('elapsed', () => {
  it('不到 10 秒留一位小数,之后取整', () => {
    expect(elapsed(0)).toBe('0.0 秒');
    expect(elapsed(1640)).toBe('1.6 秒');
    expect(elapsed(12400)).toBe('12 秒');
    expect(elapsed(-5)).toBe('0.0 秒');
  });
});

describe('THINK_OPTIONS', () => {
  it('五档,顺序是 默认 / 关 / 低 / 高 / 最大(和左上「模型」小窗口一样)', () => {
    expect(THINK_OPTIONS.map((o) => o.value)).toEqual(['', 'off', 'low', 'high', 'max']);
  });
});
