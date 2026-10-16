import { describe, expect, it } from 'vitest';
import {
  CARD_PREF_FIELDS,
  cardPrefFieldsOf,
  effectiveConfig,
  effectiveOf,
  settingsForCard,
} from './cardPrefs';
import { normalizeLangConfig } from './lang';
import { DEFAULT_PLAYER_CONFIG, normalizePlayerConfig } from './player';
import { normalizeSceneConfig, SCENE, SWITCH_THRESHOLD } from './scene';
import { DEFAULT_SPRITE_CONFIG, normalizeSpriteConfig } from './sprite';

const FIELDS = ['mode', 'jev.threshold'];

describe('effectiveConfig', () => {
  it('没有覆盖、覆盖不是对象、覆盖里没有能合并的字段:原样返回全局那个对象', () => {
    const global = { mode: 'ai', jev: { threshold: 0.6 } };
    for (const override of [undefined, null, 'jev', [1], {}, { tagTemplate: '<x:{CG}>' }]) {
      expect(effectiveConfig(global, override, FIELDS)).toBe(global);
    }
  });

  it('只合并声明过的字段,没声明的(标签格式、问法)照用全局', () => {
    const global = { mode: 'ai', tagTemplate: '<cg:{CG}>', jev: { threshold: 0.6, prompt: '全局的问法' } };
    const override = { mode: 'jev', tagTemplate: '<图:{CG}>', jev: { threshold: 0.8, prompt: '这张卡的问法' } };
    expect(effectiveConfig(global, override, FIELDS)).toEqual({
      mode: 'jev',
      tagTemplate: '<cg:{CG}>',
      jev: { threshold: 0.8, prompt: '全局的问法' },
    });
  });

  it('按路径深合并:只改了门槛,jev 里别的字段和 mode 都照用全局', () => {
    const global = { mode: 'jev', jev: { threshold: 0.6, prompt: 'p', offPrompt: 'o' } };
    expect(effectiveConfig(global, { jev: { threshold: 0.75 } }, FIELDS)).toEqual({
      mode: 'jev',
      jev: { threshold: 0.75, prompt: 'p', offPrompt: 'o' },
    });
  });

  it('不改全局那份(全局配置还在 state 里用着)', () => {
    const global = { mode: 'ai', jev: { threshold: 0.6 } };
    const before = structuredClone(global);
    effectiveConfig(global, { mode: 'jev', jev: { threshold: 0.9 } }, FIELDS);
    expect(global).toEqual(before);
  });

  it('全局没存过(undefined)或者中间那层不是对象:照样叠上去,剩下的交给 normalize', () => {
    expect(effectiveConfig(undefined, { jev: { threshold: 0.7 } }, FIELDS)).toEqual({ jev: { threshold: 0.7 } });
    expect(effectiveConfig({ mode: 'ai', jev: 'x' }, { jev: { threshold: 0.7 } }, FIELDS)).toEqual({
      mode: 'ai',
      jev: { threshold: 0.7 },
    });
  });

  it('覆盖里写了 null 也算另设(交给 normalize 退回默认);没写(undefined)才照用全局', () => {
    expect(effectiveConfig({ mode: 'jev' }, { mode: null }, ['mode'])).toEqual({ mode: null });
    expect(effectiveConfig({ mode: 'jev' }, { mode: undefined }, ['mode'])).toEqual({ mode: 'jev' });
  });
});

describe('CARD_PREF_FIELDS', () => {
  it('这一期能按卡设的:背景 / 音乐 / CG 的模式和门槛,立绘、玩家台词的模式', () => {
    expect(CARD_PREF_FIELDS).toEqual({
      'plugin.sprite': ['mode'],
      'plugin.bg': ['mode', 'jev.threshold'],
      'plugin.bgm': ['mode', 'jev.threshold'],
      'plugin.cg': ['mode', 'jev.threshold'],
      'plugin.player': ['mode'],
      'plugin.lang': ['autoFill'],
    });
  });

  it('声明的路径各插件的 normalize 真的认:另设了就改得到 normalize 出来的那个字段', () => {
    const at = (obj: unknown, path: string) =>
      path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj);
    // 每个字段换一个和默认不一样、又在范围里的值
    const valueOf = (path: string) =>
      path === 'mode' ? 'jev' : path === 'autoFill' ? true : SWITCH_THRESHOLD.min + 0.01;
    const normalizers: Record<string, (raw: unknown) => unknown> = {
      'plugin.sprite': normalizeSpriteConfig,
      'plugin.bg': (v) => normalizeSceneConfig('bg', v),
      'plugin.bgm': (v) => normalizeSceneConfig('bgm', v),
      'plugin.cg': (v) => normalizeSceneConfig('cg', v),
      'plugin.player': normalizePlayerConfig,
      'plugin.lang': normalizeLangConfig,
    };
    expect(Object.keys(normalizers).sort()).toEqual(Object.keys(CARD_PREF_FIELDS).sort());
    for (const [key, fields] of Object.entries(CARD_PREF_FIELDS)) {
      const normalize = normalizers[key];
      const global = normalize(null);
      for (const path of fields) {
        const override = path.split('.').reduceRight<unknown>((v, k) => ({ [k]: v }), valueOf(path));
        expect(at(global, path), `${key} ${path} 的默认值`).not.toEqual(valueOf(path));
        expect(at(normalize(effectiveConfig(global, override, fields)), path), `${key} ${path}`).toEqual(valueOf(path));
      }
    }
  });

  it('不能按卡设的键(包括 constructor 这类)没有字段', () => {
    expect(cardPrefFieldsOf('plugin.cg')).toEqual(['mode', 'jev.threshold']);
    for (const key of ['plugin.voice', 'plugin.jev', 'constructor', '__proto__', 'toString']) {
      expect(cardPrefFieldsOf(key)).toBeNull();
    }
  });
});

