/**
 * 生图卡带的小控件:调试台插件抽屉(place="console")里样子不变(vn-set / vn-seg / vn-switch,颜色走 --vn-* 变量);
 * 游戏设置页(place="game")里 10-25 起改用内核给的行组件(settings/SettingRow、ui/Seg),和设置页其余几栏同一套样子
 * (U18:AI 生图转正式版,「卡带只用内核给的行组件」—— 这两个组件都是轻量模块,不会像以前那样绕回一大串内核模块,
 * 卡带边界测试 cartridges.boundary.test.ts 照样过:它只管「内核不许 import 卡带」,卡带 import 内核一直是允许的)。
 * 两边用哪一套由 ConsoleTips 这个 context 认(插件抽屉传 true,游戏设置页传 false,见 ImageGenSettings.tsx)。
 */

import { useContext, type ReactNode } from 'react';
import { Tip } from '../../components/drawer/Tip';
import { Seg as KernelSeg } from '../../vn/ui/Seg';
import { SettingGroupHead, SettingRow } from '../../vn/settings/SettingRow';
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
  const asTip = useContext(ConsoleTips);
  if (!asTip) return <KernelSeg className="av-seg st-seg" options={options} value={value} onPick={onPick} />;
  // 调试台插件抽屉:照旧,不动(ui-plugins 那边的事)
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
  /** 说明:游戏设置里收进名字旁的「?」(10-25 起和设置页其余行一个样子);插件抽屉里也是「?」 */
  tip?: string;
  children: ReactNode;
}) {
  const asTip = useContext(ConsoleTips);
  if (!asTip) {
    return (
      <SettingRow name={label} en={en} tip={tip} value={value} note={note}>
        {children}
      </SettingRow>
    );
  }
  // 调试台插件抽屉:照旧,不动
  const name = (
    <span className="vn-set-label">
      {label}
      {tip && <Tip text={tip} />}
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
export function Group({ title, en, note, tip }: { title: ReactNode; en?: string; note?: ReactNode; tip?: string }) {
  const asTip = useContext(ConsoleTips);
  if (!asTip) {
    return <SettingGroupHead title={title} en={en} note={note ?? tip} />;
  }
  // 调试台插件抽屉:照旧,不动
  return (
    <div className="vn-set-group">
      <span className="ig-group-title">
        {title}
        {en && <span className="ig-en inline">{en}</span>}
        {tip && <Tip text={tip} />}
      </span>
      {note && <span className="vn-set-note">{note}</span>}
    </div>
  );
}

/** 两行之间的一段说明:游戏设置里照旧是一段;抽屉里不显示(收进旁边那一行的问号) */
export function Para({ text }: { text: string }) {
  const asTip = useContext(ConsoleTips);
  if (asTip) return null;
  return <p className="st-note ig-pad">{text}</p>;
}

/** 开关:勾选框 + 一句话(两边都用这个样子;颜色跟 --vn-accent,在设置页的纸面板里跟着往下传到角色色) */
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
