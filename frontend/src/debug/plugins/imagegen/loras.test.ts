import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGEGEN_CONFIG, normalizeImageGenConfig } from './config';
import {
  addLora,
  LORA_MAX,
  loraChoices,
  loraNames,
  loraWeightText,
  normalizeLoras,
  patchLora,
  removeLora,
  toggleLora,
  type LoraPick,
} from './loras';

const a: LoraPick = { name: 'celestia_strinova_il', weight: 1, on: true, trigger: '' };
const b: LoraPick = { name: 'flat_color', weight: 0.8, on: false, trigger: 'flat' };

describe('LoRA · 这张卡在这条连接下的一组', () => {
  it('存的值容错:不是对象、没名字、重名的扔掉;权重夹到 0–2,没写是 1;默认开着', () => {
    expect(normalizeLoras(undefined)).toEqual([]);
    expect(normalizeLoras('x')).toEqual([]);
    expect(
      normalizeLoras([
        1,
        { name: '' },
        { name: 'a', weight: 5, trigger: 7 },
        { name: 'a', weight: 0.5 },
        { name: 'b', weight: -1, on: false, trigger: 'tag' },
        { name: 'c', weight: 'heavy' },
      ]),
    ).toEqual([
      { name: 'a', weight: 2, on: true, trigger: '' },
      { name: 'b', weight: 0, on: false, trigger: 'tag' },
      { name: 'c', weight: 1, on: true, trigger: '' },
    ]);
  });

  it('后端一次最多收 20 个,多出来的不留', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `l${i}` }));
    expect(normalizeLoras(many)).toHaveLength(LORA_MAX);
  });

  it('点一下开关只动那一个', () => {
    const next = toggleLora([a, b], b.name);
    expect(next.map((x) => x.on)).toEqual([true, true]);
    expect(toggleLora(next, b.name)[1].on).toBe(false);
  });

  it('改权重夹到范围、两位小数;改触发词;别的不动', () => {
    expect(patchLora([a, b], a.name, { weight: 2.7 })[0].weight).toBe(2);
    expect(patchLora([a, b], a.name, { weight: 0.60000001 })[0].weight).toBe(0.6);
    const next = patchLora([a, b], b.name, { trigger: 'flat color' });
    expect(next[1].trigger).toBe('flat color');
    expect(next[0]).toBe(a);
  });

  it('加一个默认开着、权重 1;已经有的、空名字不重复加;到上限不加', () => {
    expect(addLora([a], ' flat_color ')).toEqual([a, { name: 'flat_color', weight: 1, on: true, trigger: '' }]);
    expect(addLora([a], a.name)).toEqual([a]);
    expect(addLora([a], '  ')).toEqual([a]);
    const full = Array.from({ length: LORA_MAX }, (_, i) => ({ ...a, name: `l${i}` }));
    expect(addLora(full, 'one_more')).toHaveLength(LORA_MAX);
  });

  it('删掉一个', () => {
    expect(removeLora([a, b], a.name)).toEqual([b]);
  });

  it('权重写法:一位小数起,0.85 这种不丢', () => {
    expect(loraWeightText(1)).toBe('1.0');
    expect(loraWeightText(0.8)).toBe('0.8');
    expect(loraWeightText(0.85)).toBe('0.85');
  });

  it('接口回的列表认字符串和 {name, alias}:发的是 name;拿不到是 null', () => {
    expect(loraNames(['a', { name: 'b', alias: 'B 别名' }, { alias: 'no-name' }, 3, ''])).toEqual(['a', 'b']);
    expect(loraNames(undefined)).toBeNull();
    expect(loraNames([])).toEqual([]);
  });

  it('加的时候:不列已经加了的,按名字搜(不分大小写)', () => {
    const all = ['celestia_strinova_il', 'Flat_Color', 'detail_tweaker'];
    expect(loraChoices(all, [a], '')).toEqual(['Flat_Color', 'detail_tweaker']);
    expect(loraChoices(all, [a], 'FLAT')).toEqual(['Flat_Color']);
    expect(loraChoices(all, [], 'zzz')).toEqual([]);
  });
});

describe('设置规整 · 本地 SD 的几项', () => {
  it('调度器默认空,LoRA 默认没有', () => {
    expect(DEFAULT_IMAGEGEN_CONFIG.scheduler).toBe('');
    expect(DEFAULT_IMAGEGEN_CONFIG.loras).toEqual([]);
  });

  it('存过的调度器、LoRA 读得回来;乱值变默认', () => {
    const c = normalizeImageGenConfig({ scheduler: 'Karras', loras: [{ name: 'x', weight: 0.5 }] });
    expect(c.scheduler).toBe('Karras');
    expect(c.loras).toEqual([{ name: 'x', weight: 0.5, on: true, trigger: '' }]);
    const bad = normalizeImageGenConfig({ scheduler: 3, loras: 'nope' });
    expect(bad.scheduler).toBe('');
    expect(bad.loras).toEqual([]);
  });

  it('本地 SD 的采样器名、空串(服务默认)不被换回 NovelAI 的;下架的 k_ 采样器换回默认', () => {
    expect(normalizeImageGenConfig({ sampler: 'DPM++ 2M' }).sampler).toBe('DPM++ 2M');
    expect(normalizeImageGenConfig({ sampler: '' }).sampler).toBe('');
    expect(normalizeImageGenConfig({ sampler: 'k_something_old' }).sampler).toBe(DEFAULT_IMAGEGEN_CONFIG.sampler);
    expect(normalizeImageGenConfig({ sampler: 'k_euler' }).sampler).toBe('k_euler');
  });
});
