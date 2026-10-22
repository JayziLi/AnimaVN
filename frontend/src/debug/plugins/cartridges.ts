/**
 * 卡带登记处(素材架构设计 2.1 的 extends、2.8;实施计划 P2b):能整个拔掉的插件,各占 plugins/<id>/ 一个文件夹,
 * 文件夹里的 cartridge.ts 默认导出一个 Cartridge。这里用 import.meta.glob 收集 —— 文件夹删掉以后照常编译、照常跑,
 * 只是少了那样功能(生成公开版就是删这几个文件夹)。
 *
 * 规矩(cartridges.boundary.test.ts 守着):
 * - 卡带文件夹外面谁都不 import 卡带里的东西,只在这里要扩展点;卡带之间也不互相 import。
 * - 内核按扩展点要(extension),不按卡带的 id 要:公开版的代码里不留卡带的名字。要不到就当没有。
 * - 用卡带的还是「没有」的默认值,第一次用到时定下来、以后不变(lazyExtension):卡带在不在,hook 的调用顺序都不变。
 *   别在模块加载时就要:卡带加载时会绕回内核模块(比如卡带用到语音播放),那时登记处还没登记完。
 * - cartridge.ts 从这个文件只 import type:这里加载时就 import 卡带,反过来拿值会绕成循环引用。
 *
 * 形态的扩展点由 plugins/forms.ts 统一要,语音的由 plugins/voiceExtensions.ts 统一要。
 */

import type { ComponentType, ReactNode } from 'react';
import type { DrawerCardFacts } from '../components/drawer/cardView';
import type { TipKey } from '../components/drawer/tips';
import type { Notify } from '../components/pluginRunner';
import type { FormsLens } from '../core/timeline';
import type { SceneAsset, VoiceExplain, VoiceProfile } from '../lib/api';
import type { ChatEntry } from '../lib/chatEntry';
import type { SlotKey } from '../studio/types';
import type { VNLine } from '../vn/script';
import type { SwitchKind } from './switches';

/** 只看名字的立绘 */
export interface NamedSprite {
  label: string;
}

/** 形态卡带给 DebugApp 的输入(useForms 的参数) */
export interface FormsInput {
  cardId: string | null;
  chatId: string | null;
  /** 当前对话的条目:存档里的记号从这里读 */
  entries: readonly ChatEntry[];
  sprites: readonly NamedSprite[];
  /** 改当前对话的一条消息(DebugApp 的 setEntries,改完它会写库) */
  patchEntry: (id: string, fn: (e: ChatEntry) => ChatEntry) => void;
}

/** 记号存进存档以后的结果(设置 → 数据那一行显示它) */
export interface MarksUploadReport {
  /** 这个浏览器地址里读到几个记号 */
  read: number;
  /** 存进存档的(本来就在的也算) */
  saved: number;
  /** 所在的消息或对话已经删了、用不上的 */
  orphaned: number;
  /** 涉及几个对话 */
  chats: number;
}

/** 旧形态记号换算成的状态记号:第 entryId 条第 line 句切到了 state(状态名) */
export interface LegacyStateMark {
  entryId: string;
  line: number;
  state: string;
}

/** 只看「在哪些形态出」的 CG(场景包里 CG 的 forms;空 = 不限)。状态(第 4 期)按编号看这张 CG 绑没绑 */
export interface FormsCg {
  id?: string;
  forms?: readonly string[];
}

/**
 * 形态卡带给 DebugApp 的状态(useForms 的结果)。卡带在、只是这张卡没开时也有,enabled 是 false;
 * 卡带不在时是 plugins/forms.ts 的 NO_FORMS
 */
