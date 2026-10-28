import './ui.css';

/**
 * 纸面开关(.av-switch,40×22;sm = 34×19)。底下是真的 checkbox,键盘、读屏、表单都照原生的来。
 * 游戏里现在用的 VnSwitch(.vn-toggle)尺寸、样子不一样,这一步不换;换皮时再换。
 */
export function Switch({
  checked,
  onChange,
  label,
  sm,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 读屏念的名字,一般就是这一行的名字 */
  label: string;
  sm?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={`av-switch${sm ? ' sm' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span aria-hidden="true" />
    </label>
  );
}
