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
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import './vn.css';
import './vnSkins.css';
import {
  cardFaceUrl,
  sceneImageUrl,
  spriteImageUrl,
  type PackSprite,
  type SceneAsset,
  type SpeakRequest,
  type SpriteEffect,
  type SpriteLayout,
} from '../lib/api';
import { currentInfo, currentText, type ChatEntry } from '../lib/chatEntry';
import { enterHint, enterShouldSend, type EnterKeyMode } from '../lib/chatSettings';
import { substituteMacros, type MacroContext } from '../lib/macros';
import { useCoarsePointer, useIsMobile } from '../lib/useIsMobile';
import { resolveByLabel } from '../plugins/common';
import { emotionCandidates, isNpcHit, type EmotionContext, type TagMatch } from '../plugins/emotionMatch';
import { SYNC_MAX_WAIT_MS, jevKindsOf, jevMayTag, NO_KINDS, voiceWaitsForJev } from '../plugins/jev';
import { entryView, looseLines } from '../plugins/jevNotes';
import { parseBilingual } from '../plugins/lang';
import { bubbleStyle, facesByCanvas, spriteStyle, type SpriteStage } from '../plugins/spriteLayout';
import { MOTION_FRAMES, normalizeEffect, playFxSound, playTypeSound, preloadSfx, preloadTypeSound, soundFile } from '../plugins/spriteFx';
import { SpriteBubble } from './SpriteBubble';
import {
  applySceneTag,
  backgroundsOf,
  bgmsOf,
  cgFrameFor,
  cgsOf,
  cgVariantsOf,
  initialScene,
  isCgOff,
  titleBgmOf,
  type SceneState,
} from '../plugins/scene';
import {
  EMO_MODE_TEXT,
  planVoiceLines,
  spriteHitsUpTo,
  spriteLabelAfter,
  voiceForSpeaker,
  voiceKey,
  voiceSkipReason,
  type VoiceCast,
  type VoicePluginConfig,
} from '../plugins/voice';
import { bgmPlayer } from './bgm';
import { AnimaLogo } from './AnimaLogo';
import { Feather } from './Feather';
import type { ParsedReply, TagHit, TagKind, VNLine } from './script';
import { vnTagKinds } from './tags';
import { useEmotionMatches } from './useEmotionMatches';
import { useVoiceLine } from './useVoiceLine';
import type { ClipState } from './voice';
import { VoiceButtons } from './VoiceButtons';
import { VoiceDetail } from './VoiceDetail';
import type { PluginFocus, PluginSection } from '../components/PluginsDrawer';
import { VNMenu, type MenuPage } from './VNMenu';
import { VNSettingsPage, type SettingsTab } from './VNSettingsPage';
import { VoiceQuick } from './VoiceQuick';
import { useVNAccent } from './accent';
import { imageRatio, isSettled, loadImage, useAssetGate, useSettledView, type GateItem } from './assetGate';
import { spriteForMood, titleSpriteStyle, type TitleMood } from './titleArt';
import { VNLoading } from './VNLoading';
import { VNTitle, type TitleCard, type TitleScene } from './VNTitle';
import { VNPick } from './VNPick';
import {
  AUTO_SPEEDS,
  loadVNSettings,
  nextAutoSpeed,
  saveVNSettings,
  TYPE_SOUND_OFF,
  type VNSettings,
} from './vnSettings';

/** 卡没绑场景包、或者包里的背景还没传图时用的默认背景 */
// 背景没加载出来 / 这张卡没背景时垫的默认背景(白昼:白到淡紫的渐变 + 星图线,10-04 定稿)
const FALLBACK_BACKGROUND = '/vn/bg/default.svg';

/** 玻璃皮肤的发送 / 停止:和对话框底行一样的小图标,不要大按钮 */
function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path
        d="M2.5 9.2 17 2.6c.5-.2 1 .3.8.8L11.2 17.9c-.2.5-.9.5-1.1 0L8.2 12.4a.6.6 0 0 0-.3-.3L2.5 10.3c-.5-.2-.5-.9 0-1.1Z"
        fill="currentColor"
      />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
      <rect x="4" y="4" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
  );
}

/** 封面一露出来就看得到的表情(待机、纸上那张脸):进封面前必须下好 */
const TITLE_FIRST: TitleMood[] = ['idle', 'ghost'];
/** 悬停菜单、点一下才换的表情:排在「尽量等」的最前面,封面上没下好时先留着旧表情 */
const TITLE_LATER: TitleMood[] = ['continue', 'new', 'load', 'config', 'exit', 'poke'];
/** 进之前必须下好往后几句要用的表情和背景(用户:「封面和前几个对话的素材要准备好」) */
const AHEAD_LINES = 4;

/** 调试台拼好传进来的那几页 */
export type HostPage = Exclude<MenuPage, 'config' | 'dev'>;

export interface PageContext {
  close: () => void;
  /** 跳到某条回复的第一句,并关掉菜单 */
  jumpTo: (entryId: string) => void;
  /** 「在当前位置存档」存到哪条消息为止 */
  currentMessageId: string | null;
  /** 历史页的「显示原文」 */
  raw: boolean;
  /**
   * 历史页里一条 AI 回复的正文:按画面上的句子一句一句列,要念的句子带重播 / 重新生成。
   * 用户消息、还没切出句子的回复给 null(照原样显示)
   */
  lineView: (entry: ChatEntry) => ReactNode | null;
  /** 换到插件页的某个插件(预设里点了插件块、设置里点了「换声音」) */
  openPlugin: (section: PluginSection) => void;
  /** 插件页该停在哪个插件;从导航直接点进来时是 null */
  pluginFocus: PluginFocus | null;
  /** 设置里的「思考过程」:关了历史页也不显示 */
  showThinking: boolean;
}

interface Props {
  entries: ChatEntry[];
  /** 调试台聊天区用的同一份宏取值 —— 开场白里的 {{user}} 两边要展开成同一个人 */
  macros: MacroContext;
  charName: string;
  userName: string;
  sprites: PackSprite[];
  /** 立绘怎么摆:所有角色共用的构图 + 这张卡的微调 */
  spriteStage: SpriteStage;
  spriteLayout: SpriteLayout;
  tagTemplate: string;
  /** 这张卡绑的场景包里的素材(背景 + BGM + CG);没绑时为空 */
  sceneAssets: SceneAsset[];
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
  /** 设置页里改语音开关 / 等不等语音:改的是插件配置,和调试台插件抽屉同一份 */
  onChangeVoiceConfig: (next: VoicePluginConfig) => void;
  /** 外语插件:在中文上方显示这句的日语 */
  showJa: boolean;
  /** 设置页「字幕」改的就是外语插件的「显示日语」(全局一份) */
  onChangeShowJa: (showJa: boolean) => void;
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
  /** 卡片的标签(第一个当作品名),标题画面用 —— 同名、同作品的卡靠它们认 */
  cardTags: string[];
  /** 正在读对话 —— 盖一层加载画面 */
  loading: boolean;
  /** 这张卡的立绘、场景列表都拿到了(切卡后要等一会儿)—— 素材等待页据此知道要等哪些图 */
  assetsReady?: boolean;
  /** 右上角的模型标签 */
  modelLabel: string;
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
  currentCardId: string | null;
  onPickCard: (id: string, fresh: boolean) => void;
}

