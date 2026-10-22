/**
 * 卡编辑器 / 素材管理的界面小部件,样子照画布第四版(v4_boards.py 的 btn / tip / section / select_row …)。
 * 类名一律 st- 开头(studio.css);颜色只用 debug.css 的 :root 变量。
 *
 * 浮在上面的东西(「?」说明、「⋯」菜单、确认框)挂到 body 上、用 fixed 定位:
 * 主区和右栏都会滚,留在原地会被裁掉;手机上栏还会给 fixed 元素另起包含块。
 * 它们开着时根节点带 st-layer 类 —— 卡编辑器的 Esc 看到有 st-layer 就不关整页,交给它们自己关。
 */

import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { SaveState } from '../components/CardPanel';
import { LABEL_MAX } from '../plugins/common';
import { useAnchored, useDismiss } from './floating';
import { Icon, type IconName } from './icons';
import { PanelCollapseButton } from './panelParts';
import { InspectorCollapse } from './sidePanels';
import { SLOT_NAMES } from './slotSummary';
import type { SlotKey } from './types';

// ---------------------------------------------------------------- 「?」说明

/** 名词旁的小圆圈:悬停、键盘聚焦或点一下显示说明(250px 宽的深色气泡),再点、点外面或 Esc 收起 */
export function HelpTip({ text }: { text: string }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || focus || pinned;
  const btn = useRef<HTMLButtonElement | null>(null);
  const tip = useRef<HTMLSpanElement | null>(null);
  const id = useId();
  const style = useAnchored(open, btn, tip, 'start', 8, -12);
  useDismiss(open, [btn], () => {
    setPinned(false);
    setHover(false);
    setFocus(false);
  });
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="st-help"
        aria-label="说明"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          setPinned(false);
        }}
        onClick={(e) => {
          // 「?」可能在一行可以点的东西里,别让那一行也跟着响
          e.stopPropagation();
          // 钉住了再点 = 收起(手机上点一下开、再点一下关;悬停 / 聚焦的状态一起清掉)
          if (pinned) {
            setPinned(false);
            setHover(false);
            setFocus(false);
          } else setPinned(true);
        }}
      >
        ?
      </button>
      {open &&
        createPortal(
          <span ref={tip} id={id} role="tooltip" className="st-tip st-layer" style={style}>
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}

// ---------------------------------------------------------------- 标题、标签

/** 右栏里一节的标题行(上面一条分隔线,first 不画):标题、「?」、右边的按钮;note 是标题下面一行小字 */
export function Section({
  title,
  help,
  right,
  note,
  first,
  children,
}: {
  title: ReactNode;
  help?: string;
  right?: ReactNode;
  note?: ReactNode;
  first?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <div className={`st-section${first ? ' first' : ''}`}>
        <span className="st-section-title">{title}</span>
        {help && <HelpTip text={help} />}
        <span className="st-flex" />
        {right}
      </div>
      {note && <div className="st-section-note">{note}</div>}
      {children}
    </>
  );
}

/** 输入框上面的小标签 */
export function FieldLabel({ text, help }: { text: ReactNode; help?: string }) {
  return (
    <div className="st-label">
      {text}
      {help && <HelpTip text={help} />}
    </div>
  );
}

/** 小圆角标签(「★ 默认差分」「AI 生成」这类) */
export function Chip({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return <span className={`st-chip${strong ? ' strong' : ''}`}>{children}</span>;
}

// ---------------------------------------------------------------- 输入

/** 多行文本:打字只改自己,失焦才交出去(onCommit);外面的值变了(换了一张)就跟着换 */
export function CommitTextarea({
  value,
  rows = 3,
  placeholder,
  disabled,
  onCommit,
}: {
  value: string;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }
  // 没失焦就被卸掉(Esc 关整页、切栏)时也交出去;失焦时交过的同一份不再交
  const latest = useRef({ draft, value, onCommit, sent: value });
  useLayoutEffect(() => {
    latest.current.draft = draft;
    latest.current.value = value;
    latest.current.onCommit = onCommit;
  });
  useLayoutEffect(() => {
    latest.current.sent = value;
  }, [value]);
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.draft !== l.value && l.draft !== l.sent) l.onCommit(l.draft);
    },
    [],
  );
  const commit = () => {
    if (draft === value) return;
    latest.current.sent = draft;
    onCommit(draft);
  };
  return (
    <textarea
      className="st-textarea"
      rows={rows}
      style={{ minHeight: rows * 21 + 18 }}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
    />
  );
}

