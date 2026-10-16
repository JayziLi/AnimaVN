import { describe, expect, it } from 'vitest';
import type { PresetOrderGroup, PresetPrompt, TavernPreset } from '../../lib/presetParser';
import { buildPresetSkeleton } from '../../lib/presetParser';
import { bindNote, groupChoices, pickedBlock, presetChoices } from './presetPage';

const group = (characterId: number, enabled: boolean[]): PresetOrderGroup => ({
  characterId,
  order: enabled.map((on, i) => ({ identifier: `b${i}`, enabled: on })),
});

describe('groupChoices', () => {
  it('每组一项:名字 (id) · 几块启用,值是下标', () => {
    const groups = [group(100000, [true, false, true]), group(100001, [true, true, true])];
    expect(groupChoices(groups, 0, groups[0].order)).toEqual([
      { value: '0', label: '默认编排 (100000) · 2 启用' },
      { value: '1', label: '角色编排 (100001) · 3 启用' },
    ]);
  });

  it('当前这组按带临时开关的编排数,别的组按存着的数', () => {
    const groups = [group(100000, [true, true]), group(100001, [true, false, false])];
    // 左栏刚把当前这组(第 2 组)的两块打开了,还没存
    const live = groups[1].order.map((o) => ({ ...o, enabled: true }));
    expect(groupChoices(groups, 1, live).map((c) => c.label)).toEqual([
      '默认编排 (100000) · 2 启用',
      '角色编排 (100001) · 3 启用',
    ]);
  });

  it('一组编排都没有:空列表', () => {
    expect(groupChoices([], 0, [])).toEqual([]);
  });
});

describe('pickedBlock', () => {
  const preset: TavernPreset = buildPresetSkeleton('测试');

  it('按 identifier 找到块', () => {
    const got = pickedBlock(preset, 'main') as PresetPrompt;
    expect(got.identifier).toBe('main');
  });

  it('没选、没预设、块已经被删了(或换了预设没有这一块):null', () => {
    expect(pickedBlock(preset, null)).toBeNull();
    expect(pickedBlock(null, 'main')).toBeNull();
    expect(pickedBlock(preset, 'gone')).toBeNull();
  });
});

describe('presetChoices', () => {
  const saved = [
    { id: 'a', name: '刻晴 DeepSeek - galgame' },
    { id: 'b', name: '默认' },
  ];

  it('库里的预设一个一项', () => {
    expect(presetChoices(saved, 'b', '默认')).toEqual([
      { value: 'a', label: '刻晴 DeepSeek - galgame' },
      { value: 'b', label: '默认' },
    ]);
  });

  it('库里一个都没有:只有一项「还没有预设」', () => {
    expect(presetChoices([], null, null)).toEqual([{ value: '', label: '(还没有预设)' }]);
  });

  it('当前这套不在库里(还没选上):最前面补一项,显示它的名字', () => {
    expect(presetChoices(saved, null, '临时')).toEqual([
      { value: '', label: '临时' },
      { value: 'a', label: '刻晴 DeepSeek - galgame' },
      { value: 'b', label: '默认' },
    ]);
  });
});

describe('bindNote', () => {
  it('这张卡绑的是别的预设、现在临时用这套:提示勾上会改绑', () => {
    expect(bindNote({ boundName: '默认', bound: false })).toBe(
      '这张卡绑的是「默认」,现在临时用的这套;勾上就改绑成这套',
    );
  });

  it('绑的就是这套,或者这张卡还没绑:不提示', () => {
    expect(bindNote({ boundName: '默认', bound: true })).toBeNull();
    expect(bindNote({ boundName: null, bound: false })).toBeNull();
  });
});
