/**
 * 生图卡带的小控件,样子照视觉小说设置页(vn-set / vn-seg / vn-switch,颜色走 --vn-* 变量):
 * 游戏里「设置 → 生图」、调试台插件页「生图」、画笔的小面板共用。
 * 不 import 设置页的同名组件:卡带加载时会绕回一大串内核模块(见 imagegen.test.ts 开头)。
 */

import type { ReactNode } from 'react';

/** 一排单选按钮 */
export function Seg<T extends string | number | boolean>({
  options,
  value,
  onPick,
}: {
  options: readonly { value: T; name: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="vn-seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onPick(o.value)}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}

/** 设置的一行:左边名字(en 是 NovelAI 网页上的叫法,小字写在下面),右边控件(下面可以跟一行小字);
 *  给了 value 是滑块那种,右边再显示当前值 */
export function Row({
  label,
  en,
  value,
  note,
  children,
}: {
  label: string;
  en?: string;
  value?: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  const name = (
    <span className="vn-set-label">
      {label}
      {en && <span className="ig-en">{en}</span>}
    </span>
  );
  if (value !== undefined) {
    return (
      <div className="vn-set">
        {name}
        {children}
        <span className="vn-set-value">{value}</span>
      </div>
    );
  }
  return (
    <div className="vn-set wide">
      {name}
      <div className="vn-set-stack">
        {children}
        {note && <span className="vn-set-note">{note}</span>}
      </div>
    </div>
  );
}

/** 一页里分几组:组名(主题色,en 是 NovelAI 网页上的叫法)+ 一句说明 */
export function Group({ title, en, note }: { title: ReactNode; en?: string; note?: ReactNode }) {
  return (
    <div className="vn-set-group">
      <span>
        {title}
        {en && <span className="ig-en inline">{en}</span>}
      </span>
      {note && <span className="vn-set-note">{note}</span>}
    </div>
  );
}

/** 开关:勾选框 + 一句话 */
export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="vn-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
