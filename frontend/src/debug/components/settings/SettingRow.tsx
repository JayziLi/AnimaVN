import type { CSSProperties, ReactNode } from 'react';
import { rangeFill } from '../../vn/ui/logic';
import { Tip } from '../drawer/Tip';
import { isTipKey, type TipKey } from '../drawer/tips';
import { differsFromDefault, SCOPE_NAME, type SettingScope } from './settingValues';

/**
 * 一个设置一行(素材架构设计 2.9 技术细节 2、3;画布「④ 一个设置一行」):名字 · 控件 · 管谁(范围小标签)· 恢复,
 * 下面一句说明;会牵连别处的,再一条黄底「↳ 会影响:…」。插件页、Jev 页、视觉小说设置的「快捷」都照这一个画法。
 * 先给 Jev 页用(specs/2026-10-16-jev-page-and-previous-reply.md),第 2 步整理插件页时所有页接着用。
 *
 * 第 2 步起插件抽屉里的说明都收进名字旁的「?」(tip,键在 components/drawer/tips.ts,也能直接给一句话);
 * help 一行字留着兼容。所有设置都是全局一份,不给 scopes 就不画范围标签。
 *
 * 参数是声明式的:control 说用什么控件,value / default / onChange 是它的值;
 * 「恢复默认 X」在 value ≠ default 时才出现,点了调 onReset(不给就是 onChange(default))。
 * cardOverride 是按卡设置(第 2 步):右边多一个「某某另设」勾选;勾上后这一行底色变浅,范围标签变「这张卡」,
 * 旁边写全局是多少和「恢复成全局」。
 */

export type { SettingScope };

export type SettingControl =
  /** 开 / 关:一律用拨动开关 */
  | { kind: 'toggle' }
  /** 滑条 + 数字;两头的字、值怎么显示(「恢复默认」按钮上的默认值也用它) */
  | { kind: 'slider'; min: number; max: number; step: number; low?: string; high?: string; format?: (v: number) => string }
  /** 二到四选一 */
  | { kind: 'segmented'; options: readonly { value: string; label: string }[] }
  /** 一行文字(每改一个字就 onChange;要「保存」按钮的用 custom)。error:写错时当场标红并说明 */
  | { kind: 'text'; placeholder?: string; mono?: boolean; error?: string | null }
  /** 自己画(地址 + 保存按钮这类);value / default / onChange 可以不给 */
  | { kind: 'custom'; render: () => ReactNode };

/** 按卡设置:这张卡另设了这一项 */
export interface CardOverride {
  /** 现在是不是这张卡另设的值 */
  active: boolean;
  /** 勾选框的字,比如「纱由美另设」;不给就写「这张卡另设」 */
  label?: string;
  /** 全局值怎么显示,比如「全局 0.6」 */
  globalText: string;
  onToggle: (on: boolean) => void;
  onRevert: () => void;
}

interface Base {
  /** 控件的 id(label 的 for 指向它);不给就用 label 拼一个 */
  id?: string;
  label: string;
  /** 名字旁的「?」:tips.ts 的键,或者直接一句话(还没改写的草稿) */
  tip?: TipKey | string;
  help?: ReactNode;
  /** 改了会牵连别处(预设里的块不发、别的插件变慢……):下面一条黄底写清楚 */
  affects?: ReactNode;
  /** 能在哪几层设,排第一的是它的家;范围标签画排第一的那个。不给 / 空数组 = 不画标签(第 2 步:抽屉里都是全局一份) */
  scopes?: readonly SettingScope[];
  disabled?: boolean;
  onReset?: () => void;
  cardOverride?: CardOverride;
}

export type SettingRowProps =
  | (Base & { control: Extract<SettingControl, { kind: 'toggle' }>; value: boolean; default?: boolean; onChange: (v: boolean) => void })
  | (Base & { control: Extract<SettingControl, { kind: 'slider' }>; value: number; default?: number; onChange: (v: number) => void })
  | (Base & { control: Extract<SettingControl, { kind: 'segmented' }>; value: string; default?: string; onChange: (v: string) => void })
  | (Base & { control: Extract<SettingControl, { kind: 'text' }>; value: string; default?: string; onChange: (v: string) => void })
  | (Base & { control: Extract<SettingControl, { kind: 'custom' }>; value?: unknown; default?: unknown; onChange?: undefined });

const idOf = (p: Base) => p.id ?? `set-${p.label.replace(/\s+/g, '-')}`;

/** 「恢复默认」按钮上写的默认值 */
function defaultText(p: SettingRowProps): string {
  const c = p.control;
  if (c.kind === 'slider' && typeof p.default === 'number') return c.format ? c.format(p.default) : String(p.default);
  if (c.kind === 'segmented') return c.options.find((o) => o.value === p.default)?.label ?? '';
  if (c.kind === 'toggle') return p.default ? '开' : '关';
  return '';
}

