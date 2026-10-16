import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from './throttle';

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('第一次马上执行', () => {
    const fn = vi.fn();
    throttle(fn, 100)();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('间隔里的调用合成一次,到点执行', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t();
    vi.advanceTimersByTime(30);
    t();
    t();
    vi.advanceTimersByTime(30);
    t();
    expect(fn).toHaveBeenCalledTimes(1);
    // 离第一次执行满 100ms
    vi.advanceTimersByTime(39);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('隔得够久再调用,又是马上执行', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t();
    vi.advanceTimersByTime(250);
    t();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('flush 把还没执行的那次马上执行,之后不会再补一次', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t();
    t();
    t.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('没有待执行的时候 flush 什么也不做', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t.flush();
    t();
    t.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel 丢掉待执行的那次', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t();
    t();
    t.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush 之后的下一次调用按 flush 的时刻重新计间隔', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t();
    vi.advanceTimersByTime(50);
    t();
    t.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(50);
    t();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
