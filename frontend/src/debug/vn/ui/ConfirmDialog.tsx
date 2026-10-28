import { useEffect, useId, useRef, type ReactNode } from 'react';
import { confirmKeyAction, popThemeClass, type ConfirmReason, type PopTheme } from './logic';
import { PaperButton } from './PaperButton';
import './ui.css';

const STAR = (
  <svg className="av-star" viewBox="-10 -10 20 20" aria-hidden="true">
    <path d="M0-10C1.1-2.6 2.6-1.1 10 0 2.6 1.1 1.1 2.6 0 10-1.1 2.6-2.6 1.1-10 0-2.6-1.1-1.1-2.6 0-10Z" />
  </svg>
);

/**
 * 确认框:只给「删了找不回来」的事(删存档、删角色卡)。
 * 默认焦点在「留着」,误按回车删不掉;Esc、点外面、「留着」都是不删(onClose 的 reason 分别是 esc / outside / keep,
 * 点「删除」是 delete);Tab 只在框里的两个按钮之间转;关掉后焦点回到打开它的那个按钮。
 * 要放在定位过的容器里(.vn-root)。进出场动画:进场自带 av-pop-in;出场由调用方(useFadeLayer)传 leaving 挂 av-pop-out。
 */
export function ConfirmDialog({
  title,
  body,
  en = 'Delete',
  del = '删除',
  keep = '留着',
  theme = 'white',
  leaving,
  onClose,
}: {
  title: ReactNode;
  body?: ReactNode;
  en?: string;
  del?: string;
  keep?: string;
  theme?: PopTheme;
  leaving?: boolean;
  onClose: (reason: ConfirmReason) => void;
}) {
  const titleId = useId();
  const delBtn = useRef<HTMLButtonElement>(null);
  const keepBtn = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    keepBtn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      const buttons = [delBtn.current, keepBtn.current];
      const act = confirmKeyAction(e.key, e.shiftKey, buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length);
      if (!act) return;
      e.preventDefault();
      if (act.type === 'close') onCloseRef.current(act.reason);
      else buttons[act.index]?.focus({ preventScroll: true });
    };
    // 挂在 window 的捕获阶段:比块编辑弹窗那种也挂在 window 上的 Esc 排得晚,但都能收到
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <>
      <div className={`av-scrim ${leaving ? 'av-fade-out' : 'av-fade'}`} onClick={() => onClose('outside')} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`av-dlg ${popThemeClass(theme)} ${leaving ? 'av-pop-out' : 'av-pop-in'}`}
      >
        <div className="hd">
          {STAR}
          <h3 id={titleId}>{title}</h3>
          <span className="av-eyebrow">{en}</span>
        </div>
        {body != null && body !== '' && <div className="msg">{body}</div>}
        <div className="ft">
          <PaperButton ref={delBtn} kind="danger" onClick={() => onClose('delete')}>
            {del}
          </PaperButton>
          <PaperButton ref={keepBtn} kind="primary" onClick={() => onClose('keep')}>
            {keep}
          </PaperButton>
        </div>
      </div>
    </>
  );
}
