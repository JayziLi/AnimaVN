import type { CSSProperties } from 'react';
import { rangeFill } from './logic';
import './ui.css';

/** 纸面滑块(.av-range):细轨 + 角色色填充 + 白圆钮;填充到哪由 --p 给 */
export function Range({
  value,
  min,
  max,
  step,
  onChange,
  onRelease,
  label,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  /** 松手(指针抬起 / 方向键放开)时;拖完听一声的滑块用 */
  onRelease?: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="range"
      className="av-range"
      value={value}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      disabled={disabled}
      style={{ '--p': rangeFill(value, min, max) } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={onRelease}
      onKeyUp={onRelease}
    />
  );
}
