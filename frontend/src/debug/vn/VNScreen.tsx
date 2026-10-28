/**
 * 视觉小说界面 —— 同一段对话的另一种看法。
 *
 * 不持有任何对话数据:条目、发送、停止、重新生成全部来自调试台,这里只负责
 * 把 AI 回复切成一句一句,配上立绘、背景、对话框播出来。所以在这里发的消息,
 * 回到调试台也能看到,反过来也一样;提示词也走的是同一套组装流程。
 *
 * 局内菜单(历史 / 存档 / 角色 / 插件 / 预设 / 模型 / 设置 / 开发者)是一个全屏的壳,
 * 设置和开发者之外的页由调试台拼好传进来(renderPage),这两页在这里画。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import './theme.css';
import './vn.css';
import './vnSkins.css';
import './vnLine.css';
import './vnEmbedPaper.css';
import { newBeatCache, parseBeats, type Beat } from '../core/beats';
import { buildTimeline, stateAt, type TimelineCtx } from '../core/timeline';
import {
  cardFaceUrl,
  sceneImageUrl,
  spriteImageUrl,
  spriteThumbUrl,
  type PackSprite,
  type SceneAsset,
  type SpeakRequest,
  type SpriteEffect,
  type SpriteLayout,
  type VoiceProfile,
} from '../lib/api';
import { currentInfo, currentText, type ChatEntry } from '../lib/chatEntry';
import { enterHint, enterShouldSend, type EnterKeyMode } from '../lib/chatSettings';
import type { MacroContext } from '../lib/macros';
import { useCoarsePointer, useIsMobile } from '../lib/useIsMobile';
import { resolveByLabel } from '../plugins/common';
import {
  emotionCandidates,
  emotionListRef,
  isNpcHit,
  type EmotionContext,
} from '../plugins/emotionMatch';
import { SYNC_MAX_WAIT_MS, jevKindsOf, jevMayTag, NO_KINDS, voiceWaitsForJev } from '../plugins/jev';
import { jaHiddenOf, type JaHideControls } from '../plugins/jaHide';
import { parseBilingual } from '../plugins/lang';
import { manualEmotions, manualOf } from '../plugins/manualMarks';
import { cgFrameFromPairs, missingCell, voiceRowFromPairs } from '../plugins/pairings';
import { bubbleStyle, facesByCanvas, spriteStyle, type SpriteStage } from '../plugins/spriteLayout';
import { fxStep, fxSwapsInstantly, MOTION_FRAMES, normalizeEffect, playFxSound, preloadSfx, soundFile } from '../plugins/spriteFx';
import { SpriteBubble } from './SpriteBubble';
import { playTypeSound, preloadTypeSound } from './typeSound';
import {
  backgroundsOf,
  bgmsOf,
  cgsOf,
  cgVariantsOf,
  titleBgmOf,
  type SceneState,
} from '../plugins/scene';
import {
  planVoiceLines,
  voiceForSpeaker,
  type VoiceCast,
  type VoicePluginConfig,
} from '../plugins/voice';
import { audioBus } from './audioBus';
import { bgmPlayer } from './bgm';
import { AnimaLogo } from './AnimaLogo';
import { Feather } from './Feather';
import type { ParsedReply, TagHit, TagKind, VNLine } from './script';
import { vnTagKinds } from './tags';
import { useEmotionMatches } from './useEmotionMatches';
import { fillMissingCell, usePairings } from './usePairings';
import { useTimelineEngine } from './useTimelineEngine';
import { useWordRecords } from './useWordRecords';
import { useVoiceLine } from './useVoiceLine';
import { VoiceButtons } from './VoiceButtons';
import { LineInspector } from './LineInspector';
import type { PluginFocus, PluginSection } from '../components/PluginsDrawer';
import { VNMenu, type MenuPage } from './VNMenu';
import type { LivePreviewData } from './settings/LivePreview';
import { VNSettingsPage, type SettingsTab } from './VNSettingsPage';
import { VoiceQuick } from './VoiceQuick';
import { ConsoleView } from './ConsoleView';
import { voicePlayer } from './voice';
import { GameIcon } from './ui/GameIcon';
import { Switch } from './ui/Switch';
import { echoHoldMs, playerSaid } from './echo';
import { PopWindow } from './ui/PopWindow';
import type { HistoryData } from './history/logic';
import { ModelWindowBody, type ModelQuick } from './ModelWindow';
import { accentCssVars, useVNAccent } from './accent';
import { useSceneGlass } from './ui/useSceneGlass';
import { FrostLayer } from './ui/FrostLayer';
import { useFrost } from './ui/useFrost';
import { menuCrumb } from './menuLabel';
import { popThemeClass } from './ui/logic';
import { isNightLabel, pickBannerScene } from './settings/banner';
import { FALLBACK_BACKGROUND } from './fallbacks';
import { skipChipLabel } from './skipChip';
import { typedParts } from './typedParts';
import { BG_FADE_MS, SPRITE_FADE_MS, useStackedLayers, useStackedLayersCtl, type StackLayer } from './stackedLayers';
import { imageRatio, isSettled, loadImage, useAssetGate, useSettledView, type GateItem } from './assetGate';
import { spriteForMood, type TitleMood } from './titleArt';
import type { FormsState, VnIllustrationContext, VnIllustrations } from '../plugins/cartridges';
import { DEFAULT_SWITCHES, type PluginSwitches } from '../plugins/switches';
import { formButton } from '../plugins/forms';
import { StateToggle } from './StateToggle';
import { VNLoading } from './VNLoading';
import { VNTitle, type TitleCard, type TitleScene } from './VNTitle';
import { VNPick } from './VNPick';
import { LineMenu } from './LineMenu';
import { ModelError } from './ModelError';
import { holdsUserLine, userSaid, type GenFail } from './genFail';
import { MOTION, useFadeLayer, useReducedMotion } from './ui/motion';
import { toastPlace } from './ui/notice';
import { ToastStack, type ToastItem } from './ui/PaperToast';
import {
  AUTO_SPEEDS,
  loadVNSettings,
  nextAutoSpeed,
  saveVNSettings,
  TYPE_SOUND_OFF,
  type VNSettings,
} from './vnSettings';

/** 封面一露出来就看得到的表情(待机):进封面前必须下好 */
const TITLE_FIRST: TitleMood[] = ['idle'];
/** 悬停菜单、点一下才换的表情:排在「尽量等」的最前面,封面上没下好时先留着旧表情 */
const TITLE_LATER: TitleMood[] = ['continue', 'new', 'load', 'config', 'exit', 'poke'];
/** 进之前必须下好往后几句要用的表情和背景(用户:「封面和前几个对话的素材要准备好」) */
const AHEAD_LINES = 4;
// 设置页里插图卡带那一页的 key
const ILLUS_TAB = 'illus';
/** 对话框上的检查器浮在对话框上方;上面的地方不够时至少留这么高(像素),压住对话框上沿 */
const INSPECT_MIN_ROOM = 240;

const NO_TOASTS: ToastItem[] = [];
const NOOP = () => {};

/** 调试台拼好传进来的那几页 */
export type HostPage = Exclude<MenuPage, 'config' | 'dev'>;

export interface PageContext {
  close: () => void;
  /** 读档 / 开新的故事:关掉菜单,如果还在封面(从「读档」进来的)一并把封面收掉,进游戏 */
  enterGame: () => void;
  /** 跳到某条回复的第 line 句(不给是第一句),并关掉菜单 */
  jumpTo: (entryId: string, line?: number) => void;
  /** 「在当前位置存档」存到哪条消息为止 */
  currentMessageId: string | null;
  /** 现在这一句所在的场景(存档回执「已存档 · 夜路 · 33 条」的地名和小图);没有背景时都是 null */
  sceneNow: { label: string | null; thumb: string | null };
  /** 存档页从封面「读档」进来的:只能挑一个读,没有「在这里存档」(没有当前对话可存) */
  loadOnly: boolean;
  /** 历史页的「显示原文」 */
  raw: boolean;
  /** 游戏里右键 / 长按「改原文」打开的历史小窗口:一打开就在改这条回复(别的时候不给) */
  editFirst?: string | null;
  /** editFirst 那条保存完了:关窗口回游戏 */
  editDone?: () => void;
  /** 换到插件页的某个插件(预设里点了插件块、设置里点了「换声音」) */
  openPlugin: (section: PluginSection) => void;
  /** 插件页该停在哪个插件;从导航直接点进来时是 null */
  pluginFocus: PluginFocus | null;
  /** 换到菜单的「设置」页(插件页底部「游戏设置 · 音量」) */
  openConfig: () => void;
  /** 换到菜单的「素材」页(插件页里的「素材管理 · 立绘包」这类链接;停在哪个页签由外面先定好) */
  openAssets: () => void;
  /** 换到菜单的「预设」页(角色页目录里「预设」那一行) */
  openPreset: () => void;
  /** 设置里的「思考过程」:关了历史页也不显示 */
  showThinking: boolean;
  /** 历史页(vn/history)的数据:每条回复的句子、现在停在哪句、字幕 */
  log: HistoryData;
  /**
   * 这一页有没保存的改动时登记一个「离开前先问」(返回 false = 留下);关菜单、Esc、换页、返回标题都先问它。
   * 页面卸载或改动保存了就登记 null。现在模型页在用
   */
  setLeaveGuard: (guard: (() => Promise<boolean>) | null) => void;
}

/**
 * 跨存档跳转(相册里画在另一个存档里的图「跳到这里」):DebugApp 读完那个档、条目换好以后才给,
 * VNScreen 把光标放到 entryId 那条回复的第 line 句。nonce 每次请求都换,同一个只消费一次
 */
export interface PendingJump {
  chatId: string;
  entryId: string;
  line: number;
  nonce: number;
}

interface Props {
  entries: ChatEntry[];
  /** 调试台聊天区用的同一份宏取值 —— 开场白里的 {{user}} 两边要展开成同一个人 */
  macros: MacroContext;
  charName: string;
  userName: string;
  sprites: PackSprite[];
  /** 形态(plugins/forms.ts):没开的卡 enabled 是 false、lens 是 null,顶栏不出按钮、表情不换 */
  forms?: FormsState;
  /** 立绘怎么摆:所有角色共用的构图 + 这张卡的微调 */
  spriteStage: SpriteStage;
  spriteLayout: SpriteLayout;
  tagTemplate: string;
  /** 这张卡绑的场景包里的素材(背景 + BGM + CG);没绑时为空 */
  sceneAssets: SceneAsset[];
  /** 场景包的名字(等待页右下「正在载入 · 名字 · 场景包」用);没绑场景包是 null */
  scenePackName: string | null;
  /** 场景包设的封面音乐;null = 放排第一的 */
  titleBgmId: string | null;
  /** 设置页里改封面音乐:存在场景包上 */
  onChangeTitleBgm: (bgmId: string | null) => void;
  bgTemplate: string;
  bgmTemplate: string;
  cgTemplate: string;
  /** 语音插件的配置,以及这张卡用哪些声音 */
  voiceConfig: VoicePluginConfig;
  voiceCast: VoiceCast;
  /** 语音面板「音色」那张短列表:全部声音(不给 = 只显示现在用的) */
  voiceProfiles?: readonly VoiceProfile[];
  /** 语音面板里点了一个声音:换成这张卡的主声音(下一句起用它) */
  onPickVoice?: (id: string) => void;
  /** 拆句拼接开着(卡带的 useSplice):合成请求带 sfx */
  sfxEnabled: boolean;
  /** 设置页里改语音开关 / 等不等语音:改的是插件配置,和调试台插件抽屉同一份 */
  onChangeVoiceConfig: (next: VoicePluginConfig) => void;
  /** 外语插件:在中文上方显示这句的日语 */
  showJa: boolean;
  /** 设置页「字幕」改的就是外语插件的「显示日语」(全局一份) */
  onChangeShowJa: (showJa: boolean) => void;
  /** 隐藏前文日语(plugins/jaHide.ts):藏了的回复不显示日语,历史页「显示原文」还看得到 */
  jaHide: JaHideControls;
  /** 立绘和文字同步(Jev 通用设置):这句 Jev 判完才出字 */
  jevSync: boolean;
  /** 回车键:和调试台的聊天框共用 */
  enterKey: EnterKeyMode;
  onChangeEnterKey: (mode: EnterKeyMode) => void;
  sending: boolean;
  /** 卡、预设都就绪才能发 */
  canSend: boolean;
  notReadyHint: string;
  /** 当前对话。换了(读档、新故事)就从最新一条回复的第一句开始看 */
  chatKey: string | null;
  chatName: string;
  /** 当前对话最后一次改动的时间 —— 标题画面上的「上次 · 3 小时前」 */
  chatUpdatedAt: string | null;
  /** 正在读对话 —— 盖一层加载画面 */
  loading: boolean;
  /** 读完另一个存档后要落到的那一句(PendingJump);没有是 null */
  pendingJump?: PendingJump | null;
  /** 这张卡的立绘、场景列表都拿到了(切卡后要等一会儿)—— 素材等待页据此知道要等哪些图 */
  assetsReady?: boolean;
  /** 有没有「相册」(生图卡带装了才有;内容由 renderPage('album') 给) */
  hasAlbum?: boolean;
  /** 左上「模型」旁边的模型名 */
  modelLabel: string;
  /** 左上「模型」开的小窗口里用的:连接、模型、思考、流式(调试台给);不给 = 点「模型」直接开菜单的模型页 */
  modelQuick?: ModelQuick;
  onSend: (text: string) => void;
  /**
   * 插话。entryId + keep:把这条回复截到 keep 为止(完整版留成另一个分支)再发;
   * keep 为 null:不截,只是先停下正在生成的那条
   */
  onInterject: (text: string, entryId: string | null, keep: string | null) => void;
  /**
   * 翻回历史、在旧的位置开口:从 entryId 这条回复分出一个新对话(截到 keep 为止)再发。
   * 原来的对话一个字不动,留在存档里
   */
  onBranch: (text: string, entryId: string, keep: string) => void;
  onStop: () => void;
  onRegenerate: () => void;
  onExit: () => void;
  renderPage: (page: HostPage, ctx: PageContext) => ReactNode;
  /** 标题画面上的角色头像 */
  cards: TitleCard[];
  /** 按脸裁的小图读不到,要这张卡的卡面头像(拉到后出现在 cards 的 avatar 上) */
  onWantAvatar: (cardId: string) => void;
  /** 选角色界面的「导入」:打开调试台的角色卡文件框 */
  onImportCard?: () => void;
  /** 选角色名字右边的「导出」:导出她的角色包(.animavn) */
  onExportCard?: (cardId: string) => void;
  /** 游戏里刚导进来的那张卡:选角色里排第一、选中、带「刚导入」小签;离开选角色时 onFreshSeen 让上面清掉 */
  freshCardId?: string | null;
  onFreshSeen?: () => void;
  currentCardId: string | null;
  onPickCard: (id: string, fresh: boolean) => void;
  /**
   * 检查器里只改这一句的表情(plugins/manualMarks.ts):记在 entryId 这条当前分支的第 line 句上;
   * pick 是 null 改回去。DebugApp 改条目、照常存盘
   */
  onSetManual?: (entryId: string, line: number, pick: { item: string; label: string } | null) => void;
  /** 生成的插图(生图卡带,plugins/illustrations.ts):没装是 null */
  illustrations?: VnIllustrations | null;
  /** 插件开关(plugins/switches.ts,插件页右上角):关掉的立绘 / 背景 / 音乐 / CG / AI 出图不显示、不干活 */
  switches?: PluginSwitches;
  /** 调试台 notify 来的提示(游戏开着时由这里画成纸卡) */
  toasts?: ToastItem[];
  onRemoveToast?: (id: number) => void;
  /** 这次生成失败了(还没重试 / 重新发):对话区停在你说的那句,台词上方放一张报错纸卡 */
  genFail?: GenFail | null;
}

interface Cursor {
  id: string;
  swipe: number;
  line: number;
}

interface BgView {
  key: string;
  src: string;
  /** 竖屏时对准横图的哪儿(object-position 的横向百分比) */
  focus: number;
}

interface CgView {
  key: string;
  /** null = 没有 CG */
  src: string | null;
  /** 哪张 CG(构图):同一张里换差分走快速淡入,出现 / 收起 / 换成别的 CG 走慢的 */
  group: string | null;
  /** 竖屏时对准横图的哪儿 */
  focus: number;
  /** 生成插图的显示分支:above 保留整图;铺满屏幕时等比裁切填满 */
  whole?: boolean;
  /** 整张放在对话框上面那一块里(--vn-window-h 是对话框量出来的高) */
  above?: boolean;
}

