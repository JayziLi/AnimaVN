/**
 * 试听用的圆按钮(▶ / ⏸)和播放条上的小音浪。背景栏舞台左下角、右栏「默认 BGM」、BGM 栏的曲目表都用它。
 * solid = 浅色实心(画布里的 round_play);ghost = 描边的小圆(表格每一行,正在放的那行变成实心)
 */

import { Icon } from './icons';

export function PlayButton({
  playing,
  size = 32,
  kind = 'solid',
  label,
  disabled,
  onClick,
}: {
  playing: boolean;
  size?: number;
  kind?: 'solid' | 'ghost';
  /** 读屏和悬停说明;不给就是「试听」/「停止试听」 */
  label?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const text = label ?? (playing ? '停止试听' : '试听');
  return (
    <button
      type="button"
      className={`st-play ${kind}${playing ? ' on' : ''}`}
      style={{ width: size, height: size }}
      aria-label={text}
      title={text}
      disabled={disabled}
      onClick={(e) => {
        // 按钮常在一行可以点的东西里(选中这一行),别让那一行也跟着响
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon name={playing ? 'pause' : 'play'} size={Math.round(size * 0.42)} />
    </button>
  );
}

// 音浪的高低(0–1):中间高两头低,看着像一段曲子;固定的,不是真的波形
const BARS = Array.from({ length: 22 }, (_, i) => {
  const t = i / 22;
  const env = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.6;
  return 0.25 + 0.75 * env * (0.55 + 0.45 * Math.abs(Math.sin(i * 2.3 + 1)));
});

/** 播放条上的小音浪:放着时跳,没放时是静止的灰条 */
export function SoundBars({ playing }: { playing: boolean }) {
  return (
    <span className={`st-bars${playing ? ' on' : ''}`} aria-hidden="true">
      {BARS.map((h, i) => (
        <i key={i} style={{ height: `${Math.round(h * 100)}%`, animationDelay: `${-(i % 7) * 0.13}s` }} />
      ))}
    </span>
  );
}
