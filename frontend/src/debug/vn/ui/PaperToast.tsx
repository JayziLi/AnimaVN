import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { popThemeClass, toastClosable, toastLeftAfterPause, toastLife, toastRole, type PopTheme, type ToastKind } from './logic';
import './ui.css';

export interface ToastItem {
  id: number;
  /** 普通 / 成功 4 秒,出错 8 秒,警告常驻(要手动收) */
  kind?: ToastKind;
  text: ReactNode;
  /** 前面斜体英文小标(Saved / Voice……) */
  en?: string;
  /** 正文下面一行等宽字的英文原文(出错时:text 写短标题,code 写原文) */
  code?: string;
  /** 成功时左边一张小图(存档的场景) */
  thumb?: string;
  /** 行尾一个文字按钮(重试 / 马上试) */
  act?: { name: string; fn: () => void };
  sticky?: boolean;
  ms?: number;
}

const CHECK = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CLOSE = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const STAR = (
  <svg className="av-star" viewBox="-10 -10 20 20" aria-hidden="true">
    <path d="M0-10C1.1-2.6 2.6-1.1 10 0 2.6 1.1 1.1 2.6 0 10-1.1 2.6-2.6 1.1-10 0-2.6-1.1-1.1-2.6 0-10Z" />
  </svg>
);

function ToastIcon({ t }: { t: ToastItem }) {
  if (t.thumb)
    return (
      <span className="ic">
        <img src={t.thumb} alt="" />
      </span>
    );
  if (t.kind === 'ok') return <span className="ic ok">{CHECK}</span>;
  if (t.kind === 'warn' || t.kind === 'err')
    return (
      <span className="ic">
        <i className={`av-dot ${t.kind === 'warn' ? 'warn' : 'bad'}`} />
      </span>
    );
  return <span className="ic">{STAR}</span>;
}

/** 收起动画(av-pop-out 0.18s)放完再摘,比它多留一点给下面的条挪上来 */
const GONE_MS = 260;

/** 一条提示:悬停暂停计时,点一下收起;收起时下面的条慢慢挪上来(grid 行高 1fr → 0fr) */
export function PaperToast({ toast: t, onRemove }: { toast: ToastItem; onRemove: (id: number) => void }) {
  const [closing, setClosing] = useState(false);
  const left = useRef<number | null>(toastLife(t));
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hover = useRef(false);

  const closed = useRef(false);

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setClosing(true);
    setTimeout(() => onRemove(t.id), GONE_MS);
  }, [onRemove, t.id]);

  const run = useCallback(() => {
    if (left.current == null || timer.current || hover.current) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(close, left.current);
  }, [close]);

  // 内容被 set 成另一种(比如警告变成功)时重新算停多久
  useEffect(() => {
    left.current = toastLife({ kind: t.kind, sticky: t.sticky, ms: t.ms });
    run();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [run, t.kind, t.sticky, t.ms, t.text]);

  const pause = () => {
    hover.current = true;
    if (!timer.current || left.current == null) return;
    clearTimeout(timer.current);
    timer.current = null;
    left.current = toastLeftAfterPause(left.current, startedAt.current, Date.now());
  };
  const resume = () => {
    hover.current = false;
    run();
  };

  return (
    <div className={`av-toast-row${closing ? ' is-gone' : ''}`}>
      <div>
        <div
          role={toastRole(t.kind)}
          className={`av-toast is-x is-${t.kind ?? 'info'} ${closing ? 'av-pop-out' : 'av-pop-in'}`}
          onPointerEnter={pause}
          onPointerLeave={resume}
          onClick={close}
        >
          <ToastIcon t={t} />
          {t.en && <i className="en">{t.en}</i>}
          <span className="tx">
            {t.text}
            {t.code && <code className="cd">{t.code}</code>}
          </span>
          {t.act && (
            <button
              type="button"
              className="act"
              onClick={(e) => {
                e.stopPropagation();
                t.act?.fn();
              }}
            >
              {t.act.name}
            </button>
          )}
          {toastClosable(t) && (
            <button type="button" className="x" aria-label="收起" onClick={close}>
              {CLOSE}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 提示条堆。pos:tl 左上 / tr 右上 / bc 底下正中(从下往上叠);theme 是设置里的「主题」(白 / 黑 / 玻璃)。
 * 要放在定位过的容器里(.vn-root)。
 */
export function ToastStack({
  toasts,
  onRemove,
  pos = 'tr',
  offset,
  theme = 'white',
}: {
  toasts: ToastItem[];
  onRemove: (id: number) => void;
  pos?: 'tl' | 'tr' | 'bc';
  /** 离边多远(px),盖掉默认的 24:右上那排按钮下面放 top: 130 */
  offset?: { top?: number; bottom?: number };
  theme?: PopTheme;
}) {
  return (
    <div className={`av-toasts is-${pos} ${popThemeClass(theme)}`} style={offset} aria-live="polite">
      {toasts.map((t) => (
        <PaperToast key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  );
}
