import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_SETTINGS, type EnterKeyMode } from '../../lib/chatSettings';
import { DEFAULT_LANG_CONFIG } from '../../plugins/lang';
import { DEFAULT_VOICE_CONFIG, normalizeVoiceConfig, type VoicePluginConfig } from '../../plugins/voice';
import { DEFAULT_BGM_VOLUME } from '../bgm';
import { DEFAULT_VOICE_VOLUME } from '../voice';
import { DEFAULT_VN_SETTINGS, type VNSettings } from '../vnSettings';
import {
  applyPatch,
  buildTabs,
  mergePatches,
  resettableRows,
  tabOfRow,
  type Patch,
  type Row,
  type SettingsState,
  type Sinks,
  type Tab,
} from './model';

/** 假的「各处的值」:所有设置的当前值放在这一个对象里,sinks 往里写 */
interface World {
  vn: VNSettings;
  enterKey: EnterKeyMode;
  voiceConfig: VoicePluginConfig;
  showJa: boolean;
  bgm: { volume: number; muted: boolean };
  voice: { volume: number; muted: boolean };
  titleMusic: string | null;
  touch?: boolean;
}

const defaults = (): World => ({
  vn: { ...DEFAULT_VN_SETTINGS },
  enterKey: DEFAULT_CHAT_SETTINGS.enterKey,
  voiceConfig: { ...DEFAULT_VOICE_CONFIG },
  showJa: DEFAULT_LANG_CONFIG.showJa,
  bgm: { volume: DEFAULT_BGM_VOLUME, muted: false },
  voice: { volume: DEFAULT_VOICE_VOLUME, muted: false },
  titleMusic: null,
});

const BGMS = [
  { id: 'b1', label: '日常' },
  { id: 'b2', label: '温馨' },
];

function stateOf(w: World): SettingsState {
  return {
    vn: w.vn,
    enterKey: w.enterKey,
    voiceConfig: w.voiceConfig,
    showJa: w.showJa,
    bgm: { ...w.bgm, error: null },
    voice: { ...w.voice, lastError: null },
    titleMusic: { bgms: BGMS, value: w.titleMusic },
    voiceCastName: '星绘(日语)',
    jaHidden: 0,
    touch: w.touch,
  };
}

function sinksOf(w: World): Sinks {
  return {
    setVN: (n) => (w.vn = n),
    setVoiceConfig: (n) => (w.voiceConfig = n),
    setEnterKey: (m) => (w.enterKey = m),
    setShowJa: (v) => (w.showJa = v),
    setBgmVolume: (v) => (w.bgm.volume = v),
    setBgmMuted: (m) => (w.bgm.muted = m),
    setVoiceVolume: (v) => (w.voice.volume = v),
    setVoiceMuted: (m) => (w.voice.muted = m),
    setTitleMusic: (id) => (w.titleMusic = id),
  };
}

/** 按这个世界现在的值建表;改一处 = applyPatch 写回世界 */
function build(w: World): Tab[] {
  const state = stateOf(w);
  return buildTabs(state, (p) => applyPatch(p, state, sinksOf(w)), { jaHide: null, data: null });
}

const allRows = (tabs: Tab[]) => tabs.flatMap((t) => t.groups.flatMap((g) => g.rows));
const rowOf = (tabs: Tab[], id: string) => allRows(tabs).find((r) => r.id === id);

/** 把一行改成和默认不一样(挨个试选项 / 两头 / 翻转,直到它显示「改过」) */
function perturb(w: World, id: string): boolean {
  const tries = (): (() => void)[] => {
    const r = rowOf(build(w), id);
    if (!r) return [];
    if (r.kind === 'seg') return r.options.map((o) => () => (rowOf(build(w), id) as typeof r).onPick(o.value));
    if (r.kind === 'range')
      return [r.min, r.max].map((v) => () => (rowOf(build(w), id) as typeof r).onChange(v));
    if (r.kind === 'switch') return [() => (rowOf(build(w), id) as typeof r).onChange(!r.value)];
    if (r.kind === 'select') return r.options.map((o) => () => (rowOf(build(w), id) as typeof r).onChange(o.value));
    return [];
  };
  for (const go of tries()) {
    go();
    const r = rowOf(build(w), id);
    if (r && 'reset' in r && r.reset?.changed) return true;
  }
  return false;
}

