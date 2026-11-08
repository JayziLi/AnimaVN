import { describe, expect, it } from 'vitest';
import { deliveryText, mark, nextToSend, pendingVoices, retry, startItems } from './deliveryModel';

const profiles = [
  { id: 'a', name: '凯露', files_at: 'pending' as const },
  { id: 'b', name: '枫', files_at: 'manual' as const },
  { id: 'c', name: "三月七 's 日语", files_at: 'pending' as const },
  { id: 'd', name: '老的', files_at: 'pending' as const },
  { id: 'e', name: '已送', files_at: 'sent' as const },
];

describe('pendingVoices', () => {
  it('keeps the new ones that are still pending, in the order they were made', () => {
    expect(pendingVoices(['c', 'b', 'a', 'e', 'gone'], profiles)).toEqual([
      { id: 'c', name: "三月七 's 日语" },
      { id: 'a', name: '凯露' },
    ]);
    expect(pendingVoices(undefined, profiles)).toEqual([]);
    expect(pendingVoices([], profiles)).toEqual([]);
  });
});

describe('sending one after another', () => {
  it('only one at a time, in order; a failure waits for retry and the next one goes on', () => {
    let items = startItems([
      { id: 'a', name: '凯露' },
      { id: 'c', name: '三月七' },
    ]);
    expect(items.map((i) => i.step)).toEqual(['wait', 'wait']);
    expect(nextToSend(items)?.id).toBe('a');
    items = mark(items, 'a', 'sending');
    expect(nextToSend(items)).toBeNull();
    items = mark(items, 'a', 'fail', '连不上台式机: 超时');
    expect(nextToSend(items)?.id).toBe('c');
    items = mark(items, 'c', 'sending');
    items = mark(items, 'c', 'done');
    expect(nextToSend(items)).toBeNull();
    items = retry(items, 'a');
    expect(items[0]).toEqual({ id: 'a', name: '凯露', step: 'wait' });
    expect(nextToSend(items)?.id).toBe('a');
    // 只有失败的能重试
    expect(retry(items, 'c')[1].step).toBe('done');
  });
});

describe('deliveryText', () => {
  it('says what is going on; failures show the backend text as it is', () => {
    const base = { id: 'a', name: '凯露' };
    expect(deliveryText({ ...base, step: 'wait' })).toBe('等一下再送…');
    expect(deliveryText({ ...base, step: 'sending' })).toBe('正在送到语音机…');
    expect(deliveryText({ ...base, step: 'done' })).toBe('送好了');
    expect(deliveryText({ ...base, step: 'fail', error: 'HTTP 502: 连不上 10.0.0.2' })).toBe('HTTP 502: 连不上 10.0.0.2');
    expect(deliveryText({ ...base, step: 'fail' })).toBe('没送成');
  });
});
