/**
 * 插件抽屉几页共用的小块(第 2 步 D5):AI 写 / Jev 标、Jev 没填 key 的提示、标签格式那一行、
 * 「提示词模板」页签(模板、恢复默认、宏的展开、当前预设里有没有这一块)、素材直接换的下拉框。
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { BlockState, PluginConfig, TagMode } from '../../../plugins/common';
import type { JevControls } from '../../JevSettings';
import { DeleteButton } from '../../pluginFields';
import { SettingRow } from '../../settings/SettingRow';
import { Icon } from '../../../studio/icons';
import { useDrawerSkin } from '../skinContext';
import { Tip } from '../Tip';
import type { TipKey } from '../tips';
import type { BlockControls, PresetControls } from './pageModel';

/**
 * 素材直接换(界面统一 10-25/26 用户定):「常用」第一行一个下拉框,库里全部的包都在里面,不分「她的 / 别人的」,
 * 选了马上把这张卡这一样原来的绑定整个替换掉。voidChoice 给时多一个「不用」选项(语音页的「不念」)。
 */
export function PackSwapRow({
  label,
  tip,
  ariaLabel,
  options,
  value,
  voidChoice,
  disabled,
  onPick,
}: {
  label: string;
  tip?: TipKey;
  ariaLabel: string;
  options: readonly { id: string; name: string }[];
  /** 这张卡现在用哪个包;没有是 null */
  value: string | null;
  /** 给了就多一个这个字的选项,选它相当于 onPick(null) */
  voidChoice?: string;
  disabled?: boolean;
  onPick: (id: string | null) => void;
}) {
  return (
    <SettingRow
      label={label}
      tip={tip}
      control={{
        kind: 'custom',
        render: () => (
          <select
            className="text-input"
            aria-label={ariaLabel}
            value={value ?? ''}
            disabled={disabled || (options.length === 0 && !voidChoice)}
            onChange={(e) => onPick(e.target.value || null)}
          >
            {voidChoice && <option value="">{voidChoice}</option>}
            {!voidChoice && !value && <option value="">{options.length ? '选一个' : '库里还没有'}</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        ),
      }}
    />
  );
}

/** 页头右边:AI 写 / Jev 标 + 问号 */
export function ModeSwitch({ name, mode, onChange }: { name: string; mode: TagMode; onChange: (mode: TagMode) => void }) {
  return (
    <span className="dw-mode">
      <span className="set-seg" role="radiogroup" aria-label={`${name}的标签由谁写`}>
        {(['ai', 'jev'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={mode === m ? 'on' : ''}
            onClick={() => mode !== m && onChange(m)}
          >
            {m === 'ai' ? 'AI 写' : 'Jev 标'}
          </button>
        ))}
      </span>
      <Tip k="mode" />
    </span>
  );
}

/** 选了 Jev 标但用不上 Jev 时页头下面那一行小字(要不要画看 pageModel.ts 的 jevKeyMissing) */
export function JevKeyNote({ jev }: { jev: JevControls }) {
  if (jev.defaults === null) return <>后端还是旧版,不认 Jev 标注,现在先按 AI 写</>;
  return (
    <>
      Jev 还没填 key,现在先按 AI 写
      {jev.openPage && (
        <button type="button" className="dw-inline-link" onClick={jev.openPage}>
          去填
        </button>
      )}
    </>
  );
}

/** 标签格式:模板写到合法了才交出去;写错时当场标红,照旧按原来的认 */
export function TagFormatRow({
  tip,
  value,
  validate,
  onChange,
}: {
  tip: TipKey;
  value: string;
  validate: (template: string) => string | null;
  onChange: (template: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // 外面的值变了(读回来晚了、恢复默认)要跟上;自己打的合法模板交出去以后两边一样,这里不动它
  useEffect(() => setDraft(value), [value]);
  const error = validate(draft);
  return (
    <SettingRow
      label="标签格式"
      tip={tip}
      control={{ kind: 'text', mono: true, error: error ? `${error}(现在仍按「${value}」认)` : null }}
      value={draft}
      onChange={(v) => {
        setDraft(v);
        if (validate(v) === null) onChange(v);
      }}
    />
  );
}

const BLOCK_STATE_TEXT: Record<BlockState, string> = {
  'no-preset': '还没有选预设',
  missing: '当前预设里没有这一块',
  off: '在当前预设里,关着',
  on: '在当前预设里,开着',
};

/** 「当前预设里有没有这块」:加入 / 开关 / 移出,预设改了没存时能存 */
export function BlockGroup({ block, preset }: { block: BlockControls; preset: PresetControls }) {
  return (
    <div className="dw-block">
      <span className={`dw-dot${block.state === 'on' ? ' on' : ''}`} aria-hidden="true" />
      <span className="dw-block-text">
        {preset.presetName && <b>「{preset.presetName}」</b>}
        {BLOCK_STATE_TEXT[block.state]}
      </span>
      {block.state === 'missing' && (
        <button type="button" className="btn small accent" onClick={block.onInsert}>
          加入当前预设
        </button>
      )}
      {(block.state === 'on' || block.state === 'off') && (
        <>
          <button type="button" className="btn small" onClick={block.onToggle}>
            {block.state === 'on' ? '关闭' : '开启'}
          </button>
          <DeleteButton disabled={false} label="移出预设" onConfirm={block.onRemove} />
        </>
      )}
      {preset.presetDirty && (
        <button type="button" className="btn small accent" disabled={preset.presetBusy} onClick={preset.onSavePreset}>
          保存预设
        </button>
      )}
    </div>
  );
}

/** 页签里的一行小标题 + 问号(+ 右边的按钮) */
export function TabTitle({ title, tip, right }: { title: string; tip?: TipKey; right?: ReactNode }) {
  return (
    <div className="dw-tab-title">
      <span>{title}</span>
      {tip && <Tip k={tip} />}
      <span className="dw-flex" />
      {right}
    </div>
  );
}

/** 「提示词模板」页签:选了 AI 写时预设里这一块发给主模型的话 */
export function TemplateTab<C extends PluginConfig>({
  anchor,
  config,
  onChangeConfig,
  defaultPrompt,
  example,
  previews,
  block,
  preset,
}: {
  /** 点预设里的插件块时滚到这里 */
  anchor: string;
  config: C;
  onChangeConfig: (next: C) => void;
  defaultPrompt: string;
  /** {{sprite_tag}} 这类宏:名字和展开结果 */
  example: { macro: string; value: string };
  /** 列表类宏的当前展开结果 */
  previews: readonly { name: string; value: string }[];
  block: BlockControls;
  preset: PresetControls;
}) {
  return (
    <div id={anchor} className="dw-tab-stack">
      <TabTitle
        title="块的正文"
        tip="adv_template"
        right={
          <button
            type="button"
            className="btn small"
            disabled={config.blockPrompt === defaultPrompt}
            onClick={() => onChangeConfig({ ...config, blockPrompt: defaultPrompt })}
          >
            恢复默认模板
          </button>
        }
      />
      <textarea
        className="text-input pl-wide pl-textarea"
        rows={9}
        value={config.blockPrompt}
        spellCheck={false}
        aria-label="块的正文"
        onChange={(e) => onChangeConfig({ ...config, blockPrompt: e.target.value })}
      />
      <span className="dw-muted">
        {`{{${example.macro}}}`} → <code className="pl-code">{example.value}</code>
      </span>
      {previews.map((p) => (
        <div key={p.name} className="dw-macro">
          <span className="dw-muted">{`{{${p.name}}}`} 现在展开为:</span>
          <pre className="pl-preview">{p.value}</pre>
        </div>
      ))}
      <BlockGroup block={block} preset={preset} />
    </div>
  );
}

/** 输入框 + 按钮,下面一排「最近的」小块 */
export function TryLine({
  value,
  onChange,
  placeholder,
  button,
  disabled,
  onTry,
  recent,
  right,
  tip,
  wide,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  button: string;
  disabled: boolean;
  onTry: () => void;
  recent: readonly string[];
  right?: ReactNode;
  /** 游戏皮里按钮后面的「?」(设计稿把「快速预览」那句说明收进这里) */
  tip?: TipKey;
  /** 输入框放长一点(语音页念整句) */
  wide?: boolean;
}) {
  const { game } = useDrawerSkin();
  const input = (
    <input
      className="text-input dw-try-input"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && !disabled) onTry();
      }}
    />
  );
  return (
    <>
      <div className="dw-try">
        {game ? (
          // 设计稿 .pl-field:放大镜 + 输入框一体的细边框
          <label className={`dw-try-field${wide ? ' wide' : ''}`}>
            <Icon name="search" size={16} />
            {input}
          </label>
        ) : (
          input
        )}
        {right}
        <button type="button" className="btn small" disabled={disabled} onClick={onTry}>
          {button}
        </button>
        {game && tip && <Tip k={tip} />}
      </div>
      {recent.length > 0 && (
        <div className="dw-recent" aria-label="最近的">
          {recent.map((t) => (
            <button key={t} type="button" className="dw-recent-chip" title={t} onClick={() => onChange(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