export interface FormsState {
  /** 这张卡开着,而且用得上 */
  enabled: boolean;
  /** 对话末尾的形态;这张卡没开时是 null */
  current: string | null;
  /** 给时间线的接口(core/timeline.ts);这张卡没开时是 null */
  lens: FormsLens | null;
  /** 新回复的 {{sprites}} 和 Jev 只在当前形态那组立绘里选;没开时原样返回传进来的那个数组 */
  spritesNow: <T extends NamedSprite>(sprites: readonly T[]) => readonly T[];
  /** 第 index 条(在对话里的位置)末尾这张 CG 能不能出;没开时 undefined = 都能出 */
  cgOkAt: ((cg: FormsCg, index: number) => boolean) | undefined;
  /** 对话末尾这张 CG 能不能出({{cgs}}、Jev 的 CG 候选);没开时 undefined */
  cgOkNow: ((cg: FormsCg) => boolean) | undefined;
  /** 给另一段对话(存档缩略图)现算形态接口;这张卡没开时是 null */
  lensFor: (chatId: string, entries: readonly ChatEntry[], sprites: readonly NamedSprite[]) => FormsLens | null;
  /** 在第 entryId 条第 line 句切成 form */
  switchAt: (entryId: string, line: number, form: string) => void;
  /** 设置 → 数据里「形态记号」那一行:把这个浏览器地址上以前的记号一次存进存档;没有就不显示这一行 */
  uploadMarks?: () => Promise<MarksUploadReport>;
  /** 状态组(第 4 期,plugins/useStates.ts)接手时:各状态的名字,顶栏出状态按钮、不出形态按钮 */
  stateNames?: readonly string[];
}

/** 视觉小说顶栏的形态按钮 */
export interface FormButtonProps {
  form: string;
  onToggle: (next: string) => void;
}

/** 插件页 CG 表格里「在哪些形态出」那一列;[] = 不限 */
export interface CgFormsEditorProps {
  forms: readonly string[];
  disabled: boolean;
  onChange: (forms: string[]) => void;
}

/** 插件页 CG 表格里「在哪些形态出」 */
export interface CgFormsExtension {
  Editor: ComponentType<CgFormsEditorProps>;
  /** 立绘包里的表情名(差分用它们起名)看起来用得上形态吗;已经有 CG 标过的,核心自己会显示 */
  relevant: (labels: readonly string[]) => boolean;
  /** CG 页顶上说明的最后一句 */
  help: string;
  /** CG 的 Jev 说明里插的一句(前面带空格) */
  jevNote: string;
}

/**
 * 语音挑好语气以后「换成某个版本」。tone 是 Jev 给这句判的档,没判是 null;不换就原样返回
 */
export interface VoiceVersion {
  /** 按名字挑的(语音请求里的 emotion) */
  name: (emotion: string | null, tone: string | null, profile: VoiceProfile) => string | null;
  /** 按配对表挑好的那一行(语音请求里的 emotion_id) */
  row: (rowId: string, tone: string | null, profile: VoiceProfile) => string;
}

/** 决定这条回复要不要让 Jev 判档时能看的东西 */
export interface ToneAskContext {
  /** 对话末尾的形态;没有形态卡带、或者这张卡没开时是 null */
  form: string | null;
  /** 这张卡的主声音;没有是 null */
  voice: VoiceProfile | null;
}

/** 「拆句拼接」(useSplice 的结果):开关,和插件页里它那一页(两样用同一份状态) */
export interface SpliceState {
  /** 这次的语音请求带不带拼接开关(planVoiceLines 的 sfx) */
  on: boolean;
  /** 插件页里它那一页;没有是 null */
  panel: CartridgePanel | null;
}

/** 「声线分档」(useTone 的结果):开关,和插件页里它那一页(两样用同一份状态) */
export interface ToneState {
  /** 开着才让 Jev 判档(关着时 asksTone 的结果不用) */
  on: boolean;
  /** 插件页里它那一页;没有是 null */
  panel: CartridgePanel | null;
}

/** 插件页里卡带的那一页拿到的东西 */
export interface CartridgePanelProps {
  profiles: readonly VoiceProfile[];
  /** 抽屉里正在看的那张卡;没有是 null */
  card: { id: string; name: string } | null;
  /** 正在看的那张卡的主声音;没有是 null */
  mainVoice: VoiceProfile | null;
}

