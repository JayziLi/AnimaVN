import { useCallback, useEffect, useRef, useState } from 'react';

/** 换立绘 / 背景时,新图叠在旧图上的淡入时长(和 vn.css 的 .vn-sprite.entering / .vn-bg.entering 一样) */
export const SPRITE_FADE_MS = 200;
export const BG_FADE_MS = 500;

export interface StackLayer<V> {
  id: number;
  view: V;
  /** 这张是淡入进来的;跳过时直接换上来的、第一张(firstEnter 为 false 时)不是 */
  enter: boolean;
  at: number;
}

/** 淡入时长之外再多等这么久才算淡完:CSS 动画要等图挂上、下一帧才开始,比记下的 at 晚一点 */
const SETTLE_SLACK_MS = 40;

/**
 * 新的一层叠上来之前,底下哪些可以摘了:从上往下找第一张完全不透明的(淡完了,或者本来就不淡),
 * 它下面的都被它整个盖住、看不见了。连着换得比淡入还快时(读得快、自动播放),收拾的计时器一直被往后推,
 * 不摘的话一整张一整张的大图会越叠越多,每层都要合成
 */
export function visibleLayers<V>(ls: StackLayer<V>[], now: number, fadeMs: number): StackLayer<V>[] {
  for (let i = ls.length - 1; i > 0; i--) {
    const l = ls[i];
    if (!l.enter || now - l.at >= fadeMs + SETTLE_SLACK_MS) return ls.slice(i);
  }
  return ls;
}

/**
 * 新的一层进来以后的层列表。
 * instant:直接换,只留新的。
 * pairOnly(立绘):真交叉淡化一次只能混两张(两张的透明度加起来必须是 1),上一张还在淡就先把它收到底
 * (变成不透明、它下面的摘掉),再和新的交叉淡化 —— 和 Ren'Py 点一下跳过转场一样。
 * 其余(背景、CG):接着叠,只摘掉被完全盖住的
 */
export function pushLayer<V>(
  ls: StackLayer<V>[],
  l: StackLayer<V>,
  instant: boolean,
  pairOnly: boolean,
  now: number,
  fadeMs: number,
): StackLayer<V>[] {
  if (instant) return [l];
  if (pairOnly) return [{ ...ls[ls.length - 1], enter: false }, l];
  return [...visibleLayers(ls, now, fadeMs), l];
}

/**
 * 立绘第 i 层这一帧挂什么:最上面那张在淡入(entering),紧挨着它下面那张同时淡出(leaving)。
 * vn.css 里两张都用 mix-blend-mode: plus-lighter 叠,算出来正好是逐像素从旧颜色变成新颜色:
 * 旧姿势多出来的手臂、翅膀跟着淡掉,不会一直挂到最后一下子没了(2026-11-19 用户在对比页挑的 C2)
 */
export function spriteFade<V>(ls: StackLayer<V>[], i: number): 'entering' | 'leaving' | '' {
  const top = ls[ls.length - 1];
  if (i === ls.length - 1) return top.enter ? 'entering' : '';
  return top.enter && i === ls.length - 2 ? 'leaving' : '';
}

/**
 * 叠层换图:新图叠在旧图上面淡入,下面的保持不透明,等最上面那张淡完了再把下面的摘掉 ——
 * 画面任何时候都是满的:换背景不会露出黑底,换表情不会两张半透明叠成重影。
 * 连着换得很快时会叠好几层,每层接着自己的淡入,不会从头来、也不会一下变回不透明。
 * instant(跳过 / 按住 Ctrl)= 直接换,不淡,也不叠。
 * 背景、CG 是不透明的整张图,这样叠本来就是标准的交叉淡化;立绘带透明轮廓,用 pairOnly + spriteFade 做真交叉淡化
 */
export function useStackedLayers<V extends { key: string }>(
  view: V,
  instant: boolean,
  fadeMs: number,
  same: (a: V, b: V) => boolean,
  firstEnter: boolean,
): StackLayer<V>[] {
  return useStackedLayersCtl(view, instant, fadeMs, same, firstEnter).layers;
}

/**
 * 同 useStackedLayers,另外给一个 settle():马上收成最上面那一张、不再淡(下面的旧图立刻摘掉)。
 * 立绘换表情时带了动作 / 气泡,放特效前先调它 —— 不然动作开始时旧图还在底下、新图半透明,两张一起跳
 */
export function useStackedLayersCtl<V extends { key: string }>(
  view: V,
  instant: boolean,
  fadeMs: number,
  same: (a: V, b: V) => boolean,
  firstEnter: boolean,
  /** 立绘:一次只混两张,见 pushLayer */
  pairOnly = false,
): { layers: StackLayer<V>[]; settle: () => void } {
  const seq = useRef(0);
  const [layers, setLayers] = useState<StackLayer<V>[]>(() => [{ id: 0, view, enter: firstEnter, at: performance.now() }]);
  const top = layers[layers.length - 1];
  useEffect(() => {
    if (view.key !== top.view.key) {
      const l: StackLayer<V> = { id: ++seq.current, view, enter: !instant, at: performance.now() };
      setLayers((ls) =>
        ls[ls.length - 1].view.key === view.key ? ls : pushLayer(ls, l, instant, pairOnly, performance.now(), fadeMs),
      );
    }
    // 同一张图只是挪了位置 / 改了焦点:原地更新,不走淡入
    else if (!same(view, top.view)) setLayers((ls) => ls.map((x, i) => (i === ls.length - 1 ? { ...x, view } : x)));
  }, [view, top.view, instant, same, fadeMs, pairOnly]);
  // 最上面那张淡完以后:摘掉它下面的,自己也摘掉 entering(动画放完还挂着 fill 的话,
  // 整屏背景会一直单独占一个合成层,毛玻璃每帧都要重算,实测帧率从 58 掉到 20 左右)。
  // 单独一个 effect:和上面写在一起的话,setLayers 引起的重跑会先执行清理函数,把这个计时器清掉
  useEffect(() => {
    if (layers.length < 2 && !top.enter) return;
    const wait = top.enter ? Math.max(0, fadeMs - (performance.now() - top.at)) + SETTLE_SLACK_MS : 0;
    const id = top.id;
    const t = window.setTimeout(
      () => setLayers((ls) => (ls[ls.length - 1].id === id ? [{ ...ls[ls.length - 1], enter: false }] : ls)),
      wait,
    );
    return () => window.clearTimeout(t);
  }, [layers, top, fadeMs]);
  const settle = useCallback(
    () => setLayers((ls) => (ls.length < 2 && !ls[ls.length - 1].enter ? ls : [{ ...ls[ls.length - 1], enter: false }])),
    [],
  );
  return { layers, settle };
}
