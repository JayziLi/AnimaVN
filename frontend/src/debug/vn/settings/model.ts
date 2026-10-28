/**
 * 设置页每一项的定义(照设计稿 pages/settings.js 的 ROWS 写法):名字、控件、选项、默认值、说明、什么时候出现。
 * 页面(VNSettingsPage)只管把这些画出来,不在里面写每一行 —— 这样「恢复默认」对每一项都走同一条路,好测。
 *
 * 值分散在好几个地方:视觉小说自己的偏好在 vnSettings、回车键在 chatSettings、字幕在外语插件配置、
 * 语音开关 / 等语音 / 情绪在语音插件配置、BGM 和语音的音量在各自的播放器、封面音乐记在场景包上。
 * 所以改任何一项都写成一个 Patch(只写要改的那几处),由 applyPatch 一次分发出去;
 * 「恢复默认」就是把默认值也写成 Patch —— 一页里好几项一起恢复时合成一次写,不会互相盖掉。
 */

import type { ReactNode } from 'react';
import { ENTER_KEY_MODES, DEFAULT_CHAT_SETTINGS, type EnterKeyMode } from '../../lib/chatSettings';
import { DEFAULT_LANG_CONFIG } from '../../plugins/lang';
import {
  DEFAULT_VOICE_CONFIG,
  MAX_WAIT_MAX,
  MAX_WAIT_MIN,
  normalizeVoiceConfig,
  type VoicePluginConfig,
} from '../../plugins/voice';
import { DEFAULT_BGM_VOLUME } from '../bgm';
import { DEFAULT_VOICE_VOLUME } from '../voice';
import { VN_ACCENTS } from '../accent';
import { TYPE_SOUNDS } from '../typeSound';
import {
  AUTO_MAX,
  AUTO_MIN,
  AUTO_SPEEDS,
  BOX_SKINS,
  DEFAULT_VN_SETTINGS,
  DIALOG_STYLES,
  DUCK_LEVELS,
  OPACITY_MIN,
  PAPER_THEMES,
  SCALE_MAX,
  SCALE_MIN,
  TEXT_FONTS,
  TEXT_FONT_STACKS,
  TEXT_SPEEDS,
  TITLE_STYLES,
  TYPE_SOUND_OFF,
  type VNSettings,
} from '../vnSettings';

// ───────── 改动 ─────────

/** 一次改动:只写要改的那几处 */
export interface Patch {
  vn?: Partial<VNSettings>;
  voice?: Partial<VoicePluginConfig>;
  enterKey?: EnterKeyMode;
  showJa?: boolean;
  /** 0–1 */
  bgmVolume?: number;
  bgmMuted?: boolean;
  voiceVolume?: number;
  voiceMuted?: boolean;
  /** 封面音乐:场景包里的 BGM id;null = 默认(排第一的) */
  titleMusic?: string | null;
}

/** 改动写到哪(页面把各处的 setter 递进来) */
export interface Sinks {
  setVN: (next: VNSettings) => void;
  setVoiceConfig: (next: VoicePluginConfig) => void;
  setEnterKey: (mode: EnterKeyMode) => void;
  setShowJa: (showJa: boolean) => void;
  setBgmVolume: (v: number) => void;
  setBgmMuted: (m: boolean) => void;
  setVoiceVolume: (v: number) => void;
  setVoiceMuted: (m: boolean) => void;
  setTitleMusic: (id: string | null) => void;
}

/** 现在的值(页面读各处拼出来的) */
export interface SettingsState {
  vn: VNSettings;
  enterKey: EnterKeyMode;
  voiceConfig: VoicePluginConfig;
  showJa: boolean;
  bgm: { volume: number; muted: boolean; error: string | null };
  voice: { volume: number; muted: boolean; lastError: string | null };
  /** 封面音乐:没选角色是 null */
  titleMusic: { bgms: { id: string; label: string }[]; value: string | null } | null;
  /** 这张卡念台词用的声音;没绑是 null,还没选角色是 undefined */
  voiceCastName: string | null | undefined;
  /** 当前对话藏了几条回复的日语 */
  jaHidden: number;
  /** 主指针是手指(pointer: coarse,手机、平板;接了鼠标 / 触控板的不算):键盘快捷键那一行不放 */
  touch?: boolean;
}

