/**
 * 视觉小说自己的偏好:文字速度、自动播放、文本框透明度……纯前端,按设备记住。
 *
 * 回车键和调试台聊天框共用,存在 chatSettings 里;BGM 音量归播放器管(bgm.ts)。
 * 这里只放视觉小说独有的。读的时候逐字段校验再和默认值合并,手改坏了也不会炸。
 */

export interface VNSettings {
  /** 打字机每个字的间隔(毫秒);0 = 整句直接出 */
  textSpeed: number;
  /** 自动播放时,一句打完之后停多久再翻下一句(毫秒) */
  autoDelay: number;
  /** 自动播放倍速:翻页前的停顿除以它,打字也跟着快;语音不加速(照常念完) */
  autoSpeed: number;
  /** 对话框底色的不透明度 */
  boxOpacity: number;
  /** 对白字号倍率 */
  textScale: number;
  /** 对话框里显示思考过程(思考中的计时块、回复第一句上的「已思考」) */
  showThinking: boolean;
  /** 右上角显示当前模型 */
  showModel: boolean;
  /** 右上角显示语音标签(这张卡绑了声音时):连没连上一眼看到,点开是语音的快捷设置 */
  showVoice: boolean;
  /** 进视觉小说先看标题画面;关掉就直接接着上次的对话(Beta) */
  titleScreen: boolean;
  /** 标题画面的样式:纸面 / 明亮(10-04 定稿的两种);海报、电影是之前的版本(Beta) */
  titleStyle: TitleStyle;
  /** 对话框皮肤:经典 = 原来的;黑玻璃 / 白玻璃 = 10-04 定稿(名牌压框沿、输入在框里、轮到你正中弹输入条) */
  boxSkin: BoxSkin;
  /** 对话框文字的字体(台词、日语那行、玩家台词条、输入框);菜单和封面不跟着变 */
  textFont: TextFont;
  /** 翻页时停掉上一句的语音;关掉 = 上一句接着念,直到这句的语音开始 */
  voiceInterrupt: boolean;
  /** 自动播放时等这句的语音合成完、念完再翻 */
  autoWaitVoice: boolean;
  /** 念台词时 BGM 压到原音量的多少(1 = 不压) */
  duckLevel: number;
  /** 主题色:按钮、名牌、滑块用的颜色(见 accent.ts) */
  accent: VNAccent;
  /** 立绘切换特效(每张立绘在立绘包里单独设的跳一下、气泡、音效)总开关 */
  spriteFx: boolean;
  /** 特效音效的音量 */
  spriteFxVolume: number;
  /** 跳字音效:逐字显示旁白时每隔一个字响一声;'off' = 不要。id 见 plugins/spriteFx.ts 的 TYPE_SOUNDS */
  typeSound: string;
  typeSoundVolume: number;
}

import { VN_ACCENTS, type VNAccent } from './accent';
import { TYPE_SOUNDS } from '../plugins/spriteFx';

export type TitleStyle = 'paper' | 'bright' | 'poster' | 'cinema';

export const TITLE_STYLES: { value: TitleStyle; name: string }[] = [
  { value: 'paper', name: '纸面' },
  { value: 'bright', name: '明亮' },
  { value: 'poster', name: '海报(旧)' },
  { value: 'cinema', name: '电影(旧)' },
];

export type BoxSkin = 'classic' | 'glass-dark' | 'glass-light';

export type TextFont = 'serif' | 'sans' | 'round' | 'kai';

export const TEXT_FONTS: { value: TextFont; name: string }[] = [
  { value: 'serif', name: '宋体' },
  { value: 'sans', name: '黑体' },
  { value: 'round', name: '圆体' },
  { value: 'kai', name: '楷体' },
];

/** 宋体 / 黑体 / 楷体用系统字体(Windows / macOS 的名字都写上);圆体是打包进游戏的资源圆体(vnFonts.css) */
export const TEXT_FONT_STACKS: Record<TextFont, string> = {
  serif: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun', serif",
  sans: "'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  round: "'AnimaRound', 'Yuanti SC', 'YouYuan', 'Microsoft YaHei', sans-serif",
  kai: "'Kaiti SC', 'STKaiti', 'KaiTi', '楷体', serif",
};

export const BOX_SKINS: { value: BoxSkin; name: string }[] = [
  { value: 'glass-dark', name: '黑玻璃' },
  { value: 'glass-light', name: '白玻璃' },
  { value: 'classic', name: '经典' },
];

const KEY = 'anima.vn.settings';

export const TYPE_SOUND_OFF = 'off';