interface Beat {
  entry: ChatEntry;
  /** 用户消息为 null */
  parsed: ParsedReply | null;
  /** 展开宏之后、切句之前的原文 —— 插话截断按它算位置 */
  raw: string;
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

const reduceMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 逐字显示。key 变了(换了一句)从头打;text 变长(流式还在写)接着打。interval 为 0 整句直接出 */
function useTypewriter(key: string, text: string, interval: number) {
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
    shown: skipped ? text : text.slice(0, n),
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

/** 立绘层:新图淡入、旧图淡出,切表情时不会闪一下空白背景 */
function SpriteLayer({
  view: next,
  charName,
  fx,
  fxVolume,
}: {
  view: SpriteView;
  charName: string;
  fx: SpriteFxCue | null;
  fxVolume: number;
}) {
  // 新表情整张下载完了才换上,没好之前留着旧的 —— 不会看到只画了一半的图
  const view = useSettledView(next);
  const [layers, setLayers] = useState<{ cur: SpriteView; prev: SpriteView | null }>({
    cur: view,
    prev: null,
  });

  useEffect(() => {
    if (view.key !== layers.cur.key) setLayers({ cur: view, prev: layers.cur });
    // 同一张图只是挪了位置(插件页里在调):原地更新,不走淡入淡出
    else if (view !== layers.cur) setLayers((l) => ({ ...l, cur: view }));
  }, [view, layers.cur]);

  // 淡出结束后把旧图摘掉。单独一个 effect:和上面写在一起的话,setLayers 引起的
  // 重跑会先执行清理函数,把这个计时器清掉,旧图就永远留在那儿了
  useEffect(() => {
    if (!layers.prev) return;
    const t = window.setTimeout(() => setLayers((l) => ({ ...l, prev: null })), 320);
    return () => window.clearTimeout(t);
  }, [layers.prev]);

  // 切换特效:等要的那张图换上来再放 —— 动作、气泡和音效一起出
  const [playing, setPlaying] = useState<(SpriteFxCue & { bubbleAt?: CSSProperties }) | null>(null);
  const played = useRef(0);
  const fxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fx || fx.id === played.current || layers.cur.key !== fx.target) return;
    played.current = fx.id;
    setPlaying({ ...fx, bubbleAt: layers.cur.bubble });
    playFxSound(fx.effect.sound, fxVolume);
    // 动作用 Web Animations 直接播:连着两次同一个动作也会重来,图也不用重新挂一遍
    const motion = fx.effect.motion ? MOTION_FRAMES[fx.effect.motion] : undefined;
    if (motion && !reduceMotion) fxRef.current?.animate(motion.frames, motion.timing);
  }, [fx, layers.cur, fxVolume]);
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => setPlaying(null), 1500);
    return () => window.clearTimeout(t);
  }, [playing]);

  const render = (v: SpriteView, cls: string) =>
    v.src ? (
      <img
        key={v.key}
        className={`vn-sprite ${cls}`}
        src={v.src}
        alt={`${charName} · ${v.label}`}
        draggable={false}
        style={v.style}
      />
    ) : (
      <div key={v.key} className={`vn-sprite vn-sprite-ph ${cls}`}>
        <span className="vn-sprite-ph-name">{charName || '角色'}</span>
        <span className="vn-sprite-ph-label">{v.label}</span>
      </div>
    );

  return (
    <div className="vn-sprite-stage" aria-hidden="true">
      {layers.prev && render(layers.prev, 'leaving')}
      {/* 动作套在外面一层:图自己的 transform 管定位,不能被动画盖掉 */}
      <div ref={fxRef} className="vn-sprite-fx">
        {render(layers.cur, 'entering')}
        {playing?.effect.bubble && (
          <SpriteBubble key={playing.id} kind={playing.effect.bubble} style={playing.bubbleAt} />
        )}
      </div>
    </div>
  );
}

/** 背景层:旧图先淡出、新图稍后淡入,中间透出一点黑,像换场景的转场 */
function BackgroundLayer({ view: next }: { view: BgView }) {
  // 同 SpriteLayer:新背景好了才开始转场
  const view = useSettledView(next);
  const [layers, setLayers] = useState<{ cur: BgView; prev: BgView | null }>({
    cur: view,
    prev: null,
  });

  useEffect(() => {
    if (view.key !== layers.cur.key) setLayers({ cur: view, prev: layers.cur });
    // 同一张图只是改了焦点:原地更新,不走转场
    else if (view.focus !== layers.cur.focus) setLayers((l) => ({ ...l, cur: view }));
  }, [view, layers.cur]);

  // 理由同 SpriteLayer:摘旧图的计时器单独一个 effect
  useEffect(() => {
    if (!layers.prev) return;
    const t = window.setTimeout(() => setLayers((l) => ({ ...l, prev: null })), 900);
    return () => window.clearTimeout(t);
  }, [layers.prev]);

  const render = (v: BgView, cls: string) => (
    <img
      key={v.key}
      className={`vn-bg ${cls}`}
      src={v.src}
      alt=""
      draggable={false}
      style={{ objectPosition: `${v.focus}% 50%` }}
    />
  );

  return (
    <>
      {layers.prev && render(layers.prev, 'leaving')}
      {render(layers.cur, layers.prev ? 'entering' : '')}
    </>
  );
}

/** CG 层:盖在背景和立绘上面。同一张 CG 换差分(表情)快速交叉淡入,出现、收起、换 CG 慢一点 */
function CgLayer({ view: next }: { view: CgView }) {
  // 同 SpriteLayer:新图下载完了才换
  const view = useSettledView(next);
  // panFrom:这张 CG(构图)出现的时刻。竖长的从顶上开始移,换差分时接着移
  const [layers, setLayers] = useState<{ cur: CgView; prev: CgView | null; slow: boolean; panFrom: number }>(
    () => ({ cur: view, prev: null, slow: false, panFrom: Date.now() }),
  );

  useEffect(() => {
    if (view.key !== layers.cur.key) {
      const other = view.group !== layers.cur.group;
      setLayers({ cur: view, prev: layers.cur, slow: other, panFrom: other ? Date.now() : layers.panFrom });
    } else if (view.focus !== layers.cur.focus) setLayers((l) => ({ ...l, cur: view }));
  }, [view, layers.cur, layers.panFrom]);

  // 理由同 SpriteLayer:摘旧图的计时器单独一个 effect
  useEffect(() => {
    if (!layers.prev) return;
    const t = window.setTimeout(() => setLayers((l) => ({ ...l, prev: null })), layers.slow ? 750 : 320);
    return () => window.clearTimeout(t);
  }, [layers.prev, layers.slow]);

  const render = (v: CgView, cls: string) =>
    v.src ? <CgImage key={v.key} view={v} cls={cls} panFrom={layers.panFrom} /> : null;

  return (
    <div className={`vn-cg-stage${layers.slow ? ' slow' : ''}`} aria-hidden="true">
      {layers.prev && render(layers.prev, 'leaving')}
      {render(layers.cur, layers.prev ? 'entering' : '')}
    </div>
  );
}

/** 竖长 CG 从上移到下(再移回来)一趟几秒 */
const CG_PAN_MS = 20000;

/**
 * CG 层里的一张图。竖长的(高比宽大,原作里要卷动着看的全身图)上下来回慢慢移:
 * 从这张 CG 出现的时刻(panFrom)算起,所以一出现是从顶上开始;换差分时新图接着同一个位置移
 */
function CgImage({ view, cls, panFrom }: { view: CgView; cls: string; panFrom: number }) {
  const tall = view.src !== null && (imageRatio(view.src) ?? 0) > 1;
  // 挂上时定一次:之后 panFrom 变了(换成别的 CG)这张也快摘了,不用跟着改
  const [delay] = useState(() => `${-((Date.now() - panFrom) % (CG_PAN_MS * 2))}ms`);
  const style: CSSProperties = tall
    ? ({ '--cg-pan-delay': delay, '--cg-pan-ms': `${CG_PAN_MS}ms` } as CSSProperties)
    : { objectPosition: `${view.focus}% 50%` };
  return (
    <img
      className={`vn-cg ${cls}${tall ? ' tall' : ''}`}
      src={view.src ?? undefined}
      alt=""
      draggable={false}
      style={style}
    />
  );
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;

/** 选项上不要台词外层的引号 */
const unquote = (s: string) => s.replace(/^\s*[「『“"]/, '').replace(/[」』”"]\s*$/, '');

/**
 * 当时玩家发的话弹成选项时的样子:「——」开头的行是写给模型的提示(——场景切换为逛街),
 * 不放进去;整行是一句带引号的台词就去掉引号;空行收掉。剩下是空的就不弹
 */
const playerSaid = (raw: string) =>
  raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('——'))
    .map((l) => (/^[「『“”"].*[」』“”"]$/.test(l) ? l.slice(1, -1) : l))
    .join('\n');

