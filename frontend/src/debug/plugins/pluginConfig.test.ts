import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SAVE_DELAY_MS,
  createDebounce,
  loadPluginConfig,
  savePluginConfig,
  type SettingsIO,
} from './pluginConfig';

/** 假的设置接口:库就是一个 Map,写的每一次都记下来 */
function fakeIO(initial: Record<string, unknown> = {}) {
  const db = new Map(Object.entries(initial));
  const puts: [string, unknown][] = [];
  const io: SettingsIO = {
    getSetting: async (key) => (db.has(key) ? db.get(key) : null),
    putSetting: async (key, value) => {
      puts.push([key, value]);
      db.set(key, value);
      return { key, value };
    },
  };
  return { io, puts };
}

const failing: SettingsIO = {
  getSetting: () => Promise.reject(new Error('断网了')),
  putSetting: () => Promise.reject(new Error('断网了')),
};

interface Cfg {
  mode: string;
  size: number;
}
const normalize = (raw: unknown): Cfg => {
  const r = (raw ?? {}) as Partial<Cfg>;
  return { mode: r.mode ?? 'ai', size: r.size ?? 1 };
};

describe('loadPluginConfig', () => {
  it('库里没有(null):返回 null,不调 normalize,调用方留着默认值', async () => {
    const { io } = fakeIO();
    const norm = vi.fn(normalize);
    const report = vi.fn();
    expect(await loadPluginConfig(io, 'plugin.x', norm, report)).toBeNull();
    expect(norm).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('库里有:过一遍 normalize(缺的字段补上)', async () => {
    const { io } = fakeIO({ 'plugin.x': { mode: 'jev' } });
    expect(await loadPluginConfig(io, 'plugin.x', normalize, vi.fn())).toEqual({ mode: 'jev', size: 1 });
  });

  it('读失败:提示「插件配置读取失败: 原因」,返回 null', async () => {
    const report = vi.fn();
    expect(await loadPluginConfig(failing, 'plugin.x', normalize, report)).toBeNull();
    expect(report).toHaveBeenCalledWith('插件配置读取失败: 断网了');
  });

  it('提示的开头可以换(各插件原来的说法)', async () => {
    const report = vi.fn();
    await loadPluginConfig(failing, 'plugin.x', normalize, report, '外语插件配置读取失败');
    expect(report).toHaveBeenCalledWith('外语插件配置读取失败: 断网了');
  });

  it('normalize 出错也算读失败;不是 Error 的直接转成字符串', async () => {
    const { io } = fakeIO({ 'plugin.x': 1 });
    const report = vi.fn();
    const result = await loadPluginConfig(
      io,
      'plugin.x',
      () => {
        throw '格式不对';
      },
      report,
    );
    expect(result).toBeNull();
    expect(report).toHaveBeenCalledWith('插件配置读取失败: 格式不对');
  });
});

describe('savePluginConfig', () => {
  it('写进对应的键', async () => {
    const { io, puts } = fakeIO();
    await savePluginConfig(io, 'plugin.x', { mode: 'jev', size: 2 }, vi.fn());
    expect(puts).toEqual([['plugin.x', { mode: 'jev', size: 2 }]]);
  });

  it('写失败:提示「插件配置保存失败: 原因」;开头可以换', async () => {
    const report = vi.fn();
    await savePluginConfig(failing, 'plugin.x', {}, report);
    await savePluginConfig(failing, 'plugin.x', {}, report, '某个插件配置保存失败');
    expect(report.mock.calls).toEqual([['插件配置保存失败: 断网了'], ['某个插件配置保存失败: 断网了']]);
  });
});

describe('停手半秒再写库', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('默认等 500 毫秒', () => {
    expect(SAVE_DELAY_MS).toBe(500);
  });

  it('连着改几下只写最后一下,停手满 500 毫秒才写', async () => {
    const { io, puts } = fakeIO();
    const debounce = createDebounce();
    const change = (next: Cfg) => debounce.run(() => void savePluginConfig(io, 'plugin.x', next, vi.fn()));

    change({ mode: 'ai', size: 1 });
    await vi.advanceTimersByTimeAsync(300);
    change({ mode: 'ai', size: 2 });
    await vi.advanceTimersByTimeAsync(300);
    change({ mode: 'jev', size: 3 });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    expect(puts).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(puts).toEqual([['plugin.x', { mode: 'jev', size: 3 }]]);
  });

  it('写完再改,又是新的一轮', async () => {
    const { io, puts } = fakeIO();
    const debounce = createDebounce();
    debounce.run(() => void savePluginConfig(io, 'plugin.x', 1, vi.fn()));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    debounce.run(() => void savePluginConfig(io, 'plugin.x', 2, vi.fn()));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(puts.map(([, v]) => v)).toEqual([1, 2]);
  });

  it('cancel(卸载)以后,还没写的不写了', async () => {
    const { io, puts } = fakeIO();
    const debounce = createDebounce();
    debounce.run(() => void savePluginConfig(io, 'plugin.x', 1, vi.fn()));
    debounce.cancel();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(puts).toEqual([]);
  });

  it('两份配置各有各的计时器,互不作废', async () => {
    const { io, puts } = fakeIO();
    const bg = createDebounce();
    const cg = createDebounce();
    bg.run(() => void savePluginConfig(io, 'plugin.bg', 'b', vi.fn()));
    cg.run(() => void savePluginConfig(io, 'plugin.cg', 'c', vi.fn()));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(puts).toEqual([
      ['plugin.bg', 'b'],
      ['plugin.cg', 'c'],
    ]);
  });
});