/** 插件页里卡带的那一页 */
export interface CartridgePanel {
  /** 插件页左栏的键(打开到哪一页用它) */
  key: string;
  /** 左栏的名字 */
  title: string;
  beta?: boolean;
  /** 排在哪一页后面:角色组是插件总表(plugins/registry.ts)的 id,实验组是别的卡带的 key */
  after: string;
  /** 左栏哪一组;不给 = 'role' */
  group?: 'role' | 'lab';
  /** 左栏这一行行尾放哪个插件开关(plugins/switches.ts);和 toggle 二选一,都不给 = 没有开关 */
  power?: SwitchKind;
  /** 卡带自己的开关(实验组的卡带);和 power 二选一 */
  toggle?: { on: boolean; set: (on: boolean) => void };
  /** 这张卡在不在用(左栏圆点);不给 = 不画圆点 */
  inUse?: (card: DrawerCardFacts) => boolean;
  /** 页头名字旁的问号:内核问号的键,或者卡带自己带的一句话(公开版会删掉的卡带,字放卡带里) */
  tip?: TipKey | { text: string };
  /** 页面底部「卡编辑器 · {卡}的{label}」去卡编辑器的哪一栏;不给 = 没有这个链接 */
  studio?: { slot: SlotKey; label: string };
  render: (p: CartridgePanelProps) => ReactNode;
}

// —— 插图(生图卡带)——

/** 视觉小说里一张插图怎么显示(CG 层照它画) */
export interface IllustrationView {
  key: string;
  src: string;
  /** 横向焦点(0–100),竖屏时裁哪里 */
  focus: number;
  /** above = 放在对话框上面那一块里(整张、居中,不被对话框挡住);不给 = 铺满屏幕(整张,空处垫模糊) */
  place?: 'screen' | 'above';
}

/** 视觉小说给插图卡带看的「现在在哪」 */
export interface VnIllustrationContext {
  /** 光标所在的那条回复;还没有回复时是 null */
  entry: ChatEntry | null;
  /** 光标在这条回复的第几句 */
  line: number;
  /** 这条回复切好的句子 */
  lines: readonly VNLine[];
  /** 这句所在的地点(背景);没有是 null */
  place: { label: string; description: string } | null;
  /** 这条回复还在写 */
  streaming: boolean;
  /** 打开游戏菜单的「设置」,停在卡带那一页 */
  openSettings: () => void;
}

/** 插图卡带给视觉小说的几样;没装卡带时整个是 null */
export interface VnIllustrations {
  /** 这条回复的第 line 句该显示的插图;没有是 null。要快:每次重画都调 */
  viewAt: (entry: ChatEntry, line: number) => IllustrationView | null;
  /** 游戏菜单「设置」里卡带自己那一页(视觉小说给它一个分页,名字是 settingsName) */
  settings: () => ReactNode;
  settingsName: string;
  /** 对话框里发送右边的小按钮(点它不会翻下一句) */
  button: (ctx: VnIllustrationContext) => ReactNode;
  /** 舞台上的一层(画画中、图上的操作、弹出的小面板) */
  stage: (ctx: VnIllustrationContext) => ReactNode;
  /** 最新一条回复写完、Jev 也判完了(只对这次打开以后写的回复调一次):自动出图 */
  onReplyDone: (entry: ChatEntry, lines: readonly VNLine[], place: VnIllustrationContext['place']) => void;
  /** 卡编辑器素材页的「AI 生成」那一栏;不给就没有这一栏 */
  studio?: StudioIllustrations;
}

/** 卡编辑器「AI 生成」那一栏拿到的东西(DebugApp 给) */
export interface StudioIllustrationContext {
  cardId: string;
  cardName: string;
  /**
   * 这张卡绑的 AI 生成 CG 包(generated,收藏时建的「AI 生图 · 卡名」)里的构图和差分,按绑定顺序;
   * 游戏里 AI / Jev 选得到的就是这些。绑定、包列表还没读到是 null
   */
  kept: readonly SceneAsset[] | null;
  /** 打开生图设置(插件页里卡带的那一页,盖在卡编辑器上面) */
  openSettings: () => void;
}