/** 把一次改动分发到各处 */
export function applyPatch(p: Patch, s: SettingsState, to: Sinks): void {
  if (p.vn) to.setVN({ ...s.vn, ...p.vn });
  if (p.voice) to.setVoiceConfig(normalizeVoiceConfig({ ...s.voiceConfig, ...p.voice }));
  if (p.enterKey !== undefined) to.setEnterKey(p.enterKey);
  if (p.showJa !== undefined) to.setShowJa(p.showJa);
  if (p.bgmVolume !== undefined) to.setBgmVolume(p.bgmVolume);
  if (p.bgmMuted !== undefined) to.setBgmMuted(p.bgmMuted);
  if (p.voiceVolume !== undefined) to.setVoiceVolume(p.voiceVolume);
  if (p.voiceMuted !== undefined) to.setVoiceMuted(p.voiceMuted);
  if (p.titleMusic !== undefined) to.setTitleMusic(p.titleMusic);
}

/** 两处改动合成一处(同一个字段后写的算数);一页恢复默认用 */
export function mergePatches(list: readonly Patch[]): Patch {
  const out: Patch = {};
  for (const p of list) {
    const { vn, voice, ...rest } = p;
    if (vn) out.vn = { ...out.vn, ...vn };
    if (voice) out.voice = { ...out.voice, ...voice };
    Object.assign(out, rest);
  }
  return out;
}

// ───────── 行 ─────────

export interface ResetInfo {
  /** 和默认值不一样 */
  changed: boolean;
  /** 恢复成什么(悬停提示用的字) */
  text: string;
  patch: Patch;
}

interface RowCommon {
  id: string;
  name: string;
  /** 条件行:false = 收起(有过渡);不写 = 一直在 */
  open?: boolean;
  beta?: boolean;
  /** 名字旁的小「?」 */
  tip?: string;
  /** 和插件页哪一页是同一个(U17) */
  dup?: string;
  note?: string;
  /** 说明后面一个「去 XX」的跳转:点了切到那一项所在的页签 */
  jump?: { text: string; to: string };
  reset?: ResetInfo;
}