/** 一串小标签(别名这类):回车加、× 删、末尾「＋ 添加」;粘贴一串用逗号隔开的也行 */
export function TagsField({
  values,
  onChange,
  placeholder = '输入后回车',
  disabled,
}: {
  values: readonly string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const add = () => {
    const next = [...values];
    for (const part of text.split(/[,，\n]/)) {
      const word = part.trim();
      if (word && !next.includes(word)) next.push(word);
    }
    setText('');
    if (next.length !== values.length) onChange(next);
  };
  return (
    <div className="st-tags">
      {values.map((v, i) => (
        <span key={`${i}:${v}`} className="st-tag">
          {v}
          {!disabled && (
            <button
              type="button"
              className="st-tag-x"
              aria-label={`删掉「${v}」`}
              title="删掉"
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              <Icon name="x" size={11} strokeWidth={2.2} />
            </button>
          )}
        </span>
      ))}
      {adding ? (
        <input
          className="st-tag-input"
          autoFocus
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            } else if (e.key === 'Escape') {
              setText('');
              setAdding(false);
            }
          }}
          onBlur={() => {
            add();
            setAdding(false);
          }}
        />
      ) : (
        !disabled && (
          <button type="button" className="st-tag-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={12} strokeWidth={2.2} />
            添加
          </button>
        )
      )}
    </div>
  );
}

