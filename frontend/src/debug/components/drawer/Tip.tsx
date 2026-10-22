/**
 * 名词旁的小问号(第 2 步第四版):悬停 / 键盘聚焦时弹出说明,点一下也能开关(手机),Esc 关。
 *
 * 弹层挂到 document.body、position: fixed,按按钮的位置摆:靠右边缘时往左翻、靠下边缘时往上翻
 * (抽屉 overflow: hidden,普通的绝对定位会被裁掉)。抽屉一滚动就收起,免得弹层留在原地。
 * 说明的字在 tips.ts;样子照画布 v6_drawer.py 的 tip()。
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './drawer.css';
import { TIPS, type TipKey } from './tips';

const WIDTH = 260;
/** 弹层和按钮、和窗口边缘的距离 */
const GAP = 7;
const EDGE = 8;

type Open = 'hover' | 'pinned' | null;

export function Tip(p: { k: TipKey } | { text: string }) {
  const text = 'k' in p ? TIPS[p.k] : p.text;
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState<Open>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useCallback(() => {
    setOpen(null);
    setPos(null);
  }, []);

  // 先不可见地画出来量高度,再摆到按钮下面(放不下就上面)
  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = pop.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.left - 12;
    if (left + WIDTH > vw - EDGE) left = r.right + 12 - WIDTH;
    left = Math.max(EDGE, Math.min(left, vw - EDGE - WIDTH));
    let top = r.bottom + GAP;
    if (top + h > vh - EDGE && r.top - GAP - h >= EDGE) top = r.top - GAP - h;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    // 点在别处:钉住的也收起
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (btn.current?.contains(t) || pop.current?.contains(t))) return;
      close();
    };
    const onScroll = () => close();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`dw-tip${open ? ' open' : ''}`}
        aria-label="说明"
        aria-describedby={open ? id : undefined}
        aria-expanded={open !== null}
        onMouseEnter={() => setOpen((o) => o ?? 'hover')}
        onMouseLeave={() => setOpen((o) => (o === 'hover' ? null : o))}
        onFocus={() => setOpen((o) => o ?? 'hover')}
        onBlur={() => setOpen((o) => (o === 'hover' ? null : o))}
        onClick={(e) => {
          // 问号常在可点的标题行里(<summary>、页签):别让外面跟着响,也别开合 <details>
          e.stopPropagation();
          e.preventDefault();
          setOpen((o) => (o === 'pinned' ? null : 'pinned'));
        }}
      >
        ?
      </button>
      {open &&
        createPortal(
          <span
            ref={pop}
            id={id}
            role="tooltip"
            className="dw-tip-pop"
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}