/**
 * 卡编辑器素材页的「AI 生成」那一栏(生图卡带给):相册 + 收藏进 CG 包的那些。
 * 导入的现成 CG 在「CG」那一栏;两种 CG 在游戏里一样能被选到
 */
export interface StudioIllustrations {
  /** 左栏这一行的名字:「AI 生成」 */
  name: string;
  /** 左栏这一行的数:相册几张、收藏几张;相册还没读到是 null。kept 同 StudioIllustrationContext.kept */
  summary: (kept: readonly SceneAsset[] | null) => { total: number; kept: number } | null;
  /** 这一栏的主区 + 右栏(和别的栏一样:<main className="st-main"> + 右栏) */
  render: (ctx: StudioIllustrationContext) => ReactNode;
}

/** DebugApp 给插图卡带的输入(useIllustrations 的参数) */
export interface IllustrationsInput {
  notify: Notify;
  cardId: string | null;
  cardName: string;
  chatId: string | null;
  /** 角色、玩家在剧情里叫什么(宏展开以后的) */
  charName: string;
  userName: string;
  entries: readonly ChatEntry[];
  /** 改当前对话的一条消息(DebugApp 的 setEntries,改完它会写库) */
  patchEntry: (id: string, fn: (e: ChatEntry) => ChatEntry) => void;
  /** 聊天连接(指导模型从里面挑) */
  connections: readonly { id: string; name: string; model: string }[];
  /**
   * 收藏进 CG 包以后(可能新建并绑上了「AI 生图 · 卡名」包):DebugApp 重读这张卡的 CG 绑定和包列表,
   * 游戏里马上选得到、卡编辑器马上看得到,不用重选这张卡。游戏里、卡编辑器里收藏都走它
   */
  onKept?: () => void;
}

/** 插图卡带的状态(useIllustrations 的结果):插件页那一页、给视觉小说的几样 */
export interface IllustrationsState {
  panel: CartridgePanel | null;
  vn: VnIllustrations | null;
}

/** 语音详情里多出来的一行 */
export interface VoiceDetailRow {
  label: string;
  value: string;
  /** 悬停时的说明 */
  title?: string;
}

/** 内核里几段默认文字的键(plugins/texts.ts):卡带可以给另一个版本(私有的说法),公开版用内核自己的中性说法 */
export type TextKey = 'cg.prompt' | 'cg.sample' | 'cg.describeFirst' | 'cg.descPlaceholder' | 'cg.variantExample';

/** 卡带能提供的扩展点,全部可选:没提供就是没有这一层 */
export interface CartridgeExtensions {
  // —— 形态(H2)——
  /**
   * DebugApp 调的 hook。核心在模块加载时定好用它还是 `() => null`,所以卡带在不在,hook 的调用顺序不变。
   * 时间线只认结果里的 lens(FormsLens,第 1a 期定的接口)
   */
  useForms?: (o: FormsInput) => FormsState;
  /** 视觉小说顶栏模型名旁边的形态按钮 */
  FormButton?: ComponentType<FormButtonProps>;
  /** 插件页 CG 表格里「在哪些形态出」的编辑 */
  cgForms?: CgFormsExtension;
  /** 形态显示给人看的名字(检查器);没有就显示形态本身 */
  formName?: (form: string) => string;
  /**
   * 状态(第 4 期,plugins/states.ts)接手以后,这段对话里以前的形态记号(存档里的 vn.forms、浏览器里还没传的)
   * 换成「在哪一句切到了哪个状态(状态名)」,状态镜头照它们算,先拆后传、先传后拆都不丢
   */
  legacyStateMarks?: (chatId: string | null, entries: readonly ChatEntry[]) => LegacyStateMark[];

  // —— 默认文字 ——
  /** 内核几段默认文字的另一个版本(plugins/texts.ts) */
  texts?: Partial<Record<TextKey, string>>;

