import { describe, expect, it } from 'vitest';
import type { VoiceProfile } from '../../lib/api';
import type { CartridgePanel } from '../../plugins/cartridges';
import { DEFAULT_SWITCHES, type PluginSwitches } from '../../plugins/switches';
import type { DrawerCardFacts } from './cardView';
import { drawerNav, switchTargetOf, type NavGroup, type NavInput } from './navModel';

const noop = () => {};
const render = () => null;

const voice = (text_lang: string, name = '刻晴(日语)') => ({ id: 'v1', name, text_lang, emotions: [] }) as unknown as VoiceProfile;

const keqing = (over: Partial<DrawerCardFacts> = {}): DrawerCardFacts => ({
  id: 'c1',
  name: '刻晴',
  sprites: 14,
  spritePack: { id: 'p1', name: '玉衡星' },
  listRef: 'pack:p1',
  mainVoice: voice('ja'),
  voices: { main: 'v1', extras: [] },
  scene: { packName: '原神 · 璃月', bg: 16, bgm: 8, cgPackName: null, cg: 0 },
  prefs: {},
  ...over,
});

const imagegen: CartridgePanel = {
  key: 'imagegen',
  title: 'AI 生图',
  beta: true,
  after: 'lang',
  group: 'role',
  power: 'illustrations',
  inUse: () => true,
  render,
};
const sfx: CartridgePanel = {
  key: 'sfx',
  title: '音效',
  beta: true,
  after: 'voice',
  group: 'lab',
  toggle: { on: true, set: noop },
  inUse: () => true,
  render,
};
const tone: CartridgePanel = {
  key: 'tone',
  title: '声线分档',
  beta: true,
  after: 'sfx',
  group: 'lab',
  toggle: { on: false, set: noop },
  inUse: () => false,
  render,
};

const input = (over: Partial<NavInput> = {}): NavInput => ({
  panels: [sfx, tone, imagegen],
  card: keqing(),
  switches: DEFAULT_SWITCHES,
  voiceOn: true,
  status: { jev: '已连上', tts: '通了', autoFill: true, engine: 'records' },
  ...over,
});

const group = (groups: NavGroup[], id: string) => groups.find((g) => g.id === id);
const row = (groups: NavGroup[], id: string) => groups.flatMap((g) => g.rows).find((r) => r.id === id);

describe('插件抽屉左栏:三组', () => {
  it('角色、全局、实验三组,先后和名字照第四版', () => {
    const nav = drawerNav(input());
    expect(nav.map((g) => [g.id, g.title])).toEqual([
      ['role', '角色'],
      ['global', '全局'],
      ['lab', '实验'],
    ]);
    expect(group(nav, 'role')?.rows.map((r) => r.name)).toEqual(['立绘', '语音', '背景', 'BGM', 'CG', '外语', 'AI 生图']);
    expect(group(nav, 'global')?.rows.map((r) => r.name)).toEqual(['Jev 标注', '语音服务', '自动补块', '表情认法']);
    expect(group(nav, 'lab')?.rows.map((r) => r.name)).toEqual(['音效', '声线分档']);
  });

  it('实验组按 after 排:声线分档跟在音效后面,传进来的先后反了也一样', () => {
    expect(group(drawerNav(input({ panels: [tone, imagegen, sfx] })), 'lab')?.rows.map((r) => r.id)).toEqual(['sfx', 'tone']);
  });

  it('没有卡带(公开版):角色组只有内核的六页,实验组整组不返回', () => {
    const nav = drawerNav(input({ panels: [] }));
    expect(nav.map((g) => g.id)).toEqual(['role', 'global']);
    expect(group(nav, 'role')?.rows.map((r) => r.id)).toEqual(['sprite', 'voice', 'bg', 'bgm', 'cg', 'lang']);
  });

  it('玩家台词不在左栏', () => {
    expect(row(drawerNav(input()), 'player')).toBeUndefined();
  });

  it('BETA 跟着卡带走', () => {
    const nav = drawerNav(input());
    expect(row(nav, 'imagegen')?.beta).toBe(true);
    expect(row(nav, 'sprite')?.beta).toBe(false);
  });
});

