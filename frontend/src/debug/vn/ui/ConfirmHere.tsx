import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { confirmKeyAction, hereOutside, popThemeClass, type ConfirmReason, type PopTheme } from './logic';
import { PaperButton } from './PaperButton';
import './ui.css';

/** 被吞掉的那一下点击最多等这么久(毫秒),没来就不再拦 */
const SWALLOW_MS = 600;

/**
 * 就地确认:不弹到屏幕中间,就在那一格上翻出「删除 / 留着」,盖住那一格的下半截(上面那截露着,看得出是哪一格)。
 * 要放在那一格里面(那一格要是定位过的);调用方给那一格挂 is-asking、给整排挂 av-dimrest,别的格子就淡下去。
 * 默认焦点在「留着」;Esc / 点外面 / 留着 都不删(onClose 的 reason 是 esc / outside / keep),点「删除」才是 delete。
 * 点在这一格别处或淡下去的别的格子上:只收起确认,那一下点击被吞掉,不会读档。
 */
export function ConfirmHere({
  title,
  body,
  del = '删除',
  keep = '留着',
  theme = 'white',
  scope,
  coverBelow = '.vn-slot-thumb',
  leaving,
  onClose,
}: {
  title: string;
  body?: string;
  del?: string;
  keep?: string;
  theme?: PopTheme;
  /** 那一整排格子:点在它里面(但不在确认框里)的点击要被吞掉 */
  scope?: RefObject<HTMLElement | null>;
  /** 从这一格里哪个元素的下沿开始盖(默认缩略图) */
  coverBelow?: string;
  leaving?: boolean;
  onClose: (reason: ConfirmReason) => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const delBtn = useRef<HTMLButtonElement>(null);
  const keepBtn = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const host = box.current?.parentElement;
    const pic = host?.querySelector(coverBelow);
    if (host && pic) setTop(Math.round(pic.getBoundingClientRect().bottom - host.getBoundingClientRect().top));
  }, [coverBelow]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusT = window.setTimeout(() => keepBtn.current?.isConnected && keepBtn.current.focus({ preventScroll: true }), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const buttons = [delBtn.current, keepBtn.current];
      const inside = box.current?.contains(document.activeElement) ?? false;
      // Tab 只在确认框已经拿到焦点时才圈住;Esc 随时算「留着」
      const act = confirmKeyAction(e.key, e.shiftKey, buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length);
      if (!act || (act.type === 'focus' && !inside)) return;
      e.preventDefault();
      // 自己吃掉:外面的 Esc(关菜单、退一层)这一下不响
      e.stopPropagation();
      if (act.type === 'close') onCloseRef.current(act.reason);
      else buttons[act.index]?.focus({ preventScroll: true });
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      const action = hereOutside(box.current?.contains(t) ?? false, scope?.current?.contains(t) ?? false);
      if (action === 'ignore') return;
      if (action === 'close-swallow' && scope?.current) {
        const el = scope.current;
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
          off();
        };
        const off = () => {
          el.removeEventListener('click', swallow, true);
          window.clearTimeout(timer);
        };
        el.addEventListener('click', swallow, true);
        // 收起时那一下点击还没到:监听比确认框多活一会儿,点击来了自己摘,没来 SWALLOW_MS 后也摘
        const timer = window.setTimeout(off, SWALLOW_MS);
      }
      onCloseRef.current('outside');
    };
    document.addEventListener('keydown', onKey, true);
    // 晚一拍再接「点外面」:打开它的那一下(点「删除」)别算成点外面
    const downT = window.setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    return () => {
      window.clearTimeout(focusT);
      window.clearTimeout(downT);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      if (opener && opener !== document.body && opener.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
    };
  }, [scope]);

  return (
    <div
      ref={box}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={`${id}t`}
      aria-describedby={body ? `${id}b` : undefined}
      className={`av-here ${popThemeClass(theme)} ${leaving ? 'av-pop-out' : 'av-pop-in'}`}
      style={top == null ? undefined : { top }}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="tx">
        <b id={`${id}t`}>{title}</b>
        {body && <span id={`${id}b`}>{body}</span>}
      </p>
      <div className="ft">
        <PaperButton ref={delBtn} kind="danger" sm onClick={() => onClose('delete')}>
          {del}
        </PaperButton>
        <PaperButton ref={keepBtn} kind="primary" sm onClick={() => onClose('keep')}>
          {keep}
        </PaperButton>
      </div>
    </div>
  );
}