describe('effectiveOf', () => {
  it('没读到、这张卡没另设、另设的键不能按卡设:原样返回全局那份', () => {
    const cg = normalizeSceneConfig('cg', { mode: 'jev' });
    const norm = (v: unknown) => normalizeSceneConfig('cg', v);
    expect(effectiveOf(cg, null, 'plugin.cg', norm)).toBe(cg);
    expect(effectiveOf(cg, {}, 'plugin.cg', norm)).toBe(cg);
    expect(effectiveOf(cg, { 'plugin.bg': { mode: 'ai' } }, 'plugin.cg', norm)).toBe(cg);
    expect(effectiveOf(cg, { 'plugin.cg': { tagTemplate: '<图:{CG}>' } }, 'plugin.cg', norm)).toBe(cg);
    expect(effectiveOf(cg, { 'plugin.lang': { showJa: false } }, 'plugin.lang', norm)).toBe(cg);
  });

  it('另设了:叠上再 normalize(门槛超出范围照全局那样夹回去)', () => {
    const cg = normalizeSceneConfig('cg', { tagTemplate: '<图:{CG}>' });
    const out = effectiveOf(cg, { 'plugin.cg': { mode: 'jev', jev: { threshold: 5 } } }, 'plugin.cg', (v) =>
      normalizeSceneConfig('cg', v),
    );
    expect(out).toEqual({ ...cg, mode: 'jev', jev: { ...cg.jev, threshold: SWITCH_THRESHOLD.max } });
    expect(cg.mode).toBe('ai');
  });

  it('立绘、玩家台词只能另设模式', () => {
    const prefs = { 'plugin.sprite': { mode: 'jev', tagTemplate: '<表情:{表情}>' }, 'plugin.player': { mode: 'jev' } };
    expect(effectiveOf(DEFAULT_SPRITE_CONFIG, prefs, 'plugin.sprite', normalizeSpriteConfig)).toEqual({
      ...DEFAULT_SPRITE_CONFIG,
      mode: 'jev',
    });
    expect(effectiveOf(DEFAULT_PLAYER_CONFIG, prefs, 'plugin.player', normalizePlayerConfig)).toEqual({
      ...DEFAULT_PLAYER_CONFIG,
      mode: 'jev',
    });
  });
});

describe('settingsForCard', () => {
  const settings = { 'plugin.cg': { mode: 'ai' }, 'plugin.voice': { enabled: true } };

  it('这张卡没另设:原样返回', () => {
    expect(settingsForCard(settings, undefined)).toBe(settings);
    expect(settingsForCard(settings, {})).toBe(settings);
    expect(settingsForCard(settings, { 'plugin.voice': { enabled: false } })).toBe(settings);
  });

  it('只换另设过、能按卡设的键;全局没存过的键也叠得上', () => {
    const out = settingsForCard(settings, {
      'plugin.cg': { jev: { threshold: 0.8 } },
      'plugin.bg': { mode: 'jev' },
      'plugin.voice': { enabled: false },
    });
    expect(out).toEqual({
      'plugin.cg': { mode: 'ai', jev: { threshold: 0.8 } },
      'plugin.bg': { mode: 'jev' },
      'plugin.voice': { enabled: true },
    });
    expect(settings['plugin.cg']).toEqual({ mode: 'ai' });
    expect(normalizeSceneConfig('bg', out['plugin.bg'])).toEqual({ ...SCENE.bg.defaults, mode: 'jev' });
  });
});