const resettableIds = (): string[] =>
  allRows(build(defaults()))
    .filter((r): r is Row & { reset: NonNullable<unknown> } => 'reset' in r && r.reset !== undefined)
    .map((r) => r.id);

describe('设置页每一项的恢复默认', () => {
  it('默认值的世界里没有一项显示「改过」', () => {
    const rows = build(defaults()).flatMap(resettableRows);
    expect(rows.length).toBeGreaterThan(30);
    expect(rows.filter((r) => r.reset.changed).map((r) => r.id)).toEqual([]);
  });

  it('每一项:改了以后显示「改过」,点它的恢复默认后整个世界回到默认,没有别的项被带着改', () => {
    const ids = resettableIds();
    for (const id of ids) {
      const w = defaults();
      expect(perturb(w, id), `${id} 改不动`).toBe(true);
      const r = rowOf(build(w), id)!;
      if (!('reset' in r) || !r.reset) throw new Error(id);
      const state = stateOf(w);
      applyPatch(r.reset.patch, state, sinksOf(w));
      expect(w, `${id} 恢复默认没有回到默认`).toEqual(defaults());
      expect(build(w).flatMap(resettableRows).filter((x) => x.reset.changed)).toEqual([]);
    }
  });

  it('「这页恢复默认」:一页里改了好几项,一次写完,全部回到默认(不会互相盖掉)', () => {
    for (const tabId of ['text', 'sound', 'look', 'display', 'control']) {
      const w = defaults();
      const ids = resettableRows(build(w).find((t) => t.id === tabId)!).map((r) => r.id);
      for (const id of ids) perturb(w, id);
      const tab = build(w).find((t) => t.id === tabId)!;
      const changed = resettableRows(tab).filter((r) => r.reset.changed);
      expect(changed.length, tabId).toBeGreaterThanOrEqual(1);
      const state = stateOf(w);
      let writes = 0;
      const sinks = sinksOf(w);
      const count = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => {
        writes++;
        f(...a);
      };
      applyPatch(mergePatches(changed.map((r) => r.reset.patch)), state, {
        ...sinks,
        setVN: count(sinks.setVN),
        setVoiceConfig: count(sinks.setVoiceConfig),
      });
      // 视觉小说的设置、语音配置各只写一次
      expect(writes, tabId).toBeLessThanOrEqual(2);
      expect(w, tabId).toEqual(defaults());
    }
  });

  it('改一项不会带着改别的项', () => {
    const w = defaults();
    const state = stateOf(w);
    applyPatch({ vn: { textSpeed: 28 } }, state, sinksOf(w));
    expect(w).toEqual({ ...defaults(), vn: { ...DEFAULT_VN_SETTINGS, textSpeed: 28 } });
    applyPatch({ voice: { waitForVoice: true, maxWaitSec: 99 } }, stateOf(w), sinksOf(w));
    // 语音配置过一遍 normalize:最多等夹在 1–10
    expect(w.voiceConfig).toEqual(normalizeVoiceConfig({ ...DEFAULT_VOICE_CONFIG, waitForVoice: true, maxWaitSec: 10 }));
  });
});

