import { afterEach, describe, expect, it, vi } from 'vitest';
import { newJobId, openPreview, previewAt, previewBlur, previewMime, previewSrc, type LivePreview } from './preview';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('过程预览 · 编号', () => {
  it('有 randomUUID 用它', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-1' });
    expect(newJobId()).toBe('uuid-1');
  });

  it('局域网 http 下没有 randomUUID:照样给一个不重复、不超过 64 位的编号', () => {
    vi.stubGlobal('crypto', {});
    const ids = new Set(Array.from({ length: 50 }, () => newJobId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(64);
  });
});

describe('过程预览 · 图', () => {
  it('按开头认图片类型,认不出按 JPEG', () => {
    expect(previewMime('/9j/4AAQ')).toBe('image/jpeg');
    expect(previewMime('iVBORw0KGgo')).toBe('image/png');
    expect(previewMime('UklGRiQAAAB')).toBe('image/webp');
    expect(previewMime('AAAA')).toBe('image/jpeg');
  });

  it('不带前缀的 base64 变成能显示的地址;已经带了前缀的不动', () => {
    expect(previewSrc('iVBORw0KGgo')).toBe('data:image/png;base64,iVBORw0KGgo');
    expect(previewSrc('data:image/webp;base64,xxx')).toBe('data:image/webp;base64,xxx');
  });

  it('越画越清楚:一开始模糊,快画完只剩一点,乱值当刚开始', () => {
    expect(previewBlur(0)).toBeGreaterThan(previewBlur(0.5));
    expect(previewBlur(0.5)).toBeGreaterThan(previewBlur(1));
    expect(previewBlur(1)).toBeGreaterThan(0);
    expect(previewBlur(Number.NaN)).toBe(previewBlur(0));
    expect(previewBlur(5)).toBe(previewBlur(1));
  });
});

/** 假的 EventSource:记下地址,测试里手动发事件 */
class FakeSource {
  static last: FakeSource | null = null;
  closed = 0;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, (() => void)[]> = {};
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSource.last = this;
  }
  addEventListener(name: string, fn: () => void) {
    (this.listeners[name] ??= []).push(fn);
  }
  close() {
    this.closed += 1;
  }
  fire(name: string) {
    for (const fn of this.listeners[name] ?? []) fn();
  }
}

describe('过程预览 · 连接', () => {
  const frame = (image: unknown, progress: unknown) => ({ data: JSON.stringify({ image, progress }) });

  it('收到帧就回调,地址用任务编号,done 以后关掉', () => {
    vi.stubGlobal('EventSource', FakeSource);
    const seen: { src: string; progress: number }[] = [];
    openPreview('job-9', (f) => seen.push(f));
    const es = FakeSource.last as FakeSource;
    expect(es.url).toContain('/api/imagegen/jobs/job-9/events');
    es.onmessage?.(frame('/9j/AAA', 0.4));
    expect(seen).toEqual([{ src: 'data:image/jpeg;base64,/9j/AAA', progress: 0.4 }]);
    es.fire('done');
    expect(es.closed).toBe(1);
  });

  it('坏的帧不回调也不抛错', () => {
    vi.stubGlobal('EventSource', FakeSource);
    const seen: unknown[] = [];
    openPreview('j', (f) => seen.push(f));
    const es = FakeSource.last as FakeSource;
    es.onmessage?.({ data: 'not json' });
    es.onmessage?.(frame('', 0.5));
    es.onmessage?.(frame(3, 0.5));
    expect(seen).toEqual([]);
  });

  it('连接出错就关,不让浏览器一直重连', () => {
    vi.stubGlobal('EventSource', FakeSource);
    openPreview('j', () => undefined);
    const es = FakeSource.last as FakeSource;
    es.onerror?.();
    expect(es.closed).toBe(1);
  });

  it('手动关可以关很多次,关了以后不再回调', () => {
    vi.stubGlobal('EventSource', FakeSource);
    const seen: unknown[] = [];
    const close = openPreview('j', (f) => seen.push(f));
    const es = FakeSource.last as FakeSource;
    close();
    close();
    expect(es.closed).toBe(1);
    es.onmessage?.(frame('/9j/AAA', 0.4));
    expect(seen).toEqual([]);
  });

  it('浏览器没有 EventSource:不崩,关也不崩', () => {
    vi.stubGlobal('EventSource', undefined);
    expect(() => openPreview('j', () => undefined)()).not.toThrow();
  });
});

describe('过程预览 · 显示在哪一句', () => {
  const p = (over: Partial<LivePreview>): LivePreview => ({
    jobId: 'j1',
    entryId: 'e1',
    swipe: 0,
    line: 3,
    src: 'data:x',
    progress: 0.2,
    ...over,
  });

  it('同一条回复同一个分支,从那句开始往后都显示(和画好的图一样,读过了也显示)', () => {
    const list = [p({})];
    expect(previewAt(list, 'e1', 0, 3)?.jobId).toBe('j1');
    expect(previewAt(list, 'e1', 0, 6)?.jobId).toBe('j1');
    expect(previewAt(list, 'e1', 0, 2)).toBeNull();
    expect(previewAt(list, 'e2', 0, 3)).toBeNull();
    expect(previewAt(list, 'e1', 1, 3)).toBeNull();
  });

  it('同时画两张:后开始的优先', () => {
    expect(previewAt([p({ jobId: 'a' }), p({ jobId: 'b' })], 'e1', 0, 3)?.jobId).toBe('b');
  });
});
