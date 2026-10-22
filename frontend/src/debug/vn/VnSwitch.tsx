/**
 * 游戏设置里的开关(滑块):只有开 / 关两种的设置用它(立绘特效、语音、思考过程……),
 * 二选一但两边都有名字的(先出文字 / 等语音、跟着表情 / 不变)照旧用 Seg。
 *
 * 键盘:Tab 到它上面按空格或回车切换。画面上的空格 / 回车是「下一句」(VNScreen 挂在 window 上),
 * 右上角语音面板不在菜单里,所以这里自己接住按键并标成已处理(preventDefault),
 * 不然按下去是翻页而不是切开关;keyup 的空格也拦掉,免得浏览器再补一次点击。
 *
 * 内核不能 import 卡带文件夹(cartridges.boundary.test.ts),所以不用生图卡带的 Toggle,自己写一个。
 */

import type { KeyboardEvent } from 'react';

export function VnSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 读屏念的名字,一般就是这一行的名字 */
  label: string;
  disabled?: boolean;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat && !disabled) onChange(!checked);
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`vn-toggle${checked ? ' on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => {
        if (e.key === ' ') e.preventDefault();
      }}
    >
      <span className="vn-toggle-knob" aria-hidden="true" />
    </button>
  );
}