describe('条件出现的行', () => {
  const open = (w: World, id: string) => {
    const r = rowOf(build(w), id);
    return r && 'open' in r ? r.open : undefined;
  };

  it('立绘特效关了,特效音量收起', () => {
    const w = defaults();
    expect(open(w, 'spriteFxVolume')).toBe(true);
    w.vn.spriteFx = false;
    expect(open(w, 'spriteFxVolume')).toBe(false);
  });

  it('跳字音:关着或文字速度是「瞬间」时音量收起', () => {
    const w = defaults();
    w.vn.typeSound = 'soft';
    w.vn.textSpeed = 0;
    expect(open(w, 'typeSoundVolume')).toBe(false);
    w.vn.textSpeed = 28;
    expect(open(w, 'typeSoundVolume')).toBe(true);
    w.vn.typeSound = 'off';
    expect(open(w, 'typeSoundVolume')).toBe(false);
  });

  it('文字速度「瞬间」时跳字音除了「关」都点不了,说明里带「去调文字速度」', () => {
    const w = defaults();
    const r = rowOf(build(w), 'typeSound');
    expect(r?.kind === 'seg' && r.options.filter((o) => o.disabled).length).toBeGreaterThan(0);
    expect(r?.kind === 'seg' && r.options.find((o) => o.value === 'off')?.disabled).toBeFalsy();
    expect(r && 'jump' in r && r.jump?.to).toBe('textSpeed');
    w.vn.textSpeed = 28;
    const r2 = rowOf(build(w), 'typeSound');
    expect(r2 && 'jump' in r2 && r2.jump).toBeUndefined();
    expect(r2?.kind === 'seg' && r2.options.some((o) => o.disabled)).toBe(false);
  });

  it('语音那几行跟着语音开关;「最多等」还要选了「等语音」', () => {
    const w = defaults();
    const ids = ['voiceVol', 'voiceMute', 'waitVoice', 'fixedEmo', 'voiceInterrupt', 'autoWaitVoice'];
    for (const id of ids) expect(open(w, id), id).toBe(true);
    expect(open(w, 'maxWait')).toBe(false);
    w.voiceConfig.waitForVoice = true;
    expect(open(w, 'maxWait')).toBe(true);
    w.voiceConfig.enabled = false;
    for (const id of [...ids, 'maxWait']) expect(open(w, id), id).toBe(false);
  });
});

