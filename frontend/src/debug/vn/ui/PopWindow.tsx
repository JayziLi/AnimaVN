/**
 * 游戏上的居中小窗口外壳(10-24 定,设计稿 kit/scene.js 的 AV.popWindow):历史、模型共用。
 * 从游戏画面直接开的才用它(右上「历史」、左上「模型」、滚轮往上);局内菜单里的「历史」还是大面板。
 * 游戏只压暗不糊;窗口的纸跟设置里的「主题」(白 / 黑 / 玻璃);开 0.22s、关 0.18s(外面用 useFadeLayer 管卸载)。
 * Esc 在捕获阶段接住(不然画面上的 Esc 会顺带开菜单);点外面关。
 * 手机竖屏(≤ 640px)是从下面升起来的大半屏(popWindow.css 第 9 段,设计稿 phone.html 的 .pf-hw):按住顶上那行往下拉,
 * 过 DROP_PX 松手就关(接着往下滑走),不够就弹回去。
 */

/** 手机上按住顶上那行往下拉多远松手算关(设计稿 phone.js openSheet:90px) */
const DROP_PX = 90;

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { GameIcon } from './GameIcon';
import { popThemeClass, type PopTheme } from './logic';
import { PHONE_QUERY } from '../settings/usePhone';
import './popWindow.css';

export function PopWindow({
  title,
  en,
  where,
  right,
  width,
  height,
  theme = 'white',
  leaving = false,
  className,
  onClose,
  onEsc,
  children,
}: {
  title: string;
  en?: string;
  /** 标题右边一行小字(模型窗口:「Openrouter · deepseek-v4-pro」) */
  where?: string;
  /** 关闭键左边放的东西(历史:「显示原文」) */
  right?: ReactNode;
  width: number;
  /** 不给 = 跟着内容,最多比画面矮 48 */
  height?: number;
  theme?: PopTheme;
  leaving?: boolean;
  className?: string;
  onClose: () => void;
  /** Esc 先问里面:返回 true = 这一下被里面用掉了(比如在改原文先退出编辑) */
  onEsc?: () => boolean;
  children: ReactNode;
}) {
  const winRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const escRef = useRef(onEsc);
  escRef.current = onEsc;
  const drag = useRef<{ id: number; y0: number; dy: number } | null>(null);
  const [dropped, setDropped] = useState(false);
  const onHeadDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (leaving || e.button !== 0 || !window.matchMedia?.(PHONE_QUERY).matches) return;
    if ((e.target as Element).closest('button, label, input, select, a, .vn-page-note')) return;
    drag.current = { id: e.pointerId, y0: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    winRef.current?.classList.add('is-drag');
  };
  const onHeadMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id || !winRef.current) return;
    d.dy = Math.max(0, e.clientY - d.y0);
    winRef.current.style.translate = `0 ${d.dy.toFixed(1)}px`;
  };
  const onHeadUp = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    const win = winRef.current;
    win?.classList.remove('is-drag');
    if (d.dy > DROP_PX && e.type === 'pointerup') {
      setDropped(true);
      onClose();
      return;
    }
    // 不够:弹回去(transition 在 css 里)
    if (win) win.style.translate = '';
  };

  // 关上以后焦点还给开它的那个(打开那一刻的焦点;里面一打开就有东西抢了焦点也不算)
  const [opener] = useState(() =>
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  useEffect(() => {
    if (leaving) return;
    const back = opener;
    // 里面已经把光标放好了(「改原文」进来的打字框)就别抢走
    if (!winRef.current?.contains(document.activeElement)) winRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (escRef.current?.()) return;
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (back?.isConnected && !back.closest('[inert]')) back.focus({ preventScroll: true });
    };
  }, [leaving, opener]);

  return (
    <div
      className={`vn-pw-layer${leaving ? ' leaving' : ''}${leaving && dropped ? ' dropped' : ''}${className ? ` ${className}` : ''}`}
      // 淡出那 .18s 整层还接住点击,不让点穿到底下的游戏
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="vn-pw-veil" onClick={leaving ? undefined : onClose} />
      <div
        ref={winRef}
        className={`vn-pw-win av-pcard ${popThemeClass(theme)}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        inert={leaving}
        style={{ width, height }}
      >
        <header
          className="vn-pw-head"
          onPointerDown={onHeadDown}
          onPointerMove={onHeadMove}
          onPointerUp={onHeadUp}
          onPointerCancel={onHeadUp}
        >
          <h2 className="vn-pw-title">
            <span className="zh">{title}</span>
            {en && <span className="en">{en}</span>}
          </h2>
          {where && <span className="vn-pw-where">{where}</span>}
          <div className="vn-pw-headr">
            {right}
            <button type="button" className="av-btn vn-pw-x" onClick={onClose} title="关闭(Esc)">
              <GameIcon name="close" size={16} />
              <span>关闭</span>
              <kbd className="av-kbd">Esc</kbd>
            </button>
          </div>
        </header>
        <div className="vn-pw-body">{children}</div>
      </div>
    </div>
  );
}
