import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioBus, CHANNELS, DEFAULT_DUCK_LEVEL, duckRamp, nextDuck, type BusDocument, type Channel } from './audioBus';

// ---- 假的 Web Audio:node 里没有 AudioContext,只记下调了什么 ----

class FakeParam {
  value = 1;
  calls: [string, ...number[]][] = [];
  setTargetAtTime(v: number, t: number, tc: number) {
    this.calls.push(['target', v, t, tc]);
  }
  cancelScheduledValues(t: number) {
    this.calls.push(['cancel', t]);
  }
}

class FakeNode {
  out: unknown = null;
  connect<T>(n: T): T {
    this.out = n;
    return n;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeContext {
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 7;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  suspend = vi.fn(async () => {
    this.state = 'suspended';
  });
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
}

class FakeDocument implements BusDocument {
  hidden = false;
  private fns: (() => void)[] = [];
  addEventListener(_type: 'visibilitychange', fn: () => void) {
    this.fns.push(fn);
  }
  set(hidden: boolean) {
    this.hidden = hidden;
    for (const fn of this.fns) fn();
  }
}

function setup() {
  const contexts: FakeContext[] = [];
  const doc = new FakeDocument();
  const bus = new AudioBus({
    createContext: () => {
      const c = new FakeContext();
      contexts.push(c);
      return c as unknown as AudioContext;
    },
    document: doc,
  });
  const ctx = () => contexts[0];
  // 声道的两级:音量(input)和压低(duck)
  const nodes = (ch: Channel) => {
    const input = bus.input(ch) as unknown as FakeGain;
    return { input, duck: input.out as FakeGain };
  };
  return { bus, doc, contexts, ctx, nodes };
}

// ---- 压低的规则 ----

describe('nextDuck / duckRamp:谁出声时压低谁', () => {
  it('语音出声时压背景音乐,停了放开;语音自己、音效、跳字音不被压', () => {
    const on = nextDuck(new Map(), 'voice', true);
    expect([...on.keys()]).toEqual(['bgm']);
    expect(duckRamp(on, 'bgm', 0.35)).toEqual({ target: 0.35, timeConstant: 0.08 });
    for (const ch of ['voice', 'fx', 'type'] as Channel[]) expect(duckRamp(on, ch, 0.35).target).toBe(1);
    const off = nextDuck(on, 'voice', false);
    expect(off.size).toBe(0);
    expect(duckRamp(off, 'bgm', 0.35)).toEqual({ target: 1, timeConstant: 0.15 });
  });

  it('不压别人的声道出声 / 停下,状态不变', () => {
    const on = nextDuck(new Map(), 'voice', true);
    expect(nextDuck(on, 'fx', true)).toEqual(on);
    expect(nextDuck(on, 'type', false)).toEqual(on);
  });

  it('同一条声道被两个来源压着时,两个都停了才放开', () => {
    const rules = { voice: ['bgm'], fx: ['bgm'] } as const;
    let s = nextDuck(new Map(), 'voice', true, rules);
    s = nextDuck(s, 'fx', true, rules);
    s = nextDuck(s, 'voice', false, rules);
    expect(duckRamp(s, 'bgm', 0.5).target).toBe(0.5);
    s = nextDuck(s, 'fx', false, rules);
    expect(duckRamp(s, 'bgm', 0.5).target).toBe(1);
  });

  it('不改传进来的状态', () => {
    const before = nextDuck(new Map(), 'voice', true);
    nextDuck(before, 'voice', false);
    expect(before.get('bgm')?.has('voice')).toBe(true);
  });
});

// ---- 总线 ----

describe('AudioBus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('解锁之前没有 AudioContext;解锁时建一个,四条声道各自「音量 → 压低」接到总音量', () => {
    const { bus, ctx, nodes } = setup();
    expect(bus.context).toBeNull();
    expect(bus.input('bgm')).toBeNull();
    bus.unlock();
    const c = ctx();
    expect(bus.context).toBe(c);
    const master = nodes('bgm').duck.out as FakeGain;
    expect(master.out).toBe(c.destination);
    expect(master.gain.value).toBe(1);
    for (const ch of CHANNELS) {
      const { input, duck } = nodes(ch);
      expect(duck.out, ch).toBe(master);
      expect(input.gain.value).toBe(1);
      expect(duck.gain.value).toBe(1);
    }
    // 1 个总音量 + 每条声道两级
    expect(c.gains).toHaveLength(1 + CHANNELS.length * 2);
  });

  it('解锁前设的音量,建声道时直接用上;解锁后改音量 0.05 秒平滑过去', () => {
    const { bus, ctx, nodes } = setup();
    bus.setLevel('bgm', 0.49);
    bus.setLevel('voice', 0.81);
    bus.unlock();
    expect(nodes('bgm').input.gain.value).toBe(0.49);
    expect(nodes('voice').input.gain.value).toBe(0.81);
    expect(nodes('fx').input.gain.value).toBe(1);
    bus.setLevel('bgm', 0.25);
    expect(nodes('bgm').input.gain.calls).toEqual([['target', 0.25, ctx().currentTime, 0.05]]);
  });