  // —— 语音的「换成某个版本」(H3)——
  /** 语音挑好语气行以后换成某个版本(plugins/voice.ts 的 planVoiceLines 调);没有 = 不换 */
  versionOf?: VoiceVersion;
  /** 这条回复要不要让 Jev 判档(Jev 请求里那个开关的来源);没有 = 不问 */
  asksTone?: (ctx: ToneAskContext) => boolean;
  /** DebugApp 调的 hook,规矩同 useForms:判档的开关和插件页里那一页;没有 = 关着、没有那一页 */
  useTone?: (notify: Notify) => ToneState;

  // —— 语音的「拆句拼接」(H4)——
  /** DebugApp 调的 hook,规矩同 useForms;没有 = 不拼 */
  useSplice?: (notify: Notify) => SpliceState;
  /** 历史页、检查器的语音详情:这条请求走了它(比如拼接)就换掉「念的文字」那一行,没有返回 null */
  voiceDetail?: (detail: VoiceExplain) => VoiceDetailRow | null;

  // —— 插图(生图)——
  /** DebugApp 调的 hook,规矩同 useForms;没有 = 没有插图(插件页少一页,视觉小说不多按钮) */
  useIllustrations?: (o: IllustrationsInput) => IllustrationsState;
}

export interface Cartridge extends CartridgeExtensions {
  /** 就是文件夹名;生成公开版按文件夹删 */
  id: string;
  /** 插件页上的叫法 */
  name: string;
  /** 插件页上标 BETA */
  beta?: boolean;
}

export type ExtensionKey = keyof CartridgeExtensions;

/** glob 的结果 → 按 id 的表(按文件夹名排)。文件夹名必须就是 id,不是就在加载时报错 */
export function collectCartridges(modules: Readonly<Record<string, Cartridge | undefined>>): ReadonlyMap<string, Cartridge> {
  const out = new Map<string, Cartridge>();
  for (const path of Object.keys(modules).sort()) {
    const c = modules[path];
    const folder = /^\.\/([^/]+)\/cartridge\.ts$/.exec(path)?.[1];
    if (c === undefined || folder === undefined || c.id !== folder) {
      throw new Error(`卡带 ${path}:要默认导出一个 Cartridge,id 和文件夹名一样(现在是 ${String(c?.id)})`);
    }
    out.set(c.id, c);
  }
  return out;
}

/** 装着的卡带,按 id;公开版是空的 */
export const CARTRIDGES: ReadonlyMap<string, Cartridge> = collectCartridges(
  import.meta.glob<Cartridge>('./*/cartridge.ts', { eager: true, import: 'default' }),
);

/** 按 id 找卡带;不在是 undefined。内核别用(会把卡带的名字写进内核),内核用 extension */
export const cartridge = (id: string): Cartridge | undefined => CARTRIDGES.get(id);

/**
 * 哪个卡带提供了这个扩展点就用它的;没有是 undefined。两个卡带提供同一个扩展点是写错了,直接报错
 * (panel 除外,见上面)
 */
export function extension<K extends ExtensionKey>(
  key: K,
  from: Iterable<Cartridge> = CARTRIDGES.values(),
): CartridgeExtensions[K] {
  let found: { id: string; value: CartridgeExtensions[K] } | undefined;
  for (const c of from) {
    const value = c[key];
    if (value === undefined) continue;
    if (found) throw new Error(`扩展点 ${key} 有两个卡带提供:${found.id}、${c.id}`);
    found = { id: c.id, value };
  }
  return found?.value;
}

/**
 * 用到时才去要扩展点:第一次调的时候要一次,以后一直给同一个。内核模块在加载时只拿到这个函数,
 * 不碰登记处 —— 卡带加载时绕回内核模块也不会撞上还没登记完的 CARTRIDGES
 */
export function lazyExtension<K extends ExtensionKey>(key: K): () => CartridgeExtensions[K] {
  let got: { value: CartridgeExtensions[K] } | undefined;
  return () => (got ??= { value: extension(key) }).value;
}