export const DEFAULT_VN_SETTINGS: VNSettings = {
  // 10-04 起默认整句直接出(用户要的);之前存过设置的设备保留原来的速度
  textSpeed: 0,
  autoDelay: 1500,
  autoSpeed: 1,
  boxOpacity: 0.72,
  textScale: 1,
  showThinking: true,
  showModel: true,
  showVoice: true,
  titleScreen: true,
  titleStyle: 'paper',
  boxSkin: 'glass-dark',
  textFont: 'serif',
  voiceInterrupt: true,
  autoWaitVoice: true,
  duckLevel: 0.35,
  accent: 'character',
  spriteFx: true,
  spriteFxVolume: 0.8,
  typeSound: TYPE_SOUND_OFF,
  typeSoundVolume: 0.5,
};

export const TEXT_SPEEDS: { value: number; name: string }[] = [
  { value: 60, name: '慢' },
  { value: 28, name: '中' },
  { value: 14, name: '快' },
  { value: 0, name: '瞬间' },
];

export const DUCK_LEVELS: { value: number; name: string }[] = [
  { value: 1, name: '不压低' },
  { value: 0.6, name: '压低一点' },
  { value: 0.35, name: '压低' },
  { value: 0.12, name: '几乎听不见' },
];

/** 快捷栏上点倍数按这个顺序循环 */
export const AUTO_SPEEDS: { value: number; name: string }[] = [
  { value: 1, name: '×1' },
  { value: 1.5, name: '×1.5' },
  { value: 2, name: '×2' },
  { value: 3, name: '×3' },
];

export function nextAutoSpeed(current: number): number {
  const i = AUTO_SPEEDS.findIndex((s) => s.value === current);
  return AUTO_SPEEDS[(i + 1) % AUTO_SPEEDS.length].value;
}

export const AUTO_MIN = 500;
export const AUTO_MAX = 5000;
export const OPACITY_MIN = 0.2;
export const SCALE_MIN = 0.85;
export const SCALE_MAX = 1.3;

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

export function loadVNSettings(): VNSettings {
  const d = DEFAULT_VN_SETTINGS;
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    // 存坏了就当没存过
  }
  return {
    textSpeed: num(raw.textSpeed, 0, 200, d.textSpeed),
    autoDelay: num(raw.autoDelay, AUTO_MIN, AUTO_MAX, d.autoDelay),
    autoSpeed: AUTO_SPEEDS.some((a) => a.value === raw.autoSpeed) ? (raw.autoSpeed as number) : d.autoSpeed,
    boxOpacity: num(raw.boxOpacity, OPACITY_MIN, 1, d.boxOpacity),
    textScale: num(raw.textScale, SCALE_MIN, SCALE_MAX, d.textScale),
    showThinking: bool(raw.showThinking, d.showThinking),
    showModel: bool(raw.showModel, d.showModel),
    showVoice: bool(raw.showVoice, d.showVoice),
    titleScreen: bool(raw.titleScreen, d.titleScreen),
    // 还没有 boxSkin 的旧存档 = 10-04 新外观之前存的:封面也换到新的默认,不留在旧海报上
    titleStyle:
      raw.boxSkin !== undefined && TITLE_STYLES.some((t) => t.value === raw.titleStyle)
        ? (raw.titleStyle as TitleStyle)
        : d.titleStyle,
    boxSkin: BOX_SKINS.some((t) => t.value === raw.boxSkin) ? (raw.boxSkin as BoxSkin) : d.boxSkin,
    textFont: TEXT_FONTS.some((t) => t.value === raw.textFont) ? (raw.textFont as TextFont) : d.textFont,
    voiceInterrupt: bool(raw.voiceInterrupt, d.voiceInterrupt),
    autoWaitVoice: bool(raw.autoWaitVoice, d.autoWaitVoice),
    duckLevel: num(raw.duckLevel, 0, 1, d.duckLevel),
    accent: VN_ACCENTS.some((a) => a.value === raw.accent) ? (raw.accent as VNAccent) : d.accent,
    spriteFx: bool(raw.spriteFx, d.spriteFx),
    spriteFxVolume: num(raw.spriteFxVolume, 0, 1, d.spriteFxVolume),
    typeSound:
      raw.typeSound === TYPE_SOUND_OFF || TYPE_SOUNDS.some((t) => t.id === raw.typeSound)
        ? (raw.typeSound as string)
        : d.typeSound,
    typeSoundVolume: num(raw.typeSoundVolume, 0, 1, d.typeSoundVolume),
  };
}

export function saveVNSettings(s: VNSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 隐私模式等写不进去:这次会话里照样生效,只是不记住
  }
}
