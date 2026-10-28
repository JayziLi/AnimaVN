/**
 * 游戏里的导入 / 导出弹层外壳(设计稿 kit/transfer.js 的 dialog,导入导出页 A「在游戏里就地完成」):
 * 中间一张纸卡(和选角色左边面板同一种纸),宋体标题 + 斜体英文小字,下面一道细线(左端一小段点缀色);
 * 底下一排按钮,上面一道细线。纸跟设置 · 外观 ·「主题」(白 / 黑 / 玻璃)。界面上只留标题、值、按钮,说明收进「?」。
 *
 * 调试台里(游戏没开)导入导出还是原来那套深色弹窗;游戏开着时(画面上有 .vn-root)换成这一张 —— 见 inGame()。
 * 挂在 body 上一个固定层里(和确认框一样盖过游戏 90、卡编辑器 92),「?」的说明浮层也挂在这一层里(data-tip-root)。
 * Esc / 点外面 = onCancel;sticky 时点外面不关(导入中只能点「取消」)。
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { popThemeClass } from '../../vn/ui/logic';
import { usePaperTheme } from '../../vn/usePaperTheme';
import '../../vn/theme.css';
import '../../vn/ui/ui.css';
import './transfer.css';

export function TransferDialog({
  title,
  en,
  width,
  className,
  sticky = false,
  onCancel,
  foot,
  children,
}: {
  title: ReactNode;
  en: string;
  width: number;
  className?: string;
  sticky?: boolean;
  onCancel: () => void;
  foot: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const theme = usePaperTheme();
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  // Esc 抢在游戏前面(它在窗口上听 Esc 开关菜单、退出选角色);输入法选字时的 Esc 不管
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="tf-host" data-tip-root="">
      <div className="tf-scrim av-fade" onClick={sticky ? undefined : () => cancel.current()} />
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`tf-dlg ${popThemeClass(theme, true)} av-pop-in${className ? ` ${className}` : ''}`}
        style={{ width }}
      >
        <div className="tf-dh">
          <h3 id={titleId}>{title}</h3>
          <span className="en">{en}</span>
        </div>
        {children}
        <div className="tf-df">{foot}</div>
      </div>
    </div>,
    document.body,
  );
}