const NO_CG: CgView = { key: 'none', src: null, group: null, focus: 50 };

interface SpriteView {
  key: string;
  src: string | null;
  /** 没有图时占位长方形上写的字 */
  label: string;
  /** 按脸对齐算出来的位置(plugins/spriteLayout.ts);占位长方形没有 */
  style?: CSSProperties;
  /** 切换特效的气泡摆在哪(plugins/spriteLayout.ts 的 bubbleStyle) */
  bubble?: CSSProperties;
}

/** 要放的一次切换特效:等 target 这张图真的换上来了才放(新图下载完之前还留着旧图) */
interface SpriteFxCue {
  id: number;
  target: string;
  effect: SpriteEffect;
}

/** 逐字显示。key 变了(换了一句)从头打;text 变长(流式还在写)接着打。interval 为 0 整句直接出 */
function useTypewriter(key: string, text: string, interval: number) {
  const reduceMotion = useReducedMotion();
  const instant = reduceMotion || interval <= 0;
  const [state, setState] = useState({ key, n: 0, skipped: instant });
  const current = state.key === key;
  const n = current ? state.n : 0;
  const skipped = current ? state.skipped || instant : instant;

  useEffect(() => {
    if (!current) {
      setState({ key, n: 0, skipped: instant });
      return;
    }
    if (skipped || n >= text.length) return;
    const t = window.setTimeout(
      () => setState((s) => (s.key === key ? { ...s, n: s.n + 1 } : s)),
      interval,
    );
    return () => window.clearTimeout(t);
  }, [key, current, n, skipped, text.length, interval, instant]);

  return {
    ...typedParts(text, n, skipped),
    done: skipped || n >= text.length,
    skip: () => setState({ key, n: text.length, skipped: true }),
  };
}

/** 每 100ms 走一格的时钟,只在 active 时走 —— 「正在思考 3.2 秒」用 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

/**
 * 加载画面的显隐:读得快(<180ms)就不闪一下;一旦露脸至少停 700ms,
 * 免得黑场一闪而过像是出错了
 */
function isField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable));
}

// 不收文字的 input。焦点停在滑条、开关上时,方向键 / 空格归它们(上面的 isField 照旧),
// 但按住 Ctrl 快进、菜单里按 Esc 关菜单不该被它们挡住
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file']);

function isTextField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (el?.tagName === 'INPUT' && NON_TEXT_INPUTS.has((el as HTMLInputElement).type)) return false;
  return isField(t);
}

/** 从 target 往上到 root 之间,有没有还能往上滚的元素(滚轮往上时先让它滚) */
function scrollsUp(target: EventTarget | null, root: Element): boolean {
  for (let el = target as Element | null; el && el !== root; el = el.parentElement) {
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return true;
  }
  return false;
}

function useLoadingVeil(loading: boolean): boolean {
  const [shown, setShown] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (loading) {
      const t = window.setTimeout(() => {
        since.current = Date.now();
        setShown(true);
      }, 180);
      return () => window.clearTimeout(t);
    }
    if (!shown) return;
    const t = window.setTimeout(() => setShown(false), Math.max(0, 700 - (Date.now() - since.current)));
    return () => window.clearTimeout(t);
  }, [loading, shown]);
  return shown;
}

const sameSprite = (a: SpriteView, b: SpriteView) => a === b;
const sameBg = (a: BgView, b: BgView) => a.focus === b.focus;

/** 立绘层:新表情叠在旧表情上 .2s 淡入(useStackedLayers),旧的一直不透明,不会闪空白、也不会重影 */
function SpriteLayer({
  view: next,
  charName,
  fx,
  fxVolume,
  covered,
  instant,
}: {
  view: SpriteView;
  charName: string;
  fx: SpriteFxCue | null;
  fxVolume: number;
  /** 这一句有 CG 显示、把立绘盖住了(立绘层透明):切换特效的动作、气泡、音效都不放 */
  covered: boolean;
  /** 跳过中:表情直接换,不淡 */
  instant: boolean;
}) {
  // 新表情整张下载完了才换上,没好之前留着旧的 —— 不会看到只画了一半的图
  const view = useSettledView(next);
  const reduceMotion = useReducedMotion();
  const played = useRef(0);
  const { layers, settle } = useStackedLayersCtl(view, instant, SPRITE_FADE_MS, sameSprite, true);
  const cur = layers[layers.length - 1].view;

  // 切换特效:等要的那张图换上来再放 —— 动作、气泡和音效一起出。
  // 这句有 CG 盖着立绘时看不见,这次就不放(也不留到 CG 收起再补),规则见 spriteFx.ts 的 fxStep
  const [playing, setPlaying] = useState<(SpriteFxCue & { bubbleAt?: CSSProperties }) | null>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const step = fxStep(fx, played.current, cur.key, covered);
    if (!fx || step === 'wait') return;
    // 带动作 / 气泡的这次:新表情马上整张换上(底下的旧图摘掉、不再淡入)再放 ——
    // 不然动作开始时旧图还在底下、新图半透明,看着像上一张没走、下一张的动画就来了
    if (fxSwapsInstantly(fx, played.current, cur.key, covered, reduceMotion)) settle();
    played.current = fx.id;
    if (step === 'skip') return;
    setPlaying({ ...fx, bubbleAt: cur.bubble });
    playFxSound(fx.effect.sound, fxVolume);
    // 动作用 Web Animations 直接播:连着两次同一个动作也会重来,图也不用重新挂一遍
    const motion = fx.effect.motion ? MOTION_FRAMES[fx.effect.motion] : undefined;
    if (motion && !reduceMotion) fxRef.current?.animate(motion.frames, motion.timing);
  }, [fx, cur, fxVolume, covered, reduceMotion, settle]);
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => setPlaying(null), 1500);
    return () => window.clearTimeout(t);
  }, [playing]);

  const render = (l: StackLayer<SpriteView>) => {
    const v = l.view;
    const cls = l.enter ? 'entering' : '';
    return v.src ? (
      <img
        key={l.id}
        className={`vn-sprite ${cls}`}
        src={v.src}
        alt={`${charName} · ${v.label}`}
        draggable={false}
        style={v.style}
      />
    ) : (
      <div key={l.id} className={`vn-sprite vn-sprite-ph ${cls}`}>
        <span className="vn-sprite-ph-name">{charName || '角色'}</span>
        <span className="vn-sprite-ph-label">{v.label}</span>
      </div>
    );
  };

  return (
    <div className="vn-sprite-stage" aria-hidden="true">
      {/* 动作套在外面一层:图自己的 transform 管定位,不能被动画盖掉。新旧几张都在这层里,做动作时一起动 */}
      <div ref={fxRef} className="vn-sprite-fx">
        {layers.map(render)}
        {playing?.effect.bubble && (
          <SpriteBubble key={playing.id} kind={playing.effect.bubble} style={playing.bubbleAt} />
        )}
      </div>
    </div>
  );
}

/** 背景层:新背景叠在旧背景上 .5s 淡入(useStackedLayers),中间不露黑底 */
function BackgroundLayer({ view: next, instant }: { view: BgView; instant: boolean }) {
  // 同 SpriteLayer:新背景好了才开始转场
  const view = useSettledView(next);
  const layers = useStackedLayers(view, instant, BG_FADE_MS, sameBg, false);
  return (
    <>
      {layers.map((l) => (
        <img
          key={l.id}
          className={`vn-bg${l.enter ? ' entering' : ''}`}
          src={l.view.src}
          alt=""
          draggable={false}
          style={{ objectPosition: `${l.view.focus}% 50%` }}
        />
      ))}
    </>
  );
}

/** CG 出现、收起、换成别的 CG 的淡入 / 淡出;同一张换差分新图叠上去的淡入(和 vn.css 的 .vn-cg-item / .vn-cg-set 一样) */
const CG_FADE_MS = 500;
const CG_DIFF_MS = 200;

interface CgItem {
  id: number;
  view: CgView;
  /** 正在淡入:slow = 出现 / 换成别的 CG,diff = 同一张换差分;null = 不淡(淡完了、一开始就在、跳过时直接换上来) */
  enter: 'slow' | 'diff' | null;
  at: number;
  /** 这张 CG(构图)出现的时刻:竖长的从顶上开始移,换差分时新图接着同一个位置移 */
  panFrom: number;
}

/** 一「场」CG:从出现到收起。里面换图都叠在这一场里;收起时整场一起淡出,淡完摘掉 */
interface CgSet {
  id: number;
  items: CgItem[];
  leaving: boolean;
  at: number;
}

const cgEnterMs = (it: CgItem) => (it.enter === 'diff' ? CG_DIFF_MS : CG_FADE_MS);

/**
 * CG 层:盖在背景和立绘上面,立绘留在底下不单独淡(CG 自带黑底,盖满了就看不见她)。
 * 照 useStackedLayers 的做法:新图叠在旧图上淡入(出现 / 换成别的 CG .5s,换差分 .2s),旧图一直不透明,
 * 淡完再摘 —— 换差分时不会两张带黑底的半透明图叠在一起发暗。收起时整场 .5s 淡出,和出现一样长。
 * instant(跳过 / 按住 Ctrl)= 直接换、直接收,不淡也不叠
 */
