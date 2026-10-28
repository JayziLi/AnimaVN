import { useEffect, useState, type RefObject } from 'react';

export interface BoxSize {
  w: number;
  h: number;
}

/** 设计稿的画板:电脑 1440×810,手机竖屏 390×844 */
export const DESK_BOARD: BoxSize = { w: 1440, h: 810 };
export const PHONE_BOARD: BoxSize = { w: 390, h: 844 };

/**
 * 一个元素现在多大(ResizeObserver)。第一次渲染时它还没量出来,先用窗口的大小顶着,免得头一帧是 0 × 0。
 * 选角色、加载页用它判横竖屏、算「设计稿上的 1px 现在是几个像素」。
 */
export function useBoxSize(ref: RefObject<HTMLElement | null>): BoxSize {
  const [size, setSize] = useState<BoxSize>(() =>
    // 没有窗口(服务端渲染、node 里跑测试)时按电脑画板
    typeof window === 'undefined' ? DESK_BOARD : { w: window.innerWidth, h: window.innerHeight },
  );
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** 竖屏:宽比高小(和封面、加载页判横竖屏的口径一样) */
export const isPortrait = (s: BoxSize) => s.w < s.h;

/** 这块屏上设计稿的 1px 是几个像素:按横竖屏各自的画板取短边的比例 */
export function boardScale(s: BoxSize): number {
  const b = isPortrait(s) ? PHONE_BOARD : DESK_BOARD;
  return Math.min(s.w / b.w, s.h / b.h);
}
