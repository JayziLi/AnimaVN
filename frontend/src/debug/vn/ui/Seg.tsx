import './ui.css';

/**
 * 纸面分段(.av-seg):浅槽 + 选中那格白底浮起。
 * 设置页(VNSettingsPage.tsx)、生图卡带的游戏设置页(plugins/imagegen/ui.tsx)都用它。
 * className 可以改成别的(比如过渡期继续用 'vn-seg')。
 */
export function Seg<T extends string | number | boolean>({
  options,
  value,
  onPick,
  className = 'av-seg',
  label,
}: {
  options: readonly { value: T; name: string; disabled?: boolean }[];
  value: T;
  onPick: (v: T) => void;
  className?: string;
  /** 读屏念的这一组的名字 */
  label?: string;
}) {
  return (
    <div className={className} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          disabled={o.disabled}
          onClick={() => onPick(o.value)}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}
