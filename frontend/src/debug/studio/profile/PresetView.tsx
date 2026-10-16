import { useCallback, useRef, useState, type ReactNode } from 'react';
import { PresetPanel, type PresetBaseProps } from '../../components/PresetPanel';
import type { PluginFocus, PluginSection } from '../../components/PluginsDrawer';
import { Icon } from '../icons';
import { PluginSheet } from '../PluginSheet';
import { Btn, MoreMenu } from '../ui';
import { BlockEditorSide } from './BlockEditorSide';
import { bindNote, groupChoices, pickedBlock, presetChoices } from './presetPage';
import './presetView.css';

/**
 * 卡编辑器 · 资料页 · 预设(目录点预设那一行):照 V4CardPreset.png。
 *
 *   主区   预设下拉 +「存」+「导入」+「⋯」(新建预设、重命名、另存为、恢复、导出、删除预设);
 *          「☑ 绑定到当前角色卡「X」· 编排 [下拉] · 新建块」;下面块列表(PresetPanel 的 page 摆法,
 *          拖动、开关、自动补的灰块、插件块、被卡覆盖、Jev 不发……都和调试台左栏一样)
 *   右栏   选中那一块的编辑(BlockEditorSide);没选时写一句怎么用
 *
 * 状态和写口全是 DebugApp 的,和调试台左栏的预设面板是同一份:这边改了那边跟着变,「存」之前都只在内存里。
 * 这里自己只记两样:右栏在编辑哪一块、插件抽屉开没开。
 */

export interface PresetViewProps extends PresetBaseProps {
  /** 插件块属于哪个插件(DebugApp 的 pluginOfBlock) */
  pluginOf: (identifier: string) => PluginSection;
  /**
   * 插件抽屉(DebugApp 的 renderPluginsDrawer)。插件块的正文在插件里改;
   * 调试台的抽屉被卡编辑器盖着,所以点插件块时抽屉开在这一页上面,关掉还回到这里
   */
  renderPlugin: (focus: PluginFocus, onClose: () => void) => ReactNode;
}

/** 窄屏三栏改成上下排(和 profile.css 末尾同一档) */
const NARROW = '(max-width: 899px)';

const noop = () => {};

