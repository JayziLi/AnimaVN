import { useEffect, useId, useRef, useState } from 'react';
import { popThemeClass, type PopTheme } from './logic';
import { MOTION, useFadeLayer } from './motion';
import { PaperButton } from './PaperButton';
import { Switch } from './Switch';
import './ui.css';

const STAR = (
  <svg className="av-star" viewBox="-10 -10 20 20" aria-hidden="true">
    <path d="M0-10C1.1-2.6 2.6-1.1 10 0 2.6 1.1 1.1 2.6 0 10-1.1 2.6-2.6 1.1-10 0-2.6-1.1-1.1-2.6 0-10Z" />
  </svg>
);

/** 换声音以后问不问换语言;toJa = 勾上以后切到日语(否则切到中文) */
export interface LangAsk {
  id: number;
  toJa: boolean;
}

/**
 * 换了主声音、新声音的语言和这张卡现在写的不一样时弹(11-05 用户定):「这个声音只识别日语 / 中文 · 是否更换对话语言？」,一个开关「切换为日语 / 中文」,点一下就切,
 * 不点就不切,再点「确定」。Esc、点外面 = 确定但不切(语言不变,声音照换)。
 * 和确认框放在同一个最外层固定层里(.av-confirm-host),从游戏、调试台都盖得住;关的时候先淡出再卸
 */
export function LangAskHost({
  ask,
  theme = 'white',
  onDone,
}: {
  ask: LangAsk | null;
  theme?: PopTheme;
  /** switchLang = 开关开着点的确定 */
  onDone: (switchLang: boolean) => void;
}) {
  const last = useRef<LangAsk | null>(null);
  if (ask) last.current = ask;
  const layer = useFadeLayer(ask !== null, MOTION.popOut);
  const shown = ask ?? last.current;
  if (!layer.mounted || !shown) return null;
  return (
    <div className="av-confirm-host">
      <LangAskDialog key={shown.id} toJa={shown.toJa} theme={theme} leaving={layer.leaving} onDone={onDone} />
    </div>
  );
}

export function LangAskDialog({
  toJa,
  theme = 'white',
  leaving,
  onDone,
}: {
  toJa: boolean;
  theme?: PopTheme;
  leaving?: boolean;
  onDone: (switchLang: boolean) => void;
}) {
  const titleId = useId();
  const [on, setOn] = useState(false);
  const okBtn = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    okBtn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      doneRef.current(false);
    };
    // 和确认框一样挂在 window 的捕获阶段:画面上的 Esc 不会顺带开菜单
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const label = toJa ? '切换为日语（中文字幕）' : '切换为中文';
  return (
    <>
      <div className={`av-scrim ${leaving ? 'av-fade-out' : 'av-fade'}`} onClick={() => onDone(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`av-dlg av-langask ${popThemeClass(theme)} ${leaving ? 'av-pop-out' : 'av-pop-in'}`}
      >
        <div className="hd">
          {STAR}
          <h3 id={titleId}>{toJa ? '这个声音只识别日语' : '这个声音只识别中文'}</h3>
          <span className="av-eyebrow">Language</span>
        </div>
        <p className="msg">是否更换对话语言？</p>
        <label className="av-langask-row">
          <Switch checked={on} onChange={setOn} label={label} />
          <span>{label}</span>
        </label>
        <div className="ft">
          <PaperButton ref={okBtn} kind="primary" onClick={() => onDone(on)}>
            确定
          </PaperButton>
        </div>
      </div>
    </>
  );
}