function CgLayer({ view: next, instant }: { view: CgView; instant: boolean }) {
  // 同 SpriteLayer:新图下载完了才换
  const view = useSettledView(next);
  const seq = useRef(0);
  const [sets, setSets] = useState<CgSet[]>(() =>
    view.src
      ? [{ id: 0, leaving: false, at: 0, items: [{ id: 0, view, enter: null, at: 0, panFrom: Date.now() }] }]
      : [],
  );

  useEffect(() => {
    setSets((ss) => {
      const last = ss[ss.length - 1];
      const cur = last && !last.leaving ? last : null;
      const top = cur ? cur.items[cur.items.length - 1] : null;
      const at = performance.now();
      if (!view.src) {
        if (!cur) return ss;
        // 收起:这一场整个淡出;跳过时直接摘
        return instant ? ss.slice(0, -1) : [...ss.slice(0, -1), { ...cur, leaving: true, at }];
      }
      if (cur && top && top.view.key === view.key) {
        // 同一张图只是挪了焦点:原地更新,不走淡入
        if (top.view === view) return ss;
        return [...ss.slice(0, -1), { ...cur, items: cur.items.map((x) => (x === top ? { ...x, view } : x)) }];
      }
      const diff = top !== null && view.group === top.view.group;
      const item: CgItem = {
        id: ++seq.current,
        view,
        enter: instant ? null : diff ? 'diff' : 'slow',
        at,
        panFrom: top && diff ? top.panFrom : Date.now(),
      };
      // 新的一场:还在淡出的上一场留在底下接着淡(跳过时直接摘)
      if (!cur) return [...(instant ? [] : ss), { id: ++seq.current, items: [item], leaving: false, at }];
      return [...ss.slice(0, -1), { ...cur, items: instant ? [item] : [...cur.items, item] }];
    });
  }, [view, instant]);

  // 淡完了收拾(理由同 useStackedLayers,单独一个 effect):最上面那张淡完 → 摘掉它底下的、自己也摘掉 entering;
  // 收起的那场淡完 → 整场摘掉
  useEffect(() => {
    const now = performance.now();
    let wait = Infinity;
    for (const s of sets) {
      const top = s.items[s.items.length - 1];
      if (s.leaving) wait = Math.min(wait, s.at + CG_FADE_MS - now);
      else if (top.enter) wait = Math.min(wait, top.at + cgEnterMs(top) - now);
      else if (s.items.length > 1) wait = 0;
    }
    if (wait === Infinity) return;
    const t = window.setTimeout(
      () => {
        const at = performance.now();
        setSets((ss) => {
          let changed = false;
          const out: CgSet[] = [];
          for (const s of ss) {
            const top = s.items[s.items.length - 1];
            if (s.leaving) {
              if (at - s.at >= CG_FADE_MS) changed = true;
              else out.push(s);
            } else if ((!top.enter || at - top.at >= cgEnterMs(top)) && (top.enter || s.items.length > 1)) {
              changed = true;
              out.push({ ...s, items: [{ ...top, enter: null }] });
            } else out.push(s);
          }
          return changed ? out : ss;
        });
      },
      Math.max(0, wait) + 40,
    );
    return () => window.clearTimeout(t);
  }, [sets]);

  return (
    <div className="vn-cg-stage" aria-hidden="true">
      {sets.map((s) => (
        <div key={s.id} className={`vn-cg-set${s.leaving ? ' leaving' : ''}`}>
          {s.items.map((it) => (
            <div key={it.id} className={`vn-cg-item${it.enter ? ` entering ${it.enter}` : ''}`}>
              {it.view.src && <CgImage view={it.view} panFrom={it.panFrom} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 竖长 CG 从上移到下(再移回来)一趟几秒 */
const CG_PAN_MS = 20000;

/**
 * CG 层里的一张图。竖长的(高比宽大,原作里要卷动着看的全身图)上下来回慢慢移:
 * 从这张 CG 出现的时刻(panFrom)算起,所以一出现是从顶上开始;换差分时新图接着同一个位置移
 */
function CgImage({ view, panFrom }: { view: CgView; panFrom: number }) {
  const tall = view.src !== null && (imageRatio(view.src) ?? 0) > 1;
  // 挂上时定一次:panFrom 只在换成别的 CG 时变,那时这张会换成新的一张,不用跟着改
  const [delay] = useState(() => `${-((Date.now() - panFrom) % (CG_PAN_MS * 2))}ms`);
  if (view.whole) {
    return (
      <>
        {view.above && <img className="vn-cg vn-cg-backdrop" src={view.src ?? undefined} alt="" draggable={false} />}
        <img className={`vn-cg whole${view.above ? ' above' : ''}`} src={view.src ?? undefined} alt="" draggable={false} />
      </>
    );
  }
  const style: CSSProperties = tall
    ? ({ '--cg-pan-delay': delay, '--cg-pan-ms': `${CG_PAN_MS}ms` } as CSSProperties)
    : { objectPosition: `${view.focus}% 50%` };
  return (
    <img
      className={`vn-cg${tall ? ' tall' : ''}`}
      src={view.src ?? undefined}
      alt=""
      draggable={false}
      style={style}
    />
  );
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;


/** 手机上先藏起来的四个工具页(10-26 定:手机版没设计,电脑版落地后再补,见 TODO.md) */
const PHONE_HIDDEN_PAGES: readonly MenuPage[] = ['plugin', 'assets', 'model', 'dev'];

export function VNScreen({
  entries,
  macros,
  charName,
  userName,
  sprites,
  forms,
  spriteStage,
  spriteLayout,
  tagTemplate,
  sceneAssets,
  scenePackName,
  titleBgmId,
  onChangeTitleBgm,
  bgTemplate,
  bgmTemplate,
  cgTemplate,
  voiceConfig,
  sfxEnabled,
  voiceCast,
  voiceProfiles,
  onPickVoice,
  onChangeVoiceConfig,
  showJa,
  onChangeShowJa,
  jaHide,
  jevSync,
  enterKey,
  onChangeEnterKey,
  sending,
  canSend,
  notReadyHint,
  chatKey,
  chatName,
  chatUpdatedAt,
  loading,
  pendingJump = null,
  assetsReady = true,
  modelLabel,
  modelQuick,
  hasAlbum = false,
  onSend,
  onInterject,
  onBranch,
  onStop,
  onRegenerate,
  onExit,
  renderPage,
  cards,
  onWantAvatar,
  onImportCard,
  onExportCard,
  freshCardId = null,
  onFreshSeen,
  currentCardId,
  onPickCard,
  onSetManual,
  illustrations: illustrationsInstalled = null,
  switches = DEFAULT_SWITCHES,
  toasts = NO_TOASTS,
  onRemoveToast = NOOP,
  genFail = null,
}: Props) {
  // AI 出图关了:不画、不显示、画笔收起;设置里那一页照旧在(插件页能再打开)
  const illustrations = switches.illustrations ? illustrationsInstalled : null;
  // ---- 偏好 ----

  const [settings, setSettings] = useState<VNSettings>(loadVNSettings);
  const changeSettings = (next: VNSettings) => {
    setSettings(next);
    saveVNSettings(next);
  };

  // ---- 解析:每条 AI 回复 → 一句一句 ----

  const tagKinds: TagKind[] = useMemo(
    () => vnTagKinds(tagTemplate, bgTemplate, bgmTemplate, cgTemplate),
    [tagTemplate, bgTemplate, bgmTemplate, cgTemplate],
  );
  // 流式时每来一个字 entries 就变一次;没变的条目直接用缓存,只重切正在写的那条(core/beats.ts)
  const beatCache = useRef(newBeatCache());
  const beats: Beat[] = useMemo(
    () => parseBeats({ entries, tagKinds, macros, charName, userName, cache: beatCache.current }),
    [entries, tagKinds, macros, charName, userName],
  );

  // ---- 播放位置 ----

  const lastAssistantIndex = (() => {
    for (let i = beats.length - 1; i >= 0; i--) if (beats[i].parsed) return i;
    return -1;
  })();

  const startOfLatest = (): Cursor | null => {
    const b = lastAssistantIndex >= 0 ? beats[lastAssistantIndex] : null;
    return b ? { id: b.entry.id, swipe: b.entry.swipeIndex, line: 0 } : null;
  };

  // 进来时停在最新一条回复的第一句 —— 刚在调试台聊到哪,就从那条接着看
  const [cursor, setCursor] = useState<Cursor | null>(startOfLatest);

  // 换了对话(读档 / 新故事):同样从最新一条回复的第一句开始
  const [cursorChat, setCursorChat] = useState(chatKey);
  if (cursorChat !== chatKey) {
    setCursorChat(chatKey);
    setCursor(startOfLatest());
  }

  // 跨存档跳转:DebugApp 读完那个档才给,这时 chatKey、entries 已经是那个存档的(上面换对话的重置要是也在这次
  // 渲染里,它先放到最新一句,这里再盖过去)。每个 nonce 只看一次:对话对上就跳,对不上(又切走了)只作废、不跳。
  // 挂载时已经在的算旧的 —— 关掉游戏再打开不重跳
  const [jumpSeen, setJumpSeen] = useState(pendingJump?.nonce ?? null);
  if (pendingJump && pendingJump.nonce !== jumpSeen) {
    setJumpSeen(pendingJump.nonce);
    const b = pendingJump.chatId === chatKey ? beats.find((x) => x.entry.id === pendingJump.entryId && x.parsed) : undefined;
    if (b) setCursor({ id: b.entry.id, swipe: b.entry.swipeIndex, line: pendingJump.line });
  }

  // 光标这次挪动是不是「往下读」(点下一句、自动播放、新回复跳过来)。立绘切换特效只在往下读时放,
  // 往回翻、读档、在历史里「回到这里」都不放。挪光标的地方先把它设上,useSpriteFx 读完就清掉
  const forwardRef = useRef(false);

  // 新冒出来的回复(发送 / 继续生成)自动跳过去
  const seenRef = useRef(new Set(entries.map((e) => e.id)));
  // 换了对话(读档、新故事、换角色)时整张对话的条目都是「没见过」的,但那不是新冒出来的回复:
  // 光标上面已经放到最新一条的开头了,这里只认账,不当成往下读 —— 不然一读档就放立绘切换特效和音效
  const seenChat = useRef(chatKey);
  useEffect(() => {
    if (seenChat.current !== chatKey) {
      seenChat.current = chatKey;
      seenRef.current = new Set(entries.map((e) => e.id));
      return;
    }
    const last = entries[entries.length - 1];
    if (last && last.role === 'assistant' && !seenRef.current.has(last.id)) {
      forwardRef.current = true;
      setCursor({ id: last.id, swipe: last.swipeIndex, line: 0 });
    }
    for (const e of entries) seenRef.current.add(e.id);
  }, [entries, chatKey]);

  // 光标指向的条目可能被删掉,或者换了分支(重新生成) —— 渲染时就地纠正。
  // 插话截断也会换分支,但同一次提交里新回复已经追加上来,光标直接跳过去了
  let beatIndex = cursor ? beats.findIndex((b) => b.entry.id === cursor.id && b.parsed) : -1;
  let line = cursor?.line ?? 0;
  if (beatIndex === -1) {
    beatIndex = lastAssistantIndex;
    line = Number.MAX_SAFE_INTEGER;
  } else if (beats[beatIndex].entry.swipeIndex !== cursor?.swipe) {
    line = 0;
  }
  const beat = beatIndex >= 0 ? beats[beatIndex] : null;
  // 对话框和选项上显示不显示日语:这条回复点过「隐藏前文日语」的不显示
  const jaVisible = showJa && !(beat && jaHiddenOf(beat.entry));
  const lines = beat?.parsed?.lines ?? [];
  line = Math.max(0, Math.min(line, lines.length - 1));
  const streaming = Boolean(beat?.entry.streaming);
  const current: VNLine | null = lines[line] ?? null;
  // 流式时最后一句还在写,没写完不能往下翻
  const lineComplete = !streaming || line < lines.length - 1;
  const hasNext = line < lines.length - 1;
  const onLatest = beatIndex === lastAssistantIndex && beatIndex >= 0;

  const typeKey = beat ? `${beat.entry.id}:${beat.entry.swipeIndex}:${line}` : 'none';

  // 生成失败、你说的那句还是最后一条:对话区停在你说的那句,点画面不往下翻(重试 / 换模型 / 再说一句才继续)
  const heldEntry = entries[entries.length - 1];
  const failedHold = holdsUserLine(genFail !== null, heldEntry?.role);

  // 玩家的台词(<我>,Jev 认出来的或旧回复里的)照常打进对话框,名牌写玩家的名字、不念、不换立绘;
  // 第 2 步起不再先弹成选项(设计稿 12.1「10-16 第 2 步」)

  // 翻回历史往下看:一条回复读完,后面是当时玩家发的话 —— 一句句弹成选项(让人看到当时
  // 说了什么),点了接着看下一条回复。最新那条后面没有回复,不弹
  const between = useMemo(() => {
    const said: string[] = [];
    for (let i = beatIndex + 1; beatIndex >= 0 && i < beats.length; i++) {
      const b = beats[i];
      if (b.parsed) return { said, next: b };
      const t = playerSaid(b.raw);
      if (t) said.push(t);
    }
    return { said: [] as string[], next: null as Beat | null };
  }, [beats, beatIndex]);
  // 正在弹第几句;记着是哪一句之后弹的,光标一动就失效
  const [userStep, setUserStep] = useState<{ key: string; i: number } | null>(null);
  const userChoice = userStep?.key === typeKey ? (between.said[userStep.i] ?? null) : null;
  // 这条回复读完了,后面还有下一条(翻回历史的时候)
  const canContinue = !hasNext && !streaming && between.next !== null;
  const continueToNext = () => {
    const nb = between.next;
    if (nb) {
      forwardRef.current = true;
      setCursor({ id: nb.entry.id, swipe: nb.entry.swipeIndex, line: 0 });
    }
    setUserStep(null);
  };

  // ---- 立绘 / 背景 / 音乐:从第一条回复一路累计到当前这句 ----

  // ---- 立绘标签 → 表情:先精确匹配,对不上的按设置 → 数据「表情认法」:旧算法问后端模型(结果只记在这个页面),
  // 认词记录先查记录、没记过的让模型认一次并记下来。开关还没读到时两边都先不问 ----

  const candidates = useMemo(() => emotionCandidates(sprites), [sprites]);
  const spriteLabels = useMemo(
    () =>
      beats
        .flatMap((b) => b.parsed?.hits ?? [])
        .filter((h) => h.kind === 'sprite' && !isNpcHit(h, charName))
        .map((h) => h.label),
    [beats, charName],
  );
  const engine = useTimelineEngine();
  const listRef = useMemo(() => emotionListRef(sprites), [sprites]);
  const legacyResolve = useEmotionMatches(spriteLabels, candidates, engine === 'legacy');
  const recordsResolve = useWordRecords(listRef, spriteLabels, candidates, engine === 'records');
  const resolveTag = engine === 'records' ? recordsResolve : legacyResolve;
  const emotionCtx: EmotionContext = useMemo(
    () => ({ resolve: resolveTag, rawOnFail: sprites.length === 0, charName }),
    [resolveTag, sprites.length, charName],
  );
  // 形态:规则在形态卡带里,这里只通过 lens 问;没开(或者没装)时是 null。顶栏按钮也是卡带给的
  const FormButton = formButton();
  const lens = forms?.lens ?? null;
  // 表情认法 = 认词记录时 CG 那一帧查配对表(这张立绘配的是哪张差分);旧算法、表还没读到时不传,照旧按名字找
  const cgPairs = usePairings('cg', listRef, engine === 'records');
  const pickCgFrame = useMemo(
    () => (engine === 'records' && cgPairs ? cgFrameFromPairs(cgPairs, sprites, sceneAssets) : undefined),
    [engine, cgPairs, sprites, sceneAssets],
  );
  const tctx: TimelineCtx = useMemo(
    () => ({ sprites, sceneAssets, emotion: emotionCtx, forms: lens, ...(pickCgFrame ? { cgFrame: pickCgFrame } : {}) }),
    [sprites, sceneAssets, emotionCtx, lens, pickCgFrame],
  );

  const faces = useMemo(() => facesByCanvas(sprites), [sprites]);
  const beatId = beat?.entry.id ?? null;
  // 时间线(core/timeline.ts):每条回复每一句的画面,从第一条回复一路累计;每条回复按内容缓存,流式时只重算正在写的那条
  const timeline = useMemo(() => buildTimeline(beats, tctx), [beats, tctx]);
  // 光标这句的画面
  const cursorState = stateAt(timeline, beatIndex, line);
  // 对不上、还在问模型的标签不切图,保持上一张 —— 控制台里会写原因。
  // 先取成字符串:view 只在表情名真变了时才换新对象 —— 流式时每来一段字都会重算一遍,view 要是跟着变成新对象,
  // 立绘层的 effect 每次都会改一次状态,一条长回复写下来就撞上 React 的「更新太深」(2026-10-01)。
  // 换算前的表情名(cursorState.spriteLabel)这里不用了:CG 那一帧已经在 cursorState.cgFrame 里挑好
  const shownLabel = cursorState.shownLabel;
  const formCurrent = forms?.current ?? null;
  // 形态换算(语音、历史按句用):第 ln 句生效的表情放到那句的形态里看
  const inForm = useMemo(
    () =>
      lens ? (label: string | null, entryId: string, ln: number) => lens.labelIn(label, lens.formFor(entryId, ln)) : null,
    [lens],
  );

  const spriteView: SpriteView = useMemo(() => {
    const label = shownLabel;
    const matched = sprites.find((s) => s.label === label) ?? sprites[0] ?? null;
    if (matched) {
      return {
        key: matched.id + (matched.has_image ? `:${matched.image_version}` : ''),
        src: spriteImageUrl(matched),
        label: matched.label,
        style: spriteStyle(faces.get(matched.id) ?? null, spriteLayout, spriteStage),
        bubble: bubbleStyle(faces.get(matched.id) ?? null, spriteLayout, spriteStage),
      };
    }
    // 这张卡一张立绘都没配:占位长方形上写匹配到的内置表情(模型不可用时是 AI 的原词)
    return { key: `ph:${label ?? ''}`, src: null, label: label ?? '未配置立绘' };
  }, [shownLabel, sprites, faces, spriteLayout, spriteStage]);

  const scene: SceneState = cursorState.scene;
  // 这句的形态里不能出的 CG 不预取
  const formHere = cursorState.form;
  // 只依赖 lens.cgOk(形态卡带给的是固定的一个函数):lens 每来一条消息都换新的,预取不用跟着重跑
  const lensCgOk = lens?.cgOk ?? null;
  const cgOkHere = useCallback(
    (cg: SceneAsset) => formHere === null || lensCgOk === null || lensCgOk(cg, formHere),
    [formHere, lensCgOk],
  );

  const bgUrl = scene.bg ? sceneImageUrl(scene.bg) : null;
  // 同上:只在换了背景时才是新对象
  const bgKey = scene.bg ? `${scene.bg.id}:${scene.bg.file_version}` : null;
  const bgFocus = scene.bg?.focus_x ?? 50;
  const bgView: BgView = useMemo(
    () =>
      bgKey && bgUrl
        ? { key: bgKey, src: bgUrl, focus: bgFocus }
        : { key: 'fallback', src: FALLBACK_BACKGROUND, focus: 50 },
    [bgKey, bgUrl, bgFocus],
  );

  // CG:画面上那张跟着当前这句的表情换(构图下面挂的差分,名字是表情名);没有对应的用构图本身那张。
  // 同上:先算出用哪张,只在换图时才生成新的 view
  const cgFrame = cursorState.cgFrame;
  const cgUrl = cgFrame ? sceneImageUrl(cgFrame) : null;
  const cgKey = cgFrame && cgUrl ? `${cgFrame.id}:${cgFrame.file_version}` : null;
  const cgGroup = scene.cg?.id ?? null;
  const cgFocus = scene.cg?.focus_x ?? 50;
  const cgView: CgView = useMemo(
    () => (switches.cg && cgKey && cgUrl ? { key: cgKey, src: cgUrl, group: cgGroup, focus: cgFocus } : NO_CG),
    [switches.cg, cgKey, cgUrl, cgGroup, cgFocus],
  );
  // 这一句有 CG:CG 层盖住立绘(CG 自带黑底,立绘留在底下不单独淡),立绘切换特效也跟着不放
  // 生成的插图(卡带):这句有就盖在 CG 层上显示它,和 CG 一样盖住立绘
  const illusView = beat && illustrations ? illustrations.viewAt(beat.entry, line) : null;
  const illusKey = illusView ? `illus:${illusView.key}` : null;
  const illusSrc = illusView?.src ?? null;
  const illusFocus = illusView?.focus ?? 50;
  const illusAbove = illusView?.place === 'above';
  const shownCg: CgView = useMemo(
    () =>
      illusKey && illusSrc
        ? { key: illusKey, src: illusSrc, group: illusKey, focus: illusFocus, whole: true, above: illusAbove }
        : cgView,
    [illusKey, illusSrc, illusFocus, illusAbove, cgView],
  );
  const cgOn = Boolean(shownCg.src);
  // 对话框有多高(含底下的留白):写到 .vn-root 的 --vn-window-h,插图「放在对话框上面」时让开这一块
  const windowObserver = useRef<ResizeObserver | null>(null);
  const measureWindow = useCallback((el: HTMLDivElement | null) => {
    windowObserver.current?.disconnect();
    windowObserver.current = null;
    const root = el?.closest<HTMLElement>('.vn-root');
    if (!el || !root) return;
    const measure = () => {
      const r = root.getBoundingClientRect();
      root.style.setProperty('--vn-window-h', `${Math.max(0, r.bottom - el.getBoundingClientRect().top)}px`);
    };
    measure();
    windowObserver.current = new ResizeObserver(measure);
    windowObserver.current.observe(el);
    windowObserver.current.observe(root);
  }, []);
  // 电脑上对话区和输入那行照设计稿整块等比缩放:设计稿是 1440×810 一张画,按窗口 min(宽/1440, 高/810) 放大缩小,
  // 字、框、离底距离一起变;这里把倍数写到 .vn-root 的 --ga-k(vnLine.css .ga-stage、四角细条用它)
  const stageObserver = useRef<ResizeObserver | null>(null);
  const measureStage = useCallback((el: HTMLDivElement | null) => {
    stageObserver.current?.disconnect();
    stageObserver.current = null;
    const root = el?.closest<HTMLElement>('.vn-root');
    if (!el || !root) return;
    const measure = () => {
      const w = root.clientWidth;
      const h = root.clientHeight;
      if (!w || !h) return;
      root.style.setProperty('--ga-k', String(Math.min(w / 1440, h / 810)));
    };
    measure();
    stageObserver.current = new ResizeObserver(measure);
    stageObserver.current.observe(root);
  }, []);
  // 对话区 A 那块(.ga-say):量高度同上;经典玻璃框里垫的模糊背景按它对齐(只糊背景,不糊立绘)
  const sayBox = useRef<HTMLDivElement | null>(null);
  const sayRef = useCallback(
    (el: HTMLDivElement | null) => {
      sayBox.current = el;
      measureWindow(el);
    },
    [measureWindow],
  );
  const frost = useFrost(sayBox, `${settings.dlgStyle}:${settings.boxSkin}:${settings.dialogueOffset}:${settings.dialogueHeight}`);
  // 给插图卡带的「现在在哪」:光标这条回复、这一句、这里的背景
  const illusCtx: VnIllustrationContext = {
    entry: beat?.entry ?? null,
    line,
    lines,
    place: scene.bg ? { label: scene.bg.label, description: scene.bg.description } : null,
    streaming,
    openSettings: () => {
      setSettingsTab(ILLUS_TAB);
      openMenu('config');
    },
    paperClass: settings.dlgStyle === 'line' || settings.boxSkin !== 'classic' ? `av-pcard ${popThemeClass(settings.theme)}` : undefined,
  };
  // 插图卡带的自动出图:最新一条回复在这次打开以后写完、Jev 也判完时告诉它一次(读档、换对话不算)
  const latestBeat = lastAssistantIndex >= 0 ? beats[lastAssistantIndex] : null;
  const writingRef = useRef(new Set<string>());
  useEffect(() => {
    const e = latestBeat?.entry;
    if (!e || !illustrations) return;
    const k = `${e.id}:${e.swipeIndex}`;
    if (e.streaming || e.jevPending !== undefined) {
      writingRef.current.add(k);
      return;
    }
    if (!writingRef.current.delete(k)) return;
    const bg = stateAt(timeline, lastAssistantIndex, Number.MAX_SAFE_INTEGER).scene.bg;
    illustrations.onReplyDone(e, latestBeat?.parsed?.lines ?? [], bg ? { label: bg.label, description: bg.description } : null);
  }, [latestBeat, illustrations, timeline, lastAssistantIndex]);

  // ---- 标题画面:最后一句、上次停下的地方、场景包里的背景 ----

  const titleHome: TitleScene = { key: bgView.key, src: bgView.src, focus: bgView.focus, label: scene.bg?.label ?? '' };

  // ---- 音乐 ----

  // 标题画面开着时放封面音乐(场景包里设的那首,没设就是排第一的),「继续」后换回场景的
  const [title, setTitle] = useState(settings.titleScreen);
  // 选角色界面(纸面 / 明亮封面的「角色」进来)
  const [picking, setPicking] = useState(false);
  // 离开选角色:刚导入的那张不再排第一、不再带小签(整合版 whole.js 的 freshImport 同样在离开选角色时清掉)
  const freshSeen = useRef(onFreshSeen);
  freshSeen.current = onFreshSeen;
  const wasPicking = useRef(false);
  useEffect(() => {
    if (wasPicking.current && !picking) freshSeen.current?.();
    wasPicking.current = picking;
  }, [picking]);
  const titleBgm = useMemo(() => titleBgmOf(sceneAssets, titleBgmId), [sceneAssets, titleBgmId]);

  // ---- 素材等待页:封面和接下来几句要用的图到齐才露画面,其余的最多等 4 秒(assetGate.ts) ----

  const packId = sprites[0]?.pack_id;
  const gateItems = useMemo(() => {
    const must = new Map<string, GateItem>();
    const nice = new Map<string, GateItem>();
    const add = (to: Map<string, GateItem>, src: string | null | undefined, kind: string) => {
      if (src && !must.has(src) && !to.has(src)) to.set(src, { src, kind });
    };
    const spriteSrc = (s: PackSprite | null | undefined) => (s ? spriteImageUrl(s) : null);
    // 封面左边的头像圈:几 KB 一个,排最前(地址和 VNTitle 里的一样)
    if (title) {
      for (const c of cards) add(must, cardFaceUrl(c.id, 128, c.id === currentCardId ? packId : undefined), '头像');
    }
    // 眼下这一句的背景、表情和 CG
    add(must, bgView.src, '背景');
    add(must, spriteView.src, '立绘');
    add(must, cgView.src, 'CG');
    // 往后 AHEAD_LINES 句的画面直接读时间线(表情形态换算过、CG 过了形态门、那一帧挑好了):
    // 这条回复剩的不够,接着读下一条回复(和 between.next 是同一条)开头那几句。
    // 更远的不等(开场白里常常换七八种表情,一张就上 MB),排在「尽量等」里
    const look = (index: number, ln: number) => {
      const st = stateAt(timeline, index, ln);
      add(must, spriteSrc(sprites.find((s) => s.label === st.shownLabel)), '立绘');
      add(must, st.scene.bg ? sceneImageUrl(st.scene.bg) : null, '背景');
      // 只等这句显示的那一帧;同一张构图的其余差分换表情时才用,在「尽量等」里
      add(must, st.cgFrame ? sceneImageUrl(st.cgFrame) : null, 'CG');
      for (const v of st.scene.cg ? cgVariantsOf(sceneAssets, st.scene.cg.id) : []) add(nice, sceneImageUrl(v), 'CG');
    };
    for (let ln = line + 1; ln < lines.length && ln <= line + AHEAD_LINES; ln++) look(beatIndex, ln);
    const left = Math.max(0, lines.length - 1 - line);
    const nextIndex = left < AHEAD_LINES && between.next ? beats.indexOf(between.next, beatIndex + 1) : -1;
    for (let ln = 0; nextIndex >= 0 && ln < AHEAD_LINES - left; ln++) look(nextIndex, ln);
    // 封面第一眼就看得到的表情;悬停、点一下才换的排在「尽量等」最前面
    if (title) {
      for (const mood of TITLE_FIRST) add(must, spriteSrc(spriteForMood(sprites, mood)), '立绘');
      for (const mood of TITLE_LATER) add(nice, spriteSrc(spriteForMood(sprites, mood)), '立绘');
    }
    // 其余的:这个包的全部表情、场景包里的全部背景
    for (const s of sprites) add(nice, spriteSrc(s), '立绘');
    for (const a of backgroundsOf(sceneAssets)) add(nice, sceneImageUrl(a), '背景');
    return { must: [...must.values()], nice: [...nice.values()] };
  }, [bgView.src, spriteView.src, cgView.src, timeline, beats, beatIndex, line, lines.length, between.next, sprites, sceneAssets, title, cards, currentCardId, packId]);
  const gate = useAssetGate(`${currentCardId ?? ''}|${packId ?? ''}`, assetsReady && !loading, gateItems.must, gateItems.nice);
  // 等待页:没到齐 180ms 以后才露(有缓存时不闪),露了至少停 0.7 秒(一闪而过像出错)
  const gateVeil = useLoadingVeil(!gate.ready);
  // 刚打开、刚换了角色:等待页撤下之前先黑着,封面也先不挂 —— 它的入场动画要让人看见;
  // 音乐也先不放,带宽留给图。同一个角色换立绘包不黑:旧立绘留着,新的好了再换(SpriteLayer),慢了才露等待页
  const [shownCard, setShownCard] = useState<string | null | undefined>(undefined);
  // 封面是从黑场进来的,还是从游戏里点「回标题」开的:前一种入场时不能透出底下的游戏画面
  const [titleCold, setTitleCold] = useState(true);
  if (gate.ready && !gateVeil && shownCard !== currentCardId) {
    setShownCard(currentCardId);
    setTitleCold(true);
  }
  const firstLoad = shownCard !== currentCardId;

  // 音乐关了:标题画面和剧情里都不放
  const playing = !switches.bgm ? null : title ? titleBgm : scene.bgm;
  const bgmUrl = playing ? sceneImageUrl(playing) : null;
  useEffect(() => {
    bgmPlayer.setActive(true);
    return () => bgmPlayer.setActive(false);
  }, []);
  useEffect(() => {
    bgmPlayer.play(firstLoad ? null : bgmUrl);
  }, [bgmUrl, firstLoad]);

  // 当前这条回复里点到的背景和曲子提前下载:翻到那一句时直接切,不用等
  const upcoming = beat?.parsed?.hits;
  useEffect(() => {
    for (const h of upcoming ?? []) {
      if (h.kind === 'bg') {
        const bg = resolveByLabel(h.label, backgroundsOf(sceneAssets));
        const url = bg && sceneImageUrl(bg);
        if (url) void loadImage(url);
        const def = bg?.bgm_id ? sceneAssets.find((a) => a.id === bg.bgm_id) : null;
        const defUrl = def && sceneImageUrl(def);
        if (defUrl) bgmPlayer.prefetch(defUrl);
      } else if (h.kind === 'bgm') {
        const m = resolveByLabel(h.label, bgmsOf(sceneAssets));
        const url = m && sceneImageUrl(m);
        if (url) bgmPlayer.prefetch(url);
      } else if (h.kind === 'cg') {
        // CG 和它的差分都先下:翻到那句、换表情时直接切
        const found = resolveByLabel(h.label, cgsOf(sceneAssets));
        const cg = found && cgOkHere(found) ? found : null;
        for (const a of cg ? [cg, ...cgVariantsOf(sceneAssets, cg.id)] : []) {
          const url = sceneImageUrl(a);
          if (url) void loadImage(url);
        }
      }
    }
  }, [upcoming, sceneAssets, cgOkHere]);

  // 立绘预加载在上面的等待页里:眼下要用的先下,其余的排在后面
  // ---- 界面状态 ----

  const [menu, setMenu] = useState<MenuPage | null>(null);
  // 从游戏画面直接开的小窗口(右上「历史」、左上「模型」、滚轮往上);菜单里的历史还是大面板
  const [win, setWin] = useState<'log' | 'model' | null>(null);
  const winLayer = useFadeLayer(win !== null, MOTION.popOut);
  const lastWin = useRef(win);
  if (win) lastWin.current = win;
  // 历史小窗口里 Esc 先问内容(在改原文就先退出编辑,不关窗口):历史页挂上来的钩子
  const logEsc = useRef<(() => boolean) | null>(null);
  // 右键 / 长按「改原文」开的历史窗口:那条回复一打开就在改,保存完关窗口回游戏(设计稿 whole.js 的 editFromGame)
  const [editFirst, setEditFirst] = useState<string | null>(null);
  useEffect(() => {
    if (win !== 'log') setEditFirst(null);
  }, [win]);
  // 从封面点「读档 / 设置」打开的:盖在封面上,只有这两页,没有「返回标题」(关掉就是封面)
  const [menuFrom, setMenuFrom] = useState<'game' | 'cover'>('game');
  // 菜单关的时候先淡出(0.18s)再卸:淡出时还画着最后停的那一页(和它是从哪儿开的)
  const menuLayer = useFadeLayer(menu !== null, MOTION.popOut);
  const lastMenu = useRef<MenuPage>('card');
  const lastMenuFrom = useRef<'game' | 'cover'>('game');
  if (menu) {
    lastMenu.current = menu;
    lastMenuFrom.current = menuFrom;
  }
  const shownMenu = menu ?? lastMenu.current;
  const shownMenuFrom = menu ? menuFrom : lastMenuFrom.current;
  // 设置页这次打开停在哪一栏(语音面板点「完整语音设置」= 声音);菜单关了就忘掉
  const [settingsTab, setSettingsTab] = useState<SettingsTab | string | undefined>(undefined);
  useEffect(() => {
    if (!menu) setSettingsTab(undefined);
  }, [menu]);
  const [rawLog, setRawLog] = useState(false);
  const [pluginFocus, setPluginFocus] = useState<PluginFocus | null>(null);
  const [uiHidden, setUiHidden] = useState(false);
  // 对话框上右键 / 长按打开的句检查器:记着是在哪一句打开的(光标一动就收起);bottom 是浮层底边离画面底部多远(贴在对话框上方)
  const [inspect, setInspect] = useState<{ key: string; bottom: number } | null>(null);
  // 对着台词右键 / 长按先出的小菜单:记着光标在画面里的位置、是哪一句(光标一动就收起)、选「详情」时检查器放多高
  const [ctxMenu, setCtxMenu] = useState<{ key: string; x: number; y: number; w: number; h: number; bottom: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [auto, setAuto] = useState(false);
  // 玻璃皮肤:读到最后一句先只亮右下角的小方块,玩家再点一下才弹出正中的输入条(记下是在哪一句点的)
  const [turnAt, setTurnAt] = useState<string | null>(null);
  // 输入条左边的 ×:收起来不挡画面(还能在对话框最下面那行打字;再点一下对话框又弹出来)
  const [turnClosed, setTurnClosed] = useState<string | null>(null);
  // 细线 / 玻璃(设计稿 .ga-input):平时最下面是一行带下划线的淡字,点它(或轮到你)整条输入浮上来;
  // 收起 / 发出去以后回到那行字。barIdle = 点开了但没写字、也不是轮到你:点画面先收起,不翻句
  const [barOpen, setBarOpen] = useState(false);
  const barIdle = useRef(false);
  // Esc 先收起思考 / 退出输入框(键盘那个 effect 不随每次渲染重挂,渲染时把这一刻的做法放进来)
  const escBarRef = useRef<(target: EventTarget | null) => boolean>(() => false);
  const [skip, setSkip] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const skipping = skip || ctrlHeld;
  const veil = useLoadingVeil(loading);
  const accent = useVNAccent(settings.accent, sprites);
  // 主题「玻璃」:提示条、报错卡这些纸卡按这一幕的背景取色(--gl-*,写在 .vn-root 上)
  const paperTheme = settings.theme;
  const glassStyle = useSceneGlass(paperTheme === 'glass', bgView.src);

  // ---- 语音:说话人对得上声音的台词才念,情绪跟着这句生效的立绘表情 ----

  // 这条回复第一句之前生效的表情:时间线里这条的开头(和立绘层同一份)
  const emotionBefore = beatIndex >= 0 ? timeline.entries[beatIndex].start.spriteLabel : timeline.initial.spriteLabel;
  // 切好的句子是按条目缓存的,流式时只有正在写的那条会变
  const beatParsed = beat?.parsed;
  const beatTones = beat?.tones;
  // 谁说的 / 什么表情由 Jev 判时,还在判的句子先不念(只有背景、音乐是 Jev 时不用等)
  const beatJevKinds = beat ? jevKindsOf(beat.entry) : NO_KINDS;
  // 语音只等它要的那几题(说话人、表情、声线):两条队列时 CG 还在判也不用等(jevVoicePending)
  const jevPendingFrom = voiceWaitsForJev(beatJevKinds)
    ? (beat?.entry.jevVoicePending ?? beat?.entry.jevPending)
    : undefined;
  // 表情认法 = 认词记录时按配对表念:这句显示的表情 → 包里那张立绘 → 配给主声音的那一行语气。
  // 旧算法、表还没读到、主声音没有表时不传,后端照旧按名字挑
  const voicePairs = usePairings('voice', listRef, engine === 'records');
  const mainVoiceId = voiceCast.main?.id ?? null;
  const pickRow = useMemo(() => {
    const table = engine === 'records' && mainVoiceId ? voicePairs?.get(mainVoiceId) : undefined;
    return table ? voiceRowFromPairs(table, sprites) : undefined;
  }, [engine, mainVoiceId, voicePairs, sprites]);
  // 开关还没读到、或者表还没读到:主声音带表情的台词先等一下,免得同一句先按名字请求、再按行号请求一遍
  const waitRows = engine === null || (engine === 'records' && voicePairs === null);
  // 缺格补配(设计 1.6.5 第 3 步):表读到了、这句显示的立绘在表里还没有格子(后加的立绘)时当场补一次;
  // 补回来之前语音照旧按名字挑、CG 照旧按名字找。同一张表一次只发一个请求,没补上的过一分钟再试(usePairings.ts)
  const voiceGap =
    engine === 'records' && voiceConfig.enabled && !voiceConfig.fixedEmotion && mainVoiceId && voicePairs
      ? missingCell(voicePairs.get(mainVoiceId), sprites, shownLabel)
      : null;
  // CG 按换算前的表情找差分(和 cgFrameFromPairs 一样);没有差分的构图不用配
  const cgId = scene.cg?.id ?? null;
  const cgGap =
    engine === 'records' && cgPairs && cgId && cgVariantsOf(sceneAssets, cgId).length > 0
      ? missingCell(cgPairs.get(cgId), sprites, cursorState.spriteLabel)
      : null;
  // typeKey:每翻一句再看一次(失败过的过了一分钟才会真的再发)
  useEffect(() => {
    if (voiceGap && mainVoiceId) fillMissingCell('voice', listRef, mainVoiceId, voiceGap);
  }, [voiceGap, mainVoiceId, listRef, typeKey]);
  useEffect(() => {
    if (cgGap && cgId) fillMissingCell('cg', listRef, cgId, cgGap);
  }, [cgGap, cgId, listRef, typeKey]);
  // 检查器里手改了表情的句子:语音也念玩家选的那个(和画面一样按立绘 id 找名字,找不到当没改)
  const beatMarks = beat ? manualOf(beat.entry) : undefined;
  const beatManual = useMemo(() => manualEmotions(beatMarks, sprites), [beatMarks, sprites]);
  const voicePlans = useMemo(
    () =>
      planVoiceLines({
        lines: beatParsed?.lines ?? [],
        hits: beatParsed?.hits ?? [],
        emotionBefore,
        ctx: emotionCtx,
        cast: voiceCast,
        streaming,
        fixedEmotion: voiceConfig.fixedEmotion,
        jevPendingFrom,
        mapEmotion: inForm && beatId ? (label, i) => inForm(label, beatId, i) : undefined,
        sfx: sfxEnabled,
        tone: beatTones ? (i) => beatTones[i] ?? null : undefined,
        pickRow,
        waitRows,
        manual: beatManual,
      }),
    [beatParsed, emotionBefore, emotionCtx, voiceCast, streaming, voiceConfig.fixedEmotion, jevPendingFrom, inForm, beatId, sfxEnabled, beatTones, pickRow, waitRows, beatManual],
  );
  const voice = useVoiceLine({
    config: voiceConfig,
    plans: voicePlans,
    line,
    lineKey: typeKey,
    silent: skipping || title,
    warmupId: voiceCast.main?.id ?? null,
    probeConnectionId: voiceCast.main?.connection_id ?? null,
    interrupt: settings.voiceInterrupt,
  });
  // 右上角的语音标签:这张卡绑了声音才有
  const showVoiceChip =
    settings.showVoice && currentCardId !== null && (voiceCast.main !== null || voiceCast.extras.length > 0);

  // 念台词时 BGM 压到多少,跟着设置走(压低由音频总线做)
  useEffect(() => {
    audioBus.setDuckLevel(settings.duckLevel);
  }, [settings.duckLevel]);

  // 立绘和文字同步(Jev 通用设置):正在显示的这句 Jev 还在判、判完可能换立绘 / 背景时,先不出字,
  // 判完画面和文字一起变。最多等 SYNC_MAX_WAIT_MS,点一下也先出字
  const beatPending = beat?.entry.jevPending;
  const jevGateWanted =
    jevSync &&
    current !== null &&
    beatPending !== undefined &&
    line >= beatPending &&
    jevMayTag(current, line, charName, beatJevKinds);
  const [jevReleased, setJevReleased] = useState<string | null>(null);
  const jevGated = jevGateWanted && jevReleased !== typeKey;
  useEffect(() => {
    if (!jevGated) return;
    const t = window.setTimeout(() => setJevReleased(typeKey), SYNC_MAX_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [jevGated, typeKey]);

  // 等语音、等 Jev 时先不打字:好了文字和声音 / 画面一起出
  const typer = useTypewriter(
    typeKey,
    voice.gated || jevGated ? '' : (current?.text ?? ''),
    // 自动播放开着倍速时打字也跟着快
    auto ? settings.textSpeed / settings.autoSpeed : settings.textSpeed,
  );
  const typedDone = typer.done && !voice.gated && !jevGated;

  // ---- 立绘切换特效:往下读到这句、表情真的换了,而且换上的立绘设了特效 ----

  const [fxCue, setFxCue] = useState<(SpriteFxCue & { typeKey: string }) | null>(null);
  const fxSeq = useRef(0);
  const arrived = useRef({ key: typeKey, forward: false });
  const prevLabel = useRef(shownLabel);
  useEffect(() => {
    if (arrived.current.key !== typeKey) {
      arrived.current = { key: typeKey, forward: forwardRef.current };
      forwardRef.current = false;
    }
    const changed = prevLabel.current !== shownLabel;
    prevLabel.current = shownLabel;
    // 同一句里表情后来才定下来(问模型、Jev 判完)也算:只要这句是往下读到的
    if (!changed || !arrived.current.forward || !settings.spriteFx || skipping || title) return;
    const effect = normalizeEffect(sprites.find((sp) => sp.label === shownLabel)?.effect);
    if (effect) setFxCue({ id: ++fxSeq.current, target: spriteView.key, effect, typeKey });
  }, [typeKey, shownLabel, settings.spriteFx, skipping, title, sprites, spriteView.key]);
  // 光标挪走了(哪怕又挪回来)就不再放这一次
  const spriteFx = fxCue && fxCue.typeKey === typeKey ? fxCue : null;

  // 设了特效的音效先解码好,第一次放不用等下载
  useEffect(() => {
    if (settings.spriteFx) preloadSfx(sprites.map((sp) => soundFile(normalizeEffect(sp.effect)?.sound)));
  }, [sprites, settings.spriteFx]);

  // ---- 跳字音效:只在旁白上响(台词留给配音),逐字显示时每隔一个字响一声 ----

  const typeSoundOn =
    settings.typeSound !== TYPE_SOUND_OFF &&
    settings.textSpeed > 0 &&
    !skipping &&
    current !== null &&
    !current.speaker &&
    !current.player;
  useEffect(() => {
    if (settings.typeSound !== TYPE_SOUND_OFF) preloadTypeSound(settings.typeSound);
  }, [settings.typeSound]);
  const typedCount = typer.shown.length;
  useEffect(() => {
    if (!typeSoundOn || typer.done || typedCount === 0 || typedCount % 2) return;
    // 标点和空白不出声,省略号、破折号连着的时候不会一串响
    if (/[\s\p{P}\p{S}]/u.test(typer.shown[typedCount - 1])) return;
    playTypeSound(settings.typeSound, settings.typeSoundVolume);
    // 只跟着字数走:其他依赖变了不该多响一声
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedCount]);

  // ---- 历史页:每条回复按画面上的句子列出来,要念的句子带重播 / 重新生成 ----

  // 菜单里的历史页和游戏上的历史小窗口都要这份句子
  const logOpen = menu === 'log' || win === 'log';
  const backlog = useMemo(() => {
    const out = new Map<
      string,
      {
        lines: VNLine[];
        plans: (SpeakRequest | null)[];
        hits: TagHit[];
        streaming: boolean;
        /** 在对话(beats)里是第几条:检查器按它查时间线 */
        index: number;
      }
    >();
    if (!logOpen) return out;
    // 每条回复开头的表情:时间线里这条的开头(之前所有立绘标签依次生效的结果,和语音用的同一份)
    beats.forEach((b, i) => {
      const p = b.parsed;
      if (!p) return;
      const before = timeline.entries[i].start.spriteLabel;
      const streaming = Boolean(b.entry.streaming);
      const plans = voiceConfig.enabled
        ? planVoiceLines({
            lines: p.lines,
            hits: p.hits,
            emotionBefore: before,
            ctx: emotionCtx,
            cast: voiceCast,
            streaming,
            fixedEmotion: voiceConfig.fixedEmotion,
            jevPendingFrom: voiceWaitsForJev(jevKindsOf(b.entry)) ? (b.entry.jevVoicePending ?? b.entry.jevPending) : undefined,
            mapEmotion: inForm ? (lb, li) => inForm(lb, b.entry.id, li) : undefined,
            sfx: sfxEnabled,
            tone: b.tones ? (li) => b.tones?.[li] ?? null : undefined,
            pickRow,
            waitRows,
            manual: manualEmotions(manualOf(b.entry), sprites),
          })
        : [];
      out.set(b.entry.id, { lines: p.lines, plans, hits: p.hits, streaming, index: i });
    });
    return out;
  }, [logOpen, beats, timeline, emotionCtx, voiceCast, voiceConfig.enabled, voiceConfig.fixedEmotion, inForm, sfxEnabled, pickRow, waitRows, sprites]);

  // ---- 句检查器(LineInspector.tsx):历史页每句的「详情」和对话框上右键 / 长按打开的浮层用同一个 ----

  /** 第 bi 条回复第 i 句的检查器;plan 是这句怎么念(不念是 null) */
  const inspectorFor = (
    bi: number,
    i: number,
    plan: SpeakRequest | null,
    o: { streaming: boolean; onJump?: () => void; onClose?: () => void },
  ): ReactNode => {
    const b = beats[bi];
    const p = b?.parsed;
    const ln = p?.lines[i];
    if (!b || !p || !ln) return null;
    const entry = b.entry;
    const profile = ln.player ? null : voiceForSpeaker(ln.speaker, charName, voiceCast);
    // 主声音、情绪跟着表情走:按配对表挑那一行(表情认法是认词记录时)
    const main = profile !== null && profile.id === mainVoiceId && !voiceConfig.fixedEmotion;
    const mainTable = engine === 'records' && mainVoiceId ? (voicePairs?.get(mainVoiceId) ?? null) : null;
    return (
      <LineInspector
        entry={entry}
        entryIndex={bi}
        timeline={timeline}
        line={ln}
        index={i}
        hits={p.hits}
        sprites={sprites}
        listRef={listRef}
        records={engine === 'records'}
        voicePairs={main ? { table: mainTable } : undefined}
        onSetManual={onSetManual ? (pick) => onSetManual(entry.id, i, pick) : undefined}
        emotionBefore={timeline.entries[bi].start.spriteLabel}
        plan={plan}
        profile={profile}
        ctx={emotionCtx}
        voiceEnabled={voiceConfig.enabled}
        fixedEmotion={voiceConfig.fixedEmotion}
        streamingLast={o.streaming && i === p.lines.length - 1}
        jev={jevKindsOf(entry).includes('sprite')}
        jevPending={entry.jevPending !== undefined && i >= entry.jevPending}
        onJump={o.onJump}
        onClose={o.onClose}
      />
    );
  };


  const openMenu = (page?: MenuPage, from: 'game' | 'cover' = 'game') => {
    // 每次打开都停在「角色」(10-26 用户定的,不记上次那页);从封面来的两个入口自己指定页
    setMenu(page ?? 'card');
    setMenuFrom(from);
    setWin(null);
    setAuto(false);
    setSkip(false);
    setInspect(null);
    setCtxMenu(null);
  };
  // 菜单里这一页登记的「离开前先问」(PageContext.setLeaveGuard);问过同意了就清掉
  const leaveGuard = useRef<(() => Promise<boolean>) | null>(null);
  const leavePage = (then: () => void) => {
    const guard = leaveGuard.current;
    if (!guard) return then();
    void guard().then((ok) => {
      if (!ok) return;
      leaveGuard.current = null;
      then();
    });
  };
  const setLeaveGuard = useCallback((guard: (() => Promise<boolean>) | null) => {
    leaveGuard.current = guard;
  }, []);
  const closeMenu = () => leavePage(() => setMenu(null));
  // 键盘那个 effect 里用(它不随每次渲染重挂)
  const closeMenuRef = useRef(closeMenu);
  closeMenuRef.current = closeMenu;
  const openPlugin = (section: PluginSection) => {
    setPluginFocus({ section, nonce: Date.now() });
    setMenu('plugin');
    setMenuFrom('game');
  };
  // 「换声音 · 试音」:菜单插件页的语音(顶上就是主声音下拉框;10-18 一度改去素材页,那里换不了主声音,10-19 改回来)
  const openVoice = () => openPlugin('voice');

  const advance = () => {
    if (uiHidden) {
      setUiHidden(false);
      return;
    }
    if (failedHold) return;
    if (!beat || !current) return;
    // 当时玩家发的话:点哪里都算选中,接着弹下一句,或者去下一条回复
    if (userChoice !== null && userStep) {
      if (userStep.i + 1 < between.said.length) setUserStep({ key: typeKey, i: userStep.i + 1 });
      else continueToNext();
      return;
    }
    if (jevGated) {
      setJevReleased(typeKey);
      return;
    }
    if (voice.gated) {
      voice.release();
      return;
    }
    if (!typer.done) {
      typer.skip();
      return;
    }
    if (hasNext && lineComplete) {
      forwardRef.current = true;
      setCursor({ id: beat.entry.id, swipe: beat.entry.swipeIndex, line: line + 1 });
    } else if (canContinue) {
      if (between.said.length > 0) setUserStep({ key: typeKey, i: 0 });
      else continueToNext();
    } else if (!hasNext && !streaming) {
      // 最后一句读完了还在点:轮到你
      setTurnAt(typeKey);
      setTurnClosed(null);
    }
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  // 自动播放那颗键(右上细条、A 键共用),定义在下面外观那段
  const cycleAutoRef = useRef<() => void>(() => {});

  // 菜单关上后还留 .18s 淡出(menuLayer 在上面):这段时间里底下的游戏也不接点击和键盘
  const busyOverlay = title || menu !== null || menuLayer.mounted || winLayer.mounted;
  // 对话框上的检查器开着(在眼下这一句上打开的;光标挪走了就不算)
  const inspecting = inspect !== null && inspect.key === typeKey && current !== null;
  const ctxOpen = ctxMenu !== null && ctxMenu.key === typeKey && current !== null;
  // 小菜单、检查器关上时先淡出再卸:淡出时还画着最后那一份
  const ctxLayer = useFadeLayer(ctxOpen, MOTION.popOut);
  const inspLayer = useFadeLayer(inspecting, MOTION.popOut);
  const lastCtx = useRef(ctxMenu);
  if (ctxMenu) lastCtx.current = ctxMenu;
  const lastInsp = useRef(inspect);
  if (inspect) lastInsp.current = inspect;

  // 自动播放:一句打完停一会儿翻下一句;流式时等下一句写完再翻。
  // 设置里开着「等语音」时,这句的语音还在合成或正在念就先不翻(合成失败了照常翻)。
  // 翻回历史时一条回复读完接着往下:当时玩家发的话停一会儿选掉
  const voiceHolds = settings.autoWaitVoice && (voice.speaking || voice.synthesizing);
  // 依赖里只放「有没有这句」:流式时每来一个字都会重新切句,current 每次都是新对象,
  // 放它进去计时器会被一直重置,要等生成完才翻得动
  const hasCurrent = current !== null;
  useEffect(() => {
    if (!auto || busyOverlay || uiHidden || skipping || !hasCurrent || !lineComplete) return;
    const ready = userChoice !== null || (typedDone && !voiceHolds && (hasNext || canContinue));
    if (!ready) return;
    const t = window.setTimeout(() => advanceRef.current(), settings.autoDelay / settings.autoSpeed);
    return () => window.clearTimeout(t);
  }, [auto, busyOverlay, uiHidden, skipping, hasCurrent, userChoice, userStep, typedDone, voiceHolds, hasNext, canContinue, lineComplete, settings.autoDelay, settings.autoSpeed, typeKey]);

  // 跳过:连打带翻(当时玩家发的话直接选掉),翻到最新那条回复的最后一句自己停 —— 翻回历史时读过的
  // 一路跳过去
  useEffect(() => {
    if (!skipping || busyOverlay || !hasCurrent) return;
    const more = (hasNext && lineComplete) || canContinue || userChoice !== null;
    if (typedDone && !more) {
      if (!streaming && skip) setSkip(false);
      return;
    }
    const t = window.setTimeout(() => advanceRef.current(), 60);
    return () => window.clearTimeout(t);
  }, [skipping, skip, busyOverlay, hasCurrent, userChoice, userStep, canContinue, typedDone, hasNext, lineComplete, streaming, typeKey]);

  // 等待页 / 换存档的黑场盖着的时候,键盘和滚轮也别动底下的故事:看不见的句子会被翻过去、
  // 语音照念;Esc 会在等待页底下开出一个看不见的菜单
  const veiled = firstLoad || gateVeil || (veil && !title);
  // 菜单、标题、等待页盖在上面时,底下的游戏不能被 Tab 到:不然 Tab 到看不见的「重来」上按回车,
  // 就悄悄重新生成了最后一条回复
  const covered = busyOverlay || veiled;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 别处已经处理过的(改存档名时的 Esc、聊天记录里改消息时的 Esc ……)不再当成游戏操作
      if (e.defaultPrevented) return;
      if (e.key === 'Control') {
        // 在输入框里按 Ctrl 是要复制粘贴,不是按住快进
        if (!busyOverlay && !veiled && !isTextField(e.target) && !e.repeat) setCtrlHeld(true);
        return;
      }
      // 按住 Ctrl 又按了别的键 = 组合键(Ctrl+C 之类),不是按住快进
      if (e.ctrlKey) setCtrlHeld(false);
      if (e.key === 'Escape') {
        if (e.isComposing) return;
        if (ctxOpen) {
          setCtxMenu(null);
          return;
        }
        if (inspecting) {
          setInspect(null);
          return;
        }
        if (menu) {
          // 菜单里的输入框:Esc 先只是退出输入框,再按一次才关菜单(菜单盖在封面上时,关了就回封面)
          if (isTextField(e.target)) (e.target as HTMLElement).blur();
          else closeMenuRef.current();
          return;
        }
        // 封面上没开菜单:已经是最外层,Esc 不做事(一层一层退,层数退完了)
        if (title) return;
        if (veiled) return;
        else if (uiHidden) setUiHidden(false);
        else if (escBarRef.current(e.target)) return;
        else if (!isTextField(e.target)) {
          setMenu('card');
          setMenuFrom('game');
          setAuto(false);
          setSkip(false);
        }
        return;
      }
      // 检查器开着:看的是这一句,不翻页(点外面或 Esc 关掉再接着读)
      if (isField(e.target) || busyOverlay || veiled || inspecting || ctxOpen) return;
      // 带修饰键的是浏览器 / 系统快捷键(Alt+→ 前进、Ctrl+A 全选),不归游戏管
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        audioBus.unlock();
        advanceRef.current();
      } else if ((e.key === 'a' || e.key === 'A') && !e.repeat) {
        cycleAutoRef.current();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(false);
    };
    const onBlur = () => setCtrlHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [busyOverlay, veiled, title, menu, uiHidden, inspecting, ctxOpen]);

  // 滚轮往上 = 看历史;右键 = 隐藏界面(galgame 玩家的习惯);对话框上右键是这句的检查器(onBoxContextMenu)
  const onWheel = (e: React.WheelEvent) => {
    if (busyOverlay || veiled || e.deltaY > -8) return;
    // 思考过程、输入框自己能滚:还没滚到顶就是在滚它们,不是要看历史
    if (scrollsUp(e.target, e.currentTarget)) return;
    setWin('log');
  };
  const onContextMenu = (e: React.MouseEvent) => {
    // 输入框里右键 / 长按是要粘贴、选字,不是隐藏界面
    if (isField(e.target)) return;
    e.preventDefault();
    setUiHidden((h) => !h);
  };
  // 对话框上右键 / 长按:打开这一句的检查器,浮在对话框上方,不翻下一句;还没有句子时照旧隐藏界面
  const onBoxContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    if (isField(e.target)) return;
    if (!beat || !current || failedHold) {
      onContextMenu(e);
      return;
    }
    e.preventDefault();
    openLineMenu(e.currentTarget, e.clientX, e.clientY);
  };
  // 手机长按台词也出小菜单:iOS Safari 长按不发 contextmenu,自己数 0.5s;手指挪开 10px 就不算。
  // 长按出了菜单,松手那一下的 click 不再翻下一句
  const press = useRef<{ t: number; x: number; y: number; el: HTMLElement } | null>(null);
  const pressFired = useRef(false);
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.t);
    press.current = null;
  };
  const onBoxPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    pressFired.current = false;
    if (e.pointerType !== 'touch' || isField(e.target) || !beat || !current || failedHold) return;
    const el = e.currentTarget;
    const { clientX: x, clientY: y } = e;
    cancelPress();
    press.current = {
      x,
      y,
      el,
      t: window.setTimeout(() => {
        press.current = null;
        pressFired.current = true;
        openLineMenu(el, x, y);
      }, 500),
    };
  };
  const onBoxPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancelPress();
  };
  const onBoxClick = () => {
    if (pressFired.current) {
      pressFired.current = false;
      return;
    }
    tapScreen();
  };
  // 点画面:点开了输入但没写字(也不是轮到你)先收起,不翻句;不然翻下一句
  const tapScreen = () => {
    if (barIdle.current) {
      setBarOpen(false);
      return;
    }
    advance();
  };
  const openLineMenu = (el: HTMLElement, clientX: number, clientY: number) => {
    const box = el.getBoundingClientRect();
    const root = el.closest('.vn-root')?.getBoundingClientRect();
    const bottom = root ? root.bottom - box.top + 8 : 0;
    // 对话框占了大半屏(手机横屏)时,上面至少留 INSPECT_MIN_ROOM 给检查器,压住对话框上沿也行
    setCtxMenu({
      key: typeKey,
      x: Math.round(clientX - (root?.left ?? 0)),
      y: Math.round(clientY - (root?.top ?? 0)),
      w: Math.round(root?.width ?? 0),
      h: Math.round(root?.height ?? 0),
      bottom: Math.round(Math.max(8, Math.min(bottom, (root?.height ?? 0) - INSPECT_MIN_ROOM))),
    });
    setAuto(false);
    setSkip(false);
  };
  const closeInspect = () => setInspect(null);
  const closeCtx = () => setCtxMenu(null);
  const copyLine = () => {
    // 复制的是这一句的字(不带名字)
    if (current) void navigator.clipboard?.writeText(current.text).catch(() => undefined);
    setCtxMenu(null);
  };
  const openInspect = () => {
    if (ctxMenu) setInspect({ key: ctxMenu.key, bottom: ctxMenu.bottom });
    setCtxMenu(null);
  };
  // 「改原文」:你自己说的那句没有;还在写 / 在等回复时也没有(写完才能改)
  const canEditLine = Boolean(beat && current && !current.player && !beat.entry.streaming && !sending);
  const editLine = () => {
    setCtxMenu(null);
    if (!beat || !canEditLine) return;
    setEditFirst(beat.entry.id);
    setWin('log');
  };

  // ---- 输入:一直在,随时插话 ----

  // 发出去的那句浮一下(echo):字少停 1.8s,字多停久一点,最多 3.2s;「——」开头的提示行不显示
  const [echo, setEcho] = useState<{ text: string; at: number } | null>(null);
  const echoLayer = useFadeLayer(echo !== null, MOTION.popOut);
  const lastEcho = useRef(echo);
  if (echo) lastEcho.current = echo;
  useEffect(() => {
    if (!echo) return;
    const t = window.setTimeout(() => setEcho(null), echoHoldMs(echo.text));
    return () => window.clearTimeout(t);
  }, [echo]);

  const send = () => {
    const text = draft.trim();
    if (!text || !canSend) return;
    setDraft('');
    setBarOpen(false);
    const said = playerSaid(text);
    setEcho(said ? { text: said, at: Date.now() } : null);
    audioBus.unlock();
    // 自动留着:开着自动发出去,新回复写出来就接着一句句往下翻;跳过要停,不然一路跳过新回复
    setSkip(false);
    const latest = lastAssistantIndex >= 0 ? beats[lastAssistantIndex] : null;
    const last = entries[entries.length - 1];
    // 一条回复只留到玩家看到的这句为止的原文。尽量在库里的原文上截,{{char}} 这类宏原样
    // 留着;宏展开前后切出来的句数对不上(极少见,长段落按字数硬切时)才退回到展开后的文本上截
    const keepUpTo = (b: Beat, parsed: ParsedReply) => {
      if (lines.length === 0) return '';
      const stored = currentText(b.entry);
      const plain = parseBilingual(stored, {
        charName,
        userName,
        tags: tagKinds,
        streaming: Boolean(b.entry.streaming),
      });
      return plain.lines.length === parsed.lines.length
        ? stored.slice(0, plain.ends[line]).trimEnd()
        : b.raw.slice(0, parsed.ends[line]).trimEnd();
    };
    if (!onLatest && beat?.parsed && lines.length > 0) {
      // 翻回历史、在旧的位置开口:从这里分出一条新的故事线,原来的对话留在存档里
      onBranch(text, beat.entry.id, keepUpTo(beat, beat.parsed));
    } else if (onLatest && latest?.parsed && (streaming || hasNext)) {
      // 最新这条还没读完就开口了:这条回复只留到玩家看到的这句为止
      onInterject(text, latest.entry.id, keepUpTo(latest, latest.parsed));
    } else if (sending) {
      // 在往回翻旧的时候插话:不截断,只是先停下正在写的那条
      onInterject(text, last?.role === 'assistant' ? last.id : null, null);
    } else {
      onSend(text);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  // 回车发送还是换行看设置;自动模式下手机软键盘没有 Shift,回车就是换行,点按钮发送
  const softKeyboard = useCoarsePointer();
  // 窄屏时占位符放不下这串按键提示(会折成两行被截掉),干脆不提
  const narrow = useIsMobile();
  const hint = softKeyboard || narrow ? '' : enterHint(enterKey, softKeyboard);
  const enterSends = enterKey === 'send' || (enterKey === 'auto' && !softKeyboard);

  // 输入框跟着内容长高,封顶四行左右,再多就在框里滚
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // 加上框线的厚度(老样子的输入框有 1px 边;对话区 A 的输入没有边,一行正好 40)
    el.style.height = `${Math.min(el.scrollHeight + el.offsetHeight - el.clientHeight, 132)}px`;
  }, [draft]);

  /**
   * 跳到某条回复的某一句,关掉菜单。立绘、背景、音乐都是按光标累计的,跟着回到那一句的样子
   */
  const jumpTo = (entryId: string, at = 0) => {
    const b = beats.find((x) => x.entry.id === entryId && x.parsed);
    if (b) setCursor({ id: b.entry.id, swipe: b.entry.swipeIndex, line: at });
    setUserStep(null);
    setMenu(null);
  };

  // ---- 思考中 / 生成中 ----

  const info = beat ? currentInfo(beat.entry) : undefined;
  const reasoning = info?.reasoning ?? '';
  const waiting = streaming && lines.length === 0;
  const now = useNow(waiting);
  const thinkKey = beat ? `${beat.entry.id}:${beat.entry.swipeIndex}` : '';
  // 计时一直从发出去算,「正在组织语言」变成「正在思考」时不重来 —— 生成完显示的
  // 「已思考 N 秒」是后端从请求模型算到最后一段思考,起点只差一个网络来回,两个数才接得上
  const sentAt = info?.sendDate ? Date.parse(info.sendDate) : NaN;
  const elapsed = Number.isFinite(sentAt) ? Math.max(0, now - sentAt) : 0;
  const [thinkOpenKey, setThinkOpenKey] = useState<string | null>(null);
  const thinkOpen = thinkOpenKey === thinkKey && settings.showThinking;
  // 回复出来以后,第一句上留一个「已思考 N 秒」的小条,点开还能看
  const showThinkChip = !failedHold && !waiting && line === 0 && Boolean(reasoning) && settings.showThinking;

  // ---- 渲染 ----

  const shown: VNLine | null = current;
  let speaker: string | null = shown?.speaker ?? null;
  let body: ReactNode;
  if (failedHold && heldEntry) {
    speaker = userName;
    body = userSaid(currentText(heldEntry));
  } else if (waiting) {
    speaker = charName;
    body = null;
  } else if (current) {
    body = (
      <>
        {typer.shown}
        {typer.rest && (
          <span className="vn-type-rest" aria-hidden="true">
            {typer.rest}
          </span>
        )}
        {jevGated && (
          <span className="vn-voice-wait" title="等 Jev 判表情…(点一下先出文字)">
            ……
          </span>
        )}
        {!jevGated && voice.gated && (
          <span className="vn-voice-wait" title="等语音…(点一下先出文字)">
            ……
          </span>
        )}
        {/* 不等语音:文字照常出,语音还在合成就在字后面转个圈,好了自己念、圈消失 */}
        {!voice.gated && voice.synthesizing && (
          <span className="vn-voice-spin" role="status" aria-label="正在生成语音" title="正在生成语音" />
        )}
        {streaming && !hasNext && typedDone && <span className="vn-caret" />}
      </>
    );
  } else {
    body = (
      <span className="vn-empty">
        {canSend ? '还没有对话。在下面说点什么,开始吧。' : notReadyHint}
      </span>
    );
  }
  const showNextMark =
    !failedHold && Boolean(current) && typedDone && userChoice === null && ((hasNext && lineComplete) || canContinue);
  const atEnd = !failedHold && Boolean(current) && typedDone && !hasNext && !streaming && !canContinue;
  const lastEntry = entries[entries.length - 1];
  const currentMessageId = onLatest ? (lastEntry?.id ?? null) : (beat?.entry.id ?? null);

  // 菜单面板的页头场景横幅(10-24):存档 / 读档 = 她现在待的场景,设置 = 场景包里另一张(和设置里的实机预览错开);别的页不放
  const menuBanner = useMemo(() => {
    if (shownMenu !== 'save' && shownMenu !== 'config') return null;
    const bgs = backgroundsOf(sceneAssets);
    if (shownMenu === 'save') {
      const cur = scene.bg ?? bgs[0] ?? null;
      return cur ? sceneImageUrl(cur) : null;
    }
    // 设置:场景包里另一张,昼夜和现在这张一样(settings/banner.ts 挑)
    const scenes = bgs.flatMap((a) => {
      const src = sceneImageUrl(a);
      return src ? [{ label: a.label, src, focus: a.focus_x }] : [];
    });
    return pickBannerScene(scenes, scene.bg?.label ?? null)?.src ?? null;
  }, [shownMenu, sceneAssets, scene.bg]);

  const pageCtx: PageContext = {
      setLeaveGuard,
      close: closeMenu,
      enterGame: () => {
        setMenu(null);
        setTitle(false);
      },
      jumpTo,
      currentMessageId,
      sceneNow: { label: scene.bg?.label || null, thumb: bgUrl },
      loadOnly: shownMenuFrom === 'cover',
      raw: rawLog,
      openPlugin,
      pluginFocus,
      openConfig: () => openMenu('config'),
      openAssets: () => openMenu('assets'),
      openPreset: () => openMenu('preset'),
      showThinking: settings.showThinking,
      log: {
        of: (entry) => {
          const b = backlog.get(entry.id);
          return b ? { lines: b.lines, plans: b.plans, hits: b.hits, streaming: b.streaming } : null;
        },
        at: beat ? { entryId: beat.entry.id, line } : null,
        showJa,
        jaHidden: jaHiddenOf,
        esc: logEsc,
        // 历史里她每一句的头像:那句时间线上的表情差分,按脸裁(设计稿 AV.menuHistory 的 faceCrop)
        face: (entryId, at) => {
          const b = backlog.get(entryId);
          const tl = b ? timeline.entries[b.index] : null;
          if (!tl) return null;
          const label = (tl.lines[at] ?? tl.empty).shownLabel;
          const s = sprites.find((x) => x.label === label) ?? sprites[0];
          const src = s ? spriteThumbUrl(s, 160) : null;
          if (!s || !src) return null;
          const fs = s.face_scan;
          return { src, face: faces.get(s.id) ?? null, aspect: fs?.width && fs.height ? fs.width / fs.height : 0.5 };
        },
      },
  };
  const hostPage = (page: HostPage) => renderPage(page, pageCtx);

  // 设置页右边的实机预览:这一幕的背景、她、这条回复里的几句(还没有对话时用一句占位)
  const settingsPreview: LivePreviewData | null =
    shownMenu === 'config'
      ? {
          bg: bgView.src,
          bgFocus: bgView.focus,
          sprite: switches.sprite ? spriteView.src : null,
          spriteStyle: spriteView.style,
          lines: (lines.length > 0 ? lines : [{ speaker: charName || null, text: '「……」' }]).slice(0, 6).map((l) => ({
            who: l.player ? userName : l.speaker,
            text: l.text,
            ja: jaVisible ? l.ja : null,
          })),
          accentStyle: accentCssVars(accent),
        }
      : null;

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const toastAt = toastPlace(menu !== null || picking || inspecting);

  // ---- 外观:对话框(设置 → 外观)----
  // 细线 = 对话区 A(第 5 段,10-24 定):不用框,底部一层压暗 + 一条细线,名字在线上、台词在线下;
  // 经典 = 玻璃框 + 名牌(boxSkin 那套)。输入条、四角按钮两种一样,所以细线也走玻璃那套行为(轮到你弹输入条)
  const dlgLine = settings.dlgStyle === 'line';
  const glass = dlgLine || settings.boxSkin !== 'classic';
  // 点名字重听这一句:她这句有语音时(你说话、报错停在你那句时没有);经典玻璃框点名牌也一样(设计稿 .dlg-classic)
  const canReplay = glass && voice.request !== null && !failedHold && !shown?.player;
  // 这一幕是白天还是夜里(场景名带「夜」「星空」):细线白天压暗深一点、日语小字亮一点(设计稿 .ga.is-day)
  const night = isNightLabel(scene.bg?.label ?? '');
  // 轮到你说话:她说完了(最新一条回复读到底、不在生成)、或者还没有对话;玻璃皮肤下正中弹输入条
  const myTurn =
    glass &&
    canSend &&
    !sending &&
    !failedHold &&
    !menu &&
    !title &&
    userChoice === null &&
    turnClosed !== typeKey &&
    ((atEnd && (turnAt === typeKey || auto)) || (!current && entries.length === 0));
  // 回看历史(停在旧的一句或当时玩家说的话上):最下面那行字、输入框的提示换成「会分出一条新的故事线」
  const pastHere = canSend && !onLatest && beat !== null;
  // 最下面那条输入浮上来没有(设计稿 .ga.bar-on):轮到你、或者点了那行淡字
  const barOn = glass && canSend && (myTurn || barOpen);
  barIdle.current = glass && barOpen && !myTurn && !draft.trim();
  // 轮到你:光标直接放进输入框(手机上不弹软键盘,等玩家自己点)
  useEffect(() => {
    if (!myTurn || softKeyboard) return;
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(t);
  }, [myTurn, softKeyboard]);
  const ghostRef = useRef<HTMLButtonElement>(null);
  // 点那行淡字:整条浮上来、光标放进去。同一下点击里就聚焦(iOS 要在点击里聚焦才弹键盘),所以先同步画出来
  const openBar = () => {
    flushSync(() => setBarOpen(true));
    inputRef.current?.focus({ preventScroll: true });
  };
  // 左边的 ×:收起来回到那行淡字(轮到你时记下这一句收过,不再自己弹出来)
  const closeBar = () => {
    setBarOpen(false);
    if (myTurn) setTurnClosed(typeKey);
    window.setTimeout(() => ghostRef.current?.focus({ preventScroll: true }), 60);
  };
  escBarRef.current = (target) => {
    if (thinkOpen) {
      setThinkOpenKey(null);
      return true;
    }
    if (!glass || !barOn || target !== inputRef.current) return false;
    inputRef.current?.blur();
    if (!myTurn && !draft.trim()) setBarOpen(false);
    return true;
  };
  // 经典(老样子的框)「生成中」小签关上时也留 .18s 淡出
  const genLayer = useFadeLayer(sending, MOTION.popOut);
  // 自动播放:按一下 关 → ×1 → ×1.5 → ×2 → ×3 → 关(A 键一样);倍速记在设置里
  const cycleAuto = () => {
    if (!auto) {
      if (settings.autoSpeed !== AUTO_SPEEDS[0].value) changeSettings({ ...settings, autoSpeed: AUTO_SPEEDS[0].value });
      setAuto(true);
    } else if (settings.autoSpeed === AUTO_SPEEDS[AUTO_SPEEDS.length - 1].value) {
      setAuto(false);
    } else {
      changeSettings({ ...settings, autoSpeed: nextAutoSpeed(settings.autoSpeed) });
    }
  };
  cycleAutoRef.current = cycleAuto;
  const speedName = AUTO_SPEEDS.find((a) => a.value === settings.autoSpeed)?.name ?? '';
  // 插图卡带的小按钮:玻璃皮肤放在发送右边,经典皮肤放在快捷按钮一排的最前面
  const illusButton = illustrations ? (
    <div className="vn-illus-btn" onClick={stop}>
      {illustrations.button(illusCtx)}
    </div>
  ) : null;
  // 最下面那行淡字(设计稿 PH_TALK / PH_GEN / PH_PAST)和浮上来的输入框里的提示(PH_TURN / PH_PAST)
  const ghostText = !canSend
    ? notReadyHint
    : sending
      ? '随时插话…'
      : pastHere
        ? '在这里开口,会从这里分出一条新的故事线…'
        : '说点什么 · 随时可以插话';
  const inputForm = (
      <form className={glass ? 'ga-form' : 'vn-input'} onSubmit={submit}>
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="你要说的话"
          placeholder={
            canSend
              ? glass
                ? pastHere
                  ? '在这里开口,会从这里分出一条新的故事线…'
                  : '说点什么'
                : !onLatest && beat
                  ? '在这里开口,会从这里分出一条新的故事线…'
                  : sending
                    ? '随时插话…'
                    : `以 ${userName} 的身份说点什么…${hint ? `(${hint})` : ''}`
              : notReadyHint
          }
          disabled={!canSend}
          // 软键盘右下角那颗键显示成「发送」还是「换行」
          enterKeyHint={enterSends ? 'send' : 'enter'}
          onKeyDown={(e) => {
            // 框里是空的:回车 / 空格和在画面上按一样,翻下一句 —— 刚发完话焦点还留在这里,
            // 不用先拿鼠标点一下画面。输入法选字时的空格、回车是选词上屏(Safari 上
            // isComposing 是 false、keyCode 是 229),不拦;手机软键盘也不拦,那颗键另有用处
            if (
              !softKeyboard &&
              !draft.trim() &&
              (e.key === 'Enter' || e.key === ' ') &&
              !e.shiftKey &&
              !e.ctrlKey &&
              !e.metaKey &&
              !e.altKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              audioBus.unlock();
              advanceRef.current();
              return;
            }
            // 输入法选字时的回车是确认候选词,enterShouldSend 里已经挡掉
            if (enterShouldSend(e, enterKey, softKeyboard)) {
              e.preventDefault();
              send();
            }
          }}
        />
        {sending && !draft.trim() ? (
          <button type="button" className={glass ? 'ga-send stop' : 'vn-send stop'} onClick={onStop} title="停止" aria-label="停止">
            {glass ? <GameIcon name="stop" size={20} /> : '停止'}
          </button>
        ) : (
          <button
            type="submit"
            className={glass ? 'ga-send' : 'vn-send'}
            disabled={!canSend || !draft.trim()}
            title={glass ? '发送(回车)' : '发送'}
            aria-label="发送"
          >
            {glass ? <GameIcon name="send" size={20} /> : '发送'}
          </button>
        )}
      </form>
  );
  // 对话区 A / 经典玻璃框挂在根上的状态(设计稿 .gm.ga 上的那些 class:旁白、你说话、能重听、在念、正在写、输入浮上来、思考展开、语音关了)
  const narr = glass && !speaker && !waiting && !genFail;
  const youLine = Boolean(shown?.player) || failedHold;
  const gaClass = glass
    ? ` ga ${night ? 'is-night' : 'is-day'}${dlgLine ? '' : ' dlg-classic'}${narr ? ' narr' : ''}${youLine ? ' you' : ''}${canReplay ? ' can-replay' : ''}${canReplay && voice.speaking ? ' speaking' : ''}${waiting ? ' gen' : ''}${barOn ? ' bar-on' : ''}${thinkOpen ? ' think-on' : ''}${voiceConfig.enabled ? '' : ' voice-off'}`
    : '';

  return (
    <div
      className={`vn-root${gaClass}${uiHidden ? ' ui-hidden' : ''}${menu ? ' menu-open' : ''}${myTurn ? ' my-turn' : ''}${cgOn ? ' cg-on' : ''}${voice.paused ? ' voice-err' : ''}`}
      // 细线照黑玻璃的字色走(白字 + 阴影),框和名牌由 vnLine.css 收掉
      data-skin={dlgLine ? 'glass-dark' : settings.boxSkin}
      data-dlg={dlgLine ? 'line' : 'classic'}
      data-font={settings.textFont}
      style={
        {
          '--vn-box-alpha': settings.boxOpacity,
          '--vn-text-scale': settings.textScale,
          '--vn-dialogue-offset': `${settings.dialogueOffset}px`,
          '--vn-dialogue-height': `${settings.dialogueHeight}px`,
          ...accentCssVars(accent),
          ...glassStyle,
        } as React.CSSProperties
      }
      // 浏览器要用户点过才让网页出声;界面里任何一次点击都顺手解锁一下
      onPointerDown={() => audioBus.unlock()}
    >
      <div
        className={`vn-stage${cgOn ? ' cg-on' : ''}`}
        inert={covered}
        onClick={tapScreen}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
      >
        {/* 背景 / 立绘在开关里关了:不画(背景留黑) */}
        {switches.bg && <BackgroundLayer view={bgView} instant={skipping} />}
        {switches.sprite && (
          <SpriteLayer
            view={spriteView}
            charName={charName}
            fx={spriteFx}
            fxVolume={settings.spriteFxVolume}
            covered={cgOn}
            instant={skipping}
          />
        )}
        <CgLayer view={shownCg} instant={skipping} />
      </div>
      {/* 细线对话区:底部很淡的压暗,只为字看得清;出 CG 时从更低处开始(vnLine.css .ga-shade) */}
      {dlgLine && <div className="ga-shade" aria-hidden="true" />}

      {/* 发出去的那句:不进对话框,在画面中间偏上(galgame 出选项的位置)浮一下再自己淡出,点一下提前收 */}
      {echoLayer.mounted && lastEcho.current && (
        <p
          className={`ga-echo${echoLayer.leaving ? ' leaving' : ''}`}
          role="status"
          aria-live="polite"
          inert={covered}
          onClick={(e) => {
            e.stopPropagation();
            setEcho(null);
          }}
        >
          {lastEcho.current.text}
        </p>
      )}

      {/* 翻回历史往下看:当时玩家发的话弹成选项,点哪里都接着往下 */}
      {userChoice !== null && (
        <div className="vn-choice-layer" inert={covered}>
          <button className="vn-choice past" onClick={advance}>
            <span className="vn-choice-cap">{glass ? '历史回复' : '当时的回复'}</span>
            <span className="vn-choice-text">{userChoice}</span>
          </button>
        </div>
      )}

      {/* 右上那排细条左边:跳过中的小签、形态切换(语音、模型挪进了四角的按钮) */}
      {(lens || skipping) && (
        <div className="vn-topbar" inert={covered}>
          {/* 跳过中:背景和立绘直接换(不淡),这里挂一枚小签,点一下就停 */}
          {skipping && (
            <button
              className="vn-chip vn-state vn-skip-chip"
              onClick={() => {
                setSkip(false);
                setCtrlHeld(false);
              }}
              title={ctrlHeld ? '松开 Ctrl 就停' : '点一下停'}
            >
              {skipChipLabel(ctrlHeld)}
            </button>
          )}
          {lens && forms?.stateNames && forms.stateNames.length >= 2 ? (
            <StateToggle
              names={forms.stateNames}
              current={cursorState.form ?? formCurrent ?? forms.stateNames[0]}
              onPick={(next) => {
                // 记号插在正在看的这句上;还没有句子时插在最后一条后面
                const at = beatId ?? entries[entries.length - 1]?.id;
                if (at) forms.switchAt(at, beatId ? line : Number.MAX_SAFE_INTEGER, next);
              }}
            />
          ) : lens && forms && FormButton && (
            <FormButton
              form={cursorState.form ?? formCurrent ?? ''}
              onToggle={(next) => {
                // 记号插在正在看的这句上;还没有句子时插在最后一条后面
                const at = beatId ?? entries[entries.length - 1]?.id;
                if (at) forms.switchAt(at, beatId ? line : Number.MAX_SAFE_INTEGER, next);
              }}
            />
          )}
        </div>
      )}

      {/* 四角的按钮(第 5 段,10-23 晚 / 10-24 定;细线、经典两种一样):半透明深色细条,线条图标。
          右上 自动 · 跳过 · ≡,下面单独一格历史;左上「模型」;右下 画笔 · 语音 · 重来 · 隐藏。存档在菜单里 */}
      <div className="vn-corners" inert={covered}>
        <div className="vn-strip vn-strip-model">
          <button onClick={() => (modelQuick ? setWin('model') : openMenu('model'))} aria-label="模型" title={modelLabel ? `模型:${modelLabel}` : '模型'}>
            <GameIcon name="model" size={24} />
            {settings.showModel && modelLabel && <span className="vn-model-name">{modelLabel}</span>}
          </button>
        </div>
        <nav className="vn-strip vn-strip-top" aria-label="播放和菜单">
          <button
            className={`vn-auto${auto ? ' on' : ''}`}
            onClick={cycleAuto}
            aria-pressed={auto}
            aria-label={auto ? `自动播放 ${speedName}` : '自动播放'}
            title="自动播放:按一下 关 → ×1 → ×1.5 → ×2 → ×3 → 关(快捷键 A)"
          >
            {auto && <span className="sp">{speedName}</span>}
            <GameIcon name="auto" size={24} />
          </button>
          <button className={skip ? 'on' : ''} onClick={() => setSkip((v) => !v)} aria-pressed={skip} aria-label="跳过" title="跳过(按住 Ctrl 也行)">
            <GameIcon name="skip" size={24} />
          </button>
          <button onClick={() => openMenu()} aria-label="菜单" title="菜单:角色、存档、设置……">
            <GameIcon name="menu" size={24} />
          </button>
        </nav>
        <div className="vn-strip vn-strip-hist">
          <button onClick={() => setWin('log')} aria-label="历史" title="历史(滚轮往上也行)">
            <GameIcon name="history" size={24} />
          </button>
        </div>
        <div className="vn-strip vn-strip-tools" role="group" aria-label="快捷">
          {illusButton}
          {(showVoiceChip || (voice.paused && currentCardId !== null)) && (
            <VoiceQuick
              variant="icon"
              speaking={voice.speaking}
              cast={voiceCast}
              config={voiceConfig}
              onChangeConfig={onChangeVoiceConfig}
              paused={voice.paused}
              synthesizing={voice.synthesizing}
              onRetry={voice.retry}
              onOpenSettings={() => {
                openMenu('config');
                setSettingsTab('sound');
              }}
              onOpenVoice={openVoice}
              theme={paperTheme}
              request={failedHold ? null : voice.request}
              onLineAction={voice.release}
              profiles={voiceProfiles}
              onPickVoice={onPickVoice}
              modelLabel={modelLabel}
            />
          )}
          <button
            onClick={sending ? onStop : onRegenerate}
            disabled={!sending && (entries.length === 0 || !canSend)}
            aria-label={sending ? '停止生成' : '重来'}
            title={sending ? '停止生成' : '重来:重新生成最后一条回复'}
          >
            <GameIcon name={sending ? 'stop' : 'retry'} size={22} />
          </button>
          <button onClick={() => setUiHidden(true)} aria-label="隐藏界面" title="隐藏界面,只看立绘和背景(右键也行)">
            <GameIcon name="hide" size={22} />
          </button>
        </div>
      </div>

      {illustrations && (
        <div className="vn-illus" inert={covered}>
          {illustrations.stage(illusCtx)}
        </div>
      )}

      {glass ? (
        <>
          {/* 对话区 A(设计稿 kit/scene.js mountA 的 .ga-say):名字(声波 + 宋体,悬停「重听」)和「已思考」一行,
              一条细线(左端 56px 白线往右渐隐),线下日语小字 + 中文台词(▼ / ■ 跟在句尾),正在写时这一行换成「正在写 ··· 停止」。
              经典(.dlg-classic)是同一份:玻璃框 + 名牌,框里只糊背景。外面那层 .ga-zone 只管位置:上沿钉在画面 68.4%,
              字多了放不下才往上让(不压到最下面那行输入) */}
          <div className="ga-stage" ref={measureStage} data-frost-scale="">
          <div className="ga-zone" inert={covered}>
            <div
              className="ga-say"
              ref={sayRef}
              onWheel={onWheel}
              onClick={onBoxClick}
              onContextMenu={onBoxContextMenu}
              onPointerDown={onBoxPointerDown}
              onPointerMove={onBoxPointerMove}
              onPointerUp={cancelPress}
              onPointerCancel={cancelPress}
            >
              {!dlgLine && <FrostLayer src={shownCg.src ?? bgView.src ?? undefined} style={frost} />}
              {genFail && (
                <ModelError
                  fail={genFail}
                  said={userSaid(heldEntry ? currentText(heldEntry) : '')}
                  sentBefore={Math.max(0, entries.length - 1)}
                  theme={paperTheme}
                  frostSrc={bgView.src}
                  onOpenModels={() => openMenu('model')}
                />
              )}
              {(waiting || showThinkChip) && (
                <div className="ga-thinkbody" onClick={stop} aria-hidden={!thinkOpen}>
                  <p>{reasoning}</p>
                </div>
              )}
              <div className="ga-head">
                {/* 声波名字:名字是一个按钮 = 声波 + 名字 + 悬停时才出来的「重听」;不能重听时只是字(点了照常翻句) */}
                <button
                  type="button"
                  className="ga-name"
                  tabIndex={canReplay ? 0 : -1}
                  aria-disabled={!canReplay}
                  aria-label={canReplay ? `重听这一句(${speaker})` : undefined}
                  onClick={
                    canReplay
                      ? (e) => {
                          e.stopPropagation();
                          voice.release();
                          voicePlayer.replay(voice.request!);
                        }
                      : undefined
                  }
                >
                  <GameIcon name="voice-wave" size={22} className="ga-wave" />
                  <span className="nm">{speaker ?? charName}</span>
                  <span className="hint" aria-hidden="true">
                    重听
                  </span>
                </button>
                {(waiting || showThinkChip) && (
                  <button
                    type="button"
                    className="ga-think"
                    onClick={(e) => {
                      e.stopPropagation();
                      setThinkOpenKey(thinkOpen ? null : thinkKey);
                    }}
                    disabled={!reasoning || !settings.showThinking}
                    aria-expanded={thinkOpen}
                  >
                    <GameIcon name="think" size={15} />
                    <span className="lb">
                      {waiting
                        ? `${reasoning && settings.showThinking ? '正在思考' : '正在组织语言…'} ${seconds(elapsed)}`
                        : info?.reasoningMs
                          ? `已思考 ${seconds(info.reasoningMs)}`
                          : // 正文已经在写、秒数要等生成完才有:先写「已思考」,别跳成「思考过程」
                            streaming
                            ? '已思考'
                            : '思考过程'}
                    </span>
                    {reasoning && settings.showThinking && <span className="more">{thinkOpen ? '收起' : '展开'}</span>}
                  </button>
                )}
              </div>
              <div className="ga-rule" aria-hidden="true" />
              <div className="ga-body">
                {/* 外语插件:这句的日语小字在上,中文照常打字在下;带「」时括号挂在左边外面 */}
                {jaVisible && shown?.ja && !waiting && !failedHold && (
                  <p className={`ga-ja${shown.ja.startsWith('「') ? ' say' : ''}`}>{shown.ja}</p>
                )}
                {body !== null && (
                  <p className={`ga-zh${!failedHold && shown?.text.startsWith('「') ? ' say' : ''}`}>
                    {body}
                    {showNextMark && (
                      <span className="ga-mark next" aria-hidden="true">
                        ▼
                      </span>
                    )}
                    {atEnd && (
                      <span className="ga-mark end" aria-hidden="true">
                        ■
                      </span>
                    )}
                  </p>
                )}
                {/* 正在写:线下面一行「正在写 ···」+ 停止,替换台词那一行 */}
                {waiting && (
                  <div className="ga-gen">
                    <span className="t">正在写</span>
                    <span className="dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <button
                      type="button"
                      className="ga-stop"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStop();
                      }}
                    >
                      <GameIcon name="stop" size={15} />
                      <span>停止</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 输入(设计稿 .ga-input):平时画面正中、离底 22px 一行带下划线的淡字;点它 / 轮到你时整条
              (× 收起 + 输入框 + 发送)从 6px 下方淡入浮上来,两头淡出的细线点进去变亮;收起 / 发出去后回到那行字 */}
          <div className="ga-input" inert={covered}>
            <button
              ref={ghostRef}
              type="button"
              className="ga-ghost"
              tabIndex={barOn ? -1 : 0}
              disabled={!canSend}
              onClick={(e) => {
                e.stopPropagation();
                openBar();
              }}
            >
              {ghostText}
            </button>
            <div className={`ga-bar${draft.trim() ? ' has' : ''}`} inert={!barOn} onClick={stop}>
              <button type="button" className="ga-x" onClick={closeBar} title="收起(点下面那行字还能再打开)" aria-label="收起输入框">
                <GameIcon name="close" size={18} />
              </button>
              {inputForm}
            </div>
          </div>
          </div>
        </>
      ) : (
        <div className="vn-window" ref={measureWindow} onWheel={onWheel} inert={covered}>
          <div
            className="vn-box"
            onClick={onBoxClick}
            onContextMenu={onBoxContextMenu}
            onPointerDown={onBoxPointerDown}
            onPointerMove={onBoxPointerMove}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
          >
            {genFail && (
              <ModelError
                fail={genFail}
                said={userSaid(heldEntry ? currentText(heldEntry) : '')}
                sentBefore={Math.max(0, entries.length - 1)}
                theme={paperTheme}
                frostSrc={bgView.src}
                onOpenModels={() => openMenu('model')}
              />
            )}
            {speaker && (
              <div className={`vn-name${shown?.player || failedHold ? ' player' : ''}`}>
                <span className="vn-name-nm">{speaker}</span>
              </div>
            )}
            {genLayer.mounted && (
              <span className={`vn-gen${genLayer.leaving ? ' leaving' : ''}`} title="正在生成">
                <Feather size={14} className="breathe" />
                生成中
              </span>
            )}

            {(waiting || showThinkChip) && (
              <div className={`vn-think${waiting ? ' live' : ''}${thinkOpen ? ' open' : ''}`} onClick={stop}>
                <button
                  className="vn-think-head"
                  onClick={() => setThinkOpenKey(thinkOpen ? null : thinkKey)}
                  disabled={!reasoning || !settings.showThinking}
                  aria-expanded={thinkOpen}
                >
                  <Feather size={16} className={waiting ? 'breathe' : ''} />
                  <span className="vn-think-label">
                    {waiting
                      ? reasoning && settings.showThinking
                        ? '正在思考'
                        : '正在组织语言…'
                      : info?.reasoningMs
                        ? `已思考 ${seconds(info.reasoningMs)}`
                        : streaming
                          ? '已思考'
                          : '思考过程'}
                  </span>
                  {waiting && <span className="vn-think-secs">{seconds(elapsed)}</span>}
                  {waiting && reasoning && !thinkOpen && settings.showThinking && (
                    <span className="vn-think-peek">…{reasoning.slice(-24)}</span>
                  )}
                  {reasoning && settings.showThinking && (
                    <span className="vn-think-more">{thinkOpen ? '收起' : '展开'}</span>
                  )}
                </button>
                {thinkOpen && <div className="vn-think-body">{reasoning}</div>}
              </div>
            )}

            {/* 外语插件:这句的日语小字在上,中文照常打字在下 */}
            {jaVisible && shown?.ja && !waiting && !failedHold && <div className="vn-ja">{shown.ja}</div>}
            {body !== null && <div className={`vn-text${speaker ? '' : ' narration'}`}>{body}</div>}
            {showNextMark && <span className="vn-next" aria-hidden="true">▼</span>}
            {atEnd && <span className="vn-end" aria-hidden="true">■</span>}

            {voice.request && !failedHold && (
              <div className="vn-quick" onClick={stop}>
                <VoiceButtons req={voice.request} onAction={voice.release} className="lead" />
              </div>
            )}
          </div>
          {inputForm}
        </div>
      )}

      {/* 对话框上右键 / 长按:先出小菜单(复制这句 / 这句的详情);整层接住点击,点外面只是关掉、不翻下一句 */}
      {ctxLayer.mounted && lastCtx.current && (
        <div
          className={`vn-ctx-layer${ctxLayer.leaving ? ' leaving' : ''}`}
          inert={covered}
          onClick={() => {
            // 长按出的菜单:松手那一下的 click 落在这一层上,不算「点外面」
            if (pressFired.current) {
              pressFired.current = false;
              return;
            }
            closeCtx();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            closeCtx();
          }}
        >
          <LineMenu
            at={{ x: lastCtx.current.x, y: lastCtx.current.y }}
            bounds={{ w: lastCtx.current.w, h: lastCtx.current.h }}
            theme={paperTheme}
            leaving={ctxLayer.leaving}
            onEdit={canEditLine ? editLine : undefined}
            onCopy={copyLine}
            onInfo={openInspect}
          />
        </div>
      )}

      {/* 「这句的详情」:句检查器,纸卡;整层接住点击,点外面只是关掉、不翻下一句 */}
      {inspLayer.mounted && lastInsp.current && (
        <div
          className={`vn-insp-layer${inspLayer.leaving ? ' leaving' : ''}`}
          inert={covered}
          onClick={closeInspect}
          onContextMenu={(e) => {
            e.preventDefault();
            closeInspect();
          }}
        >
          <div
            className={`vn-insp av-pcard ${popThemeClass(paperTheme)} ${inspLayer.leaving ? 'av-pop-out' : 'av-pop-in'}`}
            role="dialog"
            aria-label="这一句的详情"
            style={{ '--vn-insp-bottom': `${lastInsp.current.bottom}px` } as CSSProperties}
            onClick={stop}
            onContextMenu={stop}
          >
            {inspectorFor(beatIndex, line, voicePlans[line] ?? null, { streaming, onClose: closeInspect })}
          </div>
        </div>
      )}

      {/* 游戏上的小窗口:历史(和菜单的历史页同一份内容)、模型 */}
      {winLayer.mounted && lastWin.current === 'log' && (
        <PopWindow
          title="历史"
          en="Backlog"
          // 标题后面一行小字:她现在的场景 · 日子(设计稿 AV.historyWindow 的「夜路 · 10-18」)
          where={menuCrumb('', chatName, scene.bg?.label).split(' · ').slice(1).join(' · ') || undefined}
          width={900}
          height={640}
          className="vn-pw-hist"
          theme={paperTheme}
          leaving={winLayer.leaving}
          onClose={() => setWin(null)}
          onEsc={() => logEsc.current?.() ?? false}
          right={
            <span className="vn-raw-toggle">
              <Switch sm label="显示原文" checked={rawLog} onChange={setRawLog} />
              显示原文
              <span className="vn-page-note">标签、宏原样露出来</span>
            </span>
          }
        >
          {renderPage('log', {
            ...pageCtx,
            editFirst,
            editDone: () => setWin(null),
            close: () => setWin(null),
            jumpTo: (id: string, at?: number) => {
              jumpTo(id, at);
              setWin(null);
            },
          })}
        </PopWindow>
      )}
      {winLayer.mounted && lastWin.current === 'model' && modelQuick && (
        <PopWindow
          title="模型"
          en="Model"
          where={`${modelQuick.connections.find((c) => c.active)?.name ?? ''} · ${modelQuick.model || '未设模型'}`}
          width={600}
          theme={paperTheme}
          leaving={winLayer.leaving}
          onClose={() => setWin(null)}
        >
          <ModelWindowBody
            q={modelQuick}
            onMore={() => {
              setWin(null);
              openMenu('model');
            }}
          />
        </PopWindow>
      )}

      {menuLayer.mounted && (
        <VNMenu
          page={shownMenu}
          from={shownMenuFrom}
          theme={paperTheme}
          hidden={[...(hasAlbum ? [] : (['album'] as const)), ...(narrow ? PHONE_HIDDEN_PAGES : [])]}
          leaving={menuLayer.leaving}
          onPage={(p) =>
            p !== menu &&
            leavePage(() => {
              setMenu(p);
              setSettingsTab(undefined);
              // 从导航点进插件页:停在默认的第一个插件,不再跳回上次指定的那个
              setPluginFocus(null);
            })
          }
          charName={charName}
          chatName={chatName}
          sceneName={scene.bg?.label ?? null}
          faceSrc={currentCardId ? cardFaceUrl(currentCardId, 96, packId) : null}
          bgSrc={bgView.src}
          bannerSrc={menuBanner}
          headExtra={
            shownMenu === 'log' ? (
              <span className="vn-raw-toggle">
                <Switch sm label="显示原文" checked={rawLog} onChange={setRawLog} />
                显示原文
                <span className="vn-page-note">标签、宏原样露出来</span>
              </span>
            ) : null
          }
          onClose={closeMenu}
          onTitle={() =>
            leavePage(() => {
              setMenu(null);
              setTitleCold(false);
              setTitle(true);
            })
          }
        >
          {shownMenu === 'config' ? (
            <VNSettingsPage
              settings={settings}
              onChange={changeSettings}
              preview={settingsPreview}
              enterKey={enterKey}
              onChangeEnterKey={onChangeEnterKey}
              voiceConfig={voiceConfig}
              onChangeVoiceConfig={onChangeVoiceConfig}
              voiceCastName={
                currentCardId ? (voiceCast.main?.name ?? voiceCast.extras[0]?.name ?? null) : undefined
              }
              onOpenVoice={openVoice}
              showJa={showJa}
              onChangeShowJa={onChangeShowJa}
              jaHide={jaHide}
              initialTab={settingsTab}
              extraTabs={
                illustrationsInstalled
                  ? [
                      // 10-25 转正式版:设置页「进阶」里的这一页不再标 BETA(插件抽屉里那页的 BETA 是另一回事,ui-plugins 那边改)
                      {
                        key: ILLUS_TAB,
                        name: illustrationsInstalled.settingsName,
                        render: illustrationsInstalled.settings,
                      },
                    ]
                  : undefined
              }
              titleMusic={
                currentCardId
                  ? { bgms: bgmsOf(sceneAssets), value: titleBgmId, onChange: onChangeTitleBgm }
                  : null
              }
              onUploadMarks={forms?.uploadMarks}
            />
          ) : shownMenu === 'dev' ? (
            <ConsoleView
              beat={beat}
              beatNumber={beats.slice(0, beatIndex + 1).filter((b) => b.parsed).length}
              beatIndex={beatIndex}
              line={line}
              timeline={timeline}
              sprites={sprites}
              spriteStage={spriteStage}
              spriteLayout={spriteLayout}
              emotion={emotionCtx}
              tagKinds={tagKinds}
              sceneAssets={sceneAssets}
              scene={scene}
              voice={{
                enabled: voiceConfig.enabled,
                fixedEmotion: voiceConfig.fixedEmotion,
                cast: voiceCast,
                plans: voicePlans,
                clips: voice.clips,
                paused: voice.paused,
                lastError: voice.lastError,
                charName,
                streaming,
              }}
              onExit={onExit}
            />
          ) : (
            hostPage(shownMenu)
          )}
        </VNMenu>
      )}

      {title && !firstLoad && (
        <VNTitle
          variant={settings.titleStyle}
          cold={titleCold}
          cardId={currentCardId}
          charName={charName}
          lastPlayed={chatUpdatedAt}
          lastMood={shownLabel}
          sprites={sprites}
          faces={faces}
          home={titleHome}
          cards={cards}
          onContinue={() => setTitle(false)}
          onNewStory={() => {
            if (!currentCardId) return;
            setTitle(false);
            onPickCard(currentCardId, true);
          }}
          onLoad={() => openMenu('save', 'cover')}
          onSettings={() => openMenu('config', 'cover')}
          onExit={onExit}
          onPick={() => setPicking(true)}
          // 菜单盖在封面上时(from=cover):封面别卸,只是被盖住 —— 不接点击
          covered={menuLayer.mounted && shownMenuFrom === 'cover'}
        />
      )}

      {picking && (
        <VNPick
          cards={cards}
          currentCardId={currentCardId}
          lastPlayed={chatUpdatedAt}
          onBack={() => setPicking(false)}
          onContinue={(id) => {
            setPicking(false);
            setTitle(false);
            if (id !== currentCardId) onPickCard(id, false);
          }}
          onImport={onImportCard}
          onExport={onExportCard}
          freshId={freshCardId}
          // 名字下面那行「上次 · 客厅 · …」:当前这位现在停在的场景
          currentScene={titleHome.label}
          // 右边每条素材的「更多」:换成她(不是当前这位的话)再开菜单停在管这一样的页
          onMore={(kind, id) => {
            setPicking(false);
            setTitle(false);
            if (id !== currentCardId) onPickCard(id, false);
            if (kind === 'sprite') openPlugin('sprite');
            else if (kind === 'scene') openPlugin('bg');
            else if (kind === 'voice') openPlugin('voice');
            else openMenu(kind === 'preset' ? 'preset' : 'card');
          }}
          onWantAvatar={onWantAvatar}
        />
      )}

      {/* 刚打开、刚换角色:黑底一直垫到等待页撤下。等待页自己是淡入的,底下没有这层黑,
          淡入的那一下会透出游戏画面 */}
      {firstLoad && <div className="vn-gate blank" />}
      {gateVeil && (
          <VNLoading
            key={currentCardId ?? ''}
            charName={charName}
            scenePackName={scenePackName}
            backdrop={isSettled(bgView.src) ? bgView.src : null}
            // 图还没下完也先给地址:等待页拿它的平均色先铺上
            backdropSrc={bgView.src}
            fraction={gate.fraction}
            slow={gate.slow}
            onSkip={gate.skip}
          />
        )}

      {/* 提示条(纸卡,现在一律白纸):右上那排按钮和历史那一格下面;菜单 / 选角色 / 句检查器开着时挪到底下正中 */}
      {toasts.length > 0 && (
        <ToastStack
          toasts={toasts}
          onRemove={onRemoveToast}
          theme={paperTheme}
          pos={toastAt.pos}
          offset={toastAt.offset}
        />
      )}

      {/* 标题画面开着时不盖黑场:在封面上点头像换人,由封面自己的转场遮 */}
      {veil && !title && (
        <div className="vn-loading" aria-live="polite">
          <span className="vn-loading-hint">正在准备 · 背景 · 立绘 · 对话</span>
          <span className="vn-loading-mark">
            <AnimaLogo size={40} className="drift" />
            NOW LOADING
          </span>
        </div>
      )}
    </div>
  );
}
