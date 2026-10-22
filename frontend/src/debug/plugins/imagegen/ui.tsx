/**
 * 生图卡带的小控件,样子照视觉小说设置页(vn-set / vn-seg / vn-switch,颜色走 --vn-* 变量):
 * 游戏里「设置 → 生图」、调试台插件页「生图」、画笔的小面板共用。
 * 不 import 设置页的同名组件:卡带加载时会绕回一大串内核模块(见 imagegen.test.ts 开头)。
 */

import { useContext, type ReactNode } from 'react';
import { Tip } from '../../components/drawer/Tip';
import { ConsoleTips } from './consoleTips';

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
  tip,
  children,
}: {
  label: string;
  en?: string;
  value?: string;
  note?: ReactNode;
  /** 说明:游戏设置里写在行下面,插件抽屉里收进名字旁的「?」 */
  tip?: string;
  children: ReactNode;
}) {
  const asTip = useContext(ConsoleTips);
  const name = (
    <span className="vn-set-label">
      {label}
      {tip && asTip && <Tip text={tip} />}
      {en && <span className="ig-en">{en}</span>}
    </span>
  );
  // 滑块那种行(value)下面本来就不写字:说明只在抽屉里出问号
  const line = !asTip && tip ? tip : null;
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
        {line && <span className="vn-set-note">{line}</span>}
        {note && <span className="vn-set-note">{note}</span>}
      </div>
    </div>
  );
}

/** 一页里分几组:组名(主题色,en 是 NovelAI 网页上的叫法)+ 一句说明 */
export function Group({ title, en, note, tip }: { title: ReactNode; en?: string; note?: ReactNode; tip?: string }) {
  const asTip = useContext(ConsoleTips);
  return (
    <div className="vn-set-group">
      <span className="ig-group-title">
        {title}
        {en && <span className="ig-en inline">{en}</span>}
        {tip && asTip && <Tip text={tip} />}
      </span>
      {tip && !asTip && <span className="vn-set-note">{tip}</span>}
      {note && <span className="vn-set-note">{note}</span>}
    </div>
  );
}

/** 两行之间的一段说明:游戏设置里照旧是一段;抽屉里不显示(收进旁边那一行的问号) */
export function Para({ text }: { text: string }) {
  const asTip = useContext(ConsoleTips);
  return asTip ? null : <p className="vn-set-note ig-pad">{text}</p>;
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