export interface SegRow extends RowCommon {
  kind: 'seg';
  options: { value: string | number | boolean; name: string; disabled?: boolean }[];
  value: string | number | boolean;
  onPick: (v: string | number | boolean) => void;
  /** 选字体的那行:下面放一句用这个字体写的示例 */
  sample?: string;
}
export interface RangeRow extends RowCommon {
  kind: 'range';
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  /** 右边显示的当前值 */
  text: string;
  /** 松手(指针抬起)时;跳字音量用它试听 */
  onRelease?: () => void;
}
export interface SwitchRow extends RowCommon {
  kind: 'switch';
  value: boolean;
  onChange: (v: boolean) => void;
}
export interface SelectRow extends RowCommon {
  kind: 'select';
  options: { value: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
  /** 选项里没有可选的(比如没选角色)时的说明,不画下拉 */
  empty?: string;
}
/** 只读:快捷键 */
export interface KeysRow extends RowCommon {
  kind: 'keys';
}
/** 页面自己画的一行(按钮、读到的状态……),里面自己用 SettingRow */
export interface NodeRow {
  kind: 'node';
  id: string;
  node: ReactNode;
  open?: boolean;
}
/** 出错的红字(没出错时不显示) */
export interface ErrRow {
  kind: 'err';
  id: string;
  text: string | null;
}

export type Row = SegRow | RangeRow | SwitchRow | SelectRow | KeysRow | NodeRow | ErrRow;

export interface Group {
  id?: string;
  /** 小节标题;不写 = 这一页只有一组 */
  title?: string;
  en?: string;
  /** 标题旁的小字 */
  note?: string;
  /** 标题右边的按钮(语音组的「换音色 · 试音」) */
  action?: { text: string; id: 'openVoice' };
  rows: Row[];
}

export interface Tab {
  id: string;
  name: string;
  en: string;
  beta?: boolean;
  /** 进阶:排在「进阶」分隔后面 */
  adv?: boolean;
  groups: Group[];
}

export const isResettable = (r: Row): r is Exclude<Row, NodeRow | ErrRow | KeysRow> & { reset: ResetInfo } =>
  r.kind !== 'node' && r.kind !== 'err' && r.kind !== 'keys' && r.reset !== undefined;

/** 一页里能恢复默认的行 */
export function resettableRows(tab: Tab): (Row & { reset: ResetInfo })[] {
  return tab.groups.flatMap((g) => g.rows).filter(isResettable);
}

// ───────── 文字 ─────────

const pct = (v: number) => `${Math.round(v)}%`;
const sec1 = (v: number) => `${v.toFixed(1)} 秒`;
const nameOf = (opts: readonly { value: unknown; name: string }[], v: unknown) =>
  opts.find((o) => o.value === v)?.name ?? String(v);

const ACCENT_NOTE = {
  mono: '按钮、名牌、滑块用灰白,不抢立绘和背景的颜色',
  character: '从这张卡的立绘里取主色,和封面同一个颜色;换角色跟着变',
  pink: '原来的粉色',
} as const;

const TITLE_NOTE: Record<string, string> = {
  paper: '左边一张斜切的纸放 logo 和菜单,右边是她和上次的场景;「角色」进选角色',
  bright: '整张明亮的场景,左边一层白纱放 logo 和菜单;「角色」进选角色',
};

const BOX_SKIN_NOTE = {
  'glass-dark': '深色半透明玻璃:名字压在框上沿,输入和快捷按钮在框里最下面一行,轮到你说话时正中弹出输入条',
  'glass-light': '浅色半透明玻璃:和黑玻璃一样的排法,亮的场景里更清爽',
  classic: '原来的对话框:输入框在对话框下面单独一条',
} as const;

/** 跳字音的选项:关 + 每个音效;文字速度是「瞬间」时除了「关」都点不了 */
const typeSoundOptions = (instant: boolean) => [
  { value: TYPE_SOUND_OFF, name: '关' },
  ...TYPE_SOUNDS.map((t) => ({ value: t.id, name: t.name, disabled: instant })),
];

// ───────── 建表 ─────────

/** 页面自己画的那几行(要读后端、有自己的状态),建表时只占个位置 */
export interface Nodes {
  jaHide: ReactNode;
  data: ReactNode;
}

/**
 * 按现在的值建出所有页签。apply:改一处就调一次(分发见 applyPatch)。
 * 卡带加的分页(生图)不在这里,页面把它排在「数据」后面。
 */
export function buildTabs(s: SettingsState, apply: (p: Patch) => void, nodes: Nodes): Tab[] {
  const v = s.vn;
  const d = DEFAULT_VN_SETTINGS;

  /** 视觉小说自己的一项:读 / 写 vnSettings,默认值也在那里 */
  const vnReset = <K extends keyof VNSettings>(k: K, text: (val: VNSettings[K]) => string): ResetInfo => ({
    changed: v[k] !== d[k],
    text: text(d[k]),
    patch: { vn: { [k]: d[k] } as Partial<VNSettings> },
  });
  const vnSeg = <K extends keyof VNSettings>(
    k: K,
    name: string,
    options: { value: VNSettings[K]; name: string; disabled?: boolean }[],
    extra: Partial<SegRow> = {},
  ): SegRow => ({
    kind: 'seg',
    id: k,
    name,
    options,
    value: v[k] as SegRow['value'],
    onPick: (val) => apply({ vn: { [k]: val } as Partial<VNSettings> }),
    reset: vnReset(k, (x) => nameOf(options, x)),
    ...extra,
  });
  const vnSwitch = <K extends keyof VNSettings>(k: K, name: string, extra: Partial<SwitchRow> = {}): SwitchRow => ({
    kind: 'switch',
    id: k,
    name,
    value: v[k] as boolean,
    onChange: (val) => apply({ vn: { [k]: val } as Partial<VNSettings> }),
    reset: vnReset(k, (x) => (x ? '开' : '关')),
    ...extra,
  });
  /** 0–1 的存储值、界面上按百分比拖的滑块 */
  const vnPercent = <K extends keyof VNSettings>(
    k: K,
    name: string,
    min: number,
    max: number,
    step: number,
    extra: Partial<RangeRow> = {},
  ): RangeRow => ({
    kind: 'range',
    id: k,
    name,
    min,
    max,
    step,
    value: Math.round((v[k] as number) * 100),
    onChange: (val) => apply({ vn: { [k]: val / 100 } as Partial<VNSettings> }),
    text: pct((v[k] as number) * 100),
    reset: vnReset(k, (x) => pct((x as number) * 100)),
    ...extra,
  });

  const voiceOn = s.voiceConfig.enabled;
  const voiceReset = <K extends keyof VoicePluginConfig>(k: K, text: (val: VoicePluginConfig[K]) => string): ResetInfo => ({
    changed: s.voiceConfig[k] !== DEFAULT_VOICE_CONFIG[k],
    text: text(DEFAULT_VOICE_CONFIG[k]),
    patch: { voice: { [k]: DEFAULT_VOICE_CONFIG[k] } as Partial<VoicePluginConfig> },
  });

  const text: Tab = {
    id: 'text',
    name: '文字',
    en: 'Text',
    groups: [
      {
        rows: [
          vnSeg('textSpeed', '文字速度', TEXT_SPEEDS),
          {
            kind: 'seg',
            id: 'showJa',
            name: '字幕',
            options: [
              { value: true, name: '日中双语' },
              { value: false, name: '只显示中文' },
            ],
            value: s.showJa,
            onPick: (val) => apply({ showJa: val as boolean }),
            note: '日语配音的卡在中文上面带一行日语原文;只显示中文就把它藏起来(历史页也是)',
            dup: '外语',
            reset: {
              changed: s.showJa !== DEFAULT_LANG_CONFIG.showJa,
              text: DEFAULT_LANG_CONFIG.showJa ? '日中双语' : '只显示中文',
              patch: { showJa: DEFAULT_LANG_CONFIG.showJa },
            },
          },
          {
            kind: 'node',
            id: 'jaHide',
            node: nodes.jaHide,
          },
          {
            kind: 'range',
            id: 'autoDelay',
            name: '自动播放间隔',
            min: AUTO_MIN / 1000,
            max: AUTO_MAX / 1000,
            step: 0.1,
            value: v.autoDelay / 1000,
            onChange: (val) => apply({ vn: { autoDelay: Math.round(val * 1000) } }),
            text: sec1(v.autoDelay / 1000),
            reset: vnReset('autoDelay', (x) => sec1(x / 1000)),
          },
          vnSeg('autoSpeed', '自动播放倍速', AUTO_SPEEDS, {
            note:
              (v.autoSpeed === 1
                ? '按上面的间隔和文字速度播'
                : `自动播放时停顿缩到 ${(v.autoDelay / v.autoSpeed / 1000).toFixed(1)} 秒,打字也快 ${v.autoSpeed} 倍`) +
              ' · 语音照常速念;开着「等语音念完」时还是念完才翻 · 自动播放时快捷栏点倍数也能换',
          }),
          // 同一个值(boxOpacity),名字跟着「外观 · 对话框」换:细线时管台词后面那层压暗有多深,经典时管玻璃框的透明度
          vnPercent('boxOpacity', v.dlgStyle === 'classic' ? '对话框透明度' : '台词后面的压暗', OPACITY_MIN * 100, 100, 1),
          vnPercent('textScale', '对白字号', SCALE_MIN * 100, SCALE_MAX * 100, 5),
        ],
      },
    ],
  };

  const sound: Tab = {
    id: 'sound',
    name: '声音',
    en: 'Sound',
    groups: [
      {
        id: 'music',
        title: '音乐',
        en: 'Music',
        rows: [
          {
            kind: 'range',
            id: 'bgmVol',
            name: 'BGM 音量',
            min: 0,
            max: 100,
            value: Math.round(s.bgm.volume * 100),
            onChange: (val) => apply({ bgmVolume: val / 100, ...(s.bgm.muted ? { bgmMuted: false } : {}) }),
            text: s.bgm.muted ? '静音' : pct(s.bgm.volume * 100),
            reset: {
              changed: Math.abs(s.bgm.volume - DEFAULT_BGM_VOLUME) > 1e-6,
              text: pct(DEFAULT_BGM_VOLUME * 100),
              patch: { bgmVolume: DEFAULT_BGM_VOLUME },
            },
          },
          {
            kind: 'switch',
            id: 'bgmMute',
            name: 'BGM 静音',
            value: s.bgm.muted,
            onChange: (val) => apply({ bgmMuted: val }),
            reset: { changed: s.bgm.muted, text: '关', patch: { bgmMuted: false } },
          },
          vnSeg('duckLevel', '念台词时', DUCK_LEVELS, { note: '角色说话时把音乐压到多低,念完自己淡回来' }),
          { kind: 'err', id: 'bgmErr', text: s.bgm.error },
        ],
      },
      {
        id: 'fx',
        title: '音效',
        en: 'Effects',
        rows: [
          vnSwitch('spriteFx', '立绘特效', {
            note: '换表情时跳一下、头顶冒气泡、响一声 · 每张立绘放什么在卡编辑器的立绘里设 · 往回翻和跳过时不放',
          }),
          vnPercent('spriteFxVolume', '特效音量', 0, 100, 1, { open: v.spriteFx }),
          vnSeg('typeSound', '跳字音', typeSoundOptions(v.textSpeed === 0), {
            note:
              v.textSpeed === 0
                ? '文字速度是「瞬间」时整句直接出,没有跳字,先在「文字」里调个速度'
                : '旁白逐字出来时每隔一个字响一声;角色台词不响,留给配音',
            jump: v.textSpeed === 0 ? { text: '去调文字速度', to: 'textSpeed' } : undefined,
          }),
          vnPercent('typeSoundVolume', '跳字音量', 0, 100, 1, { open: v.typeSound !== TYPE_SOUND_OFF && v.textSpeed > 0 }),
        ],
      },
      {
        id: 'voice',
        title: '语音',
        en: 'Voice',
        note:
          s.voiceCastName === undefined
            ? undefined
            : s.voiceCastName
              ? `这张卡用「${s.voiceCastName}」的声音`
              : '这张卡还没绑声音',
        action: { text: '换音色 · 试音', id: 'openVoice' },
        rows: [
          {
            kind: 'switch',
            id: 'voice',
            name: '语音',
            value: voiceOn,
            onChange: (val) => apply({ voice: { enabled: val } }),
            note: '关掉就不再请求语音服务 · 所有角色通用',
            dup: '语音',
            reset: voiceReset('enabled', (x) => (x ? '开' : '关')),
          },
          {
            kind: 'range',
            id: 'voiceVol',
            name: '语音音量',
            min: 0,
            max: 100,
            open: voiceOn,
            value: Math.round(s.voice.volume * 100),
            onChange: (val) => apply({ voiceVolume: val / 100, ...(s.voice.muted ? { voiceMuted: false } : {}) }),
            text: s.voice.muted ? '静音' : pct(s.voice.volume * 100),
            reset: {
              changed: Math.abs(s.voice.volume - DEFAULT_VOICE_VOLUME) > 1e-6,
              text: pct(DEFAULT_VOICE_VOLUME * 100),
              patch: { voiceVolume: DEFAULT_VOICE_VOLUME },
            },
          },
          {
            kind: 'switch',
            id: 'voiceMute',
            name: '语音静音',
            open: voiceOn,
            value: s.voice.muted,
            onChange: (val) => apply({ voiceMuted: val }),
            reset: { changed: s.voice.muted, text: '关', patch: { voiceMuted: false } },
          },
          {
            kind: 'seg',
            id: 'waitVoice',
            name: '文字和语音',
            open: voiceOn,
            options: [
              { value: false, name: '先出文字' },
              { value: true, name: '等语音' },
            ],
            value: s.voiceConfig.waitForVoice,
            onPick: (val) => apply({ voice: { waitForVoice: val as boolean } }),
            note: s.voiceConfig.waitForVoice
              ? '语音好了文字和声音一起出;等太久就先出文字'
              : '文字直接出,语音还在生成时字后面转个圈,好了自己念',
            dup: '语音',
            reset: voiceReset('waitForVoice', (x) => (x ? '等语音' : '先出文字')),
          },
          {
            kind: 'range',
            id: 'maxWait',
            name: '最多等',
            min: MAX_WAIT_MIN,
            max: MAX_WAIT_MAX,
            step: 1,
            open: voiceOn && s.voiceConfig.waitForVoice,
            value: s.voiceConfig.maxWaitSec,
            onChange: (val) => apply({ voice: { maxWaitSec: val } }),
            text: `${s.voiceConfig.maxWaitSec} 秒`,
            dup: '语音',
            reset: voiceReset('maxWaitSec', (x) => `${x} 秒`),
          },
          {
            kind: 'seg',
            id: 'fixedEmo',
            name: '语音情绪',
            open: voiceOn,
            options: [
              { value: false, name: '跟着表情' },
              { value: true, name: '不变' },
            ],
            value: s.voiceConfig.fixedEmotion,
            onPick: (val) => apply({ voice: { fixedEmotion: val as boolean } }),
            note: s.voiceConfig.fixedEmotion
              ? '每句都用默认情绪念(声音情绪表里排第一的那行)'
              : '这句立绘是什么表情,就用对应的情绪念',
            dup: '语音',
            reset: voiceReset('fixedEmotion', (x) => (x ? '不变' : '跟着表情')),
          },
          vnSeg(
            'voiceInterrupt',
            '翻页时',
            [
              { value: true, name: '停止语音' },
              { value: false, name: '念完为止' },
            ],
            { open: voiceOn },
          ),
          vnSeg(
            'autoWaitVoice',
            '自动播放',
            [
              { value: true, name: '等语音念完再翻' },
              { value: false, name: '不等语音' },
            ],
            { open: voiceOn },
          ),
          { kind: 'err', id: 'voiceErr', text: voiceOn && s.voice.lastError ? `语音最近一次失败:${s.voice.lastError}` : null },
        ],
      },
    ],
  };

  const control: Tab = {
    id: 'control',
    name: '操作',
    en: 'Control',
    groups: [
      {
        rows: [
          {
            kind: 'seg',
            id: 'enterKey',
            name: '回车键',
            options: ENTER_KEY_MODES.map((m) => ({ value: m.value, name: m.name })),
            value: s.enterKey,
            onPick: (val) => apply({ enterKey: val as EnterKeyMode }),
            note: `${ENTER_KEY_MODES.find((m) => m.value === s.enterKey)?.note ?? ''} · 和调试台聊天框共用`,
            reset: {
              changed: s.enterKey !== DEFAULT_CHAT_SETTINGS.enterKey,
              text: nameOf(ENTER_KEY_MODES, DEFAULT_CHAT_SETTINGS.enterKey),
              patch: { enterKey: DEFAULT_CHAT_SETTINGS.enterKey },
            },
          },
          // 主要靠手指点的设备上不放这一行(接了鼠标 / 触控板的照常有)
          ...(s.touch ? [] : [{ kind: 'keys' as const, id: 'keys', name: '快捷键' }]),
        ],
      },
    ],
  };

  const display: Tab = {
    id: 'display',
    name: '显示',
    en: 'Display',
    groups: [
      {
        rows: [
          vnSwitch('showThinking', '思考过程', {
            note: v.showThinking
              ? '回复第一句上留「已思考 N 秒」,点开能看模型想了什么'
              : '对话框和历史页都不显示思考内容;模型照常思考,想让它不思考在「模型」页把思考深浅设成关',
          }),
          vnSwitch('showModel', '模型标签', {
            note: '左上「模型」按钮旁边写上现在用的模型;关掉只留图标',
          }),
          vnSwitch('showVoice', '语音标签', {
            note: '卡绑了声音时右下有「语音」按钮:念的时候声波跳,断了变红,点开能开关语音、调音量;关掉之后语音断了照样会出来',
          }),
          vnSeg(
            'titleScreen',
            '标题画面',
            [
              { value: true, name: '进来先看' },
              { value: false, name: '直接继续' },
            ],
            { beta: true },
          ),
        ],
      },
    ],
  };

  // 封面音乐:设的那首删了或禁用了,下拉显示回默认(游戏里也是放排第一的)
  const bgms = s.titleMusic?.bgms ?? [];
  const musicValue = s.titleMusic && bgms.some((b) => b.id === s.titleMusic?.value) ? (s.titleMusic.value ?? '') : '';
  const look: Tab = {
    id: 'look',
    name: '外观',
    en: 'Look',
    groups: [
      {
        rows: [
          vnSeg('theme', '主题', PAPER_THEMES, {
            tip: '提示条、确认框、报错纸卡和右键小菜单用白纸、黑纸还是玻璃(玻璃跟着这一幕的场景取色);白天夜里都一样,游戏画面不跟着变。封面、菜单、设置这些页等换皮时也跟着',
          }),
          vnSeg('titleStyle', '封面', TITLE_STYLES, {
            note: `${TITLE_NOTE[v.titleStyle] ?? ''} · 菜单「返回标题」看效果`,
          }),
          {
            kind: 'select',
            id: 'titleMusic',
            name: '封面音乐',
            beta: true,
            options: bgms.map((b) => ({ value: b.id, name: b.label })),
            value: musicValue,
            onChange: (val) => apply({ titleMusic: val || null }),
            empty: s.titleMusic
              ? bgms.length === 0
                ? '这张卡的场景包里还没有 BGM,封面不放音乐'
                : undefined
              : '先选一个角色',
            note: s.titleMusic && bgms.length > 0 ? '标题画面放这首,点「继续」换回场景的音乐 · 记在这张卡的场景包上,绑同一个包的角色共用' : undefined,
            reset: s.titleMusic && bgms.length > 0 ? { changed: musicValue !== '', text: '默认:排第一的', patch: { titleMusic: null } } : undefined,
          },
          vnSeg('accent', '主题色', VN_ACCENTS, { note: ACCENT_NOTE[v.accent] }),
          vnSeg('dlgStyle', '对话框', DIALOG_STYLES, {
            tip: '细线:台词直接写在画面上,底下一层淡淡的压暗和一条细线;经典:玻璃框 + 名牌。四角的按钮、输入框两种一样',
          }),
          // 经典对话框的玻璃底色;细线没有框,这一行只在选了经典时出现
          ...(v.dlgStyle === 'classic' ? [vnSeg('boxSkin', '玻璃框底色', BOX_SKINS, { note: BOX_SKIN_NOTE[v.boxSkin] })] : []),
          vnSeg('textFont', '对话框文字', TEXT_FONTS, { sample: TEXT_FONT_STACKS[v.textFont] }),
          {
            kind: 'range', id: 'dialogueOffset', name: '对话框上下位置',
            min: -40, max: 160, step: 4, value: v.dialogueOffset,
            onChange: (val) => apply({ vn: { dialogueOffset: val } }),
            text: v.dialogueOffset === 0 ? '默认位置' : `${v.dialogueOffset > 0 ? '上移' : '下移'} ${Math.abs(v.dialogueOffset)}`,
            note: '向右上移,向左下移;输入栏保持原位。右侧预览实时显示效果',
            reset: vnReset('dialogueOffset', () => '默认位置'),
          },
          {
            kind: 'range', id: 'dialogueHeight', name: '对话框高度',
            min: 0, max: 160, step: 4, value: v.dialogueHeight,
            onChange: (val) => apply({ vn: { dialogueHeight: val } }),
            text: v.dialogueHeight === 0 ? '默认高度' : `增加 ${v.dialogueHeight}`,
            note: '从当前默认高度向上扩展;长台词仍会自动撑开',
            reset: vnReset('dialogueHeight', () => '默认高度'),
          },
        ],
      },
    ],
  };

  const data: Tab = {
    id: 'data',
    name: '数据',
    en: 'Data',
    adv: true,
    groups: [{ rows: [{ kind: 'node', id: 'data', node: nodes.data }] }],
  };

  return [text, sound, control, display, look, data];
}

/** 页签的页面上有没有这一项(「去调文字速度」这种跳转找页签用) */
export function tabOfRow(tabs: readonly Tab[], id: string): string | null {
  for (const t of tabs) if (t.groups.some((g) => g.rows.some((r) => r.id === id))) return t.id;
  return null;
}
