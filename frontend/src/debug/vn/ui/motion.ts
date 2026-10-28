/**
 * 动效规矩的代码这一半(样子在 motion.css):时长常量、进场动画放完摘 class、出场先淡再卸的控制器和 hook。
 * 数值和 theme.css 的 --av-* 对上:整屏 0.22、上浮 0.32、弹层开 0.22 / 关 0.18、换页 0.16。
 * 这一步只加不接:游戏里还没有地方用。
 */

import { useEffect, useRef, useState } from 'react';

/** 毫秒;和 theme.css / motion.css 里的数对上,改一边记得改另一边 */
export const MOTION = {
  /** 整屏换整屏(--av-t) */
  screen: 220,
  /** 整块上浮(.av-rise 的 av-lift) */
  rise: 320,
  /** 弹层开(.av-pop-in) */
  popIn: 220,
  /** 弹层关(.av-pop-out,--av-t-out) */
  popOut: 180,
  /** 换页交叉淡入(--av-t-fast) */
  page: 160,
} as const;

/** 进场动画的 class:放完要摘 */
export const ENTER_CLASSES = ['av-rise', 'av-fade', 'av-pop-in', 'av-page-in'] as const;

/** animationend 没来(动画被关了、元素被藏起来)时,这么久后也摘 */
export const SETTLE_FALLBACK_MS = 700;

/** 用户在系统里开了「减少动态效果」 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/** 盯着一个 MediaQueryList:变了就回调,返回取消函数。拆出来好用假对象测 */
export function watchMedia(
  mq: { addEventListener?: (t: 'change', f: () => void) => void; removeEventListener?: (t: 'change', f: () => void) => void } | null | undefined,
  onChange: () => void,
): () => void {
  mq?.addEventListener?.('change', onChange);
  return () => mq?.removeEventListener?.('change', onChange);
}

/** 系统「减少动态效果」,跟着系统设置变(进游戏以后再去系统里改也立刻生效) */
export function useReducedMotion(): boolean {
  const [on, setOn] = useState(prefersReducedMotion);
  useEffect(() => {
    const mq = typeof window !== 'undefined' ? window.matchMedia?.(REDUCE_QUERY) : undefined;
    const update = () => setOn(Boolean(mq?.matches));
    update();
    return watchMedia(mq, update);
  }, []);
  return on;
}

interface SettleNode {
  classList: { remove: (...c: string[]) => void };
  addEventListener: (type: 'animationend', fn: (e: { target: unknown }) => void) => void;
  removeEventListener: (type: 'animationend', fn: (e: { target: unknown }) => void) => void;
}

/**
 * 进场动画放完就把 class 摘掉(animationend 或 700ms 兜底,先到先摘)。
 * 为什么:元素身上挂着 animation(fill-mode backwards / both)时,Chrome 里它和子元素的 backdrop-filter(毛玻璃)可能不生效 / 画花。
 * 返回取消函数(元素提前卸了就调)。
 */
export function settle(
  node: SettleNode | null | undefined,
  classes: readonly string[] = ENTER_CLASSES,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  },
): () => void {
  if (!node) return () => {};
  let done = false;
  // 子元素的动画结束也会冒泡上来,只认自己的
  const onEnd = (e: { target: unknown }) => {
    if (e.target === node) off();
  };
  const id = timers.set(() => off(), SETTLE_FALLBACK_MS);
  function off() {
    if (done) return;
    done = true;
    node!.classList.remove(...classes);
    node!.removeEventListener('animationend', onEnd);
    timers.clear(id);
  }
  node.addEventListener('animationend', onEnd);
  return () => {
    done = true;
    node.removeEventListener('animationend', onEnd);
    timers.clear(id);
  };
}

export interface FadeLayerState {
  /** 要不要挂在页面上 */
  mounted: boolean;
  /** 正在出场(挂 .av-pop-out / .av-fade-out) */
  leaving: boolean;
}

/**
 * 弹层的「关的时候先淡出、淡完才卸」。不依赖 React,好用假计时器测。
 * open(true) 马上挂上;open(false) 先 leaving,过 ms 毫秒再卸;减少动态效果时直接卸。
 * 淡出途中又打开:取消卸载,回到正常显示。
 */
export function createFadeLayer(
  initialOpen: boolean,
  onChange: (s: FadeLayerState) => void,
  ms: number = MOTION.popOut,
  reduced: () => boolean = prefersReducedMotion,
) {
  let state: FadeLayerState = { mounted: initialOpen, leaving: false };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const set = (next: FadeLayerState) => {
    if (next.mounted === state.mounted && next.leaving === state.leaving) return;
    state = next;
    onChange(state);
  };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    get state() {
      return state;
    },
    open(isOpen: boolean) {
      cancel();
      if (isOpen) return set({ mounted: true, leaving: false });
      if (!state.mounted) return;
      if (reduced()) return set({ mounted: false, leaving: false });
      set({ mounted: true, leaving: true });
      timer = setTimeout(() => {
        timer = null;
        set({ mounted: false, leaving: false });
      }, ms);
    },
    destroy: cancel,
  };
}

/** createFadeLayer 的 React 包装:open 变了就推给控制器,拿回 { mounted, leaving } */
export function useFadeLayer(open: boolean, ms: number = MOTION.popOut): FadeLayerState {
  const [state, setState] = useState<FadeLayerState>({ mounted: open, leaving: false });
  const ctl = useRef<ReturnType<typeof createFadeLayer> | null>(null);
  const openNow = useRef(open);
  openNow.current = open;
  useEffect(() => {
    const c = createFadeLayer(openNow.current, setState, ms);
    ctl.current = c;
    return () => c.destroy();
    // 控制器只在 ms 变时重建;open 的变化走下面那个 effect
  }, [ms]);
  useEffect(() => {
    ctl.current?.open(open);
  }, [open, ms]);
  return state;
}
