import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './debug.css';
import { AnimaIcon } from './components/AnimaIcon';
import { ChatHistoryOverlay, type ChatOp } from './components/ChatHistoryOverlay';
import { CardBindings } from './components/CardBindings';
import { CardPanel, type CardView, type SaveState } from './components/CardPanel';
import { EnvBadge } from './components/EnvBadge';
import { CardStudio } from './studio/CardStudio';
import { DropLayer } from './importer/DropLayer';
import { ImportConfirm } from './importer/ImportConfirm';
import { ImportProgress } from './importer/ImportProgress';
import { libraryRouteAfterImport, noticeOf, slotAfterImport } from './importer/importModel';
import { useImporter, type ImportDone } from './importer/useImporter';
import { summarizeSlots } from './studio/slotSummary';
import { BackgroundSlot } from './studio/slots/BackgroundSlot';
import { BgmSlot } from './studio/slots/BgmSlot';
import { SpriteSlot } from './studio/slots/SpriteSlot';
import type { ImportNotice, PackSync, SlotKey, StudioRoute } from './studio/types';
import { SlotPending } from './studio/ui';
import { ProfileTab } from './studio/profile/ProfileTab';
import { PresetView } from './studio/profile/PresetView';
import { VoiceSlot } from './studio/slots/VoiceSlot';
import { CgSlot } from './studio/slots/CgSlot';
import { PluginSheet } from './studio/PluginSheet';
import { AssetLibrary } from './library/AssetLibrary';
import type { CardBindingWriter } from './library/libraryApi';
import type { LibraryKind, LibraryRoute } from './library/libraryModel';
import { bindRemove } from './studio/slots/voiceSlotModel';
import { ChatPanel } from './components/ChatPanel';
import { ConnectionsDrawer } from './components/ConnectionsDrawer';
import { CropModal } from './components/CropModal';
import { PersonaDrawer } from './components/PersonaDrawer';
import { PluginsDrawer, type PluginFocus, type PluginKey } from './components/PluginsDrawer';
import { SettingsDrawer } from './components/SettingsDrawer';
import { avatarOf } from './lib/avatar';
import { uuid } from '../lib/uuid';
import { MOBILE_QUERY, useIsMobile } from './lib/useIsMobile';
import {
  loadChatSettings,
  saveChatSettings,
  type ChatSettings,
} from './lib/chatSettings';
import { buildMacroContext, type MacroVars, type VarValue } from './lib/macros';
import { loadGlobalVariables, saveGlobalVariables } from './lib/globalVariables';
import {
  loadCustomMacros,
  saveCustomMacros,
  toLookup,
  type CustomMacro,
} from './lib/customMacros';
import { BudgetBar } from './components/BudgetBar';
import { PresetPanel, type PresetBaseProps } from './components/PresetPanel';
import { Frozen } from './components/Frozen';
import { PromptInspector } from './components/PromptInspector';
import { assemble, type AssemblyResult, type BudgetReport, type ChatTurn } from './lib/assembler';
import {
  debugApi,
  type ChatPayload,
  type ChatSummary,
  type ClassifyKind,
  type DebugPersona,
  type ImportUndoPreview,
  type JevDefaults,
  type JevKeyStatus,
  type StoredCard,
  type StoredPreset,
} from './lib/api';
import {
  addTruncatedSwipe,
  appendSwipe,
  currentInfo,
  currentText,
  dropSwipe,
  fromStored,
  lastUserText,
  makeGreetingEntry,
  makePendingEntry,
  makeUserEntry,
  overswipeOf,
  patchSwipeInfo,
  setSwipeText,
  swipeTo,
  toStored,
  type ChatEntry,
  type SwipeInfo,
} from './lib/chatEntry';
import { resolveMarkerSource } from './lib/cardFields';
import type { WorldInfoSettings } from './lib/worldInfo';
import { loadWorldInfoSettings, saveWorldInfoSettings } from './lib/worldInfoSettings';
import { EMPTY_CARD, type TavernCard } from './lib/cardParser';
import { cardFromStored, cardToFileJson, cardToStored, fileToDataUrl } from './lib/cardStore';
import {
  buildPresetSkeleton,
  parsePreset,
  pickDefaultOrderGroup,
  type PresetOrderEntry,
  type PresetPrompt,
  type TavernPreset,
} from './lib/presetParser';
import { presetFromStored, presetToFileJson, presetToStored } from './lib/presetStore';
import { loadLastPresetId, saveLastPresetId } from './lib/lastPreset';
import { throttle } from './lib/throttle';
import {
  DEFAULT_SPRITE_CONFIG,
  SPRITE_BLOCK_ID,
  SPRITE_BLOCK_NAME,
  SPRITE_SETTING_KEY,
  insertSpriteBlock,
  normalizeSpriteConfig,
  spriteBlockState,
  spriteMacros,
  type SpritePluginConfig,
} from './plugins/sprite';
import {
  SCENE,
  backgroundsOf,
  bgmsOf,
  cgsOf,
  insertSceneBlock,
  sceneAtEnd,
  sceneBlockState,
  sceneMacros,
  sceneTagKind,
} from './plugins/scene';
import { effectiveOf } from './plugins/cardPrefs';
import { useCardPrefs } from './plugins/useCardPrefs';
import { usePluginConfig } from './plugins/usePluginConfig';
import { useScenePlugin } from './plugins/useScenePlugin';
import { useSpriteLayout } from './plugins/useSpriteLayout';
import { useSpritePacks } from './plugins/useSpritePacks';
import { setManual } from './plugins/manualMarks';
import {
  ASSEMBLY_SETTING_KEY,
  DEFAULT_ASSEMBLY_CONFIG,
  moveToLastUserTurn,
  normalizeAssemblyConfig,
  pluginAssemblyPass,
  type AssemblyConfig,
  type AutoFill,
} from './core/assembly';
import { useForms } from './plugins/forms';
import { useStates } from './plugins/useStates';
import { asksTone, useSplice } from './plugins/voiceExtensions';
import { useIllustrations } from './plugins/illustrations';
import { useVoicePlugin } from './plugins/useVoicePlugin';
import { enabledOnly, isPluginBlock, syncPluginBlocks } from './plugins/common';
import { blockIdOf, pluginOfBlock } from './plugins/registry';
import {
  DEFAULT_SWITCHES,
  SWITCH_SETTING_KEY,
  normalizeSwitches,
  offKindsOf,
  type PluginSwitches,
} from './plugins/switches';
import {
  DEFAULT_LANG_CONFIG,
  LANG_BLOCK_ID,
  LANG_BLOCK_NAME,
  LANG_SETTING_KEY,
  insertLangBlock,
  langBlockState,
  normalizeLangConfig,
  type LangPluginConfig,
} from './plugins/lang';
import {
  DEFAULT_JEV_CONFIG,
  JEV_SETTING_KEY,
  anyJev,
  jevBlockIds,
  jevStripPrompt,
  normalizeJevConfig,
  promptOverrides,
  type JevKinds,
  type JevPluginConfig,
} from './plugins/jev';
import {
  JEV_SETTLE_MS,
  JevRun,
  previousReplyLines,
  type AnnotateChoice,
  type JevSnapshot,
  type JevTrial,
} from './plugins/jevRun';
import { cutJev, jevText } from './plugins/jevNotes';
import { BUILTIN_EMOTIONS } from './plugins/emotions';
import {
  DEFAULT_PLAYER_CONFIG,
  PLAYER_BLOCK_ID,
  PLAYER_SETTING_KEY,
  insertPlayerBlock,
  normalizePlayerConfig,
  playerBlockState,
  type PlayerPluginConfig,
} from './plugins/player';
import {
  EMPTY_BINDINGS,
  PERSONA_BINDING_KEY,
  bindCard,
  normalizeBindings,
  personaForCard,
  type PersonaBindings,
} from './lib/personaBinding';
import {
  EMPTY_PRESET_BINDINGS,
  PRESET_BINDING_KEY,
  forgetPreset,
  normalizePresetBindings,
  presetForCard,
  type PresetBindings,
} from './lib/presetBinding';
import { bgmPlayer } from './vn/bgm';
import { forgetPickDetail } from './vn/pickDetail';
import { VNSaves } from './vn/VNSaves';
import { VNScreen } from './vn/VNScreen';
import { stripTags, vnTagKinds } from './vn/tags';
import { newBeatCache, parseBeats } from './core/beats';
import { buildTimeline, emotionAtStart, type TimelineCtx } from './core/timeline';
import { emotionCandidates, emotionListRef } from './plugins/emotionMatch';
import { cgFrameFromPairs } from './plugins/pairings';
import { cachedResolver } from './vn/useEmotionMatches';
import { cachedPairs } from './vn/usePairings';
import { useTimelineEngine } from './vn/useTimelineEngine';
import { cachedRecordsResolver } from './vn/useWordRecords';
import {
  autoRange,
  budgetFromParams,
  DEFAULT_BUDGET,
  loadRange,
  paramsWithBudget,
  saveRange,
} from './lib/budget';

const EMPTY_BUDGET: BudgetReport = {
  limit: null,
  fixedTokens: 0,
  presetTokens: 0,
  cardTokens: 0,
  historyTokens: 0,
  parts: { preset: 0, card: 0, persona: 0, examples: 0, worldInfo: 0, history: 0 },
  droppedCount: 0,
  droppedTokens: 0,
  overflow: false,
  forcedLastMessage: false,
  firstKeptHistoryIndex: null,
};

const EMPTY_RESULT: AssemblyResult = {
  messages: [],
  skipped: [],
  totalTokens: 0,
  danglingIdentifiers: [],
  budget: EMPTY_BUDGET,
};

/** 选卡时自动换人设 / 预设要说的一句话;选卡时几句合成一条提示。null = 没换 */
type Said = { kind: 'ok' | 'error'; text: string } | null;

/** 流式时最多隔多久把新到的字写进条目一次(每秒 10 次;见 runGeneration) */
const STREAM_PAINT_MS = 100;

const PANEL_MIN = 230;
const PANEL_MAX = 560;
const DEFAULT_LEFT = 330;
const DEFAULT_RIGHT = 350;

function clampPanel(v: number): number {
  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, v));
}

const two = (n: number) => String(n).padStart(2, '0');

