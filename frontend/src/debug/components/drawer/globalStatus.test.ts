import { describe, expect, it } from 'vitest';
import { ttsSummary, withTimeout } from './globalStatus';

const c = (id: string) => ({ id });

describe('语音服务的状态字', () => {
  it('一台都没设', () => {
    expect(ttsSummary([], {})).toEqual({ text: '没设', ok: null });
  });

  it('还有没测完的:测试中', () => {
    expect(ttsSummary([c('a'), c('b')], { a: { ok: true, ms: 30 } })).toEqual({ text: '测试中…', ok: null });
    expect(ttsSummary([c('a')], { a: 'pending' })).toEqual({ text: '测试中…', ok: null });
  });

  it('全通、全不通、一部分通', () => {
    expect(ttsSummary([c('a')], { a: { ok: true, ms: 30 } })).toEqual({ text: '通了', ok: true });
    expect(ttsSummary([c('a'), c('b')], { a: { ok: true, ms: 30 }, b: { ok: true, ms: 9 } })).toEqual({
      text: '2 台都通了',
      ok: true,
    });
    expect(ttsSummary([c('a')], { a: { ok: false, error: 'x' } })).toEqual({ text: '连不上', ok: false });
    expect(ttsSummary([c('a'), c('b')], { a: { ok: true, ms: 1 }, b: { ok: false, error: 'x' } })).toEqual({
      text: '1/2 台通了',
      ok: false,
    });
  });
});

describe('withTimeout', () => {
  it('按时回来照常给结果,超时就报那句话', async () => {
    await expect(withTimeout(Promise.resolve(3), 50, '超时')).resolves.toBe(3);
    await expect(withTimeout(new Promise(() => {}), 10, '5 秒没回')).rejects.toThrow('5 秒没回');
    await expect(withTimeout(Promise.reject(new Error('坏了')), 50, '超时')).rejects.toThrow('坏了');
  });
});
