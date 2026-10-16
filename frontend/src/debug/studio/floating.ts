/**
 * 浮层(「?」说明、「⋯」菜单、导入提示条的小面板)贴着按钮摆、点外面或 Esc 收起。
 * 从 ui.tsx 拆出来:组件文件只导出组件(快速刷新的要求),导入器的小面板也要用。
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

const EDGE = 8;

/**
 * 浮层贴着 anchor 摆:默认在下面,下面放不下就翻到上面;左右夹在窗口里。
 * 开着时窗口缩放、任何地方滚动都重算(主区、右栏各自会滚)
 */
export function useAnchored(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  float: RefObject<HTMLElement | null>,
  align: 'start' | 'end',
  gap: number,
  shiftX = 0,
): CSSProperties {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const f = float.current;
      if (!a || !f) return;
      const w = f.offsetWidth;
      const h = f.offsetHeight;
      const left = Math.max(EDGE, Math.min(align === 'end' ? a.right - w : a.left + shiftX, window.innerWidth - w - EDGE));
      let top = a.bottom + gap;
      if (top + h > window.innerHeight - EDGE && a.top - gap - h >= EDGE) top = a.top - gap - h;
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      setPos(null);
    };
  }, [open, anchor, float, align, gap, shiftX]);
  // 第一次量尺寸之前先藏着,免得在左上角闪一下
  return pos ?? { top: 0, left: 0, visibility: 'hidden' };
}

/** 浮层开着时:点外面关、Esc 关(抢在视觉小说的 Esc 前面,不让它顺手关掉菜单) */
export function useDismiss(open: boolean, inside: RefObject<HTMLElement | null>[], onClose: () => void) {
  const latest = useRef({ inside, onClose });
  useEffect(() => {
    latest.current = { inside, onClose };
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (latest.current.inside.some((r) => r.current?.contains(e.target as Node))) return;
      latest.current.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
      e.preventDefault();
      latest.current.onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
}