/** 下拉里怎么称呼一张对话:有名用名,没名用「更新时间 · 条数」 */
function chatLabel(c: ChatSummary): string {
  if (c.name) return c.name;
  const d = new Date(c.updated_at);
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())} · ${c.message_count} 条`;
}

function loadPanelWidth(key: string, fallback: number): number {
  const raw = window.localStorage.getItem(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? clampPanel(n) : fallback;
}

/** 聊天列保底宽度 —— 两个侧栏的持久化宽度可能是在大屏上拖出来的,
    换个小窗载入时加起来会超窗口,把 minmax(0,1fr) 的聊天列压成 0 */
const CHAT_MIN = 420;

/** 按当前窗口宽把两栏的持久化宽度收一收。挂载时算一次,
    从移动端布局切回桌面端时再算一次 —— 在手机尺寸挂载的话,
    innerWidth - CHAT_MIN 是负的,两栏会被压到 PANEL_MIN 那一档 */
function fitPanels(): { left: number; right: number } {
  const left = loadPanelWidth('debug.leftW', DEFAULT_LEFT);
  const right = loadPanelWidth('debug.rightW', DEFAULT_RIGHT);
  // 两栏加起来最多能占这么宽,剩下的归聊天列
  const budget = window.innerWidth - CHAT_MIN;
  if (left + right <= budget) return { left, right };
  // 装不下就按各自占比一起收。早先是「左栏先吃满、右栏拿剩下的」——
  // 左栏存着 496 时右栏被压到下限,聊天列还是只剩 300,等于 CHAT_MIN 没兜住
  const scale = budget / (left + right);
  return {
    left: clampPanel(Math.floor(left * scale)),
    right: clampPanel(Math.floor(right * scale)),
  };
}

export default function DebugApp() {
  const [card, setCard] = useState<TavernCard | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // 预设原样(插件块的正文可能是旧副本);对外一律用下面同步过插件模板的 preset
  const [rawPreset, setPreset] = useState<TavernPreset | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);
  /** 编排的本地覆盖:identifier → enabled。用户在左栏点开关只改这里,不动原预设 */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  // 预设持久化:saved 是库里的列表,presetId 是当前选中的,dirty 表示有未写回的改动
  const [savedPresets, setSavedPresets] = useState<StoredPreset[]>([]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [presetDirty, setPresetDirty] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);

  // 角色卡持久化 —— 和预设不同,这边是自动保存
  const [savedCards, setSavedCards] = useState<StoredCard[]>([]);
  const [cardId, setCardId] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  /**
   * 导入/导出的遮罩文案。这类动作要解析文件、写库、再把卡和它的对话接上,
   * 慢的时候有一两秒;不盖点东西上去用户会以为按钮没响应,又点一遍。
   * null = 没有在跑的动作。
   */
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [cardSaveState, setCardSaveState] = useState<SaveState>('idle');
  /**
   * 右栏在编辑还是列表 —— 列表和编辑器共用那块面板,点 ☰ 互换,选完卡自动回编辑。
   * 开局是列表:进来没有选中的卡(停在开始界面),右栏直接摊开角色列表,
   * 挑一个就是一次点击的事;编辑器这时候没有卡可编。
   */
  const [cardView, setCardView] = useState<CardView>('list');
  /** 列表行的头像缓存:data URL 都在库里,按 id 懒加载,拉到就留着 */
  const [cardAvatars, setCardAvatars] = useState<Map<string, string>>(new Map());

  // 玩家人设:全局一份(后端 /api/personas),激活的那个决定 {{user}} 与人设描述。
  // userName/persona 仍是组装的直接输入,只是不再手填,而是由激活人设喂进来
  const [userName, setUserName] = useState('User');
  const [persona, setPersona] = useState('');
  const [personas, setPersonas] = useState<DebugPersona[]>([]);
  /** 顶栏模型下拉的 ⟳ 正在拉列表 */
  const [modelsRefreshing, setModelsRefreshing] = useState(false);
  /**
   * 待裁剪的头像 —— 选完文件先进裁剪弹窗,确认后才写回。
   * 卡头像和人设头像共用这一套,target 决定裁完写去哪。
   */
  const [cropTask, setCropTask] = useState<{
    file: File;
    target: { kind: 'card' } | { kind: 'persona'; id: string };
  } | null>(null);
  /** 这次选文件是给谁挑头像的 —— file input 是共用的,点之前先记下 */
  const avatarTargetRef = useRef<{ kind: 'card' } | { kind: 'persona'; id: string }>({
    kind: 'card',
  });
  /** 抽屉里也能换头像,所以开弹窗的动作要能被别人调 */
  const pickAvatarFor = (target: { kind: 'card' } | { kind: 'persona'; id: string }) => {
    avatarTargetRef.current = target;
    avatarInputRef.current?.click();
  };

  // token 预算记在预设里(openai_max_context,同酒馆):换预设跟着变。预设没载入时不截断
  const tokenBudget = rawPreset ? budgetFromParams(rawPreset.params) : null;
  const [rangeScale, setRangeScale] = useState(() => loadRange() ?? autoRange(DEFAULT_BUDGET));
  // 换到预算更大的预设时,量程换到装得下的挡
  useEffect(() => {
    if (tokenBudget !== null) setRangeScale((r) => (tokenBudget > r ? autoRange(tokenBudget) : r));
  }, [tokenBudget]);

  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 对话被改过没有(编辑/删除/发消息)。对应酒馆的 chat_metadata.tainted ——
      没被改过的开场白右滑只在其他开场白之间循环,改过之后才会真的重新生成 */
  const [tainted, setTainted] = useState(false);

  // 对话持久化:chatId 是当前对话,chats 是当前卡的对话列表(顶栏下拉)
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  // 分支树要的视角:当前卡 + 孤儿对话(card_id 为空)。顶栏下拉只给当前卡的,
  // 树这边多挂孤儿,让导入后匹配不到卡的对话有地方进
  const [treeChats, setTreeChats] = useState<ChatSummary[]>([]);

  // ---- 加载指示 ----
  // 开机首屏:预设 + 卡 + 最近对话是一串串行请求,期间盖一层遮罩,
  // 免得用户看着界面一格格长出来以为是坏的
  const [booting, setBooting] = useState(true);
  /** 正在读某张对话(切对话/切卡/分叉后跳转) */
  const [chatLoading, setChatLoading] = useState(false);
  /** 分支树在重建 */
  const [treeLoading, setTreeLoading] = useState(false);
  /** 树头上哪个耗时动作在跑 */
  const [chatOp, setChatOp] = useState<ChatOp>(null);

  /** 对话历史盖在聊天区上 —— 左栏只留一颗按钮,不再跟预设抢高度 */
  const [showHistory, setShowHistory] = useState(false);

  const [connections, setConnections] = useState<
    Awaited<ReturnType<typeof debugApi.listConnections>>
  >([]);
  const [connectionId, setConnectionId] = useState<string | undefined>();
  const [version, setVersion] = useState('');

  const [inspecting, setInspecting] = useState<AssemblyResult | null>(null);
  const [lastRaw, setLastRaw] = useState<string | null>(null);
  // 移动端两侧面板是盖住聊天区的全屏抽屉 —— 开局就得是收起的,
  // 否则一进来看到的是预设面板而不是对话。初值直接问媒体查询,免得先摊开再收一帧
  const startsMobile = () => window.matchMedia(MOBILE_QUERY).matches;
  const [leftCollapsed, setLeftCollapsed] = useState(startsMobile);
  const [rightCollapsed, setRightCollapsed] = useState(startsMobile);
  // 设置 / API / 玩家三个抽屉盖的是聊天区顶部同一块地方,同时只能开一个 ——
  // 三个布尔量互相关掉容易漏,直接用一个「当前开着谁」
  const [drawer, setDrawer] = useState<'settings' | 'api' | 'persona' | 'plugins' | null>(null);
  const toggleDrawer = (d: 'settings' | 'api' | 'persona' | 'plugins') => {
    // 移动端这几个入口藏在 ⋯ 菜单里,点完得把菜单收掉,否则抽屉和菜单叠着
    setMobileMenu(false);
    // 从顶栏正常打开插件抽屉,不沿用上次从左栏跳过来时要滚到的位置
    setPluginFocus(null);
    setDrawer((cur) => (cur === d ? null : d));
  };

  // 移动端:预设、角色卡是一级入口;玩家/设置/连接/模型是次要入口,折进 ⋯ 菜单。
  const isMobile = useIsMobile();
  const [mobileMenu, setMobileMenu] = useState(false);
  useEffect(() => {
    if (!isMobile) setMobileMenu(false);
  }, [isMobile]);
  // 转屏 / 拉窗口跨过断点时重定基线:进移动端收起两栏(理由同上),回桌面端摊开
  useEffect(() => {
    setLeftCollapsed(isMobile);
    setRightCollapsed(isMobile);
    // 在手机尺寸挂载时两栏宽被压到了最窄一档,回桌面端得按新窗口宽重算,
    // 否则三栏一直是 230+230 那副样子(localStorage 里其实存着更宽的值)
    if (!isMobile) {
      const fit = fitPanels();
      setLeftW(fit.left);
      setRightW(fit.right);
    }
  }, [isMobile]);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  /** 聊天区的显示偏好。纯前端,改一次写一次 localStorage */
  const [chatSettings, setChatSettings] = useState<ChatSettings>(loadChatSettings);
  const changeChatSettings = (next: ChatSettings) => {
    setChatSettings(next);
    saveChatSettings(next);
  };

  /**
   * 宏变量。局部的跟着对话(库里 debug_chats.variables),全局的存在这台机器上。
   * 预览只读这两份;真的发出去之后,把组装算出来的新值写回来(见 commitVariables)。
   */
  const [chatVars, setChatVars] = useState<Record<string, VarValue>>({});
  const [globalVars, setGlobalVars] = useState<Record<string, VarValue>>(loadGlobalVariables);
  const variables: MacroVars = useMemo(
    () => ({ local: chatVars, global: globalVars }),
    [chatVars, globalVars],
  );
  /** 最近一次生成是哪种 —— {{lastGenerationType}} 读它 */
  const generationType = useRef('');

  /** 世界书的全局设置:扫几条、预算多少、递不递归。会影响提示词,对所有角色生效 */
  const [worldInfoSettings, setWorldInfoSettings] =
    useState<WorldInfoSettings>(loadWorldInfoSettings);
  const changeWorldInfoSettings = (next: WorldInfoSettings) => {
    setWorldInfoSettings(next);
    saveWorldInfoSettings(next);
  };

  /**
   * 自定义宏。和显示偏好分开存 —— 它会进提示词,不是「我的眼睛怎么舒服」,
   * 「恢复默认」也不该顺手把人写的宏清空。
   */
  const [customMacros, setCustomMacros] = useState<CustomMacro[]>(loadCustomMacros);
  const changeCustomMacros = (next: CustomMacro[]) => {
    setCustomMacros(next);
    saveCustomMacros(next);
  };

  // 视觉小说模式。刻意不跨刷新保留:开机不会自动选角色卡,刷新后直接进视觉小说
  // 只会看到一个「先选卡」的空界面 —— 还不如回到开始界面,选完卡再点一次入口
  const [vnOpen, setVnOpen] = useState(false);
  const toggleVn = (open: boolean) => {
    setMobileMenu(false);
    // 进入按钮这一下点击就是用户手势:趁这时解锁音频,进去就能响(iOS 只认手势里的解锁)
    if (open) bgmPlayer.unlock();
    setVnOpen(open);
  };

  // 卡编辑器(全屏页,studio/):开在哪个页签、哪一栏;null = 没开。编辑的永远是当前这张卡
  const [studio, setStudio] = useState<StudioRoute | null>(null);
  // 从卡编辑器里打开的插件抽屉(盖在卡编辑器上面,PluginSheet);null = 没开
  const [studioPlugin, setStudioPlugin] = useState<PluginFocus | null>(null);
  // 素材管理页(全屏页,library/):开在哪个页签、选中哪个包;null = 没开。关了再开回到上次的地方
  const [library, setLibrary] = useState<LibraryRoute | null>(null);
  const lastLibrary = useRef<LibraryRoute>({ tab: 'sprite', id: null });
  // 导完没有卡可开时素材管理页顶上那一行提示;关掉素材管理页就没了
  const [libraryNotice, setLibraryNotice] = useState<ImportNotice | null>(null);
  // 导完一批加一:素材管理页开着就重读列表和导入记录
  const [libraryReload, setLibraryReload] = useState(0);

  // 三栏宽度:初始从 localStorage 恢复,拖动时实时更新,松手时持久化。
  // 恢复时以「聊天列至少 CHAT_MIN」收一收两栏 —— 只收载入值,拖动仍按用户手上的来
  const [leftW, setLeftW] = useState(() => fitPanels().left);
  const [rightW, setRightW] = useState(() => fitPanels().right);
  const draggingSide = useRef<'left' | 'right' | null>(null);

  const toastTimer = useRef<number | undefined>(undefined);
  const presetInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 正在跑的那次生成,跑完(含被停下)才 resolve —— 插话要等它收完尾再接着发 */
  const inflightRef = useRef<Promise<void>>(Promise.resolve());
  // 逐操作写库的水位线(见 persist effect):条目对象或位置变了才需要写
  // 后端已经存下的提示词快照(按哈希)。快照只增不删,这次打开页面里存过的就不用再随消息发
  const savedSnapshots = useRef(new Set<string>());
  const persistedRef = useRef<{
    chatId: string | null;
    rows: Map<string, { entry: ChatEntry; idx: number }>;
  }>({ chatId: null, rows: new Map() });
  // 每条消息的写库请求排队:同一条的 PUT / DELETE 按发出的顺序落库。不排的话,刚发出去的消息
  // 在保存请求回来之前就删掉,删除根本不会发(水位线里还没有它),然后保存落库,这条就一直留在库里;
  // 改完马上翻分支也可能是旧的那次 PUT 最后到
  const writeChain = useRef(new Map<string, Promise<unknown>>());
  // 已经排上队、还没落库的:{entry, idx} = 要写成这样,null = 要删。只管当前这张对话
  // (换对话的路不止一条:loadChat / newChat 自己会把水位线换成新对话的,所以按对话 id 认)
  const queuedRef = useRef<{
    chatId: string | null;
    map: Map<string, { entry: ChatEntry; idx: number } | null>;
  }>({ chatId: null, map: new Map() });
  const taintedRef = useRef(false);
  const metaRef = useRef<{ card_id: string | null; preset_id: string | null; user_name: string }>(
    { card_id: null, preset_id: null, user_name: 'User' },
  );
  // 历史提示词快照的内存缓存 —— 读回的对话只有哈希,点开才按哈希取
  const snapCache = useRef(new Map<string, AssemblyResult>());
  // 快速连续切换对话/卡片时,让在途的加载作废,后到的赢
  const chatSeq = useRef(0);
  // selectCard 也是一串串行 await(头像→对话列表→接对话),连点两张卡时
  // 前一张的慢响应会把后一张的头像/对话列表盖掉 —— 和 chatSeq 同款的守卫
  const cardSeq = useRef(0);
  // 自动保存的 debounce 计时器 + 保存态复位计时器
  const cardSaveTimer = useRef<number | undefined>(undefined);
  const savedFlagTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((kind: 'ok' | 'error', message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast({ kind, message });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  // 下面几个插件的全局配置都走 usePluginConfig:开机读一次,改的时候先改内存、停手半秒再写库。
  // 出错要弹提示,所以放在 notify 后面

  /**
   * 立绘插件:全局配置(标签格式 + 提示词模板)存后端,手机和电脑共用;
   * 表情映射跟着当前卡走。改配置时先改内存,停手半秒再写库,免得每敲一个字发一次请求。
   */
  const { config: spriteConfig, change: changeSpriteConfig } = usePluginConfig<SpritePluginConfig>(
    SPRITE_SETTING_KEY,
    normalizeSpriteConfig,
    DEFAULT_SPRITE_CONFIG,
    notify,
  );

  /** 插件开关(插件页右上角的小开关,关立绘 / 背景 / 音乐 / CG / AI 出图,plugins/switches.ts) */
  const { config: switches, change: changeSwitches } = usePluginConfig<PluginSwitches>(
    SWITCH_SETTING_KEY,
    normalizeSwitches,
    DEFAULT_SWITCHES,
    notify,
  );

  /** 外语插件(日语配音、中文字幕):全局配置,和立绘插件一样停手半秒再写库 */
  const { config: langConfig, change: changeLangConfig } = usePluginConfig<LangPluginConfig>(
    LANG_SETTING_KEY,
    normalizeLangConfig,
    DEFAULT_LANG_CONFIG,
    notify,
    { load: '外语插件配置读取失败' },
  );

  /** 组装的设置(core/assembly.ts):自动补块的总开关 */
  const { config: assemblyConfig } = usePluginConfig<AssemblyConfig>(
    ASSEMBLY_SETTING_KEY,
    normalizeAssemblyConfig,
    DEFAULT_ASSEMBLY_CONFIG,
    notify,
  );

  /** 玩家台词插件(<我> 弹选项):全局配置,同样停手半秒再写库 */
  const { config: playerConfig, change: changePlayerConfig } = usePluginConfig<PlayerPluginConfig>(
    PLAYER_SETTING_KEY,
    normalizePlayerConfig,
    DEFAULT_PLAYER_CONFIG,
    notify,
    { load: '玩家台词插件配置读取失败' },
  );

  /**
   * Jev 标注:每个标签插件可以选「AI 写」或「Jev 标」(模式存在各插件自己的配置里,plugins/jev.ts)。
   * 这里是几个插件共用的那份(立绘和文字同步、说话人门槛、通用问法),同样停手半秒再写库;
   * key 只在后端,这里只知道设了没有。默认问法从后端拿(只存一份)
   */
  const { config: jevConfig, change: changeJevConfig } = usePluginConfig<JevPluginConfig>(
    JEV_SETTING_KEY,
    normalizeJevConfig,
    DEFAULT_JEV_CONFIG,
    notify,
    { load: 'Jev 标注配置读取失败' },
  );
  const [jevKey, setJevKey] = useState<JevKeyStatus | null>(null);
  const [jevDefaults, setJevDefaults] = useState<JevDefaults | null>(null);
  const saveJevKey = async (key: string) => {
    await debugApi.setJevKey(key);
    setJevKey(await debugApi.annotateStatus());
  };
  /** Jev 的地址和模型名(走中转时填);空串 = 用官方的 */
  const saveJevEndpoint = async (url: string, model: string) => {
    await debugApi.setJevEndpoint(url, model);
    setJevKey(await debugApi.annotateStatus());
  };

  /**
   * 按卡设置(plugins/cardPrefs.ts):当前这张卡在全局插件设置之上另外改的几项(Jev 标还是 AI 写、Jev 的门槛)。
   * 管行为的地方(组装时摘哪几块、Jev 标哪几类、门槛、标签格式、视觉小说)用叠过的「这张卡实际用的」;
   * 插件抽屉、写进预设的插件块正文还是全局那份。这张卡没另设时就是全局那份本身,和没有按卡设置时一样
   */
  const cardPrefs = useCardPrefs(cardId, notify);
  const spriteEffective = useMemo(
    () => effectiveOf(spriteConfig, cardPrefs, SPRITE_SETTING_KEY, normalizeSpriteConfig),
    [spriteConfig, cardPrefs],
  );
  const playerEffective = useMemo(
    () => effectiveOf(playerConfig, cardPrefs, PLAYER_SETTING_KEY, normalizePlayerConfig),
    [playerConfig, cardPrefs],
  );

  /** 背景 / BGM / CG 插件:配置(全局的 configs、这张卡实际用的 effective)、场景包、当前卡绑的包和素材 */
  const scenePlugin = useScenePlugin(cardId, notify, cardPrefs);
  /** 立绘包:这张卡挂着哪些包、游戏里用哪个(换了跟着卡走),以及那个包里的立绘 */
  const spritePacks = useSpritePacks(cardId, notify);
  const { sprites } = spritePacks;
  /** 语音插件:配置、语音服务、声音,以及当前卡用哪些声音 */
  const voicePlugin = useVoicePlugin(cardId, notify);
  // 拆句拼接(卡带的 useSplice;没装是关着的):开关跟着语音请求走,插件页里它那一页用同一份状态
  const splice = useSplice(notify);
  // 游戏、提示词、语音、存档缩略图只看没禁用的素材;插件抽屉拿完整列表,好重新打开
  const cardSprites = useMemo(() => enabledOnly(sprites), [sprites]);
  const cardSceneAssets = useMemo(() => enabledOnly(scenePlugin.assets), [scenePlugin.assets]);
  // 形态(plugins/forms.ts;没装形态卡带时没有):开着时 AI({{sprites}})和 Jev 只在当前形态那组表情里选;
  // 画面和语音由视觉小说按玩家插的切换记号换。
  // 记号也存进存档(swipe_info[i].vn.forms):改的是当前对话的条目,persist effect 照常写库
  const patchEntry = useCallback(
    (id: string, fn: (e: ChatEntry) => ChatEntry) =>
      setEntries((prev) => prev.map((e) => (e.id === id ? fn(e) : e))),
    [],
  );
  const legacyForms = useForms({ cardId, chatId, entries, sprites: cardSprites, patchEntry });
  // 状态(素材架构 3.5,plugins/useStates.ts):这张卡在状态组里时接手形态的那一套(同一个接口),
  // 游戏、提示词、Jev 拿整组状态卡的立绘和场景素材,每句按它所在的状态看。「形态记号」那一行还是形态卡带的
  const states = useStates({ cardId, chatId, entries, sprites: cardSprites, assets: cardSceneAssets, patchEntry });
  const forms = useMemo(
    () => (states.enabled ? { ...states, uploadMarks: legacyForms.uploadMarks } : legacyForms),
    [states, legacyForms],
  );
  const activeSprites = states.enabled ? states.sprites : cardSprites;
  // 生成的插图(生图卡带,plugins/illustrations.ts;没装就没有):插件页里那一页、视觉小说的「画」按钮和 CG 层上的图
  const illustrations = useIllustrations({
    notify,
    cardId,
    cardName: card?.name ?? '',
    chatId,
    charName: card?.name ?? '',
    userName,
    entries,
    patchEntry,
    connections,
    // 收藏进 CG 包以后重读这张卡的 CG 绑定和包列表:第一次收藏新建的「AI 生图 · 卡名」包马上绑上,
    // 游戏里马上选得到,卡编辑器里马上算进去(以前要重选这张卡)
    onKept: () => {
      void scenePlugin.reloadCard();
      void scenePlugin.refreshCgPacks();
    },
  });
  const cartridgePanels = useMemo(() => (illustrations.panel ? [illustrations.panel] : []), [illustrations.panel]);
  const activeSceneAssets = states.enabled ? states.assets : cardSceneAssets;
  const { current: formNow, spritesNow } = forms;
  const formSprites = useMemo(() => spritesNow(activeSprites), [spritesNow, activeSprites]);
  const sceneKinds = useMemo(
    () => [
      sceneTagKind('bg', scenePlugin.effective.bg.tagTemplate),
      sceneTagKind('bgm', scenePlugin.effective.bgm.tagTemplate),
      sceneTagKind('cg', scenePlugin.effective.cg.tagTemplate),
    ],
    [scenePlugin.effective],
  );
  // 形态开着时每张 CG 只在它标的形态里出:新回复只给 Jev / AI 现在的形态能出的 CG;
  // 切到不能出的形态时收起。视觉小说里按句算,见 VNScreen
  const { cgOkAt, cgOkNow } = forms;
  // 整段对话末尾是哪个场景、在放哪首、画面上有没有 CG —— {{current_bg}} / {{current_bgm}} / {{current_cg}}
  const sceneNow = useMemo(
    () => sceneAtEnd(entries, sceneKinds, activeSceneAssets, cgOkAt),
    [entries, sceneKinds, activeSceneAssets, cgOkAt],
  );
  const sceneMacroValues = useMemo(
    () =>
      sceneMacros(scenePlugin.effective, scenePlugin.packId !== null, activeSceneAssets, sceneNow, cgOkNow),
    [scenePlugin.effective, scenePlugin.packId, activeSceneAssets, sceneNow, cgOkNow],
  );

  // 插件块的正文只认插件里的提示词模板(全局一份)。预设里存的只是副本,读的时候
  // 换成模板 —— 组装、左栏显示、保存、导出用的都是这个同步过的 preset。
  // 预设是几张卡共用的,所以这里用全局那份,不叠按卡设置(块的正文本来也不能按卡设)
  const pluginTemplates = useMemo(
    () => ({
      [SPRITE_BLOCK_ID]: spriteConfig.blockPrompt,
      [SCENE.bg.blockId]: scenePlugin.configs.bg.blockPrompt,
      [SCENE.bgm.blockId]: scenePlugin.configs.bgm.blockPrompt,
      [SCENE.cg.blockId]: scenePlugin.configs.cg.blockPrompt,
      [LANG_BLOCK_ID]: langConfig.blockPrompt,
      [PLAYER_BLOCK_ID]: playerConfig.blockPrompt,
    }),
    [spriteConfig.blockPrompt, scenePlugin.configs, langConfig.blockPrompt, playerConfig.blockPrompt],
  );
  const preset = useMemo(
    () => syncPluginBlocks(rawPreset, pluginTemplates),
    [rawPreset, pluginTemplates],
  );

  /** 视觉小说认的几类标签(立绘 / 背景 / 音乐 / CG / <我>);「历史」页默认把它们摘掉只给人看正文 */
  const vnKinds = useMemo(
    () =>
      vnTagKinds(
        spriteEffective.tagTemplate,
        scenePlugin.effective.bg.tagTemplate,
        scenePlugin.effective.bgm.tagTemplate,
        scenePlugin.effective.cg.tagTemplate,
      ),
    [spriteEffective.tagTemplate, scenePlugin.effective],
  );

  /**
   * 哪几类标签在用 Jev:插件选了 Jev、而且后端有 key(没 key 时照旧由 AI 写)。
   * 按这张卡实际用的模式算(这张卡可以另设 AI 写还是 Jev 标)
   */
  const hasJevKey = Boolean(jevKey?.has_key);
  const jevKinds: JevKinds = useMemo(
    () => ({
      sprite: hasJevKey && switches.sprite && spriteEffective.mode === 'jev',
      bg: hasJevKey && switches.bg && scenePlugin.effective.bg.mode === 'jev',
      bgm: hasJevKey && switches.bgm && scenePlugin.effective.bgm.mode === 'jev',
      cg: hasJevKey && switches.cg && scenePlugin.effective.cg.mode === 'jev',
      player: hasJevKey && playerEffective.mode === 'jev',
    }),
    [hasJevKey, switches, spriteEffective.mode, scenePlugin.effective, playerEffective.mode],
  );
  const jevOn = anyJev(jevKinds);
  /** 插件页右上角关掉的那几路(组装时块不发、标签摘掉) */
  const offKinds = useMemo(() => offKindsOf(switches), [switches]);
  /** 这次不发的插件块和原因:Jev 标的、插件关掉的。左栏显示成关着 */
  const skippedBlocks = useMemo(() => {
    const m = new Map<string, string>();
    for (const id of jevBlockIds(jevKinds)) m.set(id, 'Jev 标 · 不发');
    for (const id of jevBlockIds(offKinds)) m.set(id, '插件关了 · 不发');
    return m;
  }, [jevKinds, offKinds]);
  /** 最新一条 AI 回复的 Jev 统计(插件页标题栏显示) */
  const lastJevStats = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].role === 'assistant') return currentInfo(entries[i])?.jev ?? null;
    }
    return null;
  }, [entries]);

  /** 插件抽屉要打开到哪一页(插件的提示词模板、「Jev 标注」页);nonce 让连点同一个也能再跳一次 */
  const [pluginFocus, setPluginFocus] = useState<PluginFocus | null>(null);
  /** 打开插件抽屉的某一页(API 抽屉里 Jev 那一行的「去设置 →」) */
  const openPluginSection = (section: string) => {
    setDrawer('plugins');
    setPluginFocus({ section, nonce: Date.now() });
  };
  /** 左栏点插件块:不在预设里改,跳到插件抽屉里它的提示词模板 */
  const openPluginEditor = (identifier: string) => {
    const section = pluginOfBlock(identifier);
    setMobileMenu(false);
    // 手机上左栏是盖在聊天区上的,不收起来就看不到抽屉
    if (isMobile) setLeftCollapsed(true);
    setDrawer('plugins');
    setPluginFocus({ section, nonce: Date.now() });
  };

  // 插件的宏({{sprites}}、{{backgrounds}}、{{current_bg}} …)和自定义宏并进同一张查找表 ——
  // 组装提示词和聊天区显示用的都是它,两边展开结果一致。插件宏放后面,同名时插件优先
  const macroLookup = useMemo(
    () => ({
      ...toLookup(customMacros),
      ...spriteMacros(spriteEffective, formSprites),
      ...sceneMacroValues,
    }),
    [customMacros, spriteEffective, formSprites, sceneMacroValues],
  );

  /**
   * 拉人设并把激活的那个套进组装输入。
   * 一个人设都没有时回退到 'User' —— 和没接人设系统之前的行为一致。
   */
  const refreshPersonas = useCallback(async () => {
    try {
      const list = await debugApi.listPersonas();
      setPersonas(list);
      const active = list.find((p) => p.is_active) ?? null;
      setUserName(active ? active.name : 'User');
      setPersona(active ? active.description : '');
    } catch (e) {
      notify('error', `人设列表拉取失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [notify]);

  const activePersona = personas.find((p) => p.is_active) ?? null;

  /** 人设绑角色卡:选卡时自动切到它绑的人设,没绑切回默认人设(见 lib/personaBinding.ts) */
  const [personaBindings, setPersonaBindings] = useState<PersonaBindings>(EMPTY_BINDINGS);
  const changePersonaBindings = (next: PersonaBindings) => {
    setPersonaBindings(next);
    debugApi
      .putSetting(PERSONA_BINDING_KEY, next)
      .catch((e: unknown) =>
        notify('error', `人设绑定保存失败: ${e instanceof Error ? e.message : String(e)}`),
      );
  };
  // selectCard 是 useCallback,读最新的绑定和人设列表走 ref
  const personaRef = useRef({ bindings: personaBindings, personas });
  personaRef.current = { bindings: personaBindings, personas };

  /**
   * 选中一张卡时套用它的人设;已经是那个就不动。不直接弹提示,返回要说的话 ——
   * 选卡时和预设的合成一条。bindings 默认用存着的,卡编辑器里刚改的绑定直接传进来
   */
  // 人设切换排队、只认最后一次:快速点 A 再点 B,两次激活请求谁后到谁生效,
  // A 的晚到就会让屏幕上是 B、激活的却是 A 的人设
  const personaSeq = useRef(0);
  const personaChain = useRef<Promise<unknown>>(Promise.resolve());
  // 刚激活的是谁:排在后面的那次可能在列表重新渲染之前就跑了,personaRef 里的 is_active 还是旧的。
  // 列表一更新(服务器上的状态到了)就作废
  const justActivated = useRef<string | null>(null);
  useEffect(() => {
    justActivated.current = null;
  }, [personas]);
  const applyBoundPersona = useCallback(
    (forCardId: string, bindings?: PersonaBindings): Promise<Said> => {
      const mine = ++personaSeq.current;
      const run = personaChain.current.then(async (): Promise<Said> => {
        if (mine !== personaSeq.current) return null; // 后面又切了,这次不用换了
        const { personas: list } = personaRef.current;
        const target = personaForCard(
          bindings ?? personaRef.current.bindings,
          forCardId,
          list.map((p) => p.id),
        );
        const activeId = justActivated.current ?? list.find((p) => p.is_active)?.id;
        if (!target || target.id === activeId) return null;
        try {
          await debugApi.activatePersona(target.id);
          justActivated.current = target.id;
          await refreshPersonas();
          const name = list.find((p) => p.id === target.id)?.name ?? '';
          return { kind: 'ok', text: `人设换成了「${name}」(${target.bound ? '这张卡绑定的' : '默认人设'})` };
        } catch (e) {
          return { kind: 'error', text: `人设切换失败: ${e instanceof Error ? e.message : String(e)}` };
        }
      });
      personaChain.current = run.catch(() => undefined);
      return run;
    },
    [refreshPersonas],
  );

  /** 预设绑角色卡:选卡、开这张卡的对话时换成绑定的预设,比对话记的优先(见 lib/presetBinding.ts) */
  const [presetBindings, setPresetBindings] = useState<PresetBindings>(EMPTY_PRESET_BINDINGS);
  const changePresetBindings = (next: PresetBindings) => {
    setPresetBindings(next);
    debugApi
      .putSetting(PRESET_BINDING_KEY, next)
      .catch((e: unknown) =>
        notify('error', `预设绑定保存失败: ${e instanceof Error ? e.message : String(e)}`),
      );
  };
  // selectCard / loadChat 是 useCallback,读最新的绑定、预设列表、当前预设走 ref
  const presetRef = useRef({ bindings: presetBindings, saved: savedPresets, id: presetId, dirty: presetDirty });
  presetRef.current = { bindings: presetBindings, saved: savedPresets, id: presetId, dirty: presetDirty };

  /** 人设头像:裁完的 blob 转 data URL 存库,和卡头像一个存法 */
  const changePersonaAvatar = async (personaId: string, blob: Blob) => {
    try {
      const dataUrl = await fileToDataUrl(blob);
      await debugApi.updatePersona(personaId, { avatar: dataUrl });
      await refreshPersonas();
      notify('ok', '人设头像已更新');
    } catch (e) {
      notify('error', `人设头像更新失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const refreshConnections = useCallback(async () => {
    try {
      const list = await debugApi.listConnections();
      setConnections(list);
      // 顶栏「连接」和 API 设置抽屉共用同一个后端 is_active 标记,
      // 谁选了都立刻 activate,这里只需老实跟着它走,两边就自然同步
      setConnectionId(list.find((c) => c.is_active)?.id ?? list[0]?.id);
    } catch (e) {
      notify('error', `连接列表拉取失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [notify]);

  /** 顶栏「连接」下拉选中即启用 —— 和 API 设置抽屉的选中即启用是同一套语义 */
  const selectConnection = useCallback(
    (id: string) => {
      if (!id || id === connectionId) return;
      debugApi
        .activateConnection(id)
        .then(refreshConnections)
        .catch((e: unknown) =>
          notify('error', `切换连接失败: ${e instanceof Error ? e.message : String(e)}`),
        );
    },
    [connectionId, notify, refreshConnections],
  );

  /** 刷新分支树:当前卡 + 孤儿对话(card_id 为空)。显式传卡 id,免得拿到旧闭包 */
  // 只认最后一次:快速切 A → B 时 A 的结果晚到会把 A 的树盖到 B 上
  const treeSeq = useRef(0);
  const refreshTree = useCallback(async (forCardId: string | null) => {
    const seq = ++treeSeq.current;
    setTreeLoading(true);
    try {
      const all = await debugApi.listChats(null);
      if (seq !== treeSeq.current) return;
      setTreeChats(all.filter((c) => c.card_id === forCardId || c.card_id === null));
    } catch {
      // 树是辅助导航,拉取失败不弹错 —— 顶栏下拉和对话本身才是主路径
    } finally {
      if (seq === treeSeq.current) setTreeLoading(false);
    }
  }, []);

  /** 选中一个已存的预设:拉库 → 转成组装器形态 → 清掉临时开关 */
  const selectPreset = useCallback(
    (row: StoredPreset) => {
      try {
        const parsed = presetFromStored(row);
        setPreset(parsed);
        const picked = pickDefaultOrderGroup(parsed.orderGroups);
        setGroupIndex(picked ? parsed.orderGroups.indexOf(picked) : 0);
        setOverrides({});
        setPresetId(row.id);
        setPresetDirty(false);
        // 记成「上次打开的预设」,下次进来默认还是它(酒馆的行为)。
        // 放在这里而不是各个调用点:选预设的入口有好几个(下拉、导入、另存、
        // 读对话时恢复当时的预设),它们最终都会走到这儿
        saveLastPresetId(row.id);
      } catch (e) {
        notify('error', `预设读取失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [notify],
  );

  /**
   * 这张卡绑了预设就换过去;没绑、绑的删了、已经是它都不动。和人设一样返回要说的话。
   * 当前预设有没保存的改动时不换 —— 换了改动就丢了
   */
  const applyBoundPreset = useCallback(
    (forCardId: string | null, bindings = presetRef.current.bindings): Said => {
      const { saved, id, dirty } = presetRef.current;
      const target = presetForCard(
        bindings,
        forCardId,
        saved.map((p) => p.id),
      );
      const row = saved.find((p) => p.id === target);
      if (!row || row.id === id) return null;
      if (dirty) {
        return { kind: 'error', text: `预设有没保存的改动,没换成这张卡绑定的「${row.name}」` };
      }
      selectPreset(row);
      return { kind: 'ok', text: `预设换成了「${row.name}」(这张卡绑定的)` };
    },
    [selectPreset],
  );

  const refreshPresets = useCallback(
    async (selectId?: string) => {
      try {
        const list = await debugApi.listPresets();
        setSavedPresets(list);
        const target = selectId ? list.find((p) => p.id === selectId) : undefined;
        if (target) selectPreset(target);
        return list;
      } catch (e) {
        notify('error', `预设列表拉取失败: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      }
    },
    [notify, selectPreset],
  );

  /**
   * 记下「这张卡上次打开的是哪条对话」,对齐酒馆存在角色身上的 character.chat。
   *
   * 不这么记就只能按 updated_at 挑最近改过的那条,而读一条旧对话并不会动
   * updated_at —— 手动翻回一条老对话、切走再切回来,就会跳到别的对话上。
   *
   * 本地列表同步更新:同一次会话里连着切卡不用重新拉 listCards 也能挑对。
   * 写库失败不打扰用户 —— 书签丢了最多是回退成「最近更新的那条」。
   */
  const rememberLastChat = useCallback((forCardId: string, forChatId: string) => {
    setSavedCards((prev) =>
      prev.map((c) => (c.id === forCardId ? { ...c, last_chat_id: forChatId } : c)),
    );
    void debugApi.updateCard(forCardId, { last_chat_id: forChatId }).catch(() => {});
  }, []);

  /** 读回一张对话:条目、tainted、绑定的卡/预设/用户名各就各位 */
  /** 读一张对话并切过去。返回读到的条目;读失败、或中途又切走了返回 null */
  const loadChat = useCallback(
    async (id: string): Promise<ChatEntry[] | null> => {
      const seq = ++chatSeq.current;
      setChatLoading(true);
      // 收尾只认最后一次:中途切走了就把关灯的活儿留给接班的那次,
      // 否则作废的请求先返回会把还在转的圈提前关掉
      const settle = () => {
        if (seq === chatSeq.current) setChatLoading(false);
      };
      let detail;
      try {
        detail = await debugApi.getChat(id);
      } catch (e) {
        settle();
        notify('error', `对话读取失败: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
      if (seq !== chatSeq.current) return null; // 中途又切走了,这次作废
      setChatId(detail.id);
      // 孤儿对话(card_id 为空)不记书签:它还不属于任何卡,等下面的收养 PATCH
      // 落库之后,下次再打开就带着 card_id 进来了
      if (detail.card_id) rememberLastChat(detail.card_id, detail.id);
      setChats((prev) =>
        prev.map((c) =>
          c.id === detail.id ? { ...detail, message_count: detail.messages.length } : c,
        ),
      );
      const mapped = detail.messages.map((m, i) => fromStored(m, i));
      setEntries(mapped);
      setChatVars(detail.variables ?? {});
      generationType.current = '';
      setTainted(detail.tainted);
      taintedRef.current = detail.tainted;
      metaRef.current = {
        card_id: detail.card_id,
        preset_id: detail.preset_id,
        user_name: detail.user_name,
      };
      persistedRef.current = {
        chatId: detail.id,
        rows: new Map(mapped.map((e, i) => [e.id, { entry: e, idx: i }] as const)),
      };
      // 人设是全局的:开旧对话不把当时的名字倒灌回来,只让它跟着当前激活人设走
      setError(null);
      // 卡绑了预设就用绑定的,不管这条对话当时用的哪套(选卡时一般已经换好,这里多半
      // 什么都不做);没绑才恢复这张对话当时用的预设(还在库里的话)—— 调试台要的是可复现
      const { bindings, saved } = presetRef.current;
      if (presetForCard(bindings, detail.card_id, saved.map((p) => p.id))) {
        const said = applyBoundPreset(detail.card_id);
        if (said?.kind === 'error') notify('error', said.text);
      } else if (detail.preset_id && detail.preset_id !== presetRef.current.id) {
        try {
          const row = await debugApi.getPreset(detail.preset_id);
          if (seq !== chatSeq.current) return null; // settle 交给接班的那次
          // 和换绑定预设一样:有没保存的改动就不换,换了改动就丢了
          if (presetRef.current.dirty) {
            notify('error', `预设有没保存的改动,没换成这张对话当时用的「${row.name}」`);
            // 下面那个同步绑定的 effect 看到「对话记的 ≠ 现在用的」会把现在这套写进对话,
            // 对话原来记的预设就被悄悄改掉了。这次没换是临时的,对话记录保持原样
            metaRef.current.preset_id = presetRef.current.id;
          } else selectPreset(row);
        } catch {
          // 预设被删了:对话里的引用已经是空,不动当前选择
        }
      }
      settle();
      return mapped;
    },
    [selectPreset, applyBoundPreset, notify, rememberLastChat],
  );

  /** 另开一张新对话,旧的留在下拉里 —— 「清空对话」在持久化之后就是这个语义 */
  const newChat = useCallback(
    async (context?: { cardId: string; card: TavernCard }) => {
      // context 让 selectCard 在状态还没提交时也能带着新卡直接开聊
      const c = context?.card ?? card;
      const cid = context?.cardId ?? cardId;
      if (!c || !cid) return;
      // 以前生成中点了什么也不发生(存档页、标题的「新的故事」、历史里的新对话),像是坏了
      if (sending) {
        notify('error', '回复还在生成,先停下再开新对话');
        return;
      }
      const seq = ++chatSeq.current;
      // 也接管 chatLoading:建对话同样是网络往返,而且这一跳会作废在途的 loadChat,
      // 那次的 settle 不会执行 —— 圈得由这里关
      setChatLoading(true);
      let created;
      try {
        created = await debugApi.createChat({
          card_id: cid,
          preset_id: presetId,
          user_name: userName,
        });
      } catch (e) {
        if (seq === chatSeq.current) setChatLoading(false);
        notify('error', `新建对话失败: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      // 开场白就是 chat[0](酒馆的做法),其他开场白当成它的分支。
      //
      // 写库和记书签都放在「有没有被切走」之前:对话已经建出来了,这时候直接
      // 返回会在库里留一条没有开场白的空对话 —— 连点几张卡就攒一堆,下次进这
      // 张卡打开的就是一片空白。两个写的目标都是 created.id / cid,跟「现在在看
      // 哪张卡」无关,晚到也不会串到别人身上。
      const greeting = makeGreetingEntry(c);
      const seeded = greeting ? [greeting] : [];
      // persist effect 在「换对话」边沿只认账不回写,所以开场白得当场写
      seeded.forEach((entry, i) => {
        void debugApi.putChatMessage(created.id, toStored(entry, i)).catch((e: unknown) =>
          notify('error', `对话保存失败: ${e instanceof Error ? e.message : String(e)}`),
        );
      });
      rememberLastChat(cid, created.id);

      if (seq !== chatSeq.current) return; // 切走了:库里那条是完整的,只是不显示
      setChatLoading(false);
      setChatId(created.id);
      setChats((prev) => [{ ...created, message_count: seeded.length }, ...prev]);
      refreshTree(cid);
      setEntries(seeded);
      setChatVars({});
      generationType.current = '';
      setTainted(false);
      taintedRef.current = false;
      metaRef.current = { card_id: cid, preset_id: presetId, user_name: userName };
      persistedRef.current = {
        chatId: created.id,
        rows: new Map(seeded.map((e, i) => [e.id, { entry: e, idx: i }] as const)),
      };
      setError(null);
    },
    [card, cardId, presetId, userName, sending, notify, refreshTree, rememberLastChat],
  );

  /**
   * 选中一张已存的卡:转成组装器形态,头像单独拉,然后接上它最近的对话。
   * fresh = 不接旧对话,直接开一段新的(视觉小说标题画面的「新的故事」)
   */
  const selectCard = useCallback(
    async (row: StoredCard, opts?: { fresh?: boolean }) => {
      const seq = ++cardSeq.current;
      const parsed = cardFromStored(row);
      setCard(parsed);
      setCardId(row.id);
      setCardSaveState('idle');
      // 这张卡绑了人设就换过去(没绑换回默认人设),{{user}} 在开场白里一开始就对;
      // 绑了预设也换过去 —— 要在开新对话之前,新对话记的就是它。两句合成一条提示
      const said = [await applyBoundPersona(row.id), applyBoundPreset(row.id)].filter(
        (s): s is NonNullable<Said> => s !== null,
      );
      if (said.length > 0) {
        notify(
          said.some((s) => s.kind === 'error') ? 'error' : 'ok',
          said.map((s) => s.text).join(';'),
        );
      }
      // 从列表点进来的:选完就回编辑器,列表只是选角色的入口
      setCardView('editor');
      setAvatarUrl((prev) => {
        // 库里的头像是 data URL,不是 object URL,但上一张可能是,该释放还得释放
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return null;
      });
      if (row.has_avatar) {
        const dataUrl = await debugApi.getCardAvatar(row.id);
        // 头像缓存按 id 存,谁先到都对;但编辑区的大图只认最后一次选择
        if (dataUrl) {
          setCardAvatars((prev) => {
            if (prev.get(row.id) === dataUrl) return prev;
            const next = new Map(prev);
            next.set(row.id, dataUrl);
            return next;
          });
          if (seq === cardSeq.current) setAvatarUrl(dataUrl);
        }
      }
      // 这张卡上次打开的那条对话,没有就开一张新的 —— 贴酒馆「每个角色有自己的对话」
      const list = await debugApi.listChats(row.id);
      if (seq !== cardSeq.current) return; // 中途又选了别的卡,这次作废
      setChats(list);
      refreshTree(row.id);
      // 书签可能悬空:那条对话被删了,或者被挪去了别的卡。list 里找不着就回退到
      // 最近更新的一条 —— 也就是没有书签之前的老行为
      const bookmarked = row.last_chat_id
        ? list.find((c) => c.id === row.last_chat_id)
        : undefined;
      const target = bookmarked ?? list[0];
      if (target && !opts?.fresh) {
        await loadChat(target.id);
      } else {
        await newChat({ cardId: row.id, card: parsed });
      }
    },
    [loadChat, newChat, refreshTree, applyBoundPersona, applyBoundPreset, notify],
  );

  /** 「从这里开始」—— 复制 [0, 该消息] 前缀到新分支,然后切过去 */
  const branchHere = useCallback(
    async (messageId: string) => {
      if (!chatId || chatOp) return;
      if (sending) {
        notify('error', '回复还在生成,先停下再从这里分支');
        return;
      }
      setChatOp('branch');
      try {
        const created = await debugApi.branchChat(chatId, messageId);
        setChats(await debugApi.listChats(cardId));
        refreshTree(cardId);
        await loadChat(created.id);
        notify('ok', `已从这里分叉:「${created.name}」`);
      } catch (e) {
        notify('error', `分叉失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setChatOp(null);
      }
    },
    [chatId, cardId, sending, chatOp, loadChat, refreshTree, notify],
  );

  /**
   * 视觉小说的「在当前位置存档」:和分叉是同一个接口,但人留在原对话里接着玩 ——
   * 新分出来的那个对话就是存档,以后从存档页读回来
   */
  const saveBranch = useCallback(
    async (messageId: string | null) => {
      if (!chatId || !messageId || sending || chatOp) return;
      setChatOp('branch');
      try {
        const created = await debugApi.branchChat(chatId, messageId);
        setChats(await debugApi.listChats(cardId));
        refreshTree(cardId);
        notify('ok', `已存档:「${created.name}」`);
      } catch (e) {
        notify('error', `存档失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setChatOp(null);
      }
    },
    [chatId, cardId, sending, chatOp, refreshTree, notify],
  );

  /** 导入酒馆 jsonl 对话(可多选)。匹配到当前卡的会直接切过去看 */
  const importChats = async (files: File[]) => {
    if (files.length === 0 || chatOp) return;
    setChatOp('import');
    try {
      const created = await debugApi.importChats(files);
      setChats(await debugApi.listChats(cardId));
      refreshTree(cardId);
      const inView = created.find((c) => c.card_id === cardId);
      if (inView) await loadChat(inView.id);
      notify('ok', `已导入 ${created.length} 条对话`);
    } catch (e) {
      notify('error', `对话导入失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setChatOp(null);
    }
  };

  /** 导出:整树要在后端打包 zip,大的话要等一会儿,所以也占一个 pending 位。
   *  id 省略就是导出当前对话;历史面板的行内导出把那一行的 id 传进来,
   *  省掉「先切过去再导」这一步 */
  const runExport = async (tree: boolean, id: string | null = chatId) => {
    if (!id || chatOp) return;
    setChatOp(tree ? 'exportTree' : 'export');
    try {
      await debugApi.exportChat(id, tree);
    } catch (e) {
      notify('error', `导出失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setChatOp(null);
    }
  };

  /** 历史面板的行内重命名。名字只影响列表和导出文件名,不碰消息 */
  const renameChat = async (id: string, name: string) => {
    try {
      await debugApi.updateChat(id, { name });
      setChats(await debugApi.listChats(cardId));
      refreshTree(cardId);
    } catch (e) {
      notify('error', `重命名失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 历史面板的行内删除。删掉的正好是当前这条就得换一条,否则界面还挂在
   *  一个已经不存在的 chatId 上 —— 之后任何一次消息回写都会 404 */
  const removeChat = async (id: string) => {
    try {
      await debugApi.deleteChat(id);
      const list = await debugApi.listChats(cardId);
      setChats(list);
      refreshTree(cardId);
      if (id === chatId) {
        const next = list.find((c) => c.id !== id);
        if (next) await loadChat(next.id);
        else await newChat();
      }
      notify('ok', '已删除对话');
    } catch (e) {
      notify('error', `删除失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 历史分支的「看提示词」:在库的按哈希取(带缓存),这会儿在内存的直接看 */
  const inspectSwipe = useCallback(
    async (info: SwipeInfo) => {
      if (info.snapshot) {
        setInspecting(info.snapshot);
        return;
      }
      if (!info.snapshotHash) return;
      const cached = snapCache.current.get(info.snapshotHash);
      if (cached) {
        setInspecting(cached);
        return;
      }
      try {
        const payload = await debugApi.getSnapshot(info.snapshotHash);
        snapCache.current.set(info.snapshotHash, payload);
        setInspecting(payload);
      } catch (e) {
        notify('error', `快照读取失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [notify],
  );

  // 只跑一次:StrictMode 会双跑 effect,第二跑会把第一跑刚建的对话再建一份
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    refreshConnections();
    refreshPersonas();
    // 立绘 / 外语 / 玩家台词 / Jev 的插件配置由 usePluginConfig 自己开机读
    debugApi
      .getSetting(PERSONA_BINDING_KEY)
      .then((v) => {
        if (v !== null) setPersonaBindings(normalizeBindings(v));
      })
      .catch((e: unknown) =>
        notify('error', `人设绑定读取失败: ${e instanceof Error ? e.message : String(e)}`),
      );
    debugApi
      .getSetting(PRESET_BINDING_KEY)
      .then((v) => {
        if (v !== null) setPresetBindings(normalizePresetBindings(v));
      })
      .catch((e: unknown) =>
        notify('error', `预设绑定读取失败: ${e instanceof Error ? e.message : String(e)}`),
      );
    debugApi
      .annotateStatus()
      .then(setJevKey)
      .catch(() => setJevKey({ has_key: false, source: null }));
    // 后端还是旧版(没有这个接口)时为 null:插件页提示重启后端
    debugApi
      .annotateDefaults()
      .then(setJevDefaults)
      .catch(() => setJevDefaults(null));
    debugApi
      .health()
      .then((h) => setVersion(h.version))
      .catch(() => setVersion(''));
    // 开局恢复上次用的预设,但**不**自动选角色卡 —— 每次进来停在开始界面,
    // 由用户挑角色。预设是全局配置(酒馆也是关掉再开还是那套),角色卡是
    // 「这次想聊谁」,不该替人决定。
    // deps 必须为空:selectPreset 进 deps 会在读对话恢复预设时身份变化 →
    // 开机重跑 → 又选回上次那个 → 振荡
    void (async () => {
      try {
        const list = await debugApi.listPresets();
        setSavedPresets(list);
        // 记着的那个可能已经被删了,找不着就退回第一个
        const remembered = loadLastPresetId();
        const target = (remembered && list.find((p) => p.id === remembered)) || list[0];
        if (target) selectPreset(target);
      } catch (e) {
        notify('error', `预设列表拉取失败: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        setSavedCards(await debugApi.listCards());
      } catch (e) {
        notify('error', `角色卡列表拉取失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载时清掉挂着的计时器,免得组件没了还在跑
  useEffect(
    () => () => {
      window.clearTimeout(cardSaveTimer.current);
      window.clearTimeout(savedFlagTimer.current);
    },
    [],
  );

  /** 立绘怎么摆:所有角色共用的构图、当前包的微调,顺带给没找过脸的立绘补识别 */
  const spriteLayout = useSpriteLayout(spritePacks.packId, sprites, spritePacks.changeSprites, notify);

  /**
   * 卡面头像按需懒加载:谁要显示谁开口(wantAvatars),没人要的一张都不拉 —— 卡面头像是整张
   * 卡图转的 data URL,一张能有近 1 MB(刷新页面时靠 ETag 回 304)。角色列表挂出来时要全部;
   * 视觉小说的标题画面、等待页平时用按脸裁的小图,只有小图读不到时才要那一张
   * (以前一进视觉小说就全拉,公网上和等待页要等的图抢带宽)。
   * 拉到进 cardAvatars 缓存,删卡时清掉。
   * avatarRequested 防重:缓存每次更新都会重跑这个 effect。拉到了也不划掉 —— 渲染是切片的,
   * 「写进缓存」那次提交之前别的头像先触发一次重跑,就会看到这张既不在缓存里、也不在途,
   * 以前每次进来都有几张被拉两遍。只有拉失败才划掉,下次有人要时再试。
   */
  const [avatarWanted, setAvatarWanted] = useState<ReadonlySet<string>>(() => new Set());
  const wantAvatars = useCallback((ids: readonly string[]) => {
    setAvatarWanted((prev) => (ids.every((id) => prev.has(id)) ? prev : new Set([...prev, ...ids])));
  }, []);
  const avatarRequested = useRef(new Set<string>());
  useEffect(() => {
    for (const c of savedCards) {
      if (!avatarWanted.has(c.id)) continue;
      if (!c.has_avatar || cardAvatars.has(c.id) || avatarRequested.current.has(c.id)) continue;
      avatarRequested.current.add(c.id);
      debugApi
        .getCardAvatar(c.id)
        .then((dataUrl) => {
          if (!dataUrl) {
            avatarRequested.current.delete(c.id);
            return;
          }
          setCardAvatars((prev) => {
            if (prev.has(c.id)) return prev;
            const next = new Map(prev);
            next.set(c.id, dataUrl);
            return next;
          });
        })
        .catch(() => {
          // 拉不到就用默认头像兜底,不弹错 —— 列表是导航,不是告警通道
          avatarRequested.current.delete(c.id);
        });
    }
  }, [avatarWanted, savedCards, cardAvatars]);

  // ---- 角色卡:自动保存 + CRUD ----
  // (导入角色卡走导入器 importer/:卡、立绘、背景、曲子、CG 一起拖进来也行,见下面卡编辑器那一段)

  /**
   * 改字段:立刻更新内存(输入框要跟手),然后 debounce 600ms 写库。
   * 和预设的显式保存不同 —— 卡的编辑是确定性的改动,不需要「试完丢弃」。
   */
  const changeCard = (patch: Partial<TavernCard>) => {
    if (!card) return;
    const next = { ...card, ...patch };
    setCard(next);
    if (!cardId) return;

    window.clearTimeout(cardSaveTimer.current);
    setCardSaveState('saving');
    cardSaveTimer.current = window.setTimeout(async () => {
      try {
        await debugApi.updateCard(cardId, cardToStored(next));
        setSavedCards(await debugApi.listCards());
        setCardSaveState('saved');
        window.clearTimeout(savedFlagTimer.current);
        savedFlagTimer.current = window.setTimeout(() => setCardSaveState('idle'), 1600);
      } catch (e) {
        setCardSaveState('idle');
        notify('error', `保存失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, 600);
  };

  const newCard = async () => {
    setCardBusy(true);
    try {
      const created = await debugApi.createCard({ ...cardToStored(EMPTY_CARD), name: '新角色' });
      setSavedCards(await debugApi.listCards());
      await selectCard(created);
      notify('ok', '已新建角色卡');
    } catch (e) {
      notify('error', `新建失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCardBusy(false);
    }
  };

  const duplicateCard = async () => {
    if (!cardId) return;
    setCardBusy(true);
    try {
      const copy = await debugApi.duplicateCard(cardId);
      // 绑定跟着复制(立绘、语音后端复制时已经带上了)
      if (personaBindings.cards[cardId]) {
        changePersonaBindings(bindCard(personaBindings, copy.id, personaBindings.cards[cardId]));
      }
      if (presetBindings.cards[cardId]) {
        changePresetBindings(bindCard(presetBindings, copy.id, presetBindings.cards[cardId]));
      }
      setSavedCards(await debugApi.listCards());
      await selectCard(copy);
      notify('ok', `已复制为「${copy.name}」`);
    } catch (e) {
      notify('error', `复制失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCardBusy(false);
    }
  };

  /** 卡面板的删除:先问一句 */
  const deleteCard = async () => {
    if (!cardId || !card) return;
    if (!window.confirm(`确定删除角色卡「${card.name || '(无名)'}」? 这个操作不可撤销。`)) return;
    await removeCard();
  };

  /** 当前卡没了(删掉了、撤销了导入它的那次):换成列表里第一张,一张都没有就清空 */
  const leaveCard = async (list: StoredCard[]) => {
    if (list[0]) {
      await selectCard(list[0]);
      return;
    }
    setCard(null);
    setCardId(null);
    setAvatarUrl(null);
    setEntries([]);
    // 对话留在库里(卡删了引用自动置空),只是界面上没地方挂它了
    setChats([]);
    setTreeChats([]);
    setChatId(null);
    persistedRef.current = { chatId: null, rows: new Map() };
  };

  /** 删掉当前这张卡(已经确认过:卡面板问过一句,卡编辑器里点过两下)。删成了返回 true */
  const removeCard = async (): Promise<boolean> => {
    if (!cardId) return false;
    setCardBusy(true);
    try {
      // 别让在途的自动保存把刚删的卡又写回去
      window.clearTimeout(cardSaveTimer.current);
      await debugApi.deleteCard(cardId);
      if (personaBindings.cards[cardId]) changePersonaBindings(bindCard(personaBindings, cardId, null));
      if (presetBindings.cards[cardId]) changePresetBindings(bindCard(presetBindings, cardId, null));
      // 列表缓存里的头像一起清
      setCardAvatars((prev) => {
        if (!prev.has(cardId)) return prev;
        const next = new Map(prev);
        next.delete(cardId);
        return next;
      });
      const list = await debugApi.listCards();
      setSavedCards(list);
      await leaveCard(list);
      notify('ok', '已删除');
      return true;
    } catch (e) {
      notify('error', `删除失败: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setCardBusy(false);
    }
  };

  /** 导出成 JSON。头像一起写进去 —— 不然导出再导入回来就成了无图卡 */
  const exportCard = async () => {
    if (!card) return;
    setBusyLabel('正在导出角色卡……');
    try {
      const avatar = avatarUrl ?? (cardId ? await debugApi.getCardAvatar(cardId) : null);
      const url = URL.createObjectURL(
        new Blob([cardToFileJson(card, avatar)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `${card.name || 'character'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify('error', `导出失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyLabel(null);
    }
  };

  const changeAvatar = async (blob: Blob) => {
    if (!cardId) return;
    setCardBusy(true);
    try {
      const dataUrl = await fileToDataUrl(blob);
      await debugApi.updateCard(cardId, { avatar: dataUrl });
      setAvatarUrl(dataUrl);
      // 列表缓存同步换脸,不然列表里还是旧图
      setCardAvatars((prev) => {
        const next = new Map(prev);
        next.set(cardId, dataUrl);
        return next;
      });
      setSavedCards(await debugApi.listCards());
      notify('ok', '头像已更新');
    } catch (e) {
      notify('error', `头像更新失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCardBusy(false);
    }
  };

  /** 导入文件 = 解析 + 直接存进库,之后就出现在下拉里 */
  const loadPreset = async (file: File) => {
    setPresetBusy(true);
    setBusyLabel('正在导入预设……');
    try {
      const parsed = parsePreset(await file.text(), file.name.replace(/\.json$/i, ''));
      // -1 = 不替换任何编排组,原样入库(导入时还没有临时开关要合并)
      const created = await debugApi.createPreset(presetToStored(parsed, -1, []));
      await refreshPresets(created.id);
      // 后端对撞名的预设强制加了后缀,所以报名字要用它回给的,不是文件里的
      notify(
        'ok',
        `已导入预设「${created.name}」· ${parsed.prompts.length} 个块 / ${parsed.orderGroups.length} 组编排`,
      );
    } catch (e) {
      notify('error', `预设导入失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPresetBusy(false);
      setBusyLabel(null);
    }
  };

  // ---- 组装 ----

  const order: PresetOrderEntry[] = useMemo(() => {
    const group = preset?.orderGroups[groupIndex];
    if (!group) return [];
    return group.order.map((o) => ({
      ...o,
      enabled: overrides[o.identifier] ?? o.enabled,
    }));
  }, [preset, groupIndex, overrides]);
  // 组装期的插件规则(core/assembly.ts):在用 Jev 的插件块不发;开着的标签插件块全是 Jev 时,外语块换成
  // 不提标签的版本;组装完摘掉 Jev 负责的标签。只影响发出去的提示词,左栏看到、保存的还是原来的
  // 自动补块(设计稿 2.7):AI 模式的那一路、这张卡有跟着它走的素材、当前编排组里完全没有这块时,这次组装里补上
  const langEffective = useMemo(
    () => effectiveOf(langConfig, cardPrefs, LANG_SETTING_KEY, normalizeLangConfig),
    [langConfig, cardPrefs],
  );
  const autoFill: AutoFill = useMemo(() => {
    const cgs = cgsOf(activeSceneAssets);
    return {
      enabled: assemblyConfig.autoFill,
      configuredJev: {
        sprite: spriteEffective.mode === 'jev',
        bg: scenePlugin.effective.bg.mode === 'jev',
        bgm: scenePlugin.effective.bgm.mode === 'jev',
        cg: scenePlugin.effective.cg.mode === 'jev',
        player: playerEffective.mode === 'jev',
      },
      material: {
        // 跟着表情走的:启用的立绘、能念的主声音、有差分的 CG
        sprite:
          activeSprites.length > 0 ||
          Boolean(voicePlugin.cast.main?.connection_id) ||
          activeSceneAssets.some((a) => a.kind === 'cg' && a.parent_id),
        bg: backgroundsOf(activeSceneAssets).length > 0,
        bgm: bgmsOf(activeSceneAssets).length > 0,
        cg: cgs.some((a) => !cgOkNow || cgOkNow(a)),
      },
      lang: langEffective.autoFill,
      blocks: {
        [SPRITE_BLOCK_ID]: { identifier: SPRITE_BLOCK_ID, name: SPRITE_BLOCK_NAME, content: spriteConfig.blockPrompt },
        [SCENE.bg.blockId]: { identifier: SCENE.bg.blockId, name: SCENE.bg.blockName, content: scenePlugin.configs.bg.blockPrompt },
        [SCENE.bgm.blockId]: { identifier: SCENE.bgm.blockId, name: SCENE.bgm.blockName, content: scenePlugin.configs.bgm.blockPrompt },
        [SCENE.cg.blockId]: { identifier: SCENE.cg.blockId, name: SCENE.cg.blockName, content: scenePlugin.configs.cg.blockPrompt },
        [LANG_BLOCK_ID]: { identifier: LANG_BLOCK_ID, name: LANG_BLOCK_NAME, content: langConfig.blockPrompt },
      },
      // Anthropic 格式的连接(库里的 kimi、glm):补的块并进最后一个 user 回合,不进开头的 system
      lastUserTurn: connections.find((c) => c.id === connectionId)?.api_type === 'anthropic',
    };
  }, [
    assemblyConfig.autoFill,
    spriteEffective.mode,
    scenePlugin.effective,
    scenePlugin.configs,
    playerEffective.mode,
    activeSprites,
    voicePlugin.cast.main,
    activeSceneAssets,
    cgOkNow,
    langEffective.autoFill,
    spriteConfig.blockPrompt,
    langConfig.blockPrompt,
    connections,
    connectionId,
  ]);
  const assemblyPass = useMemo(
    () => pluginAssemblyPass({ preset, order, jevKinds, offKinds, vnKinds, autoFill }),
    [preset, order, jevKinds, offKinds, vnKinds, autoFill],
  );
  const {
    preset: assemblyPreset,
    order: assemblyOrder,
    stripKinds: jevStripKinds,
    lastUserTurn: autoToLastUser,
  } = assemblyPass;

  // ---- 预设 CRUD ----

  const savePreset = async () => {
    if (!preset || !presetId) return;
    setPresetBusy(true);
    try {
      await debugApi.updatePreset(presetId, presetToStored(preset, groupIndex, order));
      const list = await debugApi.listPresets();
      setSavedPresets(list);
      // 开关已经写进 prompt_order 了:内存里的编排也换成合并后的,再清覆盖层,
      // 不然覆盖层一清就退回保存前的开关
      setPreset({
        ...preset,
        orderGroups: preset.orderGroups.map((g, i) => (i === groupIndex ? { ...g, order } : g)),
      });
      setOverrides({});
      setPresetDirty(false);
      notify('ok', `已保存预设「${preset.name}」`);
    } catch (e) {
      notify('error', `保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPresetBusy(false);
    }
  };

  const savePresetAs = async () => {
    if (!preset) return;
    const name = window.prompt('另存为新预设,取个名字:', `${preset.name} - 副本`);
    if (name === null) return;
    if (!name.trim()) {
      notify('error', '预设名不能为空');
      return;
    }
    setPresetBusy(true);
    try {
      const created = await debugApi.createPreset({
        ...presetToStored(preset, groupIndex, order),
        name: name.trim(),
      });
      await refreshPresets(created.id);
      notify('ok', `已另存为「${created.name}」`);
    } catch (e) {
      notify('error', `另存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPresetBusy(false);
    }
  };

  /**
   * 新建预设:标准骨架(酒馆默认那 10 个块),直接入库并选中 ——
   * 和导入同一条路径。「从无到有」不靠它不行:⧉ 另存为只是复制当前,
   * 库里一个预设都没有时(或默认预设被删了)只有这条路能不靠导入起家。
   */
  const newPreset = async () => {
    // 建完会选中新预设 —— 等于切走,未保存的改动会丢,和下拉的守卫保持一致
    if (presetDirty && !window.confirm('当前预设有未保存的改动,新建会切走并丢弃。继续?')) return;
    const name = window.prompt('新建预设,取个名字:', '未命名预设');
    if (name === null) return;
    if (!name.trim()) {
      notify('error', '预设名不能为空');
      return;
    }
    setPresetBusy(true);
    try {
      // -1 = 不合并任何工作层,骨架原样入库(同导入)
      const created = await debugApi.createPreset(
        presetToStored(buildPresetSkeleton(name.trim()), -1, []),
      );
      await refreshPresets(created.id);
      notify('ok', `已新建预设「${created.name}」· 10 个标准块`);
    } catch (e) {
      notify('error', `新建失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPresetBusy(false);
    }
  };

  const renamePreset = async () => {
    if (!preset || !presetId) return;
    const name = window.prompt('重命名预设:', preset.name);
    if (name === null) return;
    if (!name.trim()) {
      notify('error', '预设名不能为空');
      return;
    }
    setPresetBusy(true);
    try {
      // 撞名的话后端会加后缀,界面得跟它对齐,不能拿用户输的那个名字
      const updated = await debugApi.updatePreset(presetId, { name: name.trim() });
      setPreset({ ...preset, name: updated.name });
      setSavedPresets(await debugApi.listPresets());
      notify('ok', `已重命名为「${updated.name}」`);
    } catch (e) {
      notify('error', `重命名失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPresetBusy(false);
    }
  };

  /** 丢弃未保存的改动,从库里重新拉一份 */
  const restorePreset = async () => {
    if (!presetId) return;
    setPresetBusy(true);
    try {
      const row = savedPresets.find((p) => p.id === presetId);
      if (row) {
        selectPreset(row);
        notify('ok', '已恢复到上次保存的状态');
      }
    } finally {
      setPresetBusy(false);
    }
  };

  const deletePreset = async () => {
    if (!presetId || !preset) return;
    if (!window.confirm(`确定删除预设「${preset.name}」? 这个操作不可撤销。`)) return;
    setPresetBusy(true);
    try {
      await debugApi.deletePreset(presetId);
      const cleaned = forgetPreset(presetBindings, presetId);
      if (JSON.stringify(cleaned) !== JSON.stringify(presetBindings)) changePresetBindings(cleaned);
      const list = await debugApi.listPresets();
      setSavedPresets(list);
      if (list[0]) {
        selectPreset(list[0]);
      } else {
        setPreset(null);
        setPresetId(null);
        setPresetDirty(false);
      }
      notify('ok', '已删除');
    } catch (e) {
      notify('error', `删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPresetBusy(false);
    }
  };

  const exportPreset = () => {
    if (!preset) return;
    const json = presetToFileJson(presetToStored(preset, groupIndex, order));
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${preset.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 改块的任意字段:只动内存,标脏,等用户点保存 */
  /** 编排里开关一块:只写覆盖层 + 标脏,点「存」才落库(和酒馆一样) */
  const toggleBlock = (identifier: string) => {
    setOverrides((prev) => {
      const current =
        prev[identifier] ??
        preset?.orderGroups[groupIndex]?.order.find((o) => o.identifier === identifier)?.enabled ??
        false;
      return { ...prev, [identifier]: !current };
    });
    setPresetDirty(true);
  };

  /** 把插件块加进当前预设。和手动加块一样只动内存,点「存」才写回 */
  const insertPluginBlock = (kind: PluginKey) => {
    if (!preset) return;
    const identifier = blockIdOf(kind);
    setPreset(
      kind === 'sprite'
        ? insertSpriteBlock(preset, groupIndex, spriteConfig.blockPrompt)
        : kind === 'lang'
          ? insertLangBlock(preset, groupIndex, langConfig.blockPrompt)
          : kind === 'player'
            ? insertPlayerBlock(preset, groupIndex, playerConfig.blockPrompt)
            : insertSceneBlock(kind, preset, groupIndex, scenePlugin.configs[kind].blockPrompt),
    );
    // 块在库里、却在编排里被关着的情况,覆盖层里可能记着 false —— 加入就是要开
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[identifier];
      return next;
    });
    setPresetDirty(true);
  };

  /** 插件抽屉里「提示词块」那一组要的状态和操作 */
  const blockControls = (kind: PluginKey) => {
    const identifier = blockIdOf(kind);
    return {
      state:
        kind === 'sprite'
          ? spriteBlockState(preset, order)
          : kind === 'lang'
            ? langBlockState(preset, order)
            : kind === 'player'
              ? playerBlockState(preset, order)
              : sceneBlockState(kind, preset, order),
      onInsert: () => insertPluginBlock(kind),
      onToggle: () => toggleBlock(identifier),
      onRemove: () => deleteBlock(identifier),
    };
  };

  const updateBlock = (identifier: string, patch: Partial<PresetPrompt>) => {
    if (!preset) return;
    setPreset({
      ...preset,
      prompts: preset.prompts.map((p) => (p.identifier === identifier ? { ...p, ...patch } : p)),
    });
    setPresetDirty(true);
  };

  /**
   * 拖拽改编排顺序:同样只动内存,标脏。to = 移除源项之后的目标下标。
   *
   * order 是 useMemo 派生的、overrides 只存 enabled 覆写,装不下顺序,
   * 所以直接改 orderGroups。overrides 按 identifier 存,重排后自动跟着走。
   */
  const reorderBlock = (from: number, to: number) => {
    if (!preset || from === to) return;
    const group = preset.orderGroups[groupIndex];
    if (!group) return;
    const next = [...group.order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPreset({
      ...preset,
      orderGroups: preset.orderGroups.map((g, i) => (i === groupIndex ? { ...g, order: next } : g)),
    });
    setPresetDirty(true);
  };

  /**
   * 正被角色卡顶替的预设块。
   *
   * 覆盖一直开着(两处 assemble 调用点的 allowCardOverrides 都是 true),
   * 而且是静默发生的 —— 一张带 system_prompt 的卡会直接顶掉你的 main 块。
   * 调试台不该藏这个。
   */
  /**
   * 新建块:必须**同时**进块库和当前编排。
   *
   * 只进 prompts 的话它躺在库里永远不显示;只进 order 的话它是个悬空引用,
   * 组装时会被记成「块不存在于预设」。两处都写才是一个真正存在的块。
   *
   * 追加在编排末尾 —— 和左栏那颗「+」在列表底部的位置对得上,
   * 新块就出现在按钮原来待的地方,想挪再拖。
   *
   * 返回新块的 identifier,左栏拿它立刻把详情弹窗开起来:
   * 不然用户会得到一个没名字没内容的空块,还得自己去找它在哪。
   */
  const addBlock = (): string | null => {
    if (!preset) return null;
    const identifier = uuid();
    const prompt: PresetPrompt = {
      identifier,
      name: '新块',
      role: 'system',
      content: '',
      marker: false,
      // 用户自己建的,不是酒馆内置的那四个
      systemPrompt: false,
      injectionPosition: 0,
      injectionDepth: 4,
      injectionOrder: 100,
      injectionTrigger: [],
      forbidOverrides: false,
    };

    // 预设可能一组编排都没有(prompt_order 不是数组的畸形预设) —— 补一组,
    // 否则新块进了库却没地方放,等于白建
    const groups =
      preset.orderGroups.length > 0
        ? preset.orderGroups
        : [{ characterId: 100000, order: [] }];
    const targetIndex = groups[groupIndex] ? groupIndex : 0;

    setPreset({
      ...preset,
      prompts: [...preset.prompts, prompt],
      orderGroups: groups.map((g, i) =>
        i === targetIndex ? { ...g, order: [...g.order, { identifier, enabled: true }] } : g,
      ),
    });
    setPresetDirty(true);
    return identifier;
  };

  /**
   * 删块 —— 只允许删用户自建的块(非 marker、非内置),规则同酒馆:
   * 内置的那几个只能关不能删,关掉已经等于不发了。
   *
   * 要从**所有**编排组里清掉,不只当前这组 —— 预设可以按角色存多组编排,
   * 只清当前组的话,别的组里会留下一个指向已删块的悬空引用。
   */
  const deleteBlock = (identifier: string) => {
    if (!preset) return;
    setPreset({
      ...preset,
      prompts: preset.prompts.filter((p) => p.identifier !== identifier),
      orderGroups: preset.orderGroups.map((g) => ({
        ...g,
        order: g.order.filter((o) => o.identifier !== identifier),
      })),
    });
    setPresetDirty(true);
  };

  /**
   * marker 块的内容来源 —— 左栏点「⋯」看详情时用。
   *
   * 卡填的那几个(角色描述 / 性格 / 场景 / 示例对话)能在弹窗里直接改,
   * 确定后走 changeCard 写回卡;人设、聊天记录、世界书不在卡里,只指路。
   */
  const resolveMarker = useCallback(
    (identifier: string) => resolveMarkerSource(identifier, card, preset),
    [card, preset],
  );

  const overriddenIdentifiers = useMemo(() => {
    const s = new Set<string>();
    if (!card || !preset) return s;
    for (const p of preset.prompts) {
      if (p.marker || p.forbidOverrides) continue;
      if (p.identifier === 'main' && card.system_prompt.trim()) s.add('main');
      if (p.identifier === 'jailbreak' && card.post_history_instructions.trim()) {
        s.add('jailbreak');
      }
    }
    return s;
  }, [card, preset]);

  // 发给模型的历史是「原文 + Jev 另外存的标注」(plugins/jevNotes.ts);现在是 Jev 模式的那几类,
  // 组装完再整个摘掉(assembleForSend)—— 切回 AI 写以后,以前 Jev 标的照样当示例
  const history: ChatTurn[] = useMemo(
    () => entries.map((e) => ({ role: e.role, content: jevText(e, vnKinds) })),
    [entries, vnKinds],
  );

  /** 聊天区显示时展开宏用的取值。和组装提示词共用同一个构造函数,两边不会算出不同的 {{user}} */
  const displayMacros = useMemo(
    () =>
      buildMacroContext({
        card,
        userName,
        personaDescription: persona,
        history,
        custom: macroLookup,
        variables,
        extra: { chatId: chatId ?? '', isMobile },
      }),
    [card, userName, persona, history, macroLookup, variables, chatId, isMobile],
  );

  const activeConnection = connections.find((c) => c.id === connectionId) ?? null;

  /** 当前连接上次拉取并存库的模型列表 —— 顶栏模型下拉的选项就是它 */
  const cachedModels = activeConnection?.cached_models ?? [];
  const activeModel = activeConnection?.model ?? '';
  const modelInList = cachedModels.includes(activeModel);

  /**
   * 顶栏「模型」选中 = 改当前连接的 model 字段 —— 和 API 设置抽屉里的模型名是同一个
   * 值,两边都从 connections 渲染,所以改哪边另一边都跟着变。先乐观写本地,免得下拉回跳
   */
  const pickModel = (model: string) => {
    if (!connectionId || !model) return;
    setConnections((prev) => prev.map((c) => (c.id === connectionId ? { ...c, model } : c)));
    debugApi
      .updateConnection(connectionId, { model })
      .catch((e: unknown) =>
        notify('error', `切换模型失败: ${e instanceof Error ? e.message : String(e)}`),
      )
      .finally(refreshConnections);
  };

  /** 现拉一次模型列表并写回连接(后端会存进 cached_models) */
  const refreshModelList = async () => {
    if (!connectionId) return;
    setModelsRefreshing(true);
    try {
      const list = await debugApi.refreshConnectionModels(connectionId);
      await refreshConnections();
      notify('ok', `拉到 ${list.length} 个模型`);
    } catch (e) {
      notify('error', `模型列表拉取失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setModelsRefreshing(false);
    }
  };
  // 流式与否是端点的属性,存在连接上;拿不到连接时默认试流式
  const useStreaming = activeConnection?.stream ?? true;

  /**
   * 滑动判定要读的状态。
   *
   * 不能直接用闭包里的 entries/tainted:连点两下时,第二下的处理器有可能来自
   * 还没提交的那次渲染,拿着旧的 swipeIndex 去判断「是不是最后一个分支」——
   * 判错的后果是本该循环的开场白真的去调了一次 API。ref 在每次提交后同步,
   * 读到的永远是最新的已提交状态。
   */
  const latest = useRef({ entries, tainted, sending });
  useEffect(() => {
    latest.current = { entries, tainted, sending };
  });

  /**
   * 逐操作写库:entries 每次提交后和水位线比引用/位置,变了的按 id upsert、
   * 消失的删除。patch() 只会替换目标条目的对象,所以引用比对就能精确圈出
   * 「哪个操作动了哪条消息」。流式中的目标条目跳过 —— 文字还在长,收尾那
   * 次提交(streaming 置 false)自然会把最终版写进去。
   */
  useEffect(() => {
    if (persistedRef.current.chatId !== chatId) {
      // 切了对话(或刚建):把当前状态认作水位线,不回写
      const rows = new Map<string, { entry: ChatEntry; idx: number }>();
      entries.forEach((e, i) => {
        if (!e.streaming && e.jevPending === undefined) rows.set(e.id, { entry: e, idx: i });
      });
      persistedRef.current = { chatId, rows };
      return;
    }
    if (!chatId) return;

    const enqueue = (id: string, op: () => Promise<unknown>) => {
      const key = `${chatId}:${id}`;
      const next = (writeChain.current.get(key) ?? Promise.resolve()).catch(() => undefined).then(op);
      writeChain.current.set(key, next);
      next
        .finally(() => {
          if (writeChain.current.get(key) === next) writeChain.current.delete(key);
        })
        .catch(() => undefined);
      return next;
    };
    // 回调晚到时可能已经切到别的对话了:旧对话的 id 不能记进新对话的水位线
    const stillHere = () => persistedRef.current.chatId === chatId;
    if (queuedRef.current.chatId !== chatId) queuedRef.current = { chatId, map: new Map() };
    const queued = queuedRef.current.map;

    // 后端每写一条都会刷新这条对话的 updated_at;本地列表跟着改,标题画面的「上次 · 刚刚」
    // 和存档页的条数、时间不用等下次拉列表
    const count = entries.length;
    const touch = () =>
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId ? { ...c, updated_at: new Date().toISOString(), message_count: count } : c,
        ),
      );
    const seen = new Set<string>();
    entries.forEach((entry, idx) => {
      seen.add(entry.id);
      // Jev 还在判最后几句:标签还要缝进去,等判完那次提交(jevPending 去掉)再写
      if (entry.streaming || entry.jevPending !== undefined) return;
      const prev = queued.has(entry.id) ? queued.get(entry.id) : persistedRef.current.rows.get(entry.id);
      if (prev && prev.entry === entry && prev.idx === idx) return;
      const mark = { entry, idx };
      queued.set(entry.id, mark);
      enqueue(entry.id, () => debugApi.putChatMessage(chatId, toStored(entry, idx, savedSnapshots.current)))
        .then(() => {
          if (stillHere()) persistedRef.current.rows.set(entry.id, mark);
          for (const info of entry.swipeInfo) {
            if (info.snapshot && info.snapshotHash) savedSnapshots.current.add(info.snapshotHash);
          }
          touch();
        })
        .catch((e: unknown) =>
          notify('error', `对话保存失败: ${e instanceof Error ? e.message : String(e)}`),
        )
        .finally(() => {
          if (queued.get(entry.id) === mark) queued.delete(entry.id);
        });
    });
    // 库里有的 + 正在写进库的,不在当前条目里的都删
    const known = new Set(persistedRef.current.rows.keys());
    for (const [id, q] of queued) if (q !== null) known.add(id);
    for (const id of known) {
      if (seen.has(id) || queued.get(id) === null) continue;
      queued.set(id, null);
      enqueue(id, () => debugApi.deleteChatMessage(chatId, id))
        .then(() => {
          if (stillHere()) persistedRef.current.rows.delete(id);
          touch();
        })
        .catch((e: unknown) =>
          notify('error', `对话保存失败: ${e instanceof Error ? e.message : String(e)}`),
        )
        .finally(() => {
          if (queued.get(id) === null) queued.delete(id);
        });
    }
  }, [entries, chatId, notify]);

  // tainted 只在切换边沿写(loadChat/newChat 已把 ref 对齐成目标值)
  useEffect(() => {
    if (!chatId || taintedRef.current === tainted) return;
    taintedRef.current = tainted;
    debugApi.updateChat(chatId, { tainted }).catch((e: unknown) =>
      notify('error', `对话保存失败: ${e instanceof Error ? e.message : String(e)}`),
    );
  }, [chatId, tainted, notify]);

  // 卡/预设/用户名的绑定同步:防抖 600ms 只发改动的字段 —— user_name 在右栏
  // 是逐字输入的,不防抖会一次击键一个请求
  useEffect(() => {
    if (!chatId) return;
    const timer = window.setTimeout(() => {
      const patch: ChatPayload = {};
      // 切卡途中(见下面 card_id 那段):这时的预设是新卡绑定的、用户名是新卡人设的,
      // 都不属于还挂着的上一张对话,写进去的话再打开那张卡就恢复成别人的预设。
      // 等 loadChat/newChat 换好对话,chatId 一变这里会重算
      const switching = metaRef.current.card_id !== null && metaRef.current.card_id !== cardId;
      if (!switching && metaRef.current.preset_id !== presetId) patch.preset_id = presetId ?? null;
      // card_id 只在「收养孤儿对话」时写。孤儿 = 导入的 ST jsonl 按 character_name
      // 匹配不到卡(card_id 为空),在哪张卡上打开就归谁。
      //
      // 除此之外对话的归属只由 loadChat/newChat 决定,绝不跟着 cardId 走:切卡时
      // cardId 是同步变的,chatId 要等 listChats → getChat/createChat 两次往返才变,
      // 这中间的状态是「上一张对话 + 新卡」。照着它算 patch 就会把上一张卡的对话
      // 改判给新卡 —— 对话从原主人那儿消失,再切回去就打开了别人的历史。
      // 往返超过 600ms(手机网络下很常见)必现,本机偶发。
      if (metaRef.current.card_id === null && cardId) patch.card_id = cardId;
      if (!switching && metaRef.current.user_name !== userName) patch.user_name = userName;
      if (Object.keys(patch).length === 0) return;
      Object.assign(metaRef.current, patch);
      debugApi.updateChat(chatId, patch).catch((e: unknown) =>
        notify('error', `对话信息保存失败: ${e instanceof Error ? e.message : String(e)}`),
      );
    }, 600);
    return () => window.clearTimeout(timer);
  }, [chatId, presetId, cardId, userName, notify]);

  /** 宏能读到的那些「当前状态」:模型、对话、上一次是怎么生成的 */
  const macroExtraFor = (type: string) => ({
    model: connections.find((c) => c.id === connectionId)?.model ?? '',
    chatId: chatId ?? '',
    isMobile,
    lastGenerationType: type,
    maxResponse:
      typeof preset?.params.openai_max_tokens === 'number' ? preset.params.openai_max_tokens : 0,
  });

  /**
   * 把一次组装算出来的变量收下:界面上换成新的,局部的写回对话,全局的写本机。
   * 只在真的发请求时调 —— 预览每敲一个字就重算一遍,要是也收,{{incvar}} 会自己往上涨。
   */
  const commitVariables = (next: MacroVars | undefined, targetChat: string | null = chatId) => {
    if (!next) return;
    const changed = (a: object, b: object) => JSON.stringify(a) !== JSON.stringify(b);
    if (changed(next.global, globalVars)) {
      setGlobalVars(next.global);
      saveGlobalVariables(next.global);
    }
    if (changed(next.local, chatVars)) {
      setChatVars(next.local);
      if (targetChat) {
        debugApi.updateChat(targetChat, { variables: next.local }).catch((e: unknown) =>
          notify('error', `变量保存失败: ${e instanceof Error ? e.message : String(e)}`),
        );
      }
    }
  };

  /**
   * 组装提示词;在用 Jev 的那几类标签全摘掉(历史、卡里的对话示例……模型看见就会照着写)。
   * AI 模式的那几类留着,模型才会接着写
   */
  /** 左栏要显示的自动补的块:各自排在哪一块前面(发出去用的编排里它后面第一块不是自动补的) */
  const autoBlockRows = useMemo(() => {
    const autoIds = new Set(assemblyPass.auto.map((a) => a.identifier));
    return assemblyPass.auto.map((a) => {
      const at = assemblyOrder.findIndex((e) => e.identifier === a.identifier);
      const next = assemblyOrder.slice(at + 1).find((e) => !autoIds.has(e.identifier));
      return { ...a, before: next?.identifier ?? null };
    });
  }, [assemblyPass.auto, assemblyOrder]);

  const assembleForSend = (input: Parameters<typeof assemble>[0]) => {
    const result = jevStripKinds ? jevStripPrompt(assemble(input), jevStripKinds) : assemble(input);
    return moveToLastUserTurn(result, autoToLastUser);
  };

  // 生成中历史每来一段字就变一次:下面这份统计(预算条、输入框上方)先按发出去那一刻的历史算,
  // 写完再按最新的算 —— 不跟着每段字重拼整份提示词、重数 token。预设、卡这些改了照样马上重算
  const previewHistory = useMemo(
    () => history,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sending ? null : history],
  );

  /** 下一次请求会发出去的东西 —— 输入框上方的统计就来自这里 */
  const preview = useMemo(() => {
    if (!card || !assemblyPreset) return EMPTY_RESULT;
    return assembleForSend({
      card,
      preset: assemblyPreset,
      order: assemblyOrder,
      history: previewHistory,
      userName,
      personaDescription: persona,
      customMacros: macroLookup,
      allowCardOverrides: true,
      tokenBudget,
      worldInfo: worldInfoSettings,
      variables,
      macroExtra: macroExtraFor(generationType.current),
    });
    // macroExtraFor 每次渲染都是新函数,它读的那几样已经单独列在下面了
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    card,
    assemblyPreset,
    assemblyOrder,
    jevStripKinds,
    autoToLastUser,
    previewHistory,
    userName,
    persona,
    macroLookup,
    tokenBudget,
    worldInfoSettings,
    variables,
    chatId,
    isMobile,
    connections,
    connectionId,
  ]);

  const ready = Boolean(card && preset && order.length > 0);

  // 预算/量程的写口。预算直接写回当前预设(拖滑块停下半秒后存),不算「未保存的改动」——
  // 只动库里的 params,预设别的没保存的改动不受影响。手输的值超过当前量程时自动换到装得下的挡
  const budgetSaveTimer = useRef<number | undefined>(undefined);
  const changeBudget = (v: number | null) => {
    setPreset((p) => (p ? { ...p, params: paramsWithBudget(p.params, v) } : p));
    if (v !== null && v > rangeScale) setRangeScale(autoRange(v));
    const id = presetId;
    if (!id) return;
    window.clearTimeout(budgetSaveTimer.current);
    budgetSaveTimer.current = window.setTimeout(() => {
      const row = presetRef.current.saved.find((r) => r.id === id);
      if (!row) return;
      debugApi
        .updatePreset(id, { params: paramsWithBudget(row.params, v) })
        .then((updated) => setSavedPresets((list) => list.map((r) => (r.id === updated.id ? updated : r))))
        .catch((e: unknown) =>
          notify('error', `预算没存进预设: ${e instanceof Error ? e.message : String(e)}`),
        );
    }, 500);
  };
  const changeRange = (r: number) => {
    setRangeScale(r);
    saveRange(r);
  };

  // ---- 发送 ----

  /** type:这次是发送(normal)、重新生成(regenerate)还是接着用户那句生成(continue) */
  const buildSnapshot = (turns: ChatTurn[], type = 'normal') => {
    if (!card || !assemblyPreset) return null;
    generationType.current = type;
    return assembleForSend({
      card,
      preset: assemblyPreset,
      order: assemblyOrder,
      history: turns,
      userName,
      personaDescription: persona,
      customMacros: macroLookup,
      allowCardOverrides: true,
      tokenBudget,
      worldInfo: worldInfoSettings,
      variables,
      macroExtra: macroExtraFor(type),
    });
  };

  /** 条目 → 发给模型的一条历史(和 history 一样合并了 Jev 的标注) */
  const turnOf = (e: ChatEntry): ChatTurn => ({ role: e.role, content: jevText(e, vnKinds) });

  // 设置 → 数据「表情认法」:Jev 的起始表情和舞台用同一种认法
  const timelineEngine = useTimelineEngine();
  // Jev 起始表情要的切句缓存(和视觉小说各一份)
  const jevBeatCache = useRef(newBeatCache());
  /**
   * 新回复开头生效的表情(签字清单第 10 条):和舞台在这条回复第 0 句、还没有标签时一样(core/timeline.ts)。
   * 认表情用视觉小说已经问到的结果(表情认法选了认词记录时是已经读到的认词记录,CG 那一帧也查已经读到的配对表),
   * 没问到的保持上一个(和舞台在结果回来以前一样)。
   * 没有立绘的卡、还没出现过表情时舞台上是空的,照旧给内置表情的第一个:Jev 要拿它给没判出表情的台词补立绘标签,
   * 不然那句会被当成旁白
   */
  const jevStartEmotion = (before: readonly ChatEntry[], targetId: string): string | null => {
    const charName = card?.name ?? '';
    const candidates = emotionCandidates(activeSprites);
    const cgPairs = timelineEngine === 'records' ? cachedPairs('cg', emotionListRef(activeSprites)) : null;
    const ctx: TimelineCtx = {
      sprites: activeSprites,
      sceneAssets: activeSceneAssets,
      emotion: {
        resolve:
          timelineEngine === 'records'
            ? cachedRecordsResolver(emotionListRef(activeSprites), candidates)
            : cachedResolver(candidates),
        rawOnFail: activeSprites.length === 0,
        charName,
      },
      forms: forms.lens,
      ...(cgPairs ? { cgFrame: cgFrameFromPairs(cgPairs, activeSprites, activeSceneAssets) } : {}),
    };
    const beats = parseBeats({ entries: before, tagKinds: vnKinds, macros: displayMacros, charName, userName, cache: jevBeatCache.current });
    return emotionAtStart(buildTimeline(beats, ctx), ctx, targetId, candidates[0]?.label ?? null);
  };

  /**
   * 一条回复的 Jev 标注(plugins/jevRun.ts),按现在各插件的模式、门槛、问法(这张卡实际用的,叠过按卡设置)。
   * before 是这条回复之前的条目(算回复开始时的场景、表情),prev 是玩家上一句,
   * targetId 是这次要标的那条(它第 0 句的形态)
   */
  const makeJevRun = (
    before: readonly ChatEntry[],
    prev: string,
    onChange: (snap: JevSnapshot) => void,
    targetId: string,
  ): JevRun => {
    const scene = sceneAtEnd(before, sceneKinds, activeSceneAssets, cgOkAt);
    const choice = (x: { label: string; aliases: readonly string[]; description?: string }): AnnotateChoice => ({
      label: x.label,
      aliases: [...x.aliases],
      description: x.description ?? '',
    });
    const emotions = formSprites.length > 0 ? formSprites.map(choice) : BUILTIN_EMOTIONS.map(choice);
    const { bg, bgm, cg } = scenePlugin.effective;
    const backgrounds = backgroundsOf(activeSceneAssets);
    // 现在的形态里能出的 CG;一张都没有时这道题不问(也就不用一句一句排队等)
    const cgsNow = cgsOf(activeSceneAssets).filter((a) => !cgOkNow || cgOkNow(a));
    return new JevRun({
      charName: card?.name ?? '',
      userName,
      prev,
      kinds: vnKinds,
      jevKinds: cgsNow.length ? jevKinds : { ...jevKinds, cg: false },
      templates: { sprite: spriteEffective.tagTemplate, bg: bg.tagTemplate, bgm: bgm.tagTemplate, cg: cg.tagTemplate },
      emotions,
      bgs: backgrounds.map(choice),
      bgms: bgmsOf(activeSceneAssets).map(choice),
      cgs: cgsNow.map(choice),
      scene: { bg: scene.bg?.label ?? null, bgm: scene.bgm?.label ?? null, cg: scene.cg?.label ?? null },
      // CG 对不对得上地点很要紧(测试里不给地点,严格准确率低 14 个点):背景名 + 说明
      placeOf: (label) => {
        const b = label ? backgrounds.find((x) => x.label === label) : null;
        return b ? (b.description.trim() ? `${b.label}(${b.description.trim()})` : b.label) : '';
      },
      emotionBefore: jevStartEmotion(before, targetId),
      popup: playerEffective.jev.popup,
      // 要不要给角色的台词多判一道档(卡带的 asksTone,plugins/voiceExtensions.ts);语音按它换版本
      askTone: asksTone({ form: formNow, voice: voicePlugin.cast.main }),
      thresholds: {
        speaker: jevConfig.speakerThreshold,
        bg: bg.jev.threshold,
        bgm: bgm.jev.threshold,
        cg: cg.jev.threshold,
      },
      prompts: promptOverrides(jevConfig, spriteEffective, bg, bgm, cg),
      annotate: (req, signal) => debugApi.annotateLines(req, signal),
      onChange,
      twoQueues: jevConfig.twoQueues,
      // 上一条 AI 回复(卡的开场白也算)的最后几句,Jev 页「带上一条回复」定几句;0 = 不带
      before: previousReplyLines(before, {
        kinds: vnKinds,
        charName: card?.name ?? '',
        userName,
        n: jevConfig.beforeLines,
      }),
    });
  };

  /**
   * 这次生成的 Jev 标注:跟着流式输出走,每写完一句交给 Jev 判,判完记成这句的标注
   * (正文不动,标注存进 swipe_info.jev)。prev 是玩家上一句。没有插件在用 Jev 时是 null
   */
  const startJev = (
    targetId: string,
    prev: string,
    write: (snap: JevSnapshot) => void,
  ): JevRun | null => {
    if (!jevOn) return null;
    void debugApi.annotateWarmup().catch(() => {});
    // 回复开始时的场景、表情:按这条之前的条目算(重新生成时不算被换掉的那个分支)
    const before = latest.current.entries.filter((e) => e.id !== targetId);
    return makeJevRun(before, prev, write, targetId);
  };

  /**
   * 试判:用现在的设置和问法把当前对话最新一条 AI 回复整条判一遍,按句列出结果,不改存档。
   * 调问法、调门槛时看效果用
   */
  const trialJev = async (): Promise<JevTrial> => {
    if (!jevOn) throw new Error('还没有插件在用 Jev(或者后端没有 key)');
    const all = latest.current.entries;
    const idx = all.findLastIndex((e) => e.role === 'assistant' && !e.streaming);
    if (idx === -1) throw new Error('当前对话里还没有 AI 回复');
    const before = all.slice(0, idx);
    const run = makeJevRun(before, lastUserText(before), () => {}, all[idx].id);
    const started = performance.now();
    run.feed(currentText(all[idx]), false);
    await run.settle(JEV_SETTLE_MS * 2);
    return { lines: run.results(), stats: run.currentStats(), ms: Math.round(performance.now() - started) };
  };

  /**
   * 把一次生成灌进某个条目的当前分支 —— 发送和右滑重生成共用这一段。
   * rollback 是失败时怎么撤销:发送要删掉整个空气泡,重生成只删掉新开的那个分支。
   */
  const runGeneration = async (
    targetId: string,
    snapshot: AssemblyResult,
    rollback: () => void,
    /** 玩家上一句(Jev 判断时的上下文) */
    prev: string,
  ) => {
    setError(null);
    setSending(true);
    // 这一轮的宏已经求过值了,它们写下的变量从现在起算数 —— 请求成不成功都一样,和酒馆一致
    commitVariables(snapshot.variables);
    let finish: () => void = () => {};
    inflightRef.current = new Promise<void>((resolve) => {
      finish = resolve;
    });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // name 只有示例对话里的句子有(example_user / example_assistant),和酒馆发的一样
    const messages = snapshot.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    }));
    const model = activeConnection?.model || undefined;
    const startedAt = performance.now();
    const patch = (fn: (e: ChatEntry) => ChatEntry) =>
      setEntries((prev) => prev.map((e) => (e.id === targetId ? fn(e) : e)));

    // 累加在闭包里,setEntries 只负责渲染 —— 免得每帧都去读上一次的 state
    let body = '';
    // 这次写的是哪个分支:第一次写的时候记下(Jev 的结果可能在流式结束后才回来,那时不能写到别的分支上)
    let swipe: number | null = null;
    const target = (e: ChatEntry) => (swipe ??= e.swipeIndex);
    // 正文只存模型写的原文;Jev 的标注另外记在这个分支的 swipe_info.jev 里,用的时候合并
    const jev = startJev(targetId, prev, ({ record, pendingFrom, voicePendingFrom }) =>
      patch((e) => ({
        ...patchSwipeInfo(e, { jev: record }, target(e)),
        jevPending: pendingFrom ?? undefined,
        // 语音要等的第一句;批量那边判完了、只剩 CG 在判时是「不用等」(两条队列时)
        jevVoicePending: voicePendingFrom ?? (pendingFrom === null ? undefined : Number.MAX_SAFE_INTEGER),
      })),
    );
    controller.signal.addEventListener('abort', () => jev?.abort());
    // 一开始就记上「这个分支是 Jev 标的」:切句从第一句起就按严格规则认说话人
    if (jev) patch((e) => patchSwipeInfo(e, { jev: jev.record() }, target(e)));
    const writeBody = () => {
      patch((e) => setSwipeText(e, body, target(e)));
      jev?.feed(body, true);
    };
    let reasoning = '';
    // 模型每秒推几十段字(思考过程也是),每段都改一次条目,整个页面就跟着重画几十遍 —— 2026-10-15 实测
    // 开发模式下 AI 写字时主线程 99% 在忙。攒成最多每 STREAM_PAINT_MS 改一次,第一段照样马上出;
    // 写完、出错、被停下时先 flush,最后一段不丢
    const bodyWriter = throttle(writeBody, STREAM_PAINT_MS);
    const reasoningWriter = throttle(() => patch((e) => patchSwipeInfo(e, { reasoning })), STREAM_PAINT_MS);
    const flushWrites = () => {
      reasoningWriter.flush();
      bodyWriter.flush();
    };
    /** 写完了:等 Jev 判完最后几句(最多 JEV_SETTLE_MS),统计和标注记到这个分支上 */
    const settleJev = async () => {
      if (!jev) return;
      await jev.settle(JEV_SETTLE_MS);
      const record = jev.record();
      patch((e) => ({ ...patchSwipeInfo(e, { jev: record }, target(e)), jevPending: undefined, jevVoicePending: undefined }));
    };

    try {
      if (useStreaming) {
        const done = await debugApi.streamComplete(
          messages,
          connectionId,
          model,
          controller.signal,
          {
            onMeta: (m) =>
              patch((e) =>
                patchSwipeInfo(e, {
                  connection: m.connection_name,
                  model: m.model,
                  ttftMs: m.ttft_ms,
                }),
              ),
            onReasoning: (t) => {
              reasoning += t;
              reasoningWriter();
            },
            onDelta: (t) => {
              body += t;
              bodyWriter();
            },
          },
        );
        flushWrites();
        setLastRaw(body);
        if (jev) jev.feed(body, false);
        patch((e) => ({
          ...patchSwipeInfo(e, {
            totalMs: done.total_ms,
            reasoningType: done.reasoning_type ?? undefined,
            reasoningMs: done.reasoning_ms ?? undefined,
          }),
          streaming: false,
        }));
      } else {
        const res = await debugApi.complete(messages, connectionId, model, controller.signal);
        body = res.raw;
        setLastRaw(res.raw);
        if (jev) jev.feed(body, false);
        patch((e) => ({
          ...patchSwipeInfo(setSwipeText(e, res.raw, target(e)), {
            connection: res.connection_name,
            model: res.model,
            totalMs: Math.round(performance.now() - startedAt),
          }),
          streaming: false,
        }));
      }
      await settleJev();
    } catch (e) {
      // 攒着还没写进条目的那一段先写进去:停下 / 断线时已经拿到手的字一个不少
      flushWrites();
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      // 已经吐出来的留着,一个字都没有的气泡才撤销 —— 不管是手动停止、网络断线,
      // 还是像"没收到结束帧"这种流被腰斩的情况:已经拿到手的内容不该因为收尾
      // 失败就跟着消失。真正的错误(非主动停止)额外弹一条页面顶部的提示。
      if (!aborted) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        notify('error', message);
      }
      patch((entry) => ({ ...entry, streaming: false }));
      if (!body.trim()) rollback();
      // 停下时写到哪算哪:没判完的句子照没标处理,不再等 Jev
      else if (jev) {
        jev.abort();
        await settleJev();
      }
    } finally {
      bodyWriter.cancel();
      reasoningWriter.cancel();
      setSending(false);
      finish();
    }
  };

  const send = async (text: string) => {
    const snapshot = buildSnapshot([...history, { role: 'user' as const, content: text }]);
    if (!snapshot) return;

    // 空气泡先落地,文字直接长在真正的位置上,不用另做一个「请求中」的占位
    const pending = makePendingEntry(snapshot);
    setEntries((prev) => [...prev, makeUserEntry(text), pending]);
    setTainted(true);

    await runGeneration(
      pending.id,
      snapshot,
      () => setEntries((prev) => prev.filter((e) => e.id !== pending.id)),
      text,
    );
  };

  /**
   * 视觉小说里的插话。玩家没读完最新那条回复就开口了:
   *   entryId + keep  → 那条回复截到 keep 为止(完整版留成另一个分支),再发玩家这句
   *   keep 为空串     → 一句都还没看到:这次生成整个撤掉(重来出的新分支只撤这一个)
   *   keep 为 null    → 不截,只是先停下正在写的那条
   * 正在生成时先停下,等那次收完尾(streaming 置 false、空回复撤销)再接着走。
   */
  const interject = async (text: string, entryId: string | null, keep: string | null) => {
    await stopGeneration();
    await sendAfter(latest.current.entries, text, entryId, keep);
  };

  /** 正在生成就先停下,等那次收完尾(streaming 置 false、空回复撤销) */
  const stopGeneration = async () => {
    if (!latest.current.sending) return;
    abortRef.current?.abort();
    await inflightRef.current;
    // 收尾的那几个 setState 要等提交后才进 latest —— 等它落定,最多等半秒
    for (let i = 0; i < 30 && latest.current.sending; i++) {
      await new Promise((r) => window.setTimeout(r, 16));
    }
  };

  /**
   * 视觉小说里翻回历史、在旧的位置开口:从那条回复分出一个新对话 —— 原来的对话一个字不动,
   * 就是一个存档,存档页里还能读回来。切到新对话,那条回复截到玩家读到的那句,再发玩家这句
   */
  const branchFromHistory = async (text: string, entryId: string, keep: string) => {
    if (!chatId || chatOp) return;
    await stopGeneration();
    const origin = chats.find((c) => c.id === chatId)?.name || '原来的对话';
    setChatOp('branch');
    let created;
    try {
      created = await debugApi.branchChat(chatId, entryId);
      setChats(await debugApi.listChats(cardId));
      refreshTree(cardId);
    } catch (e) {
      notify('error', `分支没建成: ${e instanceof Error ? e.message : String(e)}`);
      return;
    } finally {
      setChatOp(null);
    }
    const base = await loadChat(created.id);
    if (!base || base.length === 0) return;
    notify('ok', `已分出新的故事线「${created.name}」· 原来的进度留在存档「${origin}」`);
    // 分支复制出来的消息换了新 id:那条回复就是新对话的最后一条
    await sendAfter(base, text, base[base.length - 1].id, keep);
  };

  /** 插话截断出的新分支:原文截到 keep,Jev 的标注只留截下来的那几句 */
  const truncateTo = (e: ChatEntry, keep: string): ChatEntry => {
    const cut = addTruncatedSwipe(e, keep);
    const jev = currentInfo(cut)?.jev;
    return jev ? patchSwipeInfo(cut, { jev: cutJev(jev, keep, vnKinds) }) : cut;
  };

  /** 在 base 这组条目后面发玩家这句;entryId / keep 怎么截见 interject */
  const sendAfter = async (
    from: ChatEntry[],
    text: string,
    entryId: string | null,
    keep: string | null,
  ) => {
    let base = from;
    const idx = entryId ? base.findIndex((e) => e.id === entryId) : -1;
    if (idx !== -1 && keep !== null) {
      const target = base[idx];
      const full = currentText(target);
      if (!keep.trim()) {
        base =
          target.swipes.length > 1
            ? base.map((e, i) => (i === idx ? dropSwipe(e, e.swipeIndex) : e))
            : base.filter((_, i) => i !== idx);
      } else if (keep !== full.trimEnd()) {
        base = base.map((e, i) => (i === idx ? truncateTo(e, keep) : e));
      }
    } else if (idx !== -1 && !currentText(base[idx]).trim()) {
      // 停下时一个字都没写出来的空回复,收尾时已经撤掉了;这里防一手还没提交的情况
      base = base.filter((_, i) => i !== idx);
    }

    const snapshot = buildSnapshot([...base.map(turnOf), { role: 'user' as const, content: text }]);
    if (!snapshot) return;
    const pending = makePendingEntry(snapshot);
    setEntries([...base, makeUserEntry(text), pending]);
    setTainted(true);
    await runGeneration(
      pending.id,
      snapshot,
      () => setEntries((prev) => prev.filter((e) => e.id !== pending.id)),
      text,
    );
  };

  /** 右滑越过最后一个分支 —— 新开一个分支重新生成,旧的那次原样留着 */
  const regenerate = async (entry: ChatEntry) => {
    // 只有最后一条能滑,所以「这条之前的历史」就是去掉末尾
    const before = latest.current.entries.slice(0, -1);
    const snapshot = buildSnapshot(
      before.map(turnOf),
      // 我们的「重新生成」是往这条消息上加一个分支,对应酒馆的 swipe
      'swipe',
    );
    if (!snapshot) return;

    const at = entry.swipes.length; // 新分支的下标
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? appendSwipe(e, snapshot) : e)));
    setTainted(true);

    await runGeneration(
      entry.id,
      snapshot,
      () => setEntries((prev) => prev.map((e) => (e.id === entry.id ? dropSwipe(e, at) : e))),
      lastUserText(before),
    );
  };

  /**
   * 最后一条是用户发言时的「生成回复」—— 就是 send() 去掉「先追加一条用户消息」。
   *
   * 这个状态本身很常见:回复生成到一半断线、报错撤销了空气泡、或者手动删掉了
   * 不满意的回复。没有这条路的话对话就卡死在这儿 —— 用户既没法重新生成(没有
   * 可重跑的角色消息),又只能靠再发一条话把上一句顶掉。
   */
  const continueFromUser = async () => {
    const before = latest.current.entries;
    const snapshot = buildSnapshot(
      // 不去尾:最后一条用户发言正是这次要回应的那句
      before.map(turnOf),
    );
    if (!snapshot) return;

    const pending = makePendingEntry(snapshot);
    setEntries((prev) => [...prev, pending]);
    setTainted(true);

    await runGeneration(
      pending.id,
      snapshot,
      () => setEntries((prev) => prev.filter((e) => e.id !== pending.id)),
      lastUserText(before),
    );
  };

  /**
   * 输入框上方那颗按钮。按最后一条是谁分两种活儿:
   *   角色消息 → 重跑它,结果追加成新分支(旧的左滑还能滑回去)
   *   用户发言 → 生成缺掉的那条回复
   *
   * 重跑走 regenerate() 而不是 swipe():后者对没改过的开场白是「在其他开场白
   * 之间循环」(不调 API),而这颗按钮要的是真生成。新对话里最后一条正好是
   * 开场白,于是「新对话直接重新生成第一条」自然成立。
   */
  const regenerateLast = () => {
    const now = latest.current;
    if (now.sending) return;
    const last = now.entries[now.entries.length - 1];
    if (!last) return;
    if (last.role === 'assistant') void regenerate(last);
    else void continueFromUser();
  };

  // ---- 编辑 / 删除 / 滑动 ----

  const editMessage = (id: string, text: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? setSwipeText(e, text) : e)));
    setTainted(true);
  };

  const deleteAt = (id: string, scope: 'message' | 'swipe') => {
    setEntries((prev) =>
      scope === 'message'
        ? prev.filter((e) => e.id !== id)
        : prev.map((e) => (e.id === id ? dropSwipe(e, e.swipeIndex) : e)),
    );
    setTainted(true);
  };

  const swipe = (id: string, dir: 'left' | 'right') => {
    const now = latest.current;
    if (now.sending) return; // 正在生成时不接受滑动

    const index = now.entries.findIndex((e) => e.id === id);
    const entry = now.entries[index];
    if (!entry) return;

    const behavior = overswipeOf(entry, index, now.entries.length, now.tainted);
    if (behavior === 'none') return; // 只有最后一条角色消息能滑,和酒馆一样

    const go = (to: number) =>
      setEntries((prev) => prev.map((e) => (e.id === id ? swipeTo(e, to) : e)));

    if (dir === 'left') {
      // 滑到头再往左会绕回最后一个,和酒馆一样
      go(entry.swipeIndex === 0 ? entry.swipes.length - 1 : entry.swipeIndex - 1);
      return;
    }

    if (entry.swipeIndex < entry.swipes.length - 1) {
      go(entry.swipeIndex + 1);
      return;
    }

    if (behavior === 'loop') {
      go(0);
    } else {
      void regenerate(entry);
    }
  };

  // ---- 三栏拖拽调宽 ----

  const startDrag = (side: 'left' | 'right', e: React.PointerEvent) => {
    // 移动端没有「列」可拖(两栏是全屏抽屉),分隔条本身也 display:none
    if (isMobile) return;
    if (side === 'left' ? leftCollapsed : rightCollapsed) return;
    e.preventDefault();
    draggingSide.current = side;
    const startX = e.clientX;
    const startW = side === 'left' ? leftW : rightW;
    let latest = startW;

    const onMove = (ev: PointerEvent) => {
      // 左栏往右拖变宽,右栏往左拖变宽
      const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
      latest = clampPanel(startW + delta);
      (side === 'left' ? setLeftW : setRightW)(latest);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('dragging-columns');
      draggingSide.current = null;
      window.localStorage.setItem(
        side === 'left' ? 'debug.leftW' : 'debug.rightW',
        String(Math.round(latest)),
      );
    };
    document.body.classList.add('dragging-columns');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 收起时不能写内联宽度变量 —— 内联样式会盖掉 .left-collapsed 类里的 44px
  const bodyStyle = {
    ...(leftCollapsed ? {} : { '--left': `${leftW}px` }),
    ...(rightCollapsed ? {} : { '--right': `${rightW}px` }),
  } as React.CSSProperties;

  /** 从库里挑一个预设换上。有没保存的改动时先问一句 —— 调试台左栏和视觉小说里共用 */
  const choosePreset = (id: string) => {
    const row = savedPresets.find((p) => p.id === id);
    if (!row) return;
    if (presetDirty && !window.confirm('当前预设有未保存的改动,切换会丢弃。继续?')) return;
    selectPreset(row);
  };

  /** 插件抽屉:调试台聊天区上一份,视觉小说菜单的插件页一份,只有打开到哪、怎么关不同 */
  const renderPluginsDrawer = (focus: PluginFocus | null, onClose: () => void) => (
    <PluginsDrawer
      presetName={preset?.name ?? null}
      presetDirty={presetDirty}
      presetBusy={presetBusy}
      onSavePreset={() => void savePreset()}
      card={cardId && card ? { id: cardId, name: card.name } : null}
      sprite={{
        config: spriteConfig,
        onChangeConfig: changeSpriteConfig,
        block: blockControls('sprite'),
        packs: spritePacks,
        layout: spriteLayout,
      }}
      cards={savedCards.map((c) => ({ id: c.id, name: c.name }))}
      scene={scenePlugin}
      sceneBlocks={{ bg: blockControls('bg'), bgm: blockControls('bgm'), cg: blockControls('cg') }}
      sceneMacros={sceneMacroValues}
      voice={voicePlugin}
      splice={splice}
      panels={cartridgePanels}
      switches={{ value: switches, onChange: changeSwitches }}
      lang={{ config: langConfig, onChangeConfig: changeLangConfig, block: blockControls('lang') }}
      player={{
        config: playerConfig,
        onChangeConfig: changePlayerConfig,
        block: blockControls('player'),
      }}
      jev={{
        config: jevConfig,
        onChangeConfig: changeJevConfig,
        keyStatus: jevKey,
        onSaveKey: saveJevKey,
        onSaveEndpoint: saveJevEndpoint,
        defaults: jevDefaults,
        onTest: () => debugApi.annotateTest(),
        onTrial: trialJev,
        kinds: jevKinds,
        lastStats: lastJevStats,
      }}
      focus={focus}
      notify={notify}
      onClose={onClose}
    />
  );

  /**
   * 预设面板:调试台左栏一份,视觉小说「调试」面板里一份,状态和操作是同一套,
   * 只有收起 / 点插件块这几处按所在位置不同
   */
  // ---- 角色卡的绑定:卡编辑器里的「绑定」一栏、预设面板的快捷勾选 ----

  const cardName = card?.name || '(无名)';
  const boundPresetId = presetForCard(
    presetBindings,
    cardId,
    savedPresets.map((p) => p.id),
  );
  const boundPersonaId = cardId ? (personaBindings.cards[cardId] ?? null) : null;

  /** 改这张卡绑的人设:存下来,当场换过去(解绑 = 换回默认人设,和选卡时一样) */
  const bindPersonaToCard = async (id: string | null) => {
    if (!cardId) return;
    const next = bindCard(personaBindings, cardId, id);
    changePersonaBindings(next);
    const name = personas.find((p) => p.id === id)?.name;
    const said = await applyBoundPersona(cardId, next);
    const head = name ? `「${cardName}」绑定了人设「${name}」` : `「${cardName}」不再绑定人设`;
    notify(said?.kind ?? 'ok', said ? `${head};${said.text}` : head);
  };

  /** 改这张卡绑的预设:存下来,绑上就当场换过去(有没保存的改动时先问);解绑不动当前预设 */
  const bindPresetToCard = (id: string | null) => {
    if (!cardId) return;
    changePresetBindings(bindCard(presetBindings, cardId, id));
    const name = savedPresets.find((p) => p.id === id)?.name;
    notify('ok', name ? `「${cardName}」绑定了预设「${name}」` : `「${cardName}」不再绑定预设`);
    if (id && id !== presetId) choosePreset(id);
  };

  const cardBindings = cardId ? (
    <CardBindings
      personas={personas}
      personaId={personas.some((p) => p.id === boundPersonaId) ? boundPersonaId : null}
      defaultPersonaName={personas.find((p) => p.id === personaBindings.default)?.name ?? null}
      presets={savedPresets}
      presetId={boundPresetId}
      spritePacks={spritePacks.packIds.map((id) => ({
        id,
        name: spritePacks.packs.find((p) => p.id === id)?.name ?? '…',
      }))}
      otherSpritePacks={spritePacks.packs.filter((p) => !spritePacks.packIds.includes(p.id))}
      spritePackId={spritePacks.packId}
      busy={cardBusy}
      onPersona={(id) => void bindPersonaToCard(id)}
      onPreset={bindPresetToCard}
      // 别的包:挂到这张卡的包后面并换过去(素材包哪张卡都能直接用)
      onSpritePack={(id) =>
        void (spritePacks.packIds.includes(id)
          ? spritePacks.switchPack(id)
          : spritePacks.setPacks([...spritePacks.packIds, id], id))
      }
    />
  ) : null;

  // ---- 卡编辑器(studio/):全屏页,盖在调试台和视觉小说上面 ----

  /** 打开卡编辑器;给了别的卡就先选那张卡(编辑的永远是当前这张) */
  const openStudio = (route: StudioRoute, forCardId?: string) => {
    if (forCardId && forCardId !== cardId) {
      const row = savedCards.find((c) => c.id === forCardId);
      if (!row) return;
      void selectCard(row);
    }
    setMobileMenu(false);
    setStudio(route);
  };
  // 卡没了(删掉了)就关
  useEffect(() => {
    if (!cardId) setStudio(null);
  }, [cardId]);
  /** 「开始」:关掉卡编辑器进游戏;已经在视觉小说里就只关。从素材管理页点卡名进来的,素材管理页也一起关 */
  const startFromStudio = () => {
    setStudio(null);
    setLibrary(null);
    if (!vnOpen) toggleVn(true);
  };
  // 包编辑器(卡编辑器、素材管理)改完包里的东西 → 交给各个按卡的 hook:是当前卡正在用的包就马上换进游戏,
  // 别的包的结果它们自己丢掉。hook 交出来的函数每次渲染都是新的,这里经 ref 转一道,给编辑器一个不变的对象
  const syncTargets = useRef({ spritePacks, spriteLayout, scenePlugin, voicePlugin, cardId });
  useEffect(() => {
    syncTargets.current = { spritePacks, spriteLayout, scenePlugin, voicePlugin, cardId };
  });
  const packSync = useMemo<PackSync>(
    () => ({
      sprites: (pid, list) => syncTargets.current.spritePacks.changeSprites(pid, list),
      layout: (pid, layout) => syncTargets.current.spriteLayout.adopt(pid, layout),
      scene: (pid, list) => syncTargets.current.scenePlugin.changeAssets(pid, list),
      packs: (kind) => {
        const t = syncTargets.current;
        if (kind === 'sprite') void t.spritePacks.refreshPacks();
        else if (kind === 'scene') void t.scenePlugin.refreshPacks();
        else if (kind === 'cg') void t.scenePlugin.refreshCgPacks();
        else void t.voicePlugin.refresh();
      },
    }),
    [],
  );
  // ---- 素材管理页(library/):全屏页,和卡编辑器同一层;点卡名打开的卡编辑器盖在它上面 ----

  const openLibrary = () => {
    setMobileMenu(false);
    setLibrary(lastLibrary.current);
  };
  const routeLibrary = (next: LibraryRoute) => {
    lastLibrary.current = next;
    setLibrary(next);
  };
  // 素材管理页关了(左上角、Esc、「开始」),导入提示跟着收起
  const libraryOpen = library !== null;
  useEffect(() => {
    if (!libraryOpen) setLibraryNotice(null);
  }, [libraryOpen]);
  // 「绑定到角色卡…」改卡的绑定:都直接写库;当前这张卡写完让对应的 hook 重读(游戏里马上换),声音走 hook 自己的写法
  const libraryBindings = useMemo<CardBindingWriter>(() => {
    const isCurrent = (id: string) => id === syncTargets.current.cardId;
    return {
      sprite: async (id, ids) => {
        await debugApi.setCardSpritePacks(id, ids);
        if (isCurrent(id)) await syncTargets.current.spritePacks.reload();
      },
      scene: async (id, parts) => {
        await debugApi.setCardScenePacks(id, parts);
        if (isCurrent(id)) await syncTargets.current.scenePlugin.reloadCard();
      },
      cg: async (id, ids) => {
        await debugApi.setCardCgPacks(id, ids);
        if (isCurrent(id)) await syncTargets.current.scenePlugin.reloadCard();
      },
      voice: async (id, v) => {
        if (!isCurrent(id)) {
          await debugApi.setCardVoices(id, v);
          return;
        }
        if (!(await syncTargets.current.voicePlugin.bind(v))) throw new Error('声音绑定没存上');
      },
    };
  }, []);
  /** 素材管理页删了一个包 / 声音:当前卡绑着它的话让对应的 hook 忘掉(包列表 AssetLibrary 已经让 PackSync 刷新了) */
  const forgetDeleted = (kind: LibraryKind, id: string) => {
    const t = syncTargets.current;
    if (kind === 'sprite') void t.spritePacks.reload();
    else if (kind === 'bg' || kind === 'bgm') t.scenePlugin.forgetPack(id);
    else if (kind === 'cg') t.scenePlugin.forgetCgPack(id);
    else if (t.voicePlugin.binding.main === id || t.voicePlugin.binding.extras.includes(id)) {
      void t.voicePlugin.bind(bindRemove(t.voicePlugin.binding, id));
    }
  };
  /** 撤销了一次导入:卡列表重读;当前卡被删了换一张,资料被改回去了换上改回去的,绑定重读;那次的提示条收起 */
  const afterImportUndone = async (result: ImportUndoPreview) => {
    setLibraryNotice((n) => (n?.jobId === result.job_id ? null : n));
    try {
      const list = await debugApi.listCards();
      setSavedCards(list);
      const current = syncTargets.current.cardId;
      if (current && result.cards.some((c) => c.id === current)) {
        await leaveCard(list);
        return;
      }
      const restored = current ? list.find((c) => c.id === current && result.restore_cards.some((r) => r.id === c.id)) : undefined;
      if (restored) setCard(cardFromStored(restored));
      const t = syncTargets.current;
      await Promise.all([t.spritePacks.reload(), t.scenePlugin.reloadCard()]);
    } catch (e) {
      notify('error', `撤销以后重读角色卡失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const libraryCards = useMemo(
    () => savedCards.map((c) => ({ id: c.id, name: c.name, stateOf: c.state_of ?? null })),
    [savedCards],
  );

  // 立绘栏的预览背景从这张卡的背景里挑(只看没停用的,和游戏里一样)
  const studioBackgrounds = useMemo(() => backgroundsOf(cardSceneAssets), [cardSceneAssets]);
  // 左栏的 CG 行只数导入的包,要看包的来源(导入 / AI 生成):CG 包列表平时只有插件页的 CG 页才读,打开卡编辑器时读一遍
  const studioOpen = studio !== null;
  useEffect(() => {
    if (studioOpen) void syncTargets.current.scenePlugin.refreshCgPacks();
  }, [studioOpen]);
  // 卡编辑器关了,从它里面开的插件抽屉也收起来(下次打开别还挂着)
  useEffect(() => {
    if (!studioOpen) setStudioPlugin(null);
  }, [studioOpen]);
  // 「AI 生成」那一栏(生图卡带经扩展点给,cartridges.ts 的 StudioIllustrations);没装就没有这一栏
  const aiStudio = illustrations.vn?.studio ?? null;
  // 那一栏的「已收藏」:这张卡绑的 AI 生成 CG 包(generated)里的构图和差分。绑定没读完、
  // 或者绑着的包还不在包列表里(刚收藏新建的,列表还没刷新)时看不出哪个是 AI 生成的,给 null
  const { ready: sceneReady, cgPacks, cgPackIds, assets: sceneAssets } = scenePlugin;
  const studioKept = useMemo(() => {
    if (!sceneReady) return null;
    const byId = new Map(cgPacks.map((p) => [p.id, p]));
    if (cgPackIds.some((id) => !byId.has(id))) return null;
    const generated = new Set(cgPackIds.filter((id) => byId.get(id)?.generated));
    return sceneAssets.filter((a) => a.kind === 'cg' && generated.has(a.pack_id));
  }, [sceneReady, cgPacks, cgPackIds, sceneAssets]);
  /** 「生图设置」:插件抽屉开在卡编辑器上面,停在卡带那一页 */
  const illustrationPanelKey = illustrations.panel?.key ?? null;
  const openIllustrationSettings = useCallback(() => {
    if (illustrationPanelKey) setStudioPlugin({ section: illustrationPanelKey, nonce: Date.now() });
  }, [illustrationPanelKey]);
  // 左栏「已绑定素材」每一行的副标题
  const studioSlots = studio
    ? summarizeSlots({
        sprite: { packs: spritePacks.packs, bound: spritePacks.packIds, current: spritePacks.packId },
        voice: { profiles: voicePlugin.profiles, binding: voicePlugin.binding },
        scene: { packs: scenePlugin.packs, binding: scenePlugin.binding, lists: scenePlugin.sceneLists },
        cg: { packs: scenePlugin.cgPacks, bound: scenePlugin.cgPackIds },
        ai: aiStudio ? { name: aiStudio.name, counts: aiStudio.summary(studioKept) } : null,
      })
    : [];

  // ---- 导入(importer/):拖进窗口 / 点「导入」→ 出计划 → 要问就先问 → 执行 → 打开那张卡的素材页,顶上一行提示
  //      (没有卡就打开素材管理页,选中新建的包) ----

  /** 执行完了:卡列表、包列表都刷一遍(可能有新卡、新包),再打开那张卡的卡编辑器素材页;没有卡就打开素材管理页 */
  const finishImport = async ({ result, plan, target, body }: ImportDone) => {
    const t = syncTargets.current;
    void t.spritePacks.refreshPacks();
    void t.scenePlugin.refreshPacks();
    void t.scenePlugin.refreshCgPacks();
    // 素材管理页开着(哪怕被卡编辑器盖着)就重读它的列表和导入记录
    setLibraryReload((n) => n + 1);
    // 选角页记着每张卡的立绘和背景:挂了素材的卡下次重读
    for (const id of [result.card_id, target.cardId]) if (id) forgetPickDetail(id);
    const list = await debugApi.listCards().catch(() => null);
    if (list) setSavedCards(list);
    const row = result.card_id ? list?.find((c) => c.id === result.card_id) : undefined;
    if (!row) {
      // 没有卡可开(导进来的只有包,没拖到卡上):打开素材管理页,选中第一个新建的包,顶上一行提示。
      // 新建的场景包要看有没有背景(只有曲子的开 BGM 页);卡编辑器开着就关掉,不然素材管理页在它底下看不见
      const scenes = result.created?.scene_packs.length ? await debugApi.listScenePacks().catch(() => null) : null;
      setStudio(null);
      setMobileMenu(false);
      routeLibrary(libraryRouteAfterImport(result, plan, body, scenes));
      setLibraryNotice(noticeOf(result));
      return;
    }
    // 选了「是同一张,更新它」的卡,字段变了,当前卡也要重新选一次
    const updated = plan.groups.some(
      (g) => g.type === 'card' && g.duplicate_of?.id === row.id && body.decisions?.[g.key] === 'update',
    );
    if (row.id !== cardId || updated) {
      // selectCard 一开头就换上这张卡(接对话在后面慢慢来),卡编辑器马上能开
      void selectCard(row);
    } else {
      // 挂到了当前这张卡上:重读它的立绘包、场景包、CG 包绑定
      void t.spritePacks.reload();
      void t.scenePlugin.reloadCard();
    }
    setMobileMenu(false);
    setStudio({ tab: 'assets', slot: slotAfterImport(plan, target.kind), notice: noticeOf(result) });
  };

  const importer = useImporter({
    notify,
    spritePackName: (id) => spritePacks.packs.find((p) => p.id === id)?.name ?? null,
    onApplied: finishImport,
  });

  /** 提示条里认领一个没认出来的文件:换上新的提示,这张卡的包可能多了、变了 */
  const classifyUnknown = async (path: string, kind: ClassifyKind) => {
    const jobId = studio?.notice?.jobId;
    if (!jobId) return;
    const result = await importer.classify(jobId, path, kind);
    if (!result) return;
    setStudio((s) => (s ? { ...s, notice: noticeOf(result) } : s));
    const t = syncTargets.current;
    void t.spritePacks.reload();
    void t.scenePlugin.reloadCard();
    void t.scenePlugin.refreshCgPacks();
    if (result.card_id) forgetPickDetail(result.card_id);
  };

  /** 素材管理页的提示条里认领一个没认出来的文件:换上新的提示,包列表刷新(素材管理页的列表它自己重读) */
  const classifyInLibrary = async (path: string, kind: ClassifyKind) => {
    const jobId = libraryNotice?.jobId;
    if (!jobId) return;
    const result = await importer.classify(jobId, path, kind);
    if (!result) return;
    setLibraryNotice(noticeOf(result));
    const t = syncTargets.current;
    void t.spritePacks.refreshPacks();
    void t.scenePlugin.refreshPacks();
    void t.scenePlugin.refreshCgPacks();
  };

  /**
   * 资料页:左栏目录 + 角色卡的全部字段 + 右栏(绑定、Token 分布、上下文预算、删卡);目录点「玩家人设」换成人设页。
   * 原来的资料编辑抽屉拆掉了,卡面板的「编辑资料」和滑块图标、视觉小说菜单的「角色」页都开这里
   */
  const renderStudioProfile = () =>
    card && cardId ? (
      <ProfileTab
        card={card}
        avatarUrl={avatarUrl}
        preset={preset}
        order={order}
        result={preview}
        presetName={savedPresets.find((p) => p.id === presetId)?.name ?? preset?.name ?? null}
        persona={{ name: activePersona?.name ?? '', description: persona }}
        budget={tokenBudget}
        onChangeBudget={changeBudget}
        busy={cardBusy}
        onChange={changeCard}
        onPickAvatar={() => pickAvatarFor({ kind: 'card' })}
        onExport={() => void exportCard()}
        onDuplicate={() => void duplicateCard()}
        // 删的就是正在编辑的这张:删完回到原来的界面,别停在下一张卡的资料页上
        onDelete={() => void removeCard().then((ok) => ok && setStudio(null))}
        binding={{
          personas,
          personaId: personas.some((p) => p.id === boundPersonaId) ? boundPersonaId : null,
          defaultPersonaName: personas.find((p) => p.id === personaBindings.default)?.name ?? null,
          onPersona: (id) => void bindPersonaToCard(id),
          presets: savedPresets,
          presetId: boundPresetId,
          onPreset: bindPresetToCard,
        }}
        personaPage={{
          personas,
          cardId,
          cardName,
          bindings: personaBindings,
          onChangeBindings: changePersonaBindings,
          onBindToCard: (id) => void bindPersonaToCard(id),
          onRefresh: refreshPersonas,
          onPickAvatar: (id) => pickAvatarFor({ kind: 'persona', id }),
          cardNames: new Map(savedCards.map((c) => [c.id, c.name])),
          notify,
        }}
        renderPreset={renderStudioPreset}
      />
    ) : null;
  /** 素材页的一栏(主区 + 右栏)。第 1 段的各个任务逐个换成真的编辑器,还没做的先占位 */
  const renderStudioSlot = (slot: SlotKey) => {
    if (slot === 'sprite' && card) {
      return (
        <SpriteSlot
          key={cardId}
          card={card}
          userName={userName}
          sprite={spritePacks}
          stage={spriteLayout.stage}
          backgrounds={studioBackgrounds}
          sync={packSync}
          notify={notify}
        />
      );
    }
    if (slot === 'bg' && card) {
      return (
        <BackgroundSlot
          key={cardId}
          cardName={cardName}
          scene={scenePlugin}
          sprites={spritePacks.sprites}
          layout={spriteLayout.layout}
          stage={spriteLayout.stage}
          sync={packSync}
          notify={notify}
        />
      );
    }
    if (slot === 'bgm' && card) {
      return <BgmSlot key={cardId} cardName={cardName} scene={scenePlugin} sync={packSync} notify={notify} />;
    }
    if (slot === 'voice') {
      // 情绪对照用当前服装里启用的差分(游戏里 AI 只能写这些)
      return (
        <VoiceSlot
          voice={voicePlugin}
          cardName={cardName}
          spriteLabels={cardSprites.map((s) => s.label)}
          notify={notify}
        />
      );
    }
    if (slot === 'cg') {
      // 只列导入的 CG 包(AI 生成的归「AI 生成」那一栏);差分名用当前服装里启用的(游戏里 AI 只能写这些)
      return (
        <CgSlot
          key={cardId}
          cardName={cardName}
          scene={scenePlugin}
          emotions={cardSprites.map((s) => s.label)}
          sync={packSync}
          notify={notify}
        />
      );
    }
    if (slot === 'ai' && aiStudio && cardId) {
      // 相册 + 收藏进 CG 包的那些;生图卡带自己画(主区 + 右栏)
      return aiStudio.render({ cardId, cardName, kept: studioKept, openSettings: openIllustrationSettings });
    }
    return <SlotPending slot={slot} />;
  };

  /**
   * 预设那一套(状态、块操作、预设增删改):调试台左栏、视觉小说菜单的「预设」页、卡编辑器资料页的预设页
   * 拿的是同一份,哪边改了别处跟着变。各处只有收起、点插件块去哪不一样
   */
  const presetBase: PresetBaseProps = {
    preset,
    order,
    activeGroupIndex: groupIndex,
    onPickGroup: (i) => {
      // 块的开关是按顺序组记的,换组就清掉 —— 有改过的先问一句,别悄悄没了
      const n = Object.keys(overrides).length;
      if (n > 0 && !window.confirm(`换顺序组会清掉刚才改的 ${n} 个块的开关,继续?`)) return;
      setGroupIndex(i);
      setOverrides({});
    },
    onToggleBlock: toggleBlock,
    saved: savedPresets,
    selectedId: presetId,
    dirty: presetDirty,
    busy: presetBusy,
    onUpdateBlock: updateBlock,
    onReorder: reorderBlock,
    onAddBlock: addBlock,
    onDeleteBlock: deleteBlock,
    isPluginBlock,
    autoBlocks: autoBlockRows,
    skippedBlocks,
    onPinAuto: (identifier) => insertPluginBlock(pluginOfBlock(identifier)),
    overridden: overriddenIdentifiers,
    resolveMarker,
    macros: displayMacros,
    onUpdateCard: changeCard,
    onSelectPreset: choosePreset,
    onSave: savePreset,
    onSaveAs: savePresetAs,
    onNewPreset: newPreset,
    onRename: renamePreset,
    onRestore: restorePreset,
    onDelete: deletePreset,
    onImport: () => presetInputRef.current?.click(),
    onExport: exportPreset,
    cardBinding:
      cardId && presetId
        ? {
            cardName,
            boundName: savedPresets.find((p) => p.id === boundPresetId)?.name ?? null,
            bound: boundPresetId === presetId,
            onToggle: (on) => bindPresetToCard(on ? presetId : null),
          }
        : undefined,
  };

  const renderPresetPanel = (at: {
    collapsed: boolean;
    onToggleCollapse: () => void;
    onOpenPlugin: (identifier: string) => void;
  }) => (
    <PresetPanel
      {...presetBase}
      collapsed={at.collapsed}
      onToggleCollapse={at.onToggleCollapse}
      onOpenPlugin={at.onOpenPlugin}
    />
  );

  /**
   * 资料页 · 预设:同一套状态摆成整页,右栏编辑选中的块。
   * 调试台的插件抽屉被卡编辑器盖着,点插件块时抽屉开在这一页上面
   */
  const renderStudioPreset = () => (
    <PresetView {...presetBase} pluginOf={pluginOfBlock} renderPlugin={renderPluginsDrawer} />
  );

  // 给 VN 的角色列表:每次渲染都 map 出一个新数组的话,流式生成时每来一个字选角页和等待页
  // 就要重算一遍、选角页的加载循环被打断重来
  // 状态卡(素材架构 3.5)先不单独列:选角页、卡列表只有主卡,玩的时候在顶栏切
  const listedCards = useMemo(() => savedCards.filter((c) => !c.state_of), [savedCards]);
  const vnCards = useMemo(
    () =>
      listedCards.map((c) => ({
        id: c.id,
        name: c.name,
        avatar: cardAvatars.get(c.id) ?? null,
        hasLastChat: Boolean(c.last_chat_id),
      })),
    [listedCards, cardAvatars],
  );

  return (
    // vn-open:视觉小说盖在最上面时,从它里面打开的弹窗(块编辑、高级定义、看提示词)得压过它
    // studio-open:卡编辑器开着时,从它里面打开的旧抽屉、弹窗也得压过它
    <div className={`console${vnOpen ? ' vn-open' : ''}${studio ? ' studio-open' : ''}`}>
      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}

      {/* 导入/导出遮罩:比开机那层轻,只是挡住重复点击并说明在忙什么 */}
      {busyLabel && (
        <div className="op-veil">
          <div className="op-veil-card">
            <span className="spinner" />
            <span>{busyLabel}</span>
          </div>
        </div>
      )}

      {/* 开机遮罩:预设→卡→最近对话是串行的,盖住这段免得界面一格格长出来 */}
      {booting && (
        <div className="boot-veil">
          <img className="boot-logo" src="/anima-logo.svg?v=72" alt="" draggable={false} />
          <div className="boot-title">ANIMABACKEND</div>
          <div className="boot-line">
            <span className="spinner" /> 正在载入角色卡与预设……
          </div>
        </div>
      )}

      <div className="topbar">
        {/* 测试环境的小牌子:设了 VITE_ENV_LABEL 才有 */}
        <EnvBadge />
        <div className="topbar-brand">
          <img className="topbar-logo" src="/anima-logo.svg?v=72" alt="" draggable={false} />
          <span className="topbar-title">
            <span className="topbar-title-wide">ANIMABACKEND</span>
            <span className="topbar-title-compact">ANIMA</span>
          </span>
          <span className="topbar-sub">PROMPT CONSOLE</span>
        </div>

        {/* 移动端专属:两侧面板的开关。桌面端靠列边缘那条竖排 panel-rail 收放,
            移动端根本没有「列」—— 两栏是盖住聊天区的全屏抽屉,得在顶栏给入口 */}
        <button
          className={`btn topbar-panel-btn${!leftCollapsed ? ' accent' : ''}`}
          onClick={() => {
            setMobileMenu(false);
            setLeftCollapsed((v) => !v);
            // 移动端两张抽屉都是全屏的,同时开只会互相盖住 —— 开一张就收掉另一张
            setRightCollapsed(true);
          }}
          title="预设面板"
          aria-label="预设面板"
        >
          <AnimaIcon name="preset" size={18} />
        </button>
        <button
          className={`btn topbar-panel-btn${!rightCollapsed ? ' accent' : ''}`}
          onClick={() => {
            setMobileMenu(false);
            setRightCollapsed((v) => !v);
            setLeftCollapsed(true);
          }}
          title="角色卡面板"
          aria-label="角色卡面板"
        >
          <AnimaIcon name="character-card" size={18} />
        </button>

        {/* 视觉小说入口:桌面和手机都在顶栏一级位置,不折进 ⋯ 菜单 */}
        <button
          className="btn icon-label topbar-vn-btn"
          onClick={() => toggleVn(true)}
          title="视觉小说模式 —— 用立绘和对话框看同一段对话"
          aria-label="视觉小说模式"
        >
          <AnimaIcon name="vn" size={17} />
          <span className="topbar-btn-label">视觉小说</span>
        </button>

        {/* 连接状态是「还能不能发消息」的唯一指示,移动端也留在顶栏,只是把文字收掉剩个点 */}
        <button
          className={`btn topbar-api-btn${drawer === 'api' ? ' active' : ''}`}
          onClick={() => toggleDrawer('api')}
          title="管理 API 连接"
        >
          {activeConnection ? <span className="dot on" /> : <span className="dot" />}
          <span className="topbar-btn-label">API 设置</span>
        </button>

        {/* 桌面端 display:none;移动端把 ⋯ 顶到最右 */}
        <div className="topbar-mobile-spacer" />

        {/* 桌面端:玩家、设置、连接和模型都是全局控制。
            移动端:前两项折进 ⋯；预设和角色卡本身有一级入口,导入动作留在各自面板。 */}
        <div className={`topbar-rest${mobileMenu ? ' open' : ''}`}>
          {/* 玩家人设不常动,桌面保留文字入口;手机折进 ⋯ 菜单。 */}
          <button
            className={`btn icon-label topbar-action${drawer === 'persona' ? ' accent' : ''}`}
            onClick={() => toggleDrawer('persona')}
            title={`玩家人设 —— 决定提示词里 {{user}} 是谁${activePersona ? ` (当前:${activePersona.name})` : ''}`}
          >
            <AnimaIcon name="player" size={16} />
            <span>玩家</span>
          </button>
          {/* 显示偏好的总入口 —— 以后新增的设置都往这个抽屉里塞,不再往顶栏加按钮 */}
          <button
            className={`btn icon-label topbar-action${drawer === 'settings' ? ' accent' : ''}`}
            onClick={() => toggleDrawer('settings')}
            title="设置 —— 聊天区的排版、字号、对话高亮"
          >
            <AnimaIcon name="sliders" size={16} />
            <span>设置</span>
          </button>
          <button
            className={`btn icon-label topbar-action${drawer === 'plugins' ? ' accent' : ''}`}
            onClick={() => toggleDrawer('plugins')}
            title="插件 —— 立绘等视觉小说素材,以及它们的提示词块"
          >
            <AnimaIcon name="plugin" size={16} />
            <span>插件</span>
          </button>
          <button
            className={`btn icon-label topbar-action${library ? ' accent' : ''}`}
            onClick={openLibrary}
            title="素材 —— 库里所有的立绘、声音、背景、BGM、CG,按包管理、绑到角色卡上"
          >
            <AnimaIcon name="library" size={16} />
            <span>素材</span>
          </button>
          <input
            ref={presetInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadPreset(f);
              e.target.value = '';
            }}
          />

          <div className="topbar-spacer" />

          <div className="topbar-field">
            <span className="topbar-label">连接</span>
            <select
              className="select"
              value={connectionId ?? ''}
              onChange={(e) => selectConnection(e.target.value)}
              title="选中即切换为当前启用的连接 —— 和 API 设置里的选择互通"
            >
              {connections.length === 0 && <option value="">(无)</option>}
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.is_active ? ' ●' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="topbar-field">
            <span className="topbar-label">模型</span>
            {/* 选项只有当前连接上次从 API 拉到并存库的 cached_models;空列表时点 ⟳ 现拉一次 */}
            <select
              className="select topbar-model-select"
              value={modelInList ? activeModel : ''}
              title="当前连接用的模型 —— 和 API 设置里的模型名是同一个值,改哪边都同步"
              onChange={(e) => pickModel(e.target.value)}
            >
              {/* 连接的模型不在列表里(还没拉过/手打的)时占个位显示它,但不作为可选项 */}
              {!modelInList && (
                <option value="" disabled>
                  {activeModel || '未设模型'}
                  {activeModel && cachedModels.length > 0 ? '(不在列表中)' : ''}
                </option>
              )}
              {cachedModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              className={`btn small${modelsRefreshing ? ' busy' : ''}`}
              disabled={!connectionId || modelsRefreshing}
              title={
                activeConnection?.cached_models_at
                  ? `重新拉取模型列表(上次 ${new Date(activeConnection.cached_models_at).toLocaleString()})`
                  : '拉取该连接的模型列表'
              }
              onClick={refreshModelList}
            >
              {modelsRefreshing ? '…' : <AnimaIcon name="refresh" size={15} />}
            </button>
          </div>
        </div>

        {/* 移动端菜单开关。菜单展开时点空白处收起 —— 背板见 .topbar-rest-veil */}
        <button
          className={`btn topbar-more-btn${mobileMenu ? ' accent' : ''}`}
          onClick={() => setMobileMenu((v) => !v)}
          title="更多"
          aria-label="更多"
          aria-expanded={mobileMenu}
        >
          <AnimaIcon name="more" size={18} />
        </button>
        {mobileMenu && (
          <div className="topbar-rest-veil" onClick={() => setMobileMenu(false)} />
        )}
      </div>

      {/* 视觉小说开着时三栏被盖住看不见:冻住,不跟着流式一段段重画(Frozen.tsx);退出时按最新的画一遍。
          顶栏不冻:便宜。视觉小说的「导入」走导入器临时建的文件框(importer/useImporter.ts),不靠三栏里的东西 */}
      <Frozen frozen={vnOpen}>
        <div
          className={`console-body ${leftCollapsed ? 'left-collapsed' : ''} ${
            rightCollapsed ? 'right-collapsed' : ''
          }`}
          style={bodyStyle}
        >
          <div className="left-col">
            {renderPresetPanel({
              collapsed: leftCollapsed,
              onToggleCollapse: () => setLeftCollapsed((v) => !v),
              onOpenPlugin: openPluginEditor,
            })}
            {!leftCollapsed && (
              <BudgetBar
                report={preview.budget}
                value={tokenBudget}
                onChange={changeBudget}
                range={rangeScale}
                onRange={changeRange}
              />
            )}
            {!leftCollapsed && (
              <div className="history-bar">
                <span className="chat-current" title="当前对话">
                  {chats.find((c) => c.id === chatId) ? chatLabel(chats.find((c) => c.id === chatId)!) : '(无)'}
                </span>
                <button
                  className={`history-trigger${showHistory ? ' open' : ''}`}
                  onClick={() => {
                    const next = !showHistory;
                    setShowHistory(next);
                    // 入口在左栏,面板却画在聊天区里。移动端左栏是盖住聊天区的
                    // 全屏抽屉 —— 不顺手收掉它,点开历史看上去就是什么都没发生
                    if (next && isMobile) setLeftCollapsed(true);
                  }}
                  title="对话历史与分支 —— 在聊天区展开"
                >
                  <AnimaIcon name="history" size={15} />
                  <span>对话历史</span>
                  {(treeLoading || chatOp === 'branch') && <span className="spinner tiny" />}
                </button>
              </div>
            )}
          </div>

          <div
            className={`col-resizer${leftCollapsed ? ' disabled' : ''}`}
            role="separator"
            aria-orientation="vertical"
            onPointerDown={(e) => startDrag('left', e)}
          />

          <div className="chat-col">
            {drawer === 'settings' && (
              <SettingsDrawer
                settings={chatSettings}
                onChange={changeChatSettings}
                macros={displayMacros}
                custom={customMacros}
                onChangeCustom={changeCustomMacros}
                variables={variables}
                onChangeVariables={(next) => commitVariables(next)}
                hasChat={chatId !== null}
                worldInfo={worldInfoSettings}
                onChangeWorldInfo={changeWorldInfoSettings}
                onClose={() => setDrawer(null)}
              />
            )}

            {drawer === 'plugins' && renderPluginsDrawer(pluginFocus, () => setDrawer(null))}

            {drawer === 'persona' && (
              <PersonaDrawer
                notify={notify}
                onClose={() => setDrawer(null)}
                onChanged={refreshPersonas}
                onPickAvatar={(id) => pickAvatarFor({ kind: 'persona', id })}
                bindings={personaBindings}
                onChangeBindings={changePersonaBindings}
                card={cardId && card ? { id: cardId, name: card.name } : null}
                cardNames={new Map(savedCards.map((c) => [c.id, c.name]))}
              />
            )}

            {drawer === 'api' && (
              <ConnectionsDrawer
                connections={connections}
                notify={notify}
                onClose={() => setDrawer(null)}
                onChanged={refreshConnections}
                jev={{ status: jevKey, onOpen: () => openPluginSection('jev') }}
              />
            )}

            {showHistory && (
              <ChatHistoryOverlay
                chats={treeChats}
                currentChatId={chatId}
                noCharacter={!cardId}
                busy={treeLoading || chatOp === 'branch'}
                pending={chatOp}
                onSelect={(id) => {
                  setShowHistory(false);
                  void loadChat(id);
                }}
                onNewChat={() => {
                  setShowHistory(false);
                  void newChat();
                }}
                onImport={() => chatInputRef.current?.click()}
                onExport={() => void runExport(false)}
                onExportTree={() => void runExport(true)}
                onExportOne={(id) => runExport(false, id)}
                onRename={renameChat}
                onDelete={removeChat}
                onClose={() => setShowHistory(false)}
              />
            )}

            <ChatPanel
              entries={entries}
              settings={chatSettings}
              macros={displayMacros}
              chatKey={chatId}
              charName={card?.name ?? ''}
              userName={userName}
              userAvatar={avatarOf(activePersona)}
              charAvatar={avatarUrl}
              sending={sending}
              error={error}
              preview={preview}
              ready={ready}
              loading={chatLoading}
              version={version}
              activeConnection={activeConnection}
              cardCount={listedCards.length}
              onPickCharacter={() => {
                // 摊开右栏并切到角色列表 —— 移动端进来两栏是收起的,
                // 开始界面上这颗按钮就是唯一的入口
                setCardView('list');
                setRightCollapsed(false);
              }}
              onOpenConnections={() => setDrawer('api')}
              onSend={send}
              onInspect={setInspecting}
              onInspectSwipe={inspectSwipe}
              tainted={tainted}
              onStop={() => abortRef.current?.abort()}
              onEdit={editMessage}
              onDelete={deleteAt}
              onSwipe={swipe}
              onBranch={branchHere}
              onReset={() => void newChat()}
              onRegenerate={regenerateLast}
              tagKinds={vnKinds}
            />
          </div>

          <div
            className={`col-resizer${rightCollapsed ? ' disabled' : ''}`}
            role="separator"
            aria-orientation="vertical"
            onPointerDown={(e) => startDrag('right', e)}
          />

          <CardPanel
            card={card}
            avatarUrl={avatarUrl}
            collapsed={rightCollapsed}
            saved={listedCards}
            selectedId={cardId}
            view={cardView}
            avatars={cardAvatars}
            onNeedAvatars={wantAvatars}
            saveState={cardSaveState}
            busy={cardBusy}
            onToggleCollapse={() => setRightCollapsed((v) => !v)}
            onToggleView={() => setCardView((v) => (v === 'list' ? 'editor' : 'list'))}
            onChange={changeCard}
            onSelectCard={(id) => {
              const row = savedCards.find((c) => c.id === id);
              if (row) selectCard(row);
            }}
            onNew={newCard}
            onDuplicate={duplicateCard}
            onDelete={deleteCard}
            onImport={() => importer.pick()}
            onExport={() => void exportCard()}
            onOpenStudio={(tab) => openStudio({ tab, slot: 'sprite' })}
            onPickAvatar={() => pickAvatarFor({ kind: 'card' })}
            bindings={cardBindings}
          />
        </div>
      </Frozen>

      {/* 头像选择:藏起来的 file input,点头像时触发 */}
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setCropTask({ file: f, target: avatarTargetRef.current });
          e.target.value = '';
        }}
      />

      {/* 头像裁剪:卡图和人设头像同一个弹窗、同一套 2:3 规格 */}
      {cropTask && (
        <CropModal
          file={cropTask.file}
          onCancel={() => setCropTask(null)}
          onCropped={(blob) => {
            const { target } = cropTask;
            setCropTask(null);
            if (target.kind === 'card') void changeAvatar(blob);
            else void changePersonaAvatar(target.id, blob);
          }}
        />
      )}

      {/* 对话导入:藏起来的 file input,分支树里的 ↓ 触发,可多选 jsonl */}
      <input
        ref={chatInputRef}
        type="file"
        accept=".jsonl,application/jsonl,application/x-ndjson"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void importChats(files);
          e.target.value = '';
        }}
      />

      {vnOpen && (
        <VNScreen
          entries={entries}
          macros={displayMacros}
          charName={card?.name ?? ''}
          userName={userName}
          sprites={activeSprites}
          forms={forms}
          spriteStage={spriteLayout.stage}
          spriteLayout={spriteLayout.layout}
          tagTemplate={spriteEffective.tagTemplate}
          sceneAssets={activeSceneAssets}
          titleBgmId={scenePlugin.titleBgmId}
          onChangeTitleBgm={(id) => void scenePlugin.setTitleBgm(id)}
          bgTemplate={scenePlugin.effective.bg.tagTemplate}
          bgmTemplate={scenePlugin.effective.bgm.tagTemplate}
          cgTemplate={scenePlugin.effective.cg.tagTemplate}
          voiceConfig={voicePlugin.config}
          voiceCast={voicePlugin.cast}
          sfxEnabled={splice.on}
          onChangeVoiceConfig={voicePlugin.changeConfig}
          showJa={langConfig.showJa}
          onChangeShowJa={(showJa) => changeLangConfig({ ...langConfig, showJa })}
          jevSync={jevConfig.syncText}
          enterKey={chatSettings.enterKey}
          onChangeEnterKey={(enterKey) => changeChatSettings({ ...chatSettings, enterKey })}
          sending={sending}
          canSend={ready && !chatLoading}
          notReadyHint={
            !card ? '先选一个角色' : !preset ? '先在菜单「预设」里选一个预设' : '准备中…'
          }
          chatKey={chatId}
          chatName={(() => {
            const c = chats.find((x) => x.id === chatId);
            return c ? chatLabel(c) : '';
          })()}
          chatUpdatedAt={chats.find((x) => x.id === chatId)?.updated_at ?? null}
          cardTags={card?.tags?.map((t) => t.trim()).filter(Boolean) ?? []}
          loading={chatLoading}
          assetsReady={spritePacks.ready && scenePlugin.ready && states.ready}
          modelLabel={activeModel}
          onSend={(text) => void send(text)}
          onInterject={(text, entryId, keep) => void interject(text, entryId, keep)}
          onBranch={(text, entryId, keep) => void branchFromHistory(text, entryId, keep)}
          onStop={() => abortRef.current?.abort()}
          onRegenerate={regenerateLast}
          onExit={() => toggleVn(false)}
          cards={vnCards}
          onWantAvatar={(id) => wantAvatars([id])}
          onImportCard={() => importer.pick()}
          currentCardId={cardId}
          onPickCard={(id, fresh) => {
            const row = savedCards.find((c) => c.id === id);
            if (row) void selectCard(row, { fresh });
          }}
          // 检查器里只改这一句的表情:记进这条当前分支的 swipe_info.vn.manual,persist effect 照常写库
          onSetManual={(id, line, pick) => patchEntry(id, (e) => setManual(e, line, pick))}
          illustrations={illustrations.vn}
          switches={switches}
          onOpenLibrary={openLibrary}
          renderPage={(page, ctx) => {
            if (page === 'log') {
              return (
                <div className="vn-embed vn-log-embed">
                  <ChatPanel
                    variant="backlog"
                    // 默认只给人看正文:标签摘掉、宏展开;「显示原文」= 库里存的原样(模型写的,不含 Jev 另存的标注)
                    displayText={ctx.raw ? (raw) => raw : (_raw, shown) => stripTags(shown, vnKinds)}
                    tagKinds={vnKinds}
                    // 看正文时按画面上的句子列,要念的句子带重播 / 重新生成;看原文时照原样
                    renderBody={ctx.raw ? undefined : ctx.lineView}
                    hideReasoning={!ctx.showThinking}
                    onJump={ctx.jumpTo}
                    entries={entries}
                    settings={chatSettings}
                    macros={displayMacros}
                    chatKey={chatId}
                    charName={card?.name ?? ''}
                    userName={userName}
                    userAvatar={avatarOf(activePersona)}
                    charAvatar={avatarUrl}
                    sending={sending}
                    error={error}
                    preview={preview}
                    ready={ready}
                    loading={chatLoading}
                    version={version}
                    activeConnection={activeConnection}
                    cardCount={listedCards.length}
                    onPickCharacter={() => {}}
                    onOpenConnections={() => {}}
                    onSend={(text) => void send(text)}
                    onInspect={setInspecting}
                    onInspectSwipe={inspectSwipe}
                    tainted={tainted}
                    onStop={() => abortRef.current?.abort()}
                    onEdit={editMessage}
                    onDelete={deleteAt}
                    onSwipe={swipe}
                    onBranch={branchHere}
                    onReset={() => void newChat()}
                    onRegenerate={regenerateLast}
                  />
                </div>
              );
            }
            if (page === 'save') {
              return (
                <VNSaves
                  cardId={cardId}
                  chats={chats}
                  currentChatId={chatId}
                  currentEntries={entries}
                  sceneAssets={activeSceneAssets}
                  sprites={activeSprites}
                  spriteStage={spriteLayout.stage}
                  spriteLayout={spriteLayout.layout}
                  tagKinds={vnKinds}
                  charName={card?.name ?? ''}
                  userName={userName}
                  formsLensFor={forms.lensFor}
                  macros={displayMacros}
                  busy={chatOp !== null || chatLoading}
                  canSave={Boolean(chatId) && !sending && entries.length > 0}
                  onSaveHere={() => void saveBranch(ctx.currentMessageId)}
                  onLoad={(id) => {
                    ctx.close();
                    void loadChat(id);
                  }}
                  onNewStory={() => {
                    ctx.close();
                    void newChat();
                  }}
                  onRename={renameChat}
                  onDelete={removeChat}
                />
              );
            }
            if (page === 'card') {
              return (
                <div className="vn-embed vn-card-embed">
                  <CardPanel
                    card={card}
                    avatarUrl={avatarUrl}
                    collapsed={false}
                    saved={listedCards}
                    selectedId={cardId}
                    view={cardView}
                    avatars={cardAvatars}
                    onNeedAvatars={wantAvatars}
                    saveState={cardSaveState}
                    busy={cardBusy}
                    onToggleCollapse={ctx.close}
                    onToggleView={() => setCardView((v) => (v === 'list' ? 'editor' : 'list'))}
                    onChange={changeCard}
                    onSelectCard={(id) => {
                      const row = savedCards.find((c) => c.id === id);
                      if (row) void selectCard(row);
                    }}
                    onNew={newCard}
                    onDuplicate={duplicateCard}
                    onDelete={deleteCard}
                    onImport={() => importer.pick()}
                    onExport={() => void exportCard()}
                    onOpenStudio={(tab) => openStudio({ tab, slot: 'sprite' })}
                    onPickAvatar={() => pickAvatarFor({ kind: 'card' })}
                    bindings={cardBindings}
                  />
                </div>
              );
            }
            if (page === 'plugin') {
              // 调试台的插件抽屉原样嵌进来:同一个组件、同一份数据,两边改动互通
              return (
                <div className="vn-embed vn-plugin-embed">
                  {renderPluginsDrawer(ctx.pluginFocus, ctx.close)}
                </div>
              );
            }
            if (page === 'preset') {
              return (
                <div className="vn-embed vn-preset-embed">
                  {renderPresetPanel({
                    collapsed: false,
                    onToggleCollapse: ctx.close,
                    // 插件块的正文在插件页里改:换到菜单的插件页,滚到那个插件的模板
                    onOpenPlugin: (identifier) => ctx.openPlugin(pluginOfBlock(identifier)),
                  })}
                  {/* 和调试台左栏一样:预算记在这个预设里 */}
                  <BudgetBar
                    report={preview.budget}
                    value={tokenBudget}
                    onChange={changeBudget}
                    range={rangeScale}
                    onRange={changeRange}
                  />
                </div>
              );
            }
            // 模型:就是调试台的「API 设置」,同一个组件、同一份连接数据,两边改动互通
            return (
              <div className="vn-embed vn-model-embed">
                <ConnectionsDrawer
                  connections={connections}
                  notify={notify}
                  onClose={ctx.close}
                  onChanged={refreshConnections}
                  jev={{ status: jevKey, onOpen: () => ctx.openPlugin('jev') }}
                />
              </div>
            );
          }}
        />
      )}
      {vnOpen && <EnvBadge floating />}

      {/* 素材管理页:全屏,盖在视觉小说上面;排在卡编辑器前面 —— 点卡名打开的卡编辑器盖在它上面 */}
      {library && (
        <AssetLibrary
          route={library}
          onRoute={routeLibrary}
          onClose={() => setLibrary(null)}
          cards={libraryCards}
          stage={spriteLayout.stage}
          sync={packSync}
          notify={notify}
          bindings={libraryBindings}
          // 包上「被几张卡用」跟着变
          onBindingsChanged={(kind) => packSync.packs(kind === 'bg' || kind === 'bgm' ? 'scene' : kind)}
          onDeleted={forgetDeleted}
          onOpenCard={(id, slot) => openStudio({ tab: 'assets', slot }, id)}
          onUndone={(r) => void afterImportUndone(r)}
          // 「导入」:选文件交给导入器,不带目标卡;导完有卡就开那张卡的卡编辑器(盖在这一页上面)
          onImport={() => importer.pick()}
          notice={libraryNotice}
          onNoticeClose={() => setLibraryNotice(null)}
          onClassifyUnknown={classifyInLibrary}
          covered={studio !== null}
          reloadKey={libraryReload}
        />
      )}

      {/* 卡编辑器:全屏,盖在视觉小说上面(从选角页、菜单的「角色」页也能打开) */}
      {studio && card && cardId && (
        <CardStudio
          cardId={cardId}
          card={card}
          avatarUrl={avatarUrl}
          faceVersion={spritePacks.packId}
          route={studio}
          onRoute={setStudio}
          onClose={() => setStudio(null)}
          onStart={startFromStudio}
          saveState={cardSaveState}
          renderProfile={renderStudioProfile}
          renderSlot={renderStudioSlot}
          slots={studioSlots}
          notify={notify}
          onClassifyUnknown={classifyUnknown}
          onImport={() => importer.pick({ cardId, cardName, kind: null })}
        />
      )}

      {/* 导入:拖进窗口的遮罩(落点在卡片列表、选角页、卡编辑器里)、上传和整理的进度、导入前的确认框 */}
      <DropLayer
        blocked={booting ? '正在载入,稍等再拖' : importer.blocked}
        onDrop={importer.start}
        onRefuse={(reason) => notify('error', reason)}
      />
      <ImportProgress phase={importer.phase} onCancel={importer.cancelUpload} />
      {importer.confirm && (
        <ImportConfirm
          key={importer.confirm.plan.plan_id}
          plan={importer.confirm.plan}
          target={importer.confirm.target}
          sprites={importer.confirm.sprites}
          busy={importer.confirm.busy}
          error={importer.confirm.error}
          onCancel={importer.cancelConfirm}
          onConfirm={importer.confirmApply}
        />
      )}
      {studio && studioPlugin && (
        <PluginSheet onClose={() => setStudioPlugin(null)}>
          {renderPluginsDrawer(studioPlugin, () => setStudioPlugin(null))}
        </PluginSheet>
      )}

      {inspecting && (
        <PromptInspector
          result={inspecting}
          lastRaw={lastRaw}
          onClose={() => setInspecting(null)}
          onNotify={notify}
        />
      )}
    </div>
  );
}