export function VNScreen({
  entries,
  macros,
  charName,
  userName,
  sprites,
  spriteStage,
  spriteLayout,
  tagTemplate,
  sceneAssets,
  titleBgmId,
  onChangeTitleBgm,
  bgTemplate,
  bgmTemplate,
  cgTemplate,
  voiceConfig,
  voiceCast,
  onChangeVoiceConfig,
  showJa,
  onChangeShowJa,
  jevSync,
  enterKey,
  onChangeEnterKey,
  sending,
  canSend,
  notReadyHint,
  chatKey,
  chatName,
  chatUpdatedAt,
  cardTags,
  loading,
  assetsReady = true,
  modelLabel,
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
  currentCardId,
  onPickCard,
}: Props) {
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
  // 流式时每来一个字 entries 就变一次;没变的条目直接用缓存,只重切正在写的那条
  const cacheRef = useRef(
    new Map<
      string,
      { raw: string; judged: readonly number[] | null; cfg: string; parsed: ParsedReply }
    >(),
  );
  const beats: Beat[] = useMemo(() => {
    const cfg = [charName, userName, tagTemplate, bgTemplate, bgmTemplate, cgTemplate].join('\u0000');
    const cache = cacheRef.current;
    return entries.map((entry) => {
      if (entry.role === 'user') return { entry, parsed: null, raw: currentText(entry) };
      // 原文 + Jev 另外存的标注(plugins/jevNotes.ts)
      const view = entryView(entry, tagKinds);
      const raw = substituteMacros(view.text, macros, {
        seed: `${entry.id}:${entry.swipeIndex}`,
      });
      const key = `${entry.id}:${entry.swipeIndex}:${entry.streaming ? 1 : 0}`;
      const hit = cache.get(key);
      if (hit && hit.raw === raw && hit.judged === view.judged && hit.cfg === cfg) {
        return { entry, parsed: hit.parsed, raw };
      }
      // 外语插件:日中交替写的回复,日语挂到它下面那句中文上;没有日语的和原来一样
      const opts = { charName, userName, tags: tagKinds, streaming: Boolean(entry.streaming) };
      // 立绘是 Jev 标的分支按严格规则认说话人;Jev 没判过的句子(还在判、原文改过)照切句的认法。
      // 哪几句没判过按合并后的原文算(宏展开前):切句的边界不看说话人,先切一遍拿句尾
      const strict = view.kinds.includes('sprite');
      let parsed = parseBilingual(raw, { ...opts, strict });
      if (strict) {
        const ends = raw === view.text ? parsed.ends : parseBilingual(view.text, opts).ends;
        const loose = looseLines(view, ends);
        if (loose.size > 0) parsed = parseBilingual(raw, { ...opts, strict, loose });
      }
      cache.set(key, { raw, judged: view.judged, cfg, parsed });
      return { entry, parsed, raw };
    });
  }, [entries, macros, charName, userName, tagTemplate, bgTemplate, bgmTemplate, cgTemplate, tagKinds]);

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
  const lines = beat?.parsed?.lines ?? [];
  line = Math.max(0, Math.min(line, lines.length - 1));
  const streaming = Boolean(beat?.entry.streaming);
  const current: VNLine | null = lines[line] ?? null;
  // 流式时最后一句还在写,没写完不能往下翻
  const lineComplete = !streaming || line < lines.length - 1;
  const hasNext = line < lines.length - 1;
  const onLatest = beatIndex === lastAssistantIndex && beatIndex >= 0;

  const typeKey = beat ? `${beat.entry.id}:${beat.entry.swipeIndex}:${line}` : 'none';

  // 玩家台词插件:翻到玩家的台词先弹成选项,选中了(记下这句的 typeKey)才打进对话框
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const choosing = Boolean(current?.player) && pickedKey !== typeKey;

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

  // 到当前这句为止已经生效的标签,按出现顺序。当前这条只算到正在播的这句为止;
  // 写在末尾的(-1)要等下一条回复才生效
  const hitsSoFar: TagHit[] = useMemo(() => {
    const out: TagHit[] = [];
    for (let i = 0; i <= beatIndex; i++) {
      const p = beats[i].parsed;
      if (!p) continue;
      for (const h of p.hits) {
        if (i === beatIndex && (h.lineIndex === -1 || h.lineIndex > line)) continue;
        out.push(h);
      }
    }
    return out;
  }, [beats, beatIndex, line]);

  // ---- 立绘标签 → 表情:先精确匹配,对不上的问后端模型 ----

  const candidates = useMemo(() => emotionCandidates(sprites), [sprites]);
  const spriteLabels = useMemo(
    () =>
      beats
        .flatMap((b) => b.parsed?.hits ?? [])
        .filter((h) => h.kind === 'sprite' && !isNpcHit(h, charName))
        .map((h) => h.label),
    [beats, charName],
  );
  const resolveTag = useEmotionMatches(spriteLabels, candidates);
  const emotionCtx: EmotionContext = useMemo(
    () => ({ resolve: resolveTag, rawOnFail: sprites.length === 0, charName }),
    [resolveTag, sprites.length, charName],
  );

  const faces = useMemo(() => facesByCanvas(sprites), [sprites]);
  // 加载页左边站的她:默认表情,按脸摆在左半边
  const loadingSprite = useMemo(() => {
    const s = spriteForMood(sprites, 'idle') ?? sprites[0] ?? null;
    const src = s ? spriteImageUrl(s) : null;
    if (!s || !src) return null;
    return {
      src,
      style: titleSpriteStyle(faces.get(s.id) ?? null, s.face_scan?.height ?? null, { faceSize: 0.2, faceTop: 0.12, cx: 0.32 }, 0),
    };
  }, [sprites, faces]);
  // 对不上、还在问模型的标签不切图,保持上一张 —— 控制台里会写原因。
  // 先算出表情名再算 view:流式时每来一段字 hitsSoFar 都是新数组,view 要是跟着变成新对象,
  // 立绘层的 effect 每次都会改一次状态,一条长回复写下来就撞上 React 的「更新太深」(2026-10-01)
  const spriteLabel = useMemo(
    () => spriteLabelAfter(hitsSoFar, emotionCtx, sprites[0]?.label ?? null),
    [hitsSoFar, emotionCtx, sprites],
  );

  const spriteView: SpriteView = useMemo(() => {
    const label = spriteLabel;
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
  }, [spriteLabel, sprites, faces, spriteLayout, spriteStage]);

  const scene: SceneState = useMemo(() => {
    let state = initialScene(sceneAssets);
    for (const h of hitsSoFar) state = applySceneTag(state, h, sceneAssets);
    return state;
  }, [hitsSoFar, sceneAssets]);

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
  const cgFrame = useMemo(
    () => (scene.cg ? cgFrameFor(scene.cg, sceneAssets, spriteLabel) : null),
    [scene.cg, sceneAssets, spriteLabel],
  );
  const cgUrl = cgFrame ? sceneImageUrl(cgFrame) : null;
  const cgKey = cgFrame && cgUrl ? `${cgFrame.id}:${cgFrame.file_version}` : null;
  const cgGroup = scene.cg?.id ?? null;
  const cgFocus = scene.cg?.focus_x ?? 50;
  const cgView: CgView = useMemo(
    () => (cgKey && cgUrl ? { key: cgKey, src: cgUrl, group: cgGroup, focus: cgFocus } : NO_CG),
    [cgKey, cgUrl, cgGroup, cgFocus],
  );

  // ---- 标题画面:最后一句、上次停下的地方、场景包里的背景 ----

  // 最新一条回复里她说的最后一句;她没开口就用别人说的最后一句
  const lastLine = useMemo(() => {
    const said = (lastAssistantIndex >= 0 ? beats[lastAssistantIndex].parsed?.lines : null) ?? [];
    const pick = (ok: (l: VNLine) => boolean) => {
      for (let i = said.length - 1; i >= 0; i--) if (!said[i].player && said[i].text.trim() && ok(said[i])) return said[i];
      return null;
    };
    const l = pick((x) => x.speaker === charName) ?? pick((x) => Boolean(x.speaker));
    return l ? unquote(l.text.trim()) : null;
  }, [beats, lastAssistantIndex, charName]);
  const titleHome: TitleScene = { key: bgView.key, src: bgView.src, focus: bgView.focus, label: scene.bg?.label ?? '' };
  const titleScenes: TitleScene[] = useMemo(
    () =>
      backgroundsOf(sceneAssets).flatMap((a) => {
        const src = sceneImageUrl(a);
        return src ? [{ key: `${a.id}:${a.file_version}`, src, focus: a.focus_x, label: a.label }] : [];
      }),
    [sceneAssets],
  );

  // ---- 音乐 ----

  // 标题画面开着时放封面音乐(场景包里设的那首,没设就是排第一的),「继续」后换回场景的
  const [title, setTitle] = useState(settings.titleScreen);
  // 选角色界面(纸面 / 明亮封面的「角色」进来)
  const [picking, setPicking] = useState(false);
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
    // 往后 AHEAD_LINES 句点到的表情和背景:这条回复剩的不够,接着算下一条回复的开头。
    // 更远的不等(开场白里常常换七八种表情,一张就上 MB),排在「尽量等」里
    const left = Math.max(0, lines.length - 1 - line);
    const ahead = [
      ...(beat?.parsed?.hits.filter(
        (h) => (h.lineIndex > line && h.lineIndex <= line + AHEAD_LINES) || (h.lineIndex === -1 && left < AHEAD_LINES),
      ) ?? []),
      ...(left < AHEAD_LINES
        ? (between.next?.parsed?.hits.filter((h) => h.lineIndex >= 0 && h.lineIndex < AHEAD_LINES - left) ?? [])
        : []),
    ];
    for (const h of ahead) {
      if (h.kind === 'sprite' && !isNpcHit(h, charName)) {
        const label = spriteLabelAfter([h], emotionCtx, null);
        add(must, spriteSrc(sprites.find((s) => s.label === label)), '立绘');
      } else if (h.kind === 'bg') {
        const bg = resolveByLabel(h.label, backgroundsOf(sceneAssets));
        add(must, bg ? sceneImageUrl(bg) : null, '背景');
      } else if (h.kind === 'cg') {
        // 只等构图本身那张;差分跟着表情换,在「尽量等」里
        const cg = resolveByLabel(h.label, cgsOf(sceneAssets));
        add(must, cg ? sceneImageUrl(cgFrameFor(cg, sceneAssets, null)) : null, 'CG');
        for (const v of cg ? cgVariantsOf(sceneAssets, cg.id) : []) add(nice, sceneImageUrl(v), 'CG');
      }
    }
    // 封面第一眼就看得到的表情;悬停、点一下才换的排在「尽量等」最前面
    if (title) {
      for (const mood of TITLE_FIRST) add(must, spriteSrc(spriteForMood(sprites, mood)), '立绘');
      for (const mood of TITLE_LATER) add(nice, spriteSrc(spriteForMood(sprites, mood)), '立绘');
    }
    // 其余的:这个包的全部表情、场景包里的全部背景
    for (const s of sprites) add(nice, spriteSrc(s), '立绘');
    for (const a of backgroundsOf(sceneAssets)) add(nice, sceneImageUrl(a), '背景');
    return { must: [...must.values()], nice: [...nice.values()] };
  }, [bgView.src, spriteView.src, cgView.src, beat, line, lines.length, between.next, charName, emotionCtx, sprites, sceneAssets, title, cards, currentCardId, packId]);
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

  const playing = title ? titleBgm : scene.bgm;
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
        const cg = resolveByLabel(h.label, cgsOf(sceneAssets));
        for (const a of cg ? [cg, ...cgVariantsOf(sceneAssets, cg.id)] : []) {
          const url = sceneImageUrl(a);
          if (url) void loadImage(url);
        }
      }
    }
  }, [upcoming, sceneAssets]);

  // 立绘预加载在上面的等待页里:眼下要用的先下,其余的排在后面
  // ---- 界面状态 ----

  const [menu, setMenu] = useState<MenuPage | null>(null);
  // 菜单上次停在哪一页,Esc 再打开时回到那儿
  const [lastPage, setLastPage] = useState<MenuPage>('log');
  // 设置页这次打开停在哪一栏(语音面板点「完整语音设置」= 声音);菜单关了就忘掉
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  useEffect(() => {
    if (!menu) setSettingsTab(undefined);
  }, [menu]);
  const [rawLog, setRawLog] = useState(false);
  // 历史页:鼠标移上去(手机上点一下)的那句露出「回到这里」「语音详情」;展开了详情的那句
  const [pickedLine, setPickedLine] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [pluginFocus, setPluginFocus] = useState<PluginFocus | null>(null);
  const [uiHidden, setUiHidden] = useState(false);
  const [draft, setDraft] = useState('');
  const [auto, setAuto] = useState(false);
  // 玻璃皮肤:读到最后一句先只亮右下角的小方块,玩家再点一下才弹出正中的输入条(记下是在哪一句点的)
  const [turnAt, setTurnAt] = useState<string | null>(null);
  // 输入条左边的 ×:收起来不挡画面(还能在对话框最下面那行打字;再点一下对话框又弹出来)
  const [turnClosed, setTurnClosed] = useState<string | null>(null);
  const [skip, setSkip] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const skipping = skip || ctrlHeld;
  const veil = useLoadingVeil(loading);
  const accent = useVNAccent(settings.accent, sprites);

  // ---- 语音:说话人对得上声音的台词才念,情绪跟着这句生效的立绘表情 ----

  // 这条回复第一句之前生效的表情(和立绘层同一套累计算法)
  const emotionBefore = useMemo(() => {
    const prior: TagHit[] = [];
    for (let i = 0; i < beatIndex; i++) prior.push(...(beats[i].parsed?.hits ?? []));
    return spriteLabelAfter(prior, emotionCtx, sprites[0]?.label ?? null);
  }, [beats, beatIndex, sprites, emotionCtx]);
  // 切好的句子是按条目缓存的,流式时只有正在写的那条会变
  const beatParsed = beat?.parsed;
  // 谁说的 / 什么表情由 Jev 判时,还在判的句子先不念(只有背景、音乐是 Jev 时不用等)
  const beatJevKinds = beat ? jevKindsOf(beat.entry) : NO_KINDS;
  const jevPendingFrom = voiceWaitsForJev(beatJevKinds) ? beat?.entry.jevPending : undefined;
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
      }),
    [beatParsed, emotionBefore, emotionCtx, voiceCast, streaming, voiceConfig.fixedEmotion, jevPendingFrom],
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

  // 念台词时 BGM 压到多少,跟着设置走
  useEffect(() => {
    bgmPlayer.setDuckLevel(settings.duckLevel);
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

  // 等语音、等 Jev 时先不打字:好了文字和声音 / 画面一起出。玩家台词还没选的时候也不打
  const typer = useTypewriter(
    typeKey,
    voice.gated || jevGated || choosing ? '' : (current?.text ?? ''),
    // 自动播放开着倍速时打字也跟着快
    auto ? settings.textSpeed / settings.autoSpeed : settings.textSpeed,
  );
  const typedDone = typer.done && !voice.gated && !jevGated && !choosing;

  // ---- 立绘切换特效:往下读到这句、表情真的换了,而且换上的立绘设了特效 ----

  const [fxCue, setFxCue] = useState<(SpriteFxCue & { typeKey: string }) | null>(null);
  const fxSeq = useRef(0);
  const arrived = useRef({ key: typeKey, forward: false });
  const prevLabel = useRef(spriteLabel);
  useEffect(() => {
    if (arrived.current.key !== typeKey) {
      arrived.current = { key: typeKey, forward: forwardRef.current };
      forwardRef.current = false;
    }
    const changed = prevLabel.current !== spriteLabel;
    prevLabel.current = spriteLabel;
    // 同一句里表情后来才定下来(问模型、Jev 判完)也算:只要这句是往下读到的
    if (!changed || !arrived.current.forward || !settings.spriteFx || skipping || title) return;
    const effect = normalizeEffect(sprites.find((sp) => sp.label === spriteLabel)?.effect);
    if (effect) setFxCue({ id: ++fxSeq.current, target: spriteView.key, effect, typeKey });
  }, [typeKey, spriteLabel, settings.spriteFx, skipping, title, sprites, spriteView.key]);
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

  const logOpen = menu === 'log';
  const backlog = useMemo(() => {
    const out = new Map<
      string,
      {
        lines: VNLine[];
        plans: (SpeakRequest | null)[];
        hits: TagHit[];
        /** 这条回复第一句之前生效的表情 —— 语音详情要看 */
        before: string | null;
        streaming: boolean;
      }
    >();
    if (!logOpen) return out;
    // 和 emotionBefore 同一套累计:每条回复开头的表情 = 之前所有立绘标签依次生效的结果
    let label: string | null = sprites[0]?.label ?? null;
    for (const b of beats) {
      const p = b.parsed;
      if (!p) continue;
      const streaming = Boolean(b.entry.streaming);
      const plans = voiceConfig.enabled
        ? planVoiceLines({
            lines: p.lines,
            hits: p.hits,
            emotionBefore: label,
            ctx: emotionCtx,
            cast: voiceCast,
            streaming,
            fixedEmotion: voiceConfig.fixedEmotion,
            jevPendingFrom: voiceWaitsForJev(jevKindsOf(b.entry)) ? b.entry.jevPending : undefined,
          })
        : [];
      out.set(b.entry.id, { lines: p.lines, plans, hits: p.hits, before: label, streaming });
      label = spriteLabelAfter(p.hits, emotionCtx, label);
    }
    return out;
  }, [logOpen, beats, sprites, emotionCtx, voiceCast, voiceConfig.enabled, voiceConfig.fixedEmotion]);

  const lineView = (entry: ChatEntry): ReactNode | null => {
    const b = backlog.get(entry.id);
    if (!b || b.lines.length === 0) return null;
    const here = beat?.entry.id === entry.id;
    return (
      <div className="vn-log-lines">
        {b.lines.map((ln, i) => {
          const plan = b.plans[i] ?? null;
          const key = `${entry.id}:${i}`;
          const open = detailKey === key;
          const picked = pickedLine === key;
          // 鼠标移上去露出操作;没有悬停的手机上点一下这句露出来,再点收起
          const pick = () => setPickedLine(picked ? null : key);
          return (
            <Fragment key={i}>
              <div
                className={`vn-log-line${ln.speaker ? '' : ' narration'}${ln.player ? ' player' : ''}${here && i === line ? ' current' : ''}${picked ? ' picked' : ''}${open ? ' open' : ''}`}
                tabIndex={0}
                onClick={pick}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                  e.preventDefault();
                  pick();
                }}
              >
                <span className="vn-log-text">
                  {showJa && ln.ja && <span className="vn-log-ja">{ln.ja}</span>}
                  {ln.speaker && <span className="vn-log-speaker">{ln.speaker}</span>}
                  {ln.text}
                </span>
                {plan && <VoiceButtons req={plan} />}
                {/* 操作浮在这句右上角,不挤正文 */}
                <span className="vn-log-acts" onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => jumpTo(entry.id, i)} title="从这一句接着看(重玩)">
                    回到这里
                  </button>
                  <button
                    type="button"
                    className={open ? 'on' : ''}
                    aria-expanded={open}
                    onClick={() => setDetailKey(open ? null : key)}
                    title="这句的情绪、参考音频、发给语音服务的请求 —— 排查语音用"
                  >
                    语音详情
                  </button>
                </span>
              </div>
              {open && (
                <VoiceDetail
                  line={ln}
                  index={i}
                  hits={b.hits}
                  emotionBefore={b.before}
                  plan={plan}
                  profile={ln.player ? null : voiceForSpeaker(ln.speaker, charName, voiceCast)}
                  ctx={emotionCtx}
                  voiceEnabled={voiceConfig.enabled}
                  fixedEmotion={voiceConfig.fixedEmotion}
                  streamingLast={b.streaming && i === b.lines.length - 1}
                  jev={jevKindsOf(entry).includes('sprite')}
                  jevPending={entry.jevPending !== undefined && i >= entry.jevPending}
                  onJump={() => jumpTo(entry.id, i)}
                />
              )}
            </Fragment>
          );
        })}
      </div>
    );
  };

  const openMenu = (page?: MenuPage) => {
    const p = page ?? lastPage;
    setMenu(p);
    setLastPage(p);
    setAuto(false);
    setSkip(false);
  };
  const closeMenu = () => setMenu(null);
  const openPlugin = (section: PluginSection) => {
    setPluginFocus({ section, nonce: Date.now() });
    setMenu('plugin');
    setLastPage('plugin');
  };

  const advance = () => {
    if (uiHidden) {
      setUiHidden(false);
      return;
    }
    if (!beat || !current) return;
    // 当时玩家发的话:点哪里都算选中,接着弹下一句,或者去下一条回复
    if (userChoice !== null && userStep) {
      if (userStep.i + 1 < between.said.length) setUserStep({ key: typeKey, i: userStep.i + 1 });
      else continueToNext();
      return;
    }
    // 选项:点哪里都算选中;流式时这句还没写完不能选
    if (choosing) {
      if (lineComplete) setPickedKey(typeKey);
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

  const busyOverlay = title || menu !== null;

  // 自动播放:一句打完停一会儿翻下一句;流式时等下一句写完再翻。
  // 设置里开着「等语音」时,这句的语音还在合成或正在念就先不翻(合成失败了照常翻)。
  // 玩家台词的选项:这句写完了就停一会儿自动选掉。
  // 翻回历史时一条回复读完接着往下:当时玩家发的话也一样停一会儿选掉
  const voiceHolds = settings.autoWaitVoice && (voice.speaking || voice.synthesizing);
  // 依赖里只放「有没有这句」:流式时每来一个字都会重新切句,current 每次都是新对象,
  // 放它进去计时器会被一直重置,要等生成完才翻得动
  const hasCurrent = current !== null;
  useEffect(() => {
    if (!auto || busyOverlay || uiHidden || skipping || !hasCurrent || !lineComplete) return;
    const ready =
      userChoice !== null || choosing || (typedDone && !voiceHolds && (hasNext || canContinue));
    if (!ready) return;
    const t = window.setTimeout(() => advanceRef.current(), settings.autoDelay / settings.autoSpeed);
    return () => window.clearTimeout(t);
  }, [auto, busyOverlay, uiHidden, skipping, hasCurrent, userChoice, userStep, choosing, typedDone, voiceHolds, hasNext, canContinue, lineComplete, settings.autoDelay, settings.autoSpeed, typeKey]);

  // 跳过:连打带翻(选项直接选掉),翻到最新那条回复的最后一句自己停 —— 翻回历史时读过的
  // 一路跳过去。依赖里要有 choosing:选完这句文字从头打,typedDone 没变,不重跑就停在这儿了
  useEffect(() => {
    if (!skipping || busyOverlay || !hasCurrent) return;
    if (choosing && !lineComplete) return;
    const more = (hasNext && lineComplete) || canContinue || userChoice !== null;
    if (typedDone && !more) {
      if (!streaming && skip) setSkip(false);
      return;
    }
    const t = window.setTimeout(() => advanceRef.current(), 60);
    return () => window.clearTimeout(t);
  }, [skipping, skip, busyOverlay, hasCurrent, choosing, userChoice, userStep, canContinue, typedDone, hasNext, lineComplete, streaming, typeKey]);

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
        if (title || e.isComposing) return;
        if (menu) {
          // 菜单里的输入框:Esc 先只是退出输入框,再按一次才关菜单
          if (isTextField(e.target)) (e.target as HTMLElement).blur();
          else setMenu(null);
        } else if (veiled) return;
        else if (uiHidden) setUiHidden(false);
        else if (!isTextField(e.target)) {
          setMenu(lastPage);
          setAuto(false);
          setSkip(false);
        }
        return;
      }
      if (isField(e.target) || busyOverlay || veiled) return;
      // 带修饰键的是浏览器 / 系统快捷键(Alt+→ 前进、Ctrl+A 全选),不归游戏管
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        bgmPlayer.unlock();
        advanceRef.current();
      } else if ((e.key === 'a' || e.key === 'A') && !e.repeat) {
        setAuto((a) => !a);
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
  }, [busyOverlay, veiled, title, menu, uiHidden, lastPage]);

  // 滚轮往上 = 看历史;右键 = 隐藏界面(galgame 玩家的习惯)
  const onWheel = (e: React.WheelEvent) => {
    if (busyOverlay || veiled || e.deltaY > -8) return;
    // 思考过程、输入框自己能滚:还没滚到顶就是在滚它们,不是要看历史
    if (scrollsUp(e.target, e.currentTarget)) return;
    openMenu('log');
  };
  const onContextMenu = (e: React.MouseEvent) => {
    // 输入框里右键 / 长按是要粘贴、选字,不是隐藏界面
    if (isField(e.target)) return;
    e.preventDefault();
    setUiHidden((h) => !h);
  };

  // ---- 输入:一直在,随时插话 ----

  const send = () => {
    const text = draft.trim();
    if (!text || !canSend) return;
    setDraft('');
    bgmPlayer.unlock();
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
    el.style.height = `${Math.min(el.scrollHeight + 2, 132)}px`;
  }, [draft]);

  /**
   * 跳到某条回复的某一句,关掉菜单。立绘、背景、音乐都是按光标累计的,跟着回到那一句的样子;
   * 选过的玩家台词也忘掉,重玩时再弹一次选项
   */
  const jumpTo = (entryId: string, at = 0) => {
    const b = beats.find((x) => x.entry.id === entryId && x.parsed);
    if (b) setCursor({ id: b.entry.id, swipe: b.entry.swipeIndex, line: at });
    setPickedKey(null);
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
  const showThinkChip = !waiting && line === 0 && Boolean(reasoning) && settings.showThinking;

  // ---- 渲染 ----

  // 选项弹着的时候,对话框里留着上一句(整句,不打字);这条回复第一句就是玩家台词时留空
  const shown: VNLine | null = choosing ? (lines[line - 1] ?? null) : current;
  let speaker: string | null = shown?.speaker ?? null;
  let body: ReactNode;
  if (waiting) {
    speaker = charName;
    body = null;
  } else if (choosing) {
    body = shown ? shown.text : null;
  } else if (current) {
    body = (
      <>
        {typer.shown}
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
    Boolean(current) && typedDone && userChoice === null && ((hasNext && lineComplete) || canContinue);
  const atEnd = Boolean(current) && typedDone && !hasNext && !streaming && !canContinue;
  const lastEntry = entries[entries.length - 1];
  const currentMessageId = onLatest ? (lastEntry?.id ?? null) : (beat?.entry.id ?? null);

  const hostPage = (page: HostPage) =>
    renderPage(page, {
      close: closeMenu,
      jumpTo,
      currentMessageId,
      raw: rawLog,
      lineView,
      openPlugin,
      pluginFocus,
      showThinking: settings.showThinking,
    });

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  // ---- 外观:对话框皮肤(设置 → 外观)----
  const glass = settings.boxSkin !== 'classic';
  // 轮到你说话:她说完了(最新一条回复读到底、不在生成)、或者还没有对话;玻璃皮肤下正中弹输入条
  const myTurn =
    glass &&
    canSend &&
    !sending &&
    !menu &&
    !title &&
    userChoice === null &&
    !choosing &&
    turnClosed !== typeKey &&
    ((atEnd && (turnAt === typeKey || auto)) || (!current && entries.length === 0));
  // 回看历史、停在当时玩家说的话上:下面也放一条输入条,鼓励从这里接着说(会分出新的故事线)
  const pastInput = glass && userChoice !== null && canSend && !sending && !menu && !title;
  const quickButtons = (
    <>
      <button onClick={() => openMenu('log')}>历史</button>
      <button className="wide-only" onClick={() => openMenu('save')}>存档</button>
      <button className={auto ? 'on' : ''} onClick={() => setAuto((a) => !a)} aria-pressed={auto}>
        自动
      </button>
      {auto && (
        <button
          className="vn-auto-speed on"
          onClick={() => changeSettings({ ...settings, autoSpeed: nextAutoSpeed(settings.autoSpeed) })}
          title="自动播放倍速:点一下换挡"
        >
          {AUTO_SPEEDS.find((a) => a.value === settings.autoSpeed)?.name}
        </button>
      )}
      <button className={skip ? 'on' : ''} onClick={() => setSkip((s) => !s)} aria-pressed={skip}>
        跳过
      </button>
      <button
        onClick={onRegenerate}
        disabled={sending || entries.length === 0 || !canSend}
        title="重新生成最后一条回复"
      >
        重来
      </button>
      <button onClick={() => setUiHidden(true)} title="隐藏界面,只看立绘和背景(右键也行)">
        隐藏
      </button>
      <button className="wide-only" onClick={() => openMenu('config')}>设置</button>
      <button onClick={() => openMenu()}>菜单</button>
    </>
  );
  const inputForm = (
      <form className="vn-input" onSubmit={submit}>
        <textarea
          ref={inputRef}
          // 轮到你时输入条弹到正中:直接把光标放进去(手机上不弹软键盘)
          autoFocus={glass && myTurn && !softKeyboard}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            canSend
              ? glass && myTurn
                ? '说点什么'
                : !onLatest && beat
                ? '在这里开口,会从这里分出一条新的故事线…'
                : sending
                  ? '随时插话…'
                  : glass
                    ? '说点什么 · 随时可以插话'
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
              bgmPlayer.unlock();
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
          <button type="button" className="vn-send stop" onClick={onStop} title="停止" aria-label="停止">
            {glass ? <StopIcon /> : '停止'}
          </button>
        ) : (
          <button type="submit" className="vn-send" disabled={!canSend || !draft.trim()} title="发送" aria-label="发送">
            {glass ? <SendIcon /> : '发送'}
          </button>
        )}
      </form>
  );

  return (
    <div
      className={`vn-root${uiHidden ? ' ui-hidden' : ''}${menu ? ' menu-open' : ''}${myTurn ? ' my-turn' : ''}`}
      data-skin={settings.boxSkin}
      data-font={settings.textFont}
      style={
        {
          '--vn-box-alpha': settings.boxOpacity,
          '--vn-text-scale': settings.textScale,
          '--vn-accent': accent.accent,
          '--vn-accent-ink': accent.ink,
          '--vn-accent-rgb': accent.rgb,
        } as React.CSSProperties
      }
      // 浏览器要用户点过才让网页出声;界面里任何一次点击都顺手解锁一下
      onPointerDown={() => bgmPlayer.unlock()}
    >
      <div
        className={`vn-stage${cgView.src ? ' cg-on' : ''}`}
        inert={covered}
        onClick={advance}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
      >
        <BackgroundLayer view={bgView} />
        <SpriteLayer view={spriteView} charName={charName} fx={spriteFx} fxVolume={settings.spriteFxVolume} />
        <CgLayer view={cgView} />
      </div>

      {/* 翻回历史往下看:当时玩家发的话弹成选项,点哪里都接着往下 */}
      {userChoice !== null && (
        <div className={`vn-choice-layer${pastInput ? ' with-input' : ''}`} inert={covered}>
          <button className="vn-choice past" onClick={advance}>
            <span className="vn-choice-cap">{glass ? '历史回复' : '当时的回复'}</span>
            <span className="vn-choice-text">{userChoice}</span>
          </button>
          {pastInput && (
            <div className="vn-turn-bar vn-past-bar" onClick={stop}>
              {inputForm}
            </div>
          )}
        </div>
      )}

      {/* 玩家台词插件:翻到玩家的台词先弹成选项,点哪里都算选中 */}
      {choosing && current && (
        <div className="vn-choice-layer" inert={covered}>
          <button className="vn-choice" onClick={advance} disabled={!lineComplete}>
            {showJa && current.ja && <span className="vn-choice-ja">{unquote(current.ja)}</span>}
            <span className="vn-choice-text">{unquote(current.text)}</span>
          </button>
        </div>
      )}

      {((settings.showModel && modelLabel) || voice.paused || showVoiceChip) && (
        <div className="vn-topbar" inert={covered}>
          {showVoiceChip && (
            <VoiceQuick
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
              onOpenPlugin={() => openPlugin('voice')}
            />
          )}
          {/* 语音标签关着时,断了还是要提示 */}
          {voice.paused && !showVoiceChip && (
            <button className="vn-chip warn" onClick={voice.retry} title={voice.lastError ?? ''}>
              语音断了 · 每 15 秒自动重连,点这里马上试
            </button>
          )}
          {settings.showModel && modelLabel && (
            <span className="vn-chip" title="当前模型 —— 菜单「模型」里换">
              {modelLabel}
            </span>
          )}
        </div>
      )}

      <div className="vn-window" onWheel={onWheel} inert={covered}>
        <div className="vn-box" onClick={advance} onContextMenu={onContextMenu}>
          {speaker && <div className={`vn-name${shown?.player ? ' player' : ''}`}>{speaker}</div>}
          {sending &&
            (glass ? (
              <>
                <span className="vn-flow" aria-hidden="true" />
                <span className="vn-gen" title="正在生成">
                  正在写
                  <span className="vn-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
              </>
            ) : (
              <span className="vn-gen" title="正在生成">
                <Feather size={14} className="breathe" />
                生成中
              </span>
            ))}

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
                      : // 正文已经在写、秒数要等生成完才有:先写「已思考」,别跳成「思考过程」
                        streaming
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
          {showJa && shown?.ja && !waiting && <div className="vn-ja">{shown.ja}</div>}
          {body !== null && <div className={`vn-text${speaker ? '' : ' narration'}`}>{body}</div>}
          {showNextMark && <span className="vn-next" aria-hidden="true">▼</span>}
          {atEnd && <span className="vn-end" aria-hidden="true">■</span>}

          {glass ? (
            <>
              {voice.request && (
                <div className="vn-voice-row" onClick={stop}>
                  <VoiceButtons req={voice.request} onAction={voice.release} />
                </div>
              )}
              <div className="vn-row" onClick={stop}>
                {myTurn || pastInput ? <span className="vn-row-hint">说点什么 · 随时可以插话</span> : inputForm}
                <span className="vn-row-sep" aria-hidden="true" />
                <div className="vn-quick">{quickButtons}</div>
              </div>
            </>
          ) : (
            <div className="vn-quick" onClick={stop}>
            {voice.request && <VoiceButtons req={voice.request} onAction={voice.release} className="lead" />}
              {quickButtons}
            </div>
          )}
        </div>
        {!glass && inputForm}
      </div>

      {glass && myTurn && (
        <div className="vn-turn-layer" inert={covered}>
          <div className="vn-turn-bar" onClick={stop}>
            <button
              type="button"
              className="vn-turn-close"
              onClick={() => setTurnClosed(typeKey)}
              title="收起(还能在对话框下面打字)"
              aria-label="收起输入条"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
              </svg>
            </button>
            {inputForm}
          </div>
        </div>
      )}

      {menu && (
        <VNMenu
          page={menu}
          onPage={(p) => {
            setMenu(p);
            setSettingsTab(undefined);
            setLastPage(p);
            // 从导航点进插件页:停在默认的第一个插件,不再跳回上次指定的那个
            setPluginFocus(null);
          }}
          charName={charName}
          chatName={chatName}
          headExtra={
            menu === 'log' ? (
              <label className="vn-switch">
                <input type="checkbox" checked={rawLog} onChange={(e) => setRawLog(e.target.checked)} />
                显示原文
                <span className="vn-page-note">标签、宏原样露出来</span>
              </label>
            ) : null
          }
          onClose={closeMenu}
          onTitle={() => {
            setMenu(null);
            setTitleCold(false);
            setTitle(true);
          }}
        >
          {menu === 'config' ? (
            <VNSettingsPage
              settings={settings}
              onChange={changeSettings}
              enterKey={enterKey}
              onChangeEnterKey={onChangeEnterKey}
              voiceConfig={voiceConfig}
              onChangeVoiceConfig={onChangeVoiceConfig}
              voiceCastName={
                currentCardId ? (voiceCast.main?.name ?? voiceCast.extras[0]?.name ?? null) : undefined
              }
              onOpenVoice={() => openPlugin('voice')}
              showJa={showJa}
              onChangeShowJa={onChangeShowJa}
              initialTab={settingsTab}
              titleMusic={
                currentCardId
                  ? { bgms: bgmsOf(sceneAssets), value: titleBgmId, onChange: onChangeTitleBgm }
                  : null
              }
            />
          ) : menu === 'dev' ? (
            <div className="vn-dev">
              <div className="vn-page-bar">
                <span className="vn-page-note">当前这条回复的原文和标签;提示词检查器在完整调试台里</span>
                <div className="vn-page-actions">
                  <button className="vn-pill accent" onClick={onExit}>
                    回到调试台
                  </button>
                </div>
              </div>
              <ConsoleView
                beat={beat}
                beatNumber={beats.slice(0, beatIndex + 1).filter((b) => b.parsed).length}
                sprites={sprites}
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
              />
            </div>
          ) : (
            hostPage(menu)
          )}
        </VNMenu>
      )}

      {title && !firstLoad && (
        <VNTitle
          variant={settings.titleStyle}
          cold={titleCold}
          cardId={currentCardId}
          charName={charName}
          tags={cardTags}
          lastPlayed={chatUpdatedAt}
          lastLine={lastLine}
          sprites={sprites}
          faces={faces}
          spriteStage={spriteStage}
          spriteLayout={spriteLayout}
          home={titleHome}
          scenes={titleScenes}
          cards={cards}
          onWantAvatar={onWantAvatar}
          onContinue={() => setTitle(false)}
          onNewStory={() => {
            if (!currentCardId) return;
            setTitle(false);
            onPickCard(currentCardId, true);
          }}
          onSwitchCard={(id) => onPickCard(id, false)}
          onLoad={() => {
            setTitle(false);
            openMenu('save');
          }}
          onSettings={() => {
            setTitle(false);
            openMenu('config');
          }}
          onExit={onExit}
          onPick={() => setPicking(true)}
        />
      )}

      {picking && (
        <VNPick
          cards={cards}
          currentCardId={currentCardId}
          lastLine={lastLine}
          lastPlayed={chatUpdatedAt}
          onBack={() => setPicking(false)}
          onContinue={(id) => {
            setPicking(false);
            setTitle(false);
            if (id !== currentCardId) onPickCard(id, false);
          }}
          onNewStory={(id) => {
            setPicking(false);
            setTitle(false);
            onPickCard(id, true);
          }}
          onImport={onImportCard}
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
            faceSrc={currentCardId ? cardFaceUrl(currentCardId, 256, packId) : null}
            avatar={cards.find((c) => c.id === currentCardId)?.avatar ?? null}
            onFaceMissing={() => {
              if (currentCardId) onWantAvatar(currentCardId);
            }}
            backdrop={isSettled(bgView.src) ? bgView.src : null}
            sprite={loadingSprite}
            place={scene.bg?.label ?? ''}
            line={lastLine}
            progress={gate.progress}
            fraction={gate.fraction}
            slow={gate.slow}
            onSkip={gate.skip}
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

const KIND_NAME: Record<string, string> = { sprite: '立绘', bg: '场景', bgm: '音乐', cg: 'CG', player: '玩家' };

const BGM_FROM: Record<NonNullable<SceneState['bgmFrom']>, string> = {
  initial: '开场默认',
  scene: '场景默认曲',
  tag: 'AI 标签',
};

/** 控制台里一个立绘标签的匹配结果 */
function describeMatch(m: TagMatch, sprites: readonly PackSprite[]): { ok: boolean; text: string } {
  const noImage = (label: string) => {
    const s = sprites.find((x) => x.label === label);
    return s && !s.has_image ? '(还没传图)' : '';
  };
  const where = sprites.length === 0 ? '内置表情 ' : '';
  switch (m.state) {
    case 'exact':
      return { ok: true, text: `✓ ${where}${m.label}${noImage(m.label)}` };
    case 'model':
      return { ok: true, text: `≈ ${where}${m.label}(模型 ${m.score.toFixed(2)})${noImage(m.label)}` };
    case 'pending':
      return { ok: true, text: '… 识别中' };
    case 'failed':
      return {
        ok: false,
        text: `✗ ${m.reason},${sprites.length === 0 ? '占位框写原词' : '保持上一张'}`,
      };
  }
}

/** 开发者页:模型这条回复的完整原文,以及每个标签落在哪一句、对上了哪个素材 */
function ConsoleView({
  beat,
  beatNumber,
  sprites,
  emotion,
  tagKinds,
  sceneAssets,
  scene,
  voice,
}: {
  beat: Beat | null;
  beatNumber: number;
  sprites: PackSprite[];
  /** 立绘标签的匹配(精确 / 模型) */
  emotion: EmotionContext;
  tagKinds: TagKind[];
  sceneAssets: SceneAsset[];
  scene: SceneState;
  voice: {
    enabled: boolean;
    /** 情绪不变:不等模型认表情 */
    fixedEmotion: boolean;
    cast: VoiceCast;
    plans: readonly (SpeakRequest | null)[];
    clips: ReadonlyMap<string, ClipState>;
    paused: boolean;
    lastError: string | null;
    charName: string;
    streaming: boolean;
  };
}) {
  const raw = beat?.raw ?? '';
  const hits = beat?.parsed?.hits ?? [];
  const lines = beat?.parsed?.lines ?? [];

  /** 标签 → 匹配结果 */
  const resolve = useMemo(
    () =>
      (kind: string, label: string): { ok: boolean; text: string } => {
        if (kind === 'sprite') return describeMatch(emotion.resolve(label), sprites);
        if (kind === 'player') return { ok: true, text: '✓ 玩家台词,弹选项,不念' };
        if (kind === 'cg' && isCgOff(label)) return { ok: true, text: '✓ 收起 CG' };
        const pool = kind === 'bg' ? backgroundsOf(sceneAssets) : kind === 'cg' ? cgsOf(sceneAssets) : bgmsOf(sceneAssets);
        const a = resolveByLabel(label, pool);
        if (a) return { ok: true, text: `✓ ${a.label}${a.has_file ? '' : '(还没传文件)'}` };
        if (sceneAssets.length === 0) return { ok: false, text: '✗ 这张卡没有绑定场景包' };
        return { ok: false, text: `✗ 场景包里没有这个${KIND_NAME[kind]},保持不变` };
      },
    [sprites, sceneAssets, emotion],
  );

  // 原文里把几类标签都高亮出来
  const highlighted = useMemo(() => {
    if (!raw) return [raw];
    const found: { at: number; text: string; ok: boolean; kind: string }[] = [];
    for (const k of tagKinds) {
      if (!k.pattern) continue;
      for (const m of raw.matchAll(new RegExp(k.pattern.source, 'g'))) {
        found.push({ at: m.index ?? 0, text: m[0], ok: resolve(k.kind, m[1]).ok, kind: k.kind });
      }
    }
    found.sort((a, b) => a.at - b.at);
    const out: ReactNode[] = [];
    let last = 0;
    for (const f of found) {
      if (f.at < last) continue;
      out.push(raw.slice(last, f.at));
      out.push(
        <mark key={f.at} className={`${f.ok ? 'ok' : 'miss'} k-${f.kind}`}>
          {f.text}
        </mark>,
      );
      last = f.at + f.text.length;
    }
    out.push(raw.slice(last));
    return out;
  }, [raw, tagKinds, resolve]);

  const broken = tagKinds.filter((k) => !k.pattern).map((k) => KIND_NAME[k.kind]);
  const jev = beat ? currentInfo(beat.entry)?.jev : undefined;
  const jevDropped = beat && jev ? entryView(beat.entry, tagKinds).dropped : 0;
  const jevPending = beat?.entry.jevPending;

  return (
    <div className="vn-console">
      <div className="vn-console-section">
        <div className="vn-console-title">
          此刻
          <span className="vn-console-sub">
            {beat
              ? `第 ${beatNumber} 条回复 · 分支 ${beat.entry.swipeIndex + 1}/${beat.entry.swipes.length} · ${lines.length} 句`
              : '还没有回复'}
          </span>
        </div>
        <p className="vn-console-note now">
          场景:{scene.bg ? `「${scene.bg.label}」` : '默认背景(这张卡没绑场景包,或者包里没有背景)'}
          {' · '}
          音乐:{scene.bgm ? `「${scene.bgm.label}」(${BGM_FROM[scene.bgmFrom ?? 'tag']})` : '无'}
          {' · '}
          CG:{scene.cg ? `「${scene.cg.label}」` : '无'}
        </p>
      </div>
      <div className="vn-console-section">
        <div className="vn-console-title">
          标签
          {broken.length > 0 && (
            <span className="vn-console-warn">{broken.join('、')}的模板不合法,这几类不识别</span>
          )}
        </div>
        {jev && (
          <p className={`vn-console-note${jev.failed ? ' miss' : ''}`}>
            这条的{(jev.kinds ?? []).map((k) => KIND_NAME[k]).join('、')}标签是 Jev 标的:判了 {jev.lines} 句、{jev.requests} 次请求、最慢 {(jev.maxMs / 1000).toFixed(2)} 秒、
            {jev.tokens.toLocaleString()} token(约 ${((jev.tokens * 0.042) / 1e6).toFixed(4)})
            {jevPending !== undefined ? ` · 第 ${jevPending + 1} 句起还在判` : ''}
            {jev.failed ? ` · ${jev.failed} 句没判成(照没标处理):${jev.error ?? ''}` : ''}
            {jevDropped ? ` · 原文改过,${jevDropped} 句的标注对不上已去掉` : ''}
            {jev.notes ? ' · 标签另存,模型原文在调试台聊天区点「看原文」' : ''}
          </p>
        )}
        {hits.length === 0 ? (
          <p className="vn-console-note">
            这条回复里没有标签。去插件面板检查:当前预设里有没有「立绘指令 / 场景指令 / 音乐指令 · 插件」这几个块,块有没有开启。
          </p>
        ) : (
          <div className="vn-console-scroll">
            <table className="vn-console-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>类别</th>
                  <th>标签原文</th>
                  <th>生效于</th>
                  <th>匹配结果</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((h, i) => {
                  const r =
                    h.kind === 'sprite' && isNpcHit(h, emotion.charName)
                      ? { ok: true, text: `— 「${h.speaker}」的台词,不切立绘` }
                      : resolve(h.kind, h.label);
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{KIND_NAME[h.kind] ?? h.kind}</td>
                      <td>
                        <code>{h.raw}</code>
                      </td>
                      <td>{h.lineIndex === -1 ? '回复末尾(延续到下一条)' : `第 ${h.lineIndex + 1} 句`}</td>
                      <td className={r.ok ? 'ok' : 'miss'}>{r.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="vn-console-section">
        <div className="vn-console-title">
          语音
          <span className="vn-console-sub">
            {!voice.enabled
              ? '插件里关着'
              : !voice.cast.main && voice.cast.extras.length === 0
                ? '这张卡没绑声音(调试台 → 插件 → 语音)'
                : voice.paused
                  ? `连续失败,暂停中(每 15 秒自动重连):${voice.lastError ?? ''}`
                  : `主声音「${voice.cast.main?.name ?? '无'}」${voice.fixedEmotion ? ' · 情绪不变' : ''}`}
          </span>
        </div>
        {lines.length > 0 && (
          <div className="vn-console-scroll">
            <table className="vn-console-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>说话人 → 声音</th>
                  <th>情绪(要的 → 实际)</th>
                  <th>方式</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((ln, i) => {
                  const plan = voice.plans[i] ?? null;
                  const profile = ln.player ? null : voiceForSpeaker(ln.speaker, voice.charName, voice.cast);
                  const st = plan ? voice.clips.get(voiceKey(plan)) : undefined;
                  const why = voiceSkipReason(ln, profile, {
                    streamingLast: voice.streaming && i === lines.length - 1,
                    pendingTag:
                      !voice.fixedEmotion &&
                      spriteHitsUpTo(hits, i, voice.charName).some(
                        (h) => emotion.resolve(h.label).state === 'pending',
                      ),
                    jevPending: jevPending !== undefined && i >= jevPending,
                    jev: beat ? jevKindsOf(beat.entry).includes('sprite') : false,
                  });
                  const actual =
                    st?.state === 'ready' && st.emotion !== (plan?.emotion ?? '') ? ` → ${st.emotion}` : '';
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        {ln.untagged ? '(没写立绘标签)' : (ln.speaker ?? '旁白')}
                        {profile ? ` → ${profile.name}` : ''}
                      </td>
                      <td>{plan ? `${plan.emotion ?? '(默认)'}${actual}` : '—'}</td>
                      <td>{st?.state === 'ready' ? EMO_MODE_TEXT[st.mode] : '—'}</td>
                      <td className={st?.state === 'error' ? 'miss' : st?.state === 'ready' ? 'ok' : ''}>
                        {plan ? clipText(st) : why}
                        {/* 实际送去合成的字(日语声音念的是日语) */}
                        {plan && <div className="vn-console-sub">{plan.text}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="vn-console-section">
        <div className="vn-console-title">模型完整输出</div>
        <pre className="vn-console-raw">{raw ? highlighted : '(空)'}</pre>
      </div>
    </div>
  );
}

function clipText(st: ClipState | undefined): string {
  if (!st) return '还没请求';
  switch (st.state) {
    case 'queued':
      return '排队中';
    case 'loading':
      return '合成中…';
    case 'ready':
      return `✓ ${st.cache === 'hit' ? '缓存命中' : '新合成'} · ${(st.ms / 1000).toFixed(1)} 秒`;
    case 'error':
      return `✗ ${st.message}`;
  }
}