  it('只建一次;每次解锁都试着恢复运行(切到后台时不恢复),并通知订阅的人', () => {
    const { bus, doc, contexts, ctx } = setup();
    const heard = vi.fn();
    bus.onUnlock(heard);
    bus.unlock();
    expect(ctx().resume).toHaveBeenCalledTimes(1);
    ctx().state = 'suspended';
    doc.hidden = true;
    bus.unlock();
    expect(ctx().resume).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(1);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('浏览器不支持 Web Audio:解锁什么也不做,也不通知', () => {
    const bus = new AudioBus({ createContext: () => null, document: null });
    const heard = vi.fn();
    bus.onUnlock(heard);
    bus.unlock();
    expect(bus.context).toBeNull();
    expect(heard).not.toHaveBeenCalled();
  });

  it('语音出声压背景音乐(默认 35%,0.08 秒压下),停了 0.15 秒淡回;别的声道不动', () => {
    const { bus, ctx, nodes } = setup();
    bus.unlock();
    const now = ctx().currentTime;
    bus.duck('voice', true);
    expect(nodes('bgm').duck.gain.calls).toEqual([
      ['cancel', now],
      ['target', DEFAULT_DUCK_LEVEL, now, 0.08],
    ]);
    bus.duck('voice', false);
    expect(nodes('bgm').duck.gain.calls.slice(2)).toEqual([
      ['cancel', now],
      ['target', 1, now, 0.15],
    ]);
    for (const ch of ['voice', 'fx', 'type'] as Channel[]) expect(nodes(ch).duck.gain.calls, ch).toEqual([]);
  });

  it('压着的时候改压低程度,立刻按新值压;没压着时只记下', () => {
    const { bus, ctx, nodes } = setup();
    bus.unlock();
    const g = nodes('bgm').duck.gain;
    bus.setDuckLevel(0.6);
    expect(g.calls).toEqual([]);
    bus.duck('voice', true);
    expect(g.calls.at(-1)).toEqual(['target', 0.6, ctx().currentTime, 0.08]);
    bus.setDuckLevel(2);
    expect(g.calls.at(-1)).toEqual(['target', 1, ctx().currentTime, 0.08]);
  });

  it('解锁之前就开始压:只记状态不出错', () => {
    const { bus } = setup();
    expect(() => bus.duck('voice', true)).not.toThrow();
    expect(() => bus.setDuckLevel(0.5)).not.toThrow();
  });

  it('视觉小说关了:等背景音乐淡完再挂起;这段时间里又打开就不挂', () => {
    const { bus, ctx } = setup();
    bus.unlock();
    bus.setActive(true, 1800);
    expect(bus.active).toBe(true);
    bus.setActive(false, 1800);
    expect(bus.active).toBe(false);
    vi.advanceTimersByTime(1799);
    expect(ctx().suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ctx().suspend).toHaveBeenCalledTimes(1);

    bus.setActive(false, 1800);
    vi.advanceTimersByTime(1000);
    bus.setActive(true, 1800);
    vi.advanceTimersByTime(5000);
    expect(ctx().suspend).toHaveBeenCalledTimes(1);
    // 打开时挂起着就恢复
    expect(ctx().resume).toHaveBeenCalledTimes(2);
  });

  it('切到后台挂起;回来时视觉小说开着才恢复', () => {
    const { bus, doc, ctx } = setup();
    doc.set(true); // 还没解锁:什么也不做
    doc.set(false);
    bus.unlock();
    const c = ctx();
    doc.set(true);
    expect(c.suspend).toHaveBeenCalledTimes(1);
    doc.set(false);
    expect(c.resume).toHaveBeenCalledTimes(1); // 只有解锁那一次
    bus.setActive(true, 1800); // 挂起着,打开时恢复(第 2 次)
    doc.set(true);
    doc.set(false);
    expect(c.suspend).toHaveBeenCalledTimes(2);
    expect(c.resume).toHaveBeenCalledTimes(3);
  });

  it('短音效:解锁前试听另开一个、直接接扬声器;解锁后走总线的声道', () => {
    const { bus, contexts, nodes } = setup();
    const before = bus.shortOut('fx')!;
    expect(contexts).toHaveLength(1);
    expect(before.out).toBe((before.ac as unknown as FakeContext).destination);
    // 另开的那个只开一次
    expect(bus.shortOut('type')!.ac).toBe(before.ac);
    expect(contexts).toHaveLength(1);

    bus.unlock();
    expect(contexts).toHaveLength(2);
    const fx = bus.shortOut('fx')!;
    expect(fx.ac).toBe(bus.context);
    expect(fx.out).toBe(nodes('fx').input);
    expect(bus.shortOut('type')!.out).toBe(nodes('type').input);
  });

  it('切到后台时不叫醒总线(后台不出音效);试听另开的那个不受影响', () => {
    const { bus, doc } = setup();
    const own = bus.shortOut('fx')!.ac;
    bus.unlock();
    const shared = bus.context!;
    expect(bus.mayWake(shared)).toBe(true);
    doc.hidden = true;
    expect(bus.mayWake(shared)).toBe(false);
    expect(bus.mayWake(own)).toBe(true);
  });
});
