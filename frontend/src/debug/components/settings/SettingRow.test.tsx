import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingRow } from './SettingRow';
import { differsFromDefault } from './settingValues';

const noop = () => {};

describe('SettingRow', () => {
  it('draws the name, the control, the scope tag and the help line', () => {
    const html = renderToStaticMarkup(
      <SettingRow
        label="说话人门槛"
        help="判「这句不是角色说的」要多大把握才信"
        control={{ kind: 'slider', min: 0.5, max: 0.95, step: 0.05, low: '更敢判成别人', high: '更不容易漏念', format: (v) => v.toFixed(2) }}
        scopes={['global']}
        value={0.8}
        default={0.8}
        onChange={noop}
      />,
    );
    expect(html).toContain('说话人门槛');
    expect(html).toContain('type="range"');
    expect(html).toContain('0.80');
    expect(html).toContain('更敢判成别人');
    expect(html).toContain('全局');
    expect(html).toContain('判「这句不是角色说的」要多大把握才信');
  });

  it('offers 「恢复默认」 only when the value differs from the default', () => {
    const at = (value: number) =>
      renderToStaticMarkup(
        <SettingRow label="带上一条回复" control={{ kind: 'slider', min: 0, max: 24, step: 1 }} value={value} default={24} onChange={noop} />,
      );
    expect(at(24)).not.toContain('恢复默认');
    expect(at(8)).toContain('恢复默认 24');
  });

  it('marks the home scope and shows the global value when this card overrides it', () => {
    const device = renderToStaticMarkup(
      <SettingRow label="音量" control={{ kind: 'toggle' }} scopes={['device', 'global']} value onChange={noop} />,
    );
    expect(device).toContain('这台设备');
    const overridden = renderToStaticMarkup(
      <SettingRow
        label="换 CG 的门槛"
        control={{ kind: 'slider', min: 0.3, max: 0.95, step: 0.05 }}
        scopes={['global', 'card']}
        value={0.75}
        default={0.6}
        onChange={noop}
        cardOverride={{ active: true, globalText: '全局 0.6', onToggle: noop, onRevert: noop }}
      />,
    );
    expect(overridden).toContain('这张卡');
    expect(overridden).toContain('全局 0.6');
    expect(overridden).toContain('恢复成全局');
    expect(overridden).not.toContain('恢复默认');
  });

  it('draws segmented choices as radios with the current one checked', () => {
    const html = renderToStaticMarkup(
      <SettingRow
        label="立绘"
        control={{ kind: 'segmented', options: [{ value: 'ai', label: 'AI 写' }, { value: 'jev', label: 'Jev 标' }] }}
        value="jev"
        onChange={noop}
      />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Jev 标/);
  });

  it('compares slider numbers loosely and other values exactly', () => {
    expect(differsFromDefault(0.1 + 0.2, 0.3)).toBe(false);
    expect(differsFromDefault(0.35, 0.3)).toBe(true);
    expect(differsFromDefault('a', 'a')).toBe(false);
    expect(differsFromDefault(true, undefined)).toBe(false);
  });

  it('draws on / off as a switch', () => {
    const html = renderToStaticMarkup(
      <SettingRow label="立绘和文字同步" control={{ kind: 'toggle' }} value default={true} onChange={noop} />,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('type="checkbox"');
  });

  it('offers 「某某另设」 before this card overrides it, and lightens the row after', () => {
    const before = renderToStaticMarkup(
      <SettingRow
        label="换 CG 的门槛"
        control={{ kind: 'slider', min: 0.3, max: 0.95, step: 0.05 }}
        value={0.6}
        default={0.6}
        onChange={noop}
        cardOverride={{ active: false, label: '纱由美另设', globalText: '全局 0.6', onToggle: noop, onRevert: noop }}
      />,
    );
    expect(before).toContain('纱由美另设');
    expect(before).not.toContain('overridden');
    const after = renderToStaticMarkup(
      <SettingRow
        label="换 CG 的门槛"
        control={{ kind: 'slider', min: 0.3, max: 0.95, step: 0.05 }}
        value={0.75}
        default={0.6}
        onChange={noop}
        cardOverride={{ active: true, label: '纱由美另设', globalText: '全局 0.6', onToggle: noop, onRevert: noop }}
      />,
    );
    expect(after).toContain('set-row overridden');
  });

  it('spells out what else a setting changes', () => {
    const html = renderToStaticMarkup(
      <SettingRow
        label="谁来写标签"
        control={{ kind: 'segmented', options: [{ value: 'ai', label: 'AI 写' }, { value: 'jev', label: 'Jev 标' }] }}
        value="jev"
        onChange={noop}
        affects="预设里的「CG 指令」块这次不发"
      />,
    );
    expect(html).toContain('会影响:预设里的「CG 指令」块这次不发');
  });

  it('draws no scope tag when scopes are not given (plugin drawer, step 2: everything there is global)', () => {
    const html = renderToStaticMarkup(
      <SettingRow label="人物大小" control={{ kind: 'slider', min: 0.1, max: 0.4, step: 0.005 }} value={0.21} default={0.21} onChange={noop} />,
    );
    expect(html).not.toContain('全局');
    expect(html).not.toContain('set-scope');
  });

  it('puts the explanation behind a 「?」 next to the name instead of a help line', () => {
    const byKey = renderToStaticMarkup(
      <SettingRow label="标签格式" tip="tag_format" control={{ kind: 'text', mono: true }} value="<sprite:{表情}>" onChange={noop} />,
    );
    expect(byKey).toContain('aria-label="说明"');
    expect(byKey).not.toContain('set-help');
    const byText = renderToStaticMarkup(
      <SettingRow label="试一下" tip="一句还没改写的草稿" control={{ kind: 'toggle' }} value={false} onChange={noop} />,
    );
    expect(byText).toContain('aria-label="说明"');
  });

  it('marks a bad text value on the spot', () => {
    const html = renderToStaticMarkup(
      <SettingRow label="标签格式" control={{ kind: 'text', error: '模板里必须有且只有一个 {CG}' }} value="<cg>" onChange={noop} />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('模板里必须有且只有一个 {CG}');
  });
});
