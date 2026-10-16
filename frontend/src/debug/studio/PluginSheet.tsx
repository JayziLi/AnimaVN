/**
 * 插件抽屉(DebugApp 的 renderPluginsDrawer)开在卡编辑器上面:调试台的抽屉被卡编辑器盖着,
 * 从卡编辑器里要打开插件(资料页点预设里的插件块、「AI 生成」那一栏的「生图设置」)就开在这一层里,关掉还回到原处。
 *
 * 点背景、Esc 关。带 st-layer —— 开着时卡编辑器的 Esc 不关整页,交给这里。
 * 挂到 body 上,层级照 studio.css 顶上那张表:从卡编辑器里打开的旧抽屉 95;顶栏 52 不盖。
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** 输入框里的 Esc 留给输入框自己(插件里给包改名时是「取消」) */
function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  return t instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'file', 'color'].includes(t.type);
}

export function PluginSheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
      // 不管关不关都吃掉:底下的视觉小说也在窗口上听 Esc
      e.preventDefault();
      if (isTextField(e.target)) return;
      latest.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  // 点背景要按下和松开都在背景上才算:从抽屉里拖选出来松手不算
  const downOnBackdrop = useRef(false);
  return createPortal(
    <div
      className="st-sheet st-layer"
      onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) latest.current();
        downOnBackdrop.current = false;
      }}
    >
      <div className="st-sheet-box">{children}</div>
    </div>,
    document.body,
  );
}
