import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeTip } from './logic';
import './ui.css';

/** 触屏点开「?」时,别的「?」收起:谁打开了就广播一下它的 id */
const OPEN_EVENT = 'av-tip-open';

/** 浮层挂到哪:最近的 [data-tip-root],没有就是 .vn-root(游戏画面根,定位过的容器) */
const ROOT_SELECTOR = '[data-tip-root], .vn-root';

/**
 * 名词旁的「?」。
 * hover(电脑):鼠标移上去 / 键盘聚焦时,说明浮层挂到画面根最上层(不会被滚动框裁掉),靠近底边自动翻到上面。
 * tap(手机):点一下在这一行下面展开一段说明(.av-tip-inline,要放在能换行的 flex 行里),再点或点别的「?」收起;
 *   手机上点击区更大的样式要容器上有 class「av-tips-tap」。
 */
export function Help({ tip, mode = 'hover', label = '说明' }: { tip: string; mode?: 'hover' | 'tap'; label?: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (mode !== 'tap') return;
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) setOpen(false);
    };
    window.addEventListener(OPEN_EVENT, onOther);
    return () => window.removeEventListener(OPEN_EVENT, onOther);
  }, [mode, id]);

  // 浮层刚出来时量一下它多大,再算放哪(第一帧先藏着,不闪)
  useLayoutEffect(() => {
    if (mode !== 'hover' || !open) {
      setPos(null);
      return;
    }
    const r = root;
    if (!r || !btn.current || !box.current) return;
    setPos(
      placeTip(
        btn.current.getBoundingClientRect(),
        { w: box.current.offsetWidth, h: box.current.offsetHeight },
        { rect: r.getBoundingClientRect(), w: r.offsetWidth, h: r.offsetHeight },
      ),
    );
  }, [mode, open, root, tip]);

  const show = () => {
    setRoot(btn.current?.closest<HTMLElement>(ROOT_SELECTOR) ?? null);
    setOpen(true);
  };

  if (mode === 'tap') {
    return (
      <>
        <button
          type="button"
          className="av-help"
          aria-label={label}
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            const next = !open;
            setOpen(next);
            if (next) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
          }}
        >
          ?
        </button>
        {open && <p className="av-tip-inline">{tip}</p>}
      </>
    );
  }
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="av-help"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onPointerEnter={show}
        onPointerLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open &&
        root &&
        createPortal(
          <div ref={box} id={id} role="tooltip" className={`av-tipbox${pos ? ' is-on' : ''}`} style={pos ?? { left: 0, top: 0 }}>
            {tip}
          </div>,
          root,
        )}
    </>
  );
}
