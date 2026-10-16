import { describe, expect, it } from 'vitest';
import { CARTRIDGES, cartridge, collectCartridges, extension, type Cartridge } from './cartridges';

const fake = (id: string, extra: Partial<Cartridge> = {}): Cartridge => ({ id, name: id, ...extra });

describe('collectCartridges', () => {
  it('按 id 收,按文件夹名排', () => {
    const got = collectCartridges({ './fake-b/cartridge.ts': fake('fake-b'), './fake-a/cartridge.ts': fake('fake-a') });
    expect([...got.keys()]).toEqual(['fake-a', 'fake-b']);
    expect(got.get('fake-a')?.name).toBe('fake-a');
  });

  it('一个卡带都没有(公开版)就是空表', () => {
    expect(collectCartridges({}).size).toBe(0);
  });

  it('id 和文件夹名不一样、没有默认导出,都在加载时报错', () => {
    expect(() => collectCartridges({ './fake-a/cartridge.ts': fake('fake-x') })).toThrow(/fake-a/);
    expect(() => collectCartridges({ './fake-a/cartridge.ts': undefined })).toThrow(/默认导出/);
  });
});

describe('extension', () => {
  const asksTone = () => true;

  it('没有卡带提供就是 undefined', () => {
    expect(extension('asksTone', [fake('fake-a')])).toBeUndefined();
    expect(extension('asksTone', [])).toBeUndefined();
  });

  it('有一个卡带提供就用它的', () => {
    expect(extension('asksTone', [fake('fake-a'), fake('fake-b', { asksTone })])).toBe(asksTone);
  });

  it('两个卡带提供同一个扩展点是写错了', () => {
    const both = [fake('fake-a', { asksTone }), fake('fake-b', { asksTone })];
    expect(() => extension('asksTone', both)).toThrow(/fake-a、fake-b/);
  });
});

describe('装着的卡带', () => {
  it('表里的键就是各自的 id', () => {
    for (const [id, c] of CARTRIDGES) {
      expect(c.id).toBe(id);
      expect(cartridge(id)).toBe(c);
    }
    expect(cartridge('no-such-cartridge')).toBeUndefined();
  });
});