export function PresetView({ pluginOf, renderPlugin, ...base }: PresetViewProps) {
  const { preset, order, saved, selectedId, dirty, busy, cardBinding } = base;
  /** 右栏在编辑哪一块(identifier);块被删了、换了预设没这一块时查不到,右栏就写怎么用 */
  const [picked, setPicked] = useState<string | null>(null);
  /** 点了插件块:插件抽屉停在哪个插件(对象本身要稳定,抽屉按它跳转);null = 没开 */
  const [plugin, setPlugin] = useState<PluginFocus | null>(null);
  const sideRef = useRef<HTMLDivElement | null>(null);

  const prompt = pickedBlock(preset, picked);
  const presets = presetChoices(saved, selectedId, preset?.name ?? null);
  const presetValue = presets.some((c) => c.value === selectedId) ? (selectedId ?? '') : '';
  const presetLabel = presets.find((c) => c.value === presetValue)?.label ?? '';
  const groups = preset ? groupChoices(preset.orderGroups, base.activeGroupIndex, order) : [];
  const note = cardBinding ? bindNote(cardBinding) : null;

  const openBlock = (identifier: string) => {
    setPicked(identifier);
    // 窄屏右栏排在列表下面:滚过去,不然点了像没反应
    if (window.matchMedia(NARROW).matches) {
      requestAnimationFrame(() => sideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };
  const addBlock = () => {
    const identifier = base.onAddBlock();
    if (identifier) openBlock(identifier);
  };
  const openPlugin = (identifier: string) => setPlugin({ section: pluginOf(identifier), nonce: Date.now() });
  const closePlugin = useCallback(() => setPlugin(null), []);

  return (
    <>
      <main className="st-main pf-main pv-main" aria-label="预设">
        <div className="pv-bar">
          <div className={`st-select pv-preset${busy || saved.length === 0 ? ' disabled' : ''}`}>
            <span className="st-select-value">{presetLabel}</span>
            {dirty && <span className="st-select-sub pv-unsaved">● 改动没存</span>}
            <Icon name="chev" size={15} />
            <select
              aria-label="预设"
              value={presetValue}
              disabled={busy || saved.length === 0}
              onChange={(e) => e.target.value && base.onSelectPreset(e.target.value)}
            >
              {presets.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <Btn
            kind={dirty ? 'primary' : 'secondary'}
            className="pv-tall"
            disabled={busy || !selectedId || !dirty}
            onClick={base.onSave}
            title={
              !selectedId ? '这套还没存进库:点「⋯」另存为' : dirty ? '把改动存进这个预设' : '没有要存的改动'
            }
          >
            存
          </Btn>
          <Btn icon="upload" className="pv-tall" disabled={busy} onClick={base.onImport} title="导入预设(.json)">
            导入
          </Btn>
          <MoreMenu
            size={36}
            label="更多:新建预设、重命名、另存为、恢复、导出、删除预设"
            items={[
              { label: '新建预设', onClick: base.onNewPreset, disabled: busy },
              { label: '重命名', onClick: base.onRename, disabled: busy || !selectedId },
              { label: '另存为', onClick: base.onSaveAs, disabled: busy || !preset },
              // 恢复 = 丢掉没存的改动,回到库里那一份
              { label: '恢复', onClick: base.onRestore, disabled: busy || !selectedId || !dirty },
              { label: '导出', onClick: base.onExport, disabled: busy || !preset },
              { label: '删除预设', onClick: base.onDelete, danger: true, disabled: busy || !selectedId },
            ]}
          />
        </div>

        {(cardBinding || preset) && (
          <div className="pv-row">
            {cardBinding && (
              <label className="pv-bind">
                <input
                  type="checkbox"
                  checked={cardBinding.bound}
                  disabled={busy}
                  onChange={(e) => cardBinding.onToggle(e.target.checked)}
                />
                <span>绑定到当前角色卡「{cardBinding.cardName}」</span>
              </label>
            )}
            {groups.length > 0 && (
              <span className="pv-group-field">
                <span className="pv-row-label">编排</span>
                <span className="st-select pv-group">
                  <span className="st-select-value">{groups[base.activeGroupIndex]?.label ?? ''}</span>
                  <Icon name="chev" size={13} />
                  <select
                    aria-label="编排"
                    value={String(base.activeGroupIndex)}
                    onChange={(e) => base.onPickGroup(Number(e.target.value))}
                  >
                    {groups.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </span>
              </span>
            )}
            <span className="st-flex" />
            {preset && (
              <Btn small icon="plus" disabled={busy} onClick={addBlock}>
                新建块
              </Btn>
            )}
          </div>
        )}
        {note && <p className="pv-note">{note}</p>}

        {preset ? (
          <PresetPanel
            {...base}
            variant="page"
            // page 不收起
            collapsed={false}
            onToggleCollapse={noop}
            onOpenPlugin={openPlugin}
            onOpenBlock={openBlock}
            selectedIdentifier={prompt?.identifier ?? null}
          />
        ) : (
          <div className="st-pending pv-empty">
            <Icon name="preset" size={28} />
            <span>还没有载入预设</span>
            <span className="pv-empty-sub">新建会生成酒馆默认的 10 个标准块;也可以导入现成的 .json</span>
            <span className="pv-empty-actions">
              <Btn icon="plus" disabled={busy} onClick={base.onNewPreset}>
                新建预设
              </Btn>
              <Btn icon="upload" disabled={busy} onClick={base.onImport}>
                导入
              </Btn>
            </span>
          </div>
        )}
      </main>

      <div ref={sideRef} className="pv-side">
        <BlockEditorSide
          prompt={prompt}
          overridden={prompt ? base.overridden.has(prompt.identifier) : false}
          markerSource={prompt?.marker ? base.resolveMarker(prompt.identifier) : null}
          macros={base.macros}
          onUpdateBlock={base.onUpdateBlock}
          onUpdateCard={base.onUpdateCard}
          onDeleteBlock={(identifier) => {
            base.onDeleteBlock(identifier);
            setPicked(null);
          }}
        />
      </div>

      {plugin && <PluginSheet onClose={closePlugin}>{renderPlugin(plugin, closePlugin)}</PluginSheet>}
    </>
  );
}