describe('圆点:这张卡在不在用', () => {
  it('绑了的实心,没绑的空心;全局组不画', () => {
    const nav = drawerNav(input({ card: keqing({ sprites: 0, scene: { packName: null, bg: 0, bgm: 0, cgPackName: null, cg: 0 } }) }));
    expect(row(nav, 'sprite')?.inUse).toBe(false);
    expect(row(nav, 'voice')?.inUse).toBe(true);
    expect(row(nav, 'bg')?.inUse).toBe(false);
    expect(row(nav, 'cg')?.inUse).toBe(false);
    expect(group(nav, 'global')?.rows.map((r) => r.inUse)).toEqual([null, null, null, null]);
  });

  it('外语:主声音是日语才实心,中文声音、没有主声音是空心', () => {
    expect(row(drawerNav(input()), 'lang')?.inUse).toBe(true);
    expect(row(drawerNav(input({ card: keqing({ mainVoice: voice('zh', '刻晴(中文)') }) })), 'lang')?.inUse).toBe(false);
    expect(row(drawerNav(input({ card: keqing({ mainVoice: null }) })), 'lang')?.inUse).toBe(false);
    expect(row(drawerNav(input({ card: keqing({ mainVoice: null }) })), 'voice')?.inUse).toBe(false);
  });

  it('卡带看自己的 inUse;没给 inUse 的不画', () => {
    const nav = drawerNav(input({ panels: [sfx, tone, { ...imagegen, inUse: undefined }] }));
    expect(row(nav, 'sfx')?.inUse).toBe(true);
    expect(row(nav, 'tone')?.inUse).toBe(false);
    expect(row(nav, 'imagegen')?.inUse).toBeNull();
  });

  it('还没有卡:角色组和实验组全是空心', () => {
    const nav = drawerNav(input({ card: null }));
    expect([...(group(nav, 'role')?.rows ?? []), ...(group(nav, 'lab')?.rows ?? [])].every((r) => r.inUse === false)).toBe(true);
  });
});

describe('行尾', () => {
  it('四路素材和卡带用插件开关,语音用语音的开关,外语写「自动」', () => {
    const switches: PluginSwitches = { ...DEFAULT_SWITCHES, cg: false, illustrations: false };
    const nav = drawerNav(input({ switches, voiceOn: false }));
    expect(row(nav, 'cg')?.end).toEqual({ kind: 'switch', on: false, label: 'CG开关' });
    expect(row(nav, 'sprite')?.end).toEqual({ kind: 'switch', on: true, label: '立绘开关' });
    expect(row(nav, 'voice')?.end).toEqual({ kind: 'switch', on: false, label: '语音开关' });
    expect(row(nav, 'lang')?.end).toEqual({ kind: 'text', text: '自动' });
    expect(row(nav, 'imagegen')?.end).toEqual({ kind: 'switch', on: false, label: 'AI 生图开关' });
    expect(row(nav, 'sfx')?.end).toEqual({ kind: 'switch', on: true, label: '音效开关' });
    expect(row(nav, 'tone')?.end).toEqual({ kind: 'switch', on: false, label: '声线分档开关' });
  });

  it('卡带没有开关就不画', () => {
    const nav = drawerNav(input({ panels: [{ ...imagegen, power: undefined }] }));
    expect(row(nav, 'imagegen')?.end).toBeNull();
  });

  it('全局组写现在的状态', () => {
    const nav = drawerNav(input());
    expect(group(nav, 'global')?.rows.map((r) => r.end)).toEqual([
      { kind: 'text', text: '已连上' },
      { kind: 'text', text: '通了' },
      { kind: 'text', text: '开' },
      { kind: 'text', text: '认词记录' },
    ]);
    const off = drawerNav(input({ status: { jev: '没在用', tts: '没设', autoFill: false, engine: 'legacy' } }));
    expect(row(off, 'autofill')?.end).toEqual({ kind: 'text', text: '关' });
    expect(row(off, 'engine')?.end).toEqual({ kind: 'text', text: '旧算法' });
  });
});

describe('行尾开关点了改哪一样', () => {
  const panels = [sfx, tone, imagegen];
  it('语音改语音的开关,四路素材和生图改插件开关,音效 / 声线分档改卡带自己的', () => {
    expect(switchTargetOf('voice', panels)).toEqual({ kind: 'voice' });
    expect(switchTargetOf('cg', panels)).toEqual({ kind: 'switch', key: 'cg' });
    expect(switchTargetOf('imagegen', panels)).toEqual({ kind: 'switch', key: 'illustrations' });
    expect(switchTargetOf('sfx', panels)).toEqual({ kind: 'panel', key: 'sfx' });
  });

  it('外语、全局页、不认识的没有开关', () => {
    expect(switchTargetOf('lang', panels)).toBeNull();
    expect(switchTargetOf('jev', panels)).toBeNull();
    expect(switchTargetOf('nope', panels)).toBeNull();
  });
});
