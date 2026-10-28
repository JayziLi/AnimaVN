import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFadeLayer, ENTER_CLASSES, MOTION, SETTLE_FALLBACK_MS, settle, watchMedia, type FadeLayerState } from './motion';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('MOTION', () => {
  it('时长和设计稿对上:整屏 220、上浮 320、弹层开 220 / 关 180、换页 160', () => {
    expect(MOTION).toEqual({ screen: 220, rise: 320, popIn: 220, popOut: 180, page: 160 });
  });
});

describe('watchMedia', () => {
  it('系统设置一变就回调,取消后不再回调', () => {
    const h: { fn: (() => void) | null } = { fn: null };
    const mq = {
      addEventListener: (_t: 'change', f: () => void) => (h.fn = f),
      removeEventListener: (_t: 'change', f: () => void) => {
        if (h.fn === f) h.fn = null;
      },
    };
    const cb = vi.fn();
    const off = watchMedia(mq, cb);
    h.fn?.();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    expect(h.fn).toBeNull();
  });
  it('没有 matchMedia 时也不报错', () => {
    expect(() => watchMedia(undefined, () => {})()).not.toThrow();
  });
});

describe('createFadeLayer', () => {
  const make = (initial: boolean, reduced = false) => {
    const log: FadeLayerState[] = [];
    const ctl = createFadeLayer(initial, (s) => log.push(s), 180, () => reduced);
    return { ctl, log };
  };

  it('关的时候还在(leaving),0.18s 后才卸', () => {
    const { ctl, log } = make(true);
    ctl.open(false);
    expect(ctl.state).toEqual({ mounted: true, leaving: true });
    vi.advanceTimersByTime(179);
    expect(ctl.state).toEqual({ mounted: true, leaving: true });
    vi.advanceTimersByTime(1);
    expect(ctl.state).toEqual({ mounted: false, leaving: false });
    expect(log).toEqual([
      { mounted: true, leaving: true },
      { mounted: false, leaving: false },
    ]);
  });

  it('开的时候马上挂上', () => {
    const { ctl } = make(false);
    ctl.open(true);
    expect(ctl.state).toEqual({ mounted: true, leaving: false });
  });

  it('淡出途中又打开:取消卸载', () => {
    const { ctl } = make(true);
    ctl.open(false);
    vi.advanceTimersByTime(100);
    ctl.open(true);
    vi.advanceTimersByTime(500);
    expect(ctl.state).toEqual({ mounted: true, leaving: false });
  });

  it('本来就没挂着时关,什么也不发生', () => {
    const { ctl, log } = make(false);
    ctl.open(false);
    expect(log).toEqual([]);
  });

  it('减少动态效果时直接卸,不等', () => {
    const { ctl } = make(true, true);
    ctl.open(false);
    expect(ctl.state).toEqual({ mounted: false, leaving: false });
  });

  it('destroy 以后不再卸', () => {
    const { ctl, log } = make(true);
    ctl.open(false);
    ctl.destroy();
    vi.advanceTimersByTime(500);
    expect(log).toEqual([{ mounted: true, leaving: true }]);
  });
});

describe('settle', () => {
  const fakeNode = () => {
    const classes = new Set<string>(ENTER_CLASSES);
    let onEnd: ((e: { target: unknown }) => void) | null = null;
    const node = {
      classList: { remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) },
      addEventListener: (_: 'animationend', fn: (e: { target: unknown }) => void) => {
        onEnd = fn;
      },
      removeEventListener: () => {
        onEnd = null;
      },
    };
    return { node, classes, fire: (target: unknown) => onEnd?.({ target }) };
  };

  it('animationend 到了就摘 class', () => {
    const { node, classes, fire } = fakeNode();
    settle(node);
    fire(node);
    expect(classes.size).toBe(0);
  });

  it('子元素的 animationend 冒泡上来不算', () => {
    const { node, classes, fire } = fakeNode();
    settle(node);
    fire({});
    expect(classes.size).toBe(ENTER_CLASSES.length);
  });

  it('animationend 没来,700ms 兜底也摘', () => {
    const { node, classes } = fakeNode();
    settle(node);
    vi.advanceTimersByTime(SETTLE_FALLBACK_MS - 1);
    expect(classes.size).toBe(ENTER_CLASSES.length);
    vi.advanceTimersByTime(1);
    expect(classes.size).toBe(0);
  });

  it('只摘指定的 class;取消以后不再摘', () => {
    const { node, classes } = fakeNode();
    const cancel = settle(node, ['av-rise']);
    cancel();
    vi.advanceTimersByTime(1000);
    expect(classes.has('av-rise')).toBe(true);
    const b = fakeNode();
    settle(b.node, ['av-rise']);
    vi.advanceTimersByTime(1000);
    expect([...b.classes].sort()).toEqual(['av-fade', 'av-page-in', 'av-pop-in']);
  });

  it('没有元素也不报错', () => {
    expect(() => settle(null)()).not.toThrow();
  });
});
