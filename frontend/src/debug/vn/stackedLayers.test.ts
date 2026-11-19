import { describe, expect, it } from 'vitest';
import { pushLayer, spriteFade, visibleLayers, type StackLayer } from './stackedLayers';

const FADE = 200;
const layer = (id: number, enter: boolean, at: number): StackLayer<{ key: string }> => ({ id, view: { key: `k${id}` }, enter, at });
const ids = (ls: StackLayer<{ key: string }>[]) => ls.map((l) => l.id);

describe('visibleLayers:新的一层叠上来前,摘掉被不透明的那张整个盖住的层', () => {
  it('只有一层:原样', () => {
    expect(ids(visibleLayers([layer(1, true, 0)], 10, FADE))).toEqual([1]);
  });

  it('最上面那张已经不淡了(淡完收拾过 / 跳过时直接换上的):只留它', () => {
    expect(ids(visibleLayers([layer(1, false, 0), layer(2, false, 100)], 120, FADE))).toEqual([2]);
  });

  it('最上面那张还在淡入:它下面那张不透明的要留着,不然会透出底下', () => {
    expect(ids(visibleLayers([layer(1, false, 0), layer(2, true, 1000)], 1100, FADE))).toEqual([1, 2]);
  });

  it('连着换得很快:中间那张已经淡完(只是收拾的计时器被推后了),它下面的都摘掉', () => {
    const ls = [layer(1, false, 0), layer(2, true, 1000), layer(3, true, 1150), layer(4, true, 1300)];
    // 第 2 张 1000 开始淡,淡完 + 余量是 1240;第 3 张到 1390 才算淡完
    expect(ids(visibleLayers(ls, 1350, FADE))).toEqual([2, 3, 4]);
    expect(ids(visibleLayers(ls, 1400, FADE))).toEqual([3, 4]);
  });

  it('上面几张都还半透明:一张不摘(最底下那张兜着)', () => {
    const ls = [layer(1, false, 0), layer(2, true, 1000), layer(3, true, 1100)];
    expect(ids(visibleLayers(ls, 1150, FADE))).toEqual([1, 2, 3]);
  });
});

describe('pushLayer:新的一层进来以后留哪几层', () => {
  it('跳过时直接换:只留新的', () => {
    expect(ids(pushLayer([layer(1, false, 0), layer(2, true, 100)], layer(3, false, 150), true, true, 150, FADE))).toEqual([3]);
  });

  it('立绘(一次只混两张):上一张还在淡,先收到底(不再淡、它下面的摘掉),再和新的交叉淡化', () => {
    const out = pushLayer([layer(1, false, 0), layer(2, true, 100)], layer(3, true, 150), false, true, 150, FADE);
    expect(ids(out)).toEqual([2, 3]);
    expect(out.map((l) => l.enter)).toEqual([false, true]);
  });

  it('背景 / CG:接着叠,只摘被完全盖住的', () => {
    const out = pushLayer([layer(1, false, 0), layer(2, true, 100)], layer(3, true, 150), false, false, 150, FADE);
    expect(ids(out)).toEqual([1, 2, 3]);
  });
});

describe('spriteFade:立绘交叉淡化,最上面那张淡入、紧挨着它的那张同时淡出', () => {
  it('正在换:下面那张 leaving,上面那张 entering', () => {
    const ls = [layer(1, false, 0), layer(2, true, 100)];
    expect(ls.map((_, i) => spriteFade(ls, i))).toEqual(['leaving', 'entering']);
  });

  it('淡完了 / 跳过时直接换上的:都不挂', () => {
    expect(spriteFade([layer(1, false, 0)], 0)).toBe('');
  });

  it('第一次出场(只有一张、在淡入):只淡入', () => {
    expect(spriteFade([layer(1, true, 0)], 0)).toBe('entering');
  });
});