describe('一项不能少', () => {
  const names = (tabId: string) =>
    build(defaults())
      .find((t) => t.id === tabId)!
      .groups.flatMap((g) => g.rows)
      .flatMap((r) => ('name' in r ? [r.name] : []));

  it('文字 / 声音 / 操作 / 显示 / 外观 每一行都在(inventory.md 第 1 节)', () => {
    expect(names('text')).toEqual(['文字速度', '字幕', '自动播放间隔', '自动播放倍速', '台词后面的压暗', '对白字号']);
    expect(names('sound')).toEqual([
      'BGM 音量',
      'BGM 静音',
      '念台词时',
      '立绘特效',
      '特效音量',
      '跳字音',
      '跳字音量',
      '语音',
      '语音音量',
      '语音静音',
      '文字和语音',
      '最多等',
      '语音情绪',
      '翻页时',
      '自动播放',
    ]);
    expect(names('control')).toEqual(['回车键', '快捷键']);
    expect(names('display')).toEqual(['思考过程', '模型标签', '语音标签', '标题画面']);
    expect(names('look')).toEqual(['主题', '封面', '封面音乐', '主题色', '对话框', '对话框文字', '对话框上下位置', '对话框高度']);
    // 玻璃框底色只管经典对话框:选了经典才出来
    const classicLook = build({ ...defaults(), vn: { ...defaults().vn, dlgStyle: 'classic' } })
      .find((t) => t.id === 'look')!
      .groups.flatMap((g) => g.rows)
      .flatMap((r) => ('name' in r ? [r.name] : []));
    expect(classicLook).toContain('玻璃框底色');
  });

  it('触屏上不放「快捷键」那一行', () => {
    const control = (touch: boolean) =>
      build({ ...defaults(), touch })
        .find((t) => t.id === 'control')!
        .groups.flatMap((g) => g.rows)
        .flatMap((r) => ('name' in r ? [r.name] : []));
    expect(control(false)).toContain('快捷键');
    expect(control(true)).not.toContain('快捷键');
  });

  it('和插件页重复的项挂小签(U17):字幕 / 语音几行指到「外语」「语音」', () => {
    const dupOf = (id: string) => {
      const r = rowOf(build(defaults()), id);
      return r && 'dup' in r ? r.dup : undefined;
    };
    expect(dupOf('showJa')).toBe('外语');
    expect(dupOf('voice')).toBe('语音');
    expect(dupOf('waitVoice')).toBe('语音');
    expect(dupOf('maxWait')).toBe('语音');
    expect(dupOf('fixedEmo')).toBe('语音');
    // 没有对应插件页的项不挂(比如语音音量、BGM 音量)
    expect(dupOf('voiceVol')).toBeUndefined();
    expect(dupOf('bgmVol')).toBeUndefined();
  });

  it('前文日语在文字页、数据在进阶里;每行有自己的 id,页内不重复', () => {
    const tabs = build(defaults());
    expect(tabOfRow(tabs, 'jaHide')).toBe('text');
    expect(tabs.filter((t) => t.adv).map((t) => t.id)).toEqual(['data']);
    const ids = allRows(tabs).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('对话框是细线时那行叫「台词后面的压暗」,选经典叫「对话框透明度」(同一个值)', () => {
    const w = defaults();
    expect(rowOf(build(w), 'boxOpacity')).toMatchObject({ name: '台词后面的压暗' });
    w.vn.dlgStyle = 'classic';
    expect(rowOf(build(w), 'boxOpacity')).toMatchObject({ name: '对话框透明度' });
  });

  it('封面样式只有纸面和明亮;主题三种;对话框两种', () => {
    const tabs = build(defaults());
    const opts = (id: string) => {
      const r = rowOf(tabs, id);
      return r?.kind === 'seg' ? r.options.map((o) => o.name) : [];
    };
    expect(opts('titleStyle')).toEqual(['纸面', '明亮']);
    expect(opts('theme')).toEqual(['白', '黑', '玻璃']);
    expect(opts('dlgStyle')).toEqual(['细线', '经典']);
    expect(opts('accent')).toEqual(['跟角色', '灰白', '粉色']);
  });

  it('语音那组的音色入口:标题旁有按钮,说明写这张卡用的声音', () => {
    const g = build(defaults())
      .find((t) => t.id === 'sound')!
      .groups.find((x) => x.id === 'voice')!;
    expect(g.action).toEqual({ text: '换音色 · 试音', id: 'openVoice' });
    expect(g.note).toContain('星绘(日语)');
    expect(JSON.stringify(build(defaults()))).not.toContain('主声音');
  });
});

describe('出错的红字', () => {
  it('BGM 出错、语音最近一次失败各出一行;语音关着时不显示语音的', () => {
    const w = defaults();
    const state = { ...stateOf(w), bgm: { ...stateOf(w).bgm, error: '解码失败' }, voice: { ...stateOf(w).voice, lastError: '连不上' } };
    const tabs = buildTabs(state, () => undefined, { jaHide: null, data: null });
    expect(rowOf(tabs, 'bgmErr')).toMatchObject({ kind: 'err', text: '解码失败' });
    expect(rowOf(tabs, 'voiceErr')).toMatchObject({ kind: 'err', text: '语音最近一次失败:连不上' });
    const off = buildTabs({ ...state, voiceConfig: { ...state.voiceConfig, enabled: false } }, () => undefined, { jaHide: null, data: null });
    expect(rowOf(off, 'voiceErr')).toMatchObject({ kind: 'err', text: null });
  });
});

describe('mergePatches', () => {
  it('同一处的几项合成一份,后写的算数', () => {
    const p: Patch = mergePatches([{ vn: { textSpeed: 0 } }, { vn: { autoDelay: 1500 } }, { voice: { enabled: true } }, { voice: { enabled: false } }, { bgmMuted: false }]);
    expect(p).toEqual({ vn: { textSpeed: 0, autoDelay: 1500 }, voice: { enabled: false }, bgmMuted: false });
  });
});
