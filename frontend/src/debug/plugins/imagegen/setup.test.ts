import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGEGEN_CONFIG, normalizeImageGenConfig } from './config';
import {
  applyConfig,
  blankSetup,
  DEFAULT_LIBRARY,
  libraryOf,
  mergeSetup,
  normalizeLibrary,
  normalizeSetup,
  SETUP_COMMON,
  SETUP_PER_CONN,
  withConn,
  type ImageSetup,
} from './setup';

const NAI = 'c-nai';
const SD = 'c-sd';

/** 星绘这张卡:平时用 NovelAI,在本地 SD 下也存过一份(带一个这边还不认识的 loras) */
const xinghui = (): ImageSetup => ({
  v: 1,
  conn: NAI,
  styleId: 'anime',
  artists: 'artist:foo',
  camera: 'third',
  byConn: {
    [NAI]: { model: 'nai-diffusion-4-5-full', steps: 23 },
    [SD]: { steps: 6, loras: [{ name: 'xinghui', weight: 1, on: true, trigger: '' }] },
  },
});

describe('生图设置 · 每张卡一份(imagegen.setup)', () => {
  it('每个字段都有地方去:外层、跟着连接、全局画风库,不重复', () => {
    const all = new Set<string>([...SETUP_COMMON, ...SETUP_PER_CONN, 'styles', 'stylesVersion']);
    expect(all).toEqual(new Set(Object.keys(DEFAULT_IMAGEGEN_CONFIG)));
    expect(SETUP_COMMON.filter((k) => SETUP_PER_CONN.includes(k))).toEqual([]);
  });

  it('画师串是新加的外层字段:默认空,填了留着', () => {
    expect(DEFAULT_IMAGEGEN_CONFIG.artists).toBe('');
    expect(normalizeImageGenConfig({ artists: 'artist:foo' }).artists).toBe('artist:foo');
  });

  it('页面看到的 = 画风库 + 外层 + 选的那条连接下的那份;没读到就是默认值', () => {
    const c = mergeSetup(DEFAULT_LIBRARY, xinghui());
    expect([c.styleId, c.artists, c.camera]).toEqual(['anime', 'artist:foo', 'third']);
    expect([c.model, c.steps]).toEqual(['nai-diffusion-4-5-full', 23]);
    const sd = mergeSetup(DEFAULT_LIBRARY, { ...xinghui(), conn: SD });
    expect(sd.steps).toBe(6);
    expect(sd.model).toBe(DEFAULT_IMAGEGEN_CONFIG.model);
    expect(mergeSetup(DEFAULT_LIBRARY, null)).toEqual(DEFAULT_IMAGEGEN_CONFIG);
  });

  it('外层的字段不从连接那份里读,连接那份的字段不从外层读', () => {
    const c = mergeSetup(DEFAULT_LIBRARY, { v: 1, conn: NAI, steps: 40, byConn: { [NAI]: { camera: 'third' } } });
    expect(c.steps).toBe(DEFAULT_IMAGEGEN_CONFIG.steps);
    expect(c.camera).toBe('pov');
  });

  it('改了拆回去:只写改过的,外层写外层,跟连接走的写进这条连接;别的连接那份、不认识的字段都不动', () => {
    const s = xinghui();
    const before = mergeSetup(DEFAULT_LIBRARY, s);
    const r = applyConfig(s, before, { ...before, steps: 28, holdLines: 5 });
    expect(r.library).toBeNull();
    expect(r.setup.holdLines).toBe(5);
    expect(r.setup.byConn[NAI]).toEqual({ model: 'nai-diffusion-4-5-full', steps: 28 });
    expect(r.setup.byConn[SD]).toEqual(s.byConn[SD]);
    expect('steps' in r.setup).toBe(false);
    // 原来那份没被改到
    expect(s.byConn[NAI].steps).toBe(23);
  });

  it('改画风库只交出画风库;还没选连接时,跟连接走的那几项不写', () => {
    const s = xinghui();
    const before = mergeSetup(DEFAULT_LIBRARY, s);
    const styles = [...before.styles, { id: 'mine', name: '我的', tags: 'x', negative: '', artists: '' }];
    const r = applyConfig(s, before, { ...before, styles, styleId: 'mine' });
    expect(r.library?.styles.map((x) => x.id)).toContain('mine');
    expect(r.setup.styleId).toBe('mine');
    const none: ImageSetup = { ...s, conn: null };
    const b2 = mergeSetup(DEFAULT_LIBRARY, none);
    expect(applyConfig(none, b2, { ...b2, steps: 40 }).setup.byConn).toEqual(s.byConn);
  });

  it('星绘换到本地 SD 再切回 NovelAI,23 步还在', () => {
    const kinds = { [NAI]: 'novelai', [SD]: 'sdapi' };
    let s = withConn(xinghui(), SD, kinds);
    expect(mergeSetup(DEFAULT_LIBRARY, s).steps).toBe(6);
    s = withConn(s, NAI, kinds);
    expect(mergeSetup(DEFAULT_LIBRARY, s).steps).toBe(23);
  });

  it('换到没用过的连接:同一种(两个 NovelAI 号)抄原来那条的,不同种从默认开始', () => {
    const s = xinghui();
    const kinds = { [NAI]: 'novelai', [SD]: 'sdapi', alt: 'novelai', relay: 'openai' };
    const alt = withConn(s, 'alt', kinds);
    expect(alt.conn).toBe('alt');
    expect(alt.byConn.alt).toEqual(s.byConn[NAI]);
    expect(alt.byConn.alt).not.toBe(s.byConn[NAI]);
    expect(withConn(s, 'relay', kinds).byConn.relay).toBeUndefined();
    expect(withConn(s, null, kinds).conn).toBeNull();
    expect(withConn(s, NAI, kinds)).toBe(s);
  });

  it('调度器和 LoRA 跟着连接走:这条连接改的,别的连接看不到', () => {
    expect(SETUP_PER_CONN).toContain('scheduler');
    expect(SETUP_PER_CONN).toContain('loras');
    const s = xinghui();
    expect(mergeSetup(DEFAULT_LIBRARY, s).loras).toEqual([]);
    const sd = mergeSetup(DEFAULT_LIBRARY, { ...s, conn: SD });
    expect(sd.loras.map((l) => l.name)).toEqual(['xinghui']);
    const r = applyConfig({ ...s, conn: SD }, sd, { ...sd, scheduler: 'Karras', loras: [] });
    expect(r.setup.byConn[SD].scheduler).toBe('Karras');
    expect(r.setup.byConn[SD].loras).toEqual([]);
    expect(r.setup.byConn[NAI]).toEqual(s.byConn[NAI]);
  });

  it('第一次在这条连接下填「另外加的」:反向预设一起存,不被当成旧版的写法', () => {
    const s: ImageSetup = { v: 1, conn: SD, byConn: {} };
    const before = mergeSetup(DEFAULT_LIBRARY, s);
    expect(before.ucPreset).toBe('light');
    const r = applyConfig(s, before, { ...before, uc: 'nsfw, cleavage' });
    expect(r.setup.byConn[SD]).toEqual({ uc: 'nsfw, cleavage', ucPreset: 'light' });
    expect(mergeSetup(DEFAULT_LIBRARY, r.setup).ucPreset).toBe('light');
  });

  it('后端回的乱值整理成能用的;画风库只看 styles 和 stylesVersion', () => {
    expect(normalizeSetup(null)).toEqual(blankSetup());
    expect(normalizeSetup({ conn: '', byConn: { a: 1, b: { steps: 6 } }, extra: 'x' })).toEqual({
      v: 1,
      conn: null,
      byConn: { b: { steps: 6 } },
      extra: 'x',
    });
    const lib = normalizeLibrary({ model: 'nai-diffusion-4-5-full', steps: 9, styles: [{ id: 'a', name: 'A' }], stylesVersion: 4 });
    expect(lib).toEqual({ styles: [{ id: 'a', name: 'A', tags: '', negative: '', artists: '' }], stylesVersion: 4 });
    expect(libraryOf(mergeSetup(lib, xinghui()))).toEqual(lib);
  });
});