function Control(p: SettingRowProps) {
  const id = idOf(p);
  const c = p.control;
  switch (c.kind) {
    case 'toggle': {
      const q = p as Extract<SettingRowProps, { control: { kind: 'toggle' } }>;
      return (
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={q.value}
          aria-label={p.label}
          className={`set-switch${q.value ? ' on' : ''}`}
          disabled={p.disabled}
          onClick={() => q.onChange(!q.value)}
        >
          <span className="knob" aria-hidden="true" />
        </button>
      );
    }
    case 'slider': {
      const q = p as Extract<SettingRowProps, { control: { kind: 'slider' } }>;
      return (
        <div className="set-slider">
          {c.low && <span className="set-slider-end">{c.low}</span>}
          <input
            id={id}
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={q.value}
            disabled={p.disabled}
            // 填到哪(游戏皮的纸面滑条用它画角色色那一段;调试台不用)
            style={{ '--p': rangeFill(q.value, c.min, c.max) } as CSSProperties}
            onChange={(e) => q.onChange(Number(e.target.value))}
          />
          {c.high && <span className="set-slider-end">{c.high}</span>}
          <span className="set-slider-value">{c.format ? c.format(q.value) : String(q.value)}</span>
        </div>
      );
    }
    case 'segmented': {
      const q = p as Extract<SettingRowProps, { control: { kind: 'segmented' } }>;
      return (
        <div className="set-seg" role="radiogroup" aria-label={p.label} id={id}>
          {c.options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={q.value === o.value}
              className={q.value === o.value ? 'on' : ''}
              disabled={p.disabled}
              onClick={() => q.onChange(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      );
    }
    case 'text': {
      const q = p as Extract<SettingRowProps, { control: { kind: 'text' } }>;
      return (
        <>
          <input
            id={id}
            className={`text-input set-text${c.mono ? ' mono' : ''}${c.error ? ' bad' : ''}`}
            type="text"
            value={q.value}
            placeholder={c.placeholder}
            disabled={p.disabled}
            aria-invalid={Boolean(c.error)}
            onChange={(e) => q.onChange(e.target.value)}
          />
          {c.error && <span className="set-error">{c.error}</span>}
        </>
      );
    }
    case 'custom':
      return <>{c.render()}</>;
  }
}

export function SettingRow(p: SettingRowProps) {
  const home: SettingScope | null = p.scopes?.[0] ?? null;
  const override = p.cardOverride;
  const canReset = !override?.active && p.control.kind !== 'custom' && differsFromDefault(p.value, p.default);
  const reset = () => {
    if (p.onReset) p.onReset();
    else if (p.control.kind !== 'custom' && p.default !== undefined) (p.onChange as (v: unknown) => void)(p.default);
  };
  const named = p.control.kind === 'slider' || p.control.kind === 'text';
  const label = named ? (
    <label className="set-label" htmlFor={idOf(p)}>
      {p.label}
    </label>
  ) : (
    <span className="set-label">{p.label}</span>
  );
  return (
    <div className={`set-row${override?.active ? ' overridden' : ''}`}>
      {p.tip ? (
        <span className="set-name">
          {label}
          {isTipKey(p.tip) ? <Tip k={p.tip} /> : <Tip text={p.tip} />}
        </span>
      ) : (
        label
      )}
      <div className="set-ctl">
        <Control {...p} />
      </div>
      <div className="set-side">
        {override?.active ? (
          <>
            <span className="set-scope card">{SCOPE_NAME.card}</span>
            <span className="set-global">{override.globalText}</span>
            <button type="button" className="btn small" onClick={override.onRevert}>
              恢复成全局
            </button>
          </>
        ) : (
          <>
            {home && <span className={`set-scope ${home}`}>{SCOPE_NAME[home]}</span>}
            {canReset && (
              <button type="button" className="btn small set-reset" disabled={p.disabled} onClick={reset}>
                恢复默认{defaultText(p) ? ` ${defaultText(p)}` : ''}
              </button>
            )}
            {override && (
              <label className="set-override">
                <input type="checkbox" checked={false} onChange={(e) => override.onToggle(e.target.checked)} />
                {override.label ?? '这张卡另设'}
              </label>
            )}
          </>
        )}
      </div>
      {p.help && <div className="set-help">{p.help}</div>}
      {p.affects && (
        <div className="set-affects">
          <span aria-hidden="true">↳</span> 会影响:{p.affects}
        </div>
      )}
    </div>
  );
}

/** 一组设置:标题(+ 问号)+ 一行说明 + 几行 SettingRow,外面一个框 */
export function SettingGroup({
  title,
  note,
  tip,
  children,
}: {
  title: string;
  note?: ReactNode;
  /** 标题旁的「?」:tips.ts 的键,或者直接一句话 */
  tip?: TipKey | string;
  children: ReactNode;
}) {
  return (
    <section className="set-group" aria-label={title}>
      <div className="set-group-head">
        <span className="set-group-title">{title}</span>
        {tip && (isTipKey(tip) ? <Tip k={tip} /> : <Tip text={tip} />)}
        {note && <span className="set-group-note">{note}</span>}
      </div>
      {children}
    </section>
  );
}