/** 一行文字标签(定宽,放得下「?」)+ 后面的控件 */
function RowLabel({ label, help }: { label: ReactNode; help?: string }) {
  return (
    <span className="st-row-label">
      {label}
      {help && <HelpTip text={help} />}
    </span>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  /** 右边灰字(所在包名这类) */
  sub?: string;
}

/**
 * 下拉框本身(不带前面的标签):样子照图(值 + 右边灰字 + ⌄),点开是系统自带的选择列表(手机上好用、键盘能操作)。
 * value 为 '' 的那一项(「无」「不换」)显示成灰字
 */
export function SelectBox({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  /** 读屏用的名字 */
  label?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div className={`st-select${value === '' ? ' empty' : ''}${disabled ? ' disabled' : ''}`}>
      <span className="st-select-value">{current?.label ?? value}</span>
      {current?.sub && <span className="st-select-sub">{current.sub}</span>}
      <Icon name="chev" size={14} />
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.sub ? `${o.label}　${o.sub}` : o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 一行下拉:前面定宽的标签(放得下「?」)+ SelectBox */
export function SelectRow({
  label,
  help,
  value,
  options,
  onChange,
  disabled,
}: {
  label: ReactNode;
  help?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="st-row">
      <RowLabel label={label} help={help} />
      <SelectBox
        label={typeof label === 'string' ? label : undefined}
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}

/** 滑块:拖的时候 onChange(只改内存、跟手),松手 / 键盘调完 onCommit(写库) */
export function SliderRow({
  label,
  help,
  min,
  max,
  step,
  value,
  format,
  note,
  disabled,
  onChange,
  onCommit,
}: {
  label: ReactNode;
  help?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  note?: ReactNode;
  disabled?: boolean;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const pct = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  const commit = (el: HTMLInputElement) => onCommit(Number(el.value));
  return (
    <>
      <div className="st-row slider">
        <RowLabel label={label} help={help} />
        <input
          type="range"
          className="st-range"
          aria-label={typeof label === 'string' ? label : undefined}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          style={{ '--pct': `${pct}%` } as CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={(e) => commit(e.currentTarget)}
          onKeyUp={(e) => {
            if (/^(Arrow|Page|Home|End)/.test(e.key)) commit(e.currentTarget);
          }}
        />
        <span className="st-row-value">{format(value)}</span>
      </div>
      {note && <div className="st-row-note">{note}</div>}
    </>
  );
}

/** 开关一行:整行都能点 */
export function SwitchRow({
  label,
  checked,
  note,
  disabled,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  note?: ReactNode;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className="st-switch-row"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="st-switch-label">{label}</span>
        <span className={`st-switch${checked ? ' on' : ''}`} aria-hidden="true">
          <span className="st-switch-knob" />
        </span>
      </button>
      {note && <div className="st-switch-note">{note}</div>}
    </>
  );
}

/** 一个数字小框:打字只改自己,回车 / 失焦才交出去;不是数字就退回原值,超范围夹回去 */
function NumberBox({
  label,
  value,
  min,
  max,
  digits,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  digits: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const shown = String(Number(value.toFixed(digits)));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() === '' || !Number.isFinite(n)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <input
      className="st-num"
      inputMode="decimal"
      aria-label={label}
      value={draft ?? shown}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** 两个数字一行(偏移 X / Y 这类);单位由用的地方定,这里只管显示和输入 */
export function NumberPair({
  label,
  x,
  y,
  xLabel = 'X',
  yLabel = 'Y',
  min,
  max,
  digits = 2,
  hint,
  disabled,
  onCommit,
}: {
  label: ReactNode;
  x: number;
  y: number;
  xLabel?: string;
  yLabel?: string;
  min?: number;
  max?: number;
  /** 显示几位小数(去掉末尾的 0) */
  digits?: number;
  /** 行尾 ✥ 图标悬停的说明,比如「可在预览中直接拖动」;不给就不画 */
  hint?: string;
  disabled?: boolean;
  onCommit: (x: number, y: number) => void;
}) {
  const name = typeof label === 'string' ? label : '';
  return (
    <div className="st-row">
      <RowLabel label={label} />
      <span className="st-num-axis">{xLabel}</span>
      <NumberBox
        label={`${name} ${xLabel}`}
        value={x}
        min={min}
        max={max}
        digits={digits}
        disabled={disabled}
        onCommit={(v) => onCommit(v, y)}
      />
      <span className="st-num-axis">{yLabel}</span>
      <NumberBox
        label={`${name} ${yLabel}`}
        value={y}
        min={min}
        max={max}
        digits={digits}
        disabled={disabled}
        onCommit={(v) => onCommit(x, v)}
      />
      <span className="st-flex" />
      {hint && (
        <span className="st-num-hint" title={hint}>
          <Icon name="move" size={15} />
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 右栏

/** 右栏(340px):头(选中的那一张)、可以滚的中间、底部按钮行 */
export function Inspector({
  head,
  children,
  footer,
  label,
}: {
  head?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** 读屏用的名字,比如「调整「微笑」」 */
  label?: string;
}) {
  // 页面让右栏能收(素材管理,sidePanels.tsx):有头的放在头的右上角,没头的单独一行
  const collapse = useContext(InspectorCollapse);
  const collapseBtn = collapse && <PanelCollapseButton side="right" label="右栏" onClick={collapse} />;
  return (
    <aside className={`st-inspector${collapse ? ' collapsible' : ''}`} aria-label={label}>
      {head ? (
        <div className="st-inspector-head">
          {head}
          {collapseBtn}
        </div>
      ) : (
        collapseBtn && <div className="st-inspector-bar">{collapseBtn}</div>
      )}
      <div className="st-inspector-body">{children}</div>
      {footer && <div className="st-inspector-foot">{footer}</div>}
    </aside>
  );
}

/** 右栏头的名字:点一下变输入框,回车 / 失焦改名,Esc 放弃;改不成(重名)由外面报错,这里退回原名 */
export function TitleEdit({
  value,
  label,
  onCommit,
}: {
  value: string;
  /** 输入框读屏用的名字:「差分名」「背景名」 */
  label: string;
  onCommit: (next: string) => Promise<boolean> | void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button type="button" className="st-ihead-name" title="点击改名" onClick={() => setDraft(value)}>
        {value}
      </button>
    );
  }
  const commit = async () => {
    const next = draft.trim();
    setDraft(null);
    if (next && next !== value) await onCommit(next);
  };
  return (
    <input
      className="st-ihead-input"
      aria-label={label}
      autoFocus
      value={draft}
      maxLength={LABEL_MAX}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** 右栏头:缩略图 + 大标题 + 下面一行小牌子 / 小字 */
export function InspectorHead({ media, title, badge }: { media?: ReactNode; title: ReactNode; badge?: ReactNode }) {
  return (
    <>
      {media}
      <div className="st-ihead-text">
        <span className="st-ihead-title">{title}</span>
        {badge && <span className="st-ihead-badge">{badge}</span>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 主区顶上那一行

export interface PackTabItem {
  id: string;
  /** 缩略图地址;没有就画 icon */
  thumb?: string | null;
  icon?: IconName;
  /** 自己画的缩略图(比如按脸裁的小头像),给了就不用 thumb / icon;填满 32px 的方块 */
  media?: ReactNode;
  name: string;
  sub: string;
  selected: boolean;
}

/** 这张卡挂的几个包(或几个声音)排成一排页签,末尾虚线「＋」 */
export function PackTabs({
  items,
  onSelect,
  onAdd,
  addLabel,
  label,
}: {
  items: readonly PackTabItem[];
  onSelect: (id: string) => void;
  onAdd?: () => void;
  /** 「＋」的说明,比如「添加服装(从素材库选择或导入)」 */
  addLabel: string;
  label?: string;
}) {
  return (
    <div className="st-packtabs" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={it.selected}
          className={`st-packtab${it.selected ? ' selected' : ''}`}
          onClick={() => onSelect(it.id)}
        >
          {it.media ? (
            <span className="st-packtab-media">{it.media}</span>
          ) : it.thumb ? (
            <img className="st-packtab-thumb" src={it.thumb} alt="" draggable={false} />
          ) : (
            <span className="st-packtab-icon">
              <Icon name={it.icon ?? 'image'} size={17} />
            </span>
          )}
          <span className="st-packtab-text">
            <span className="st-packtab-name">{it.name}</span>
            <span className="st-packtab-sub">{it.sub}</span>
          </span>
        </button>
      ))}
      {onAdd && (
        <button type="button" className="st-packtab-add" aria-label={addLabel} title={addLabel} onClick={onAdd}>
          <Icon name="plus" size={18} />
        </button>
      )}
    </div>
  );
}

const SLOT_ICONS: Record<SlotKey, IconName> = {
  sprite: 'person',
  voice: 'mic',
  bg: 'scene',
  bgm: 'music',
  cg: 'cg',
  ai: 'spark',
};

/** 这一栏的图标(左栏、类型小牌子用的同一个) */
export function SlotIcon({ slot, size = 18 }: { slot: SlotKey; size?: number }) {
  return <Icon name={SLOT_ICONS[slot]} size={size} />;
}

/** 栏顶最左边的类型小牌子:「👤 立绘」 */
export function TypeLabel({ slot }: { slot: SlotKey }) {
  return (
    <span className="st-type">
      <SlotIcon slot={slot} size={14} />
      {SLOT_NAMES[slot]}
    </span>
  );
}

/** 还没做好的栏先占个位 */
export function SlotPending({ slot }: { slot: SlotKey }) {
  return (
    <main className="st-main">
      <div className="st-slot-bar">
        <TypeLabel slot={slot} />
      </div>
      <div className="st-pending">
        <SlotIcon slot={slot} size={28} />
        <span>这一栏下一步做</span>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- 按钮

export type BtnKind = 'primary' | 'secondary' | 'danger' | 'ghost';

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary 一屏只放一个(浅色);删除用 danger(红字) */
  kind?: BtnKind;
  icon?: IconName;
  small?: boolean;
}

export function Btn({ kind = 'secondary', icon, small, className, type = 'button', children, ...rest }: BtnProps) {
  const cls = ['st-btn', `st-btn-${kind}`, small ? 'small' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {icon && <Icon name={icon} size={icon === 'play' || icon === 'pause' ? 13 : 15} />}
      {children}
    </button>
  );
}

/**
 * 点两下才删的红字按钮(右栏底部「删除差分」这类):第一下变成「再点一下删除」,
 * 失焦或过几秒没点就退回去。删了找不回、又不值得弹确认框的东西用它
 */
export function DeleteBtn({
  label,
  armedLabel = '再点一下删除',
  disabled,
  small,
  onConfirm,
}: {
  label: string;
  armedLabel?: string;
  disabled?: boolean;
  small?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <Btn
      kind="danger"
      small={small}
      className={armed ? 'armed' : undefined}
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? armedLabel : label}
    </Btn>
  );
}

/** 只有图标的方按钮(←、×、⋯);filled = 带底色和边框 */
export function IconBtn({
  icon,
  label,
  size = 32,
  filled,
  disabled,
  onClick,
}: {
  icon: IconName;
  /** 读屏和悬停说明 */
  label: string;
  size?: number;
  filled?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`st-iconbtn${filled ? ' filled' : ''}`}
      style={{ width: size, height: size }}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** 名字下面一行小字(「只有这套立绘,连认词记录和位置」) */
  note?: string;
  /** 上面画一条分隔线(「删除」和别的隔开) */
  divider?: boolean;
}

/** 「⋯」更多:点开一列操作(重命名、解除绑定、删除……);label 是按钮的说明,比如「更多:重命名、导出、解除绑定」 */
export function MoreMenu({ label, items, size = 34 }: { label: string; items: readonly MenuItem[]; size?: number }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const style = useAnchored(open, btn, menu, 'end', 6);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [btn, menu], close);
  // 打开后焦点落到第一项(键盘能上下选)。等一帧:量好位置之前菜单是藏着的,藏着的东西拿不到焦点
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() =>
      menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),
    );
    return () => cancelAnimationFrame(raf);
  }, [open]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="st-iconbtn filled"
        style={{ width: size, height: size }}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="dots" size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            className="st-menu st-layer"
            style={style}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
              const at = all.indexOf(document.activeElement as HTMLButtonElement);
              all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
            }}
          >
            {items.map((it) => (
              <Fragment key={it.label}>
                {it.divider && <div className="st-menu-sep" aria-hidden="true" />}
                <button
                  type="button"
                  role="menuitem"
                  className={`st-menu-item${it.danger ? ' danger' : ''}${it.note ? ' has-note' : ''}`}
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    btn.current?.focus();
                    it.onClick();
                  }}
                >
                  {it.label}
                  {it.note && <span className="st-menu-note">{it.note}</span>}
                </button>
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

// ---------------------------------------------------------------- 弹窗

/** 居中的小弹窗:点背景、Esc 都算取消。className 加在弹窗本身上(宽一点的「从素材库选」这类) */
export function Modal({
  title,
  children,
  footer,
  onCancel,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  onCancel: () => void;
  className?: string;
}) {
  const titleId = useId();
  const latest = useRef(onCancel);
  useEffect(() => {
    latest.current = onCancel;
  });
  // Esc 抢在视觉小说的前面(它在窗口上听 Esc 开关菜单)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  // 点背景要按下和松开都在背景上才算:从输入框里拖选出来松手不算
  const downOnBackdrop = useRef(false);
  return createPortal(
    <div
      className="st-modal-backdrop st-layer"
      onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) latest.current();
        downOnBackdrop.current = false;
      }}
    >
      <div className={`st-modal${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div id={titleId} className="st-modal-title">
          {title}
        </div>
        <div className="st-modal-body">{children}</div>
        <div className="st-modal-foot">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

/** 确认框:删东西前问一句。danger = 确认按钮是红的,默认停在「取消」上 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onCancel={onCancel}
      footer={
        <>
          <Btn autoFocus={danger} onClick={onCancel}>
            取消
          </Btn>
          <Btn
            kind={danger ? 'secondary' : 'primary'}
            className={danger ? 'st-btn-danger-solid' : undefined}
            autoFocus={!danger}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Btn>
        </>
      }
    >
      {body}
    </Modal>
  );
}

/** 填一个名字的小弹窗(重命名、新建);空的不让交 */
export function PromptDialog({
  title,
  label,
  initial,
  placeholder,
  confirmLabel = '确定',
  onSubmit,
  onCancel,
}: {
  title: ReactNode;
  label: string;
  initial: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    input.current?.select();
  }, []);
  const ok = value.trim() !== '';
  const submit = () => {
    if (ok) onSubmit(value.trim());
  };
  return (
    <Modal
      title={title}
      onCancel={onCancel}
      footer={
        <>
          <Btn onClick={onCancel}>取消</Btn>
          <Btn kind="primary" disabled={!ok} onClick={submit}>
            {confirmLabel}
          </Btn>
        </>
      }
    >
      <label className="st-prompt">
        <span className="st-label">{label}</span>
        <input
          ref={input}
          className="st-input"
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
    </Modal>
  );
}

// ---------------------------------------------------------------- 保存状态

/** 顶栏右边的「✓ 已自动保存」;正在存时写「保存中…」 */
export function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span className={`st-save ${state}`} role="status">
      {state === 'saving' ? (
        <span className="st-save-dot" aria-hidden="true" />
      ) : (
        <Icon name="check" size={14} />
      )}
      <span className="st-save-label">{state === 'saving' ? '保存中…' : '已自动保存'}</span>
    </span>
  );
}

// ---------------------------------------------------------------- 挑一个的弹窗

/** 内容自己摆的弹窗(从声音列表里挑一个这类):和确认框同一个外壳,底部只有「取消」,点列表里的一项就算选好 */
export function ListDialog({ title, children, onCancel }: { title: ReactNode; children: ReactNode; onCancel: () => void }) {
  return (
    <Modal title={title} onCancel={onCancel} footer={<Btn onClick={onCancel}>取消</Btn>}>
      {children}
    </Modal>
  );
}
