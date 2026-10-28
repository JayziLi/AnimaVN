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

/**
 * 叠层换图:新图叠在旧图上面淡入,下面的保持不透明,等最上面那张淡完了再把下面的摘掉 ——
 * 画面任何时候都是满的:换背景不会露出黑底,换表情不会两张半透明叠成重影。
 * 连着换得很快时会叠好几层,每层接着自己的淡入,不会从头来、也不会一下变回不透明。
 * instant(跳过 / 按住 Ctrl)= 直接换,不淡,也不叠
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
): { layers: StackLayer<V>[]; settle: () => void } {
  const seq = useRef(0);
  const [layers, setLayers] = useState<StackLayer<V>[]>(() => [{ id: 0, view, enter: firstEnter, at: performance.now() }]);
  const top = layers[layers.length - 1];
  useEffect(() => {
    if (view.key !== top.view.key) {
      const l: StackLayer<V> = { id: ++seq.current, view, enter: !instant, at: performance.now() };
      setLayers((ls) => (ls[ls.length - 1].view.key === view.key ? ls : instant ? [l] : [...ls, l]));
    }
    // 同一张图只是挪了位置 / 改了焦点:原地更新,不走淡入
    else if (!same(view, top.view)) setLayers((ls) => ls.map((x, i) => (i === ls.length - 1 ? { ...x, view } : x)));
  }, [view, top.view, instant, same]);
  // 最上面那张淡完以后:摘掉它下面的,自己也摘掉 entering(动画放完还挂着 fill 的话,
  // 整屏背景会一直单独占一个合成层,毛玻璃每帧都要重算,实测帧率从 58 掉到 20 左右)。
  // 单独一个 effect:和上面写在一起的话,setLayers 引起的重跑会先执行清理函数,把这个计时器清掉
  useEffect(() => {
    if (layers.length < 2 && !top.enter) return;
    const wait = top.enter ? Math.max(0, fadeMs - (performance.now() - top.at)) + 40 : 0;
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
