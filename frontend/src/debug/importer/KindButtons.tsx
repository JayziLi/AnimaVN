/** 没认出来的文件选成什么:「立绘 / 背景 / BGM / CG / 不要」一排连在一起的小按钮(确认框、提示条的小面板共用) */

import type { ClassifyKind } from '../lib/api';
import { CLASSIFY_CHOICES } from './importModel';

export function KindButtons({
  label,
  value,
  disabled,
  onPick,
}: {
  /** 读屏用:「IMG_0231.png 是什么」 */
  label: string;
  /** 选中的那个;null = 还没选 */
  value: ClassifyKind | null;
  disabled?: boolean;
  onPick: (kind: ClassifyKind) => void;
}) {
  return (
    <span className="imp-kinds" role="group" aria-label={label}>
      {CLASSIFY_CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          aria-pressed={value === c.value}
          disabled={disabled}
          onClick={() => onPick(c.value)}
        >
          {c.label}
        </button>
      ))}
    </span>
  );
}
