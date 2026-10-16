import { describe, expect, it } from 'vitest';
import { MAX_BUDGET, MIN_BUDGET, parseBudgetInput } from './budget';

describe('预算输入框', () => {
  it('空、0 = 不截断', () => {
    expect(parseBudgetInput('')).toBeNull();
    expect(parseBudgetInput('   ')).toBeNull();
    expect(parseBudgetInput('0')).toBeNull();
  });

  it('普通数字;逗号、下划线、空格都认,小数取整', () => {
    expect(parseBudgetInput('151845')).toBe(151845);
    expect(parseBudgetInput(' 16,384 ')).toBe(16384);
    expect(parseBudgetInput('32_768')).toBe(32768);
    expect(parseBudgetInput('8 192')).toBe(8192);
    expect(parseBudgetInput('4096.7')).toBe(4096);
  });

  it('超上限夹到上限', () => {
    expect(parseBudgetInput('99999999')).toBe(MAX_BUDGET);
  });

  it('不是数、或小于下限:undefined(弹回原值)', () => {
    expect(parseBudgetInput('abc')).toBeUndefined();
    expect(parseBudgetInput(String(MIN_BUDGET - 1))).toBeUndefined();
    expect(parseBudgetInput('-5')).toBeUndefined();
    expect(parseBudgetInput(String(MIN_BUDGET))).toBe(MIN_BUDGET);
  });
});
