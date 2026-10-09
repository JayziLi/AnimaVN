/**
 * 宏替换的对外入口。语法和求值在 macroEngine.ts,有哪些宏在 macroDefs.ts;
 * 这里负责把调试台手上的东西(角色卡、人设、聊天记录、变量)整理成引擎要的样子。
 *
 * 大小写不敏感,宏里可以再套宏。规则和酒馆 1.18 的新宏引擎一致。
 */

import { MACRO_DEFS, MACRO_REGISTRY } from './macroDefs';
import {
  evaluateMacros,
  type MacroCategory,
  type MacroChatMessage,
  type MacroEnv,
  type MacroVars,
} from './macroEngine';

export type { MacroVars, VarValue } from './macroEngine';

/** 除了名字和那几个常用字段以外、宏还能读到的东西。都有缺省值,用不上的可以不给 */
export interface MacroExtras {
  charPrompt: string;
  charInstruction: string;
  mesExamplesRaw: string;
  charVersion: string;
  charDepthPrompt: string;
  creatorNotes: string;
  firstMessage: string;
  alternateGreetings: string[];
  model: string;
  chatId: string;
  firstIncludedMessageId: number | null;
  firstDisplayedMessageId: number | null;
  maxContext: number;
  maxResponse: number;
  input: string;
  lastGenerationType: string;
  isMobile: boolean;
  /** 不给 = 不在「卡覆盖预设块」的场合,{{original}} 原样留着 */
  original: string | undefined;
  outlets: Record<string, string>;
}

export interface MacroContext {
  char: string;
  user: string;
  persona: string;
  description: string;
  personality: string;
  scenario: string;
  lastUserMessage: string;
  lastCharMessage: string;
  /** 用户自定义的宏,键是小写宏名。内置宏优先,这里覆盖不了 {{char}} 之类 */
  custom: Record<string, string>;
  /** 聊天记录,旧的在前。不给的话 {{lastMessage}} 一类靠上面两个字段凑 */
  messages?: MacroChatMessage[];
  /** 变量。不给就是空的 */
  vars?: MacroVars;
  extra?: Partial<MacroExtras>;
}

export const EMPTY_MACRO_CONTEXT: MacroContext = {
  char: '',
  user: '',
  persona: '',
  description: '',
  personality: '',
  scenario: '',
  lastUserMessage: '',
  lastCharMessage: '',
  custom: {},
};

export const emptyVars = (): MacroVars => ({ local: {}, global: {} });

export const cloneVars = (vars: MacroVars | undefined): MacroVars => ({
  local: { ...vars?.local },
  global: { ...vars?.global },
});

/** 角色卡上会被宏读到的字段。只要有 name 和那三段就能用,其余有就带上 */
interface MacroCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  system_prompt?: string;
  post_history_instructions?: string;
  mes_example?: string;
  creator_notes?: string;
  first_mes?: string;
  alternate_greetings?: string[];
  character_version?: string;
  extensions?: Record<string, unknown>;
}

/** 组装提示词和聊天区显示共用同一份取值 —— 两边算出不同的 {{user}} 是最难查的那种 bug */
export function buildMacroContext(input: {
  card: MacroCard | null;
  userName: string;
  personaDescription: string;
  history: readonly { role: 'user' | 'assistant'; content: string }[];
  /** 自定义宏的查找表(见 lib/customMacros 的 toLookup) */
  custom?: Record<string, string>;
  /** 变量。会复制一份,求值时改的是副本 */
  variables?: MacroVars;
  extra?: Partial<MacroExtras>;
}): MacroContext {
  const { card, userName, personaDescription, history, custom, variables, extra } = input;
  const last = (role: 'user' | 'assistant') =>
    [...history].reverse().find((h) => h.role === role)?.content ?? '';
  const depthPrompt = card?.extensions?.depth_prompt;
  return {
    char: card?.name || 'Character',
    user: userName || 'User',
    persona: personaDescription,
    description: card?.description ?? '',
    personality: card?.personality ?? '',
    scenario: card?.scenario ?? '',
    lastUserMessage: last('user'),
    lastCharMessage: last('assistant'),
    custom: custom ?? {},
    messages: history.map((h) => ({ isUser: h.role === 'user', text: h.content })),
    vars: cloneVars(variables),
    extra: {
      charPrompt: card?.system_prompt ?? '',
      charInstruction: card?.post_history_instructions ?? '',
      mesExamplesRaw: card?.mes_example ?? '',
      charVersion: card?.character_version ?? '',
      charDepthPrompt:
        typeof depthPrompt === 'object' && depthPrompt !== null
          ? String((depthPrompt as { prompt?: unknown }).prompt ?? '')
          : '',
      creatorNotes: card?.creator_notes ?? '',
      firstMessage: card?.first_mes ?? '',
      alternateGreetings: card?.alternate_greetings ?? [],
      ...extra,
    },
  };
}

export interface MacroOptions {
  /**
   * 给随机类宏(`{{random}}` / `{{roll}}`)定种子。
   *
   * 聊天区是每次 React 重渲染都跑一遍替换的,不定种子的话你在输入框里敲个字,
   * 上面开场白里的骰子就换个点数。传消息 id 进来,同一条消息永远掷出同一个数。
   *
   * 不传 = 真随机,组装提示词走的是这条:每次发送本来就该重掷。
   */
  seed?: string;
  /**
   * 让 {{setvar}} 这类宏真的改 ctx.vars。
   *
   * 默认不改:求值用的是变量的副本,结束就扔。聊天区显示、块的预览都属于这种 ——
   * 它们每次重渲染都会跑,真改的话 {{incvar}} 会自己一直往上涨。
   * 只有组装提示词传 true,它有自己的一份变量,算完把结果交回去。
   */
  mutate?: boolean;
  /** 所有随机类的宏(包括 {{pick}})都用这个取数。对照测试用它把随机数钉死 */
  random?: () => number;
}

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32。不求分布多漂亮,只求「同一条消息每次渲染掷出同一个数」 */
export function seededRandom(seed: string): () => number {
  let a = hash32(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 只有第一次取到值,之后是空 */
function oneShot(value: string | undefined): (() => string) | undefined {
  if (value === undefined) return undefined;
  let used = false;
  return () => {
    if (used) return '';
    used = true;
    return value;
  };
}

function toEnv(ctx: MacroContext, opts: MacroOptions): MacroEnv {
  const x = ctx.extra ?? {};
  const messages =
    ctx.messages ??
    [
      { isUser: false, text: ctx.lastCharMessage },
      { isUser: true, text: ctx.lastUserMessage },
    ].filter((m) => m.text);
  const maxContext = x.maxContext ?? 0;
  const maxResponse = x.maxResponse ?? 0;

  // 同一个位置连掷几次(3d6)要是几个不同的数,所以每个位置留一个发生器
  const seeded = new Map<string, () => number>();
  const fromSeed = (key: string) => {
    let next = seeded.get(key);
    if (!next) {
      next = seededRandom(key);
      seeded.set(key, next);
    }
    return next();
  };

  return {
    names: { user: ctx.user, char: ctx.char, group: ctx.char, groupNotMuted: ctx.char, notChar: ctx.user },
    character: {
      charPrompt: x.charPrompt ?? '',
      charInstruction: x.charInstruction ?? '',
      description: ctx.description,
      personality: ctx.personality,
      scenario: ctx.scenario,
      persona: ctx.persona,
      mesExamplesRaw: x.mesExamplesRaw ?? '',
      version: x.charVersion ?? '',
      charDepthPrompt: x.charDepthPrompt ?? '',
      creatorNotes: x.creatorNotes ?? '',
      firstMessage: x.firstMessage ?? '',
      alternateGreetings: x.alternateGreetings ?? [],
    },
    model: x.model ?? '',
    chat: {
      id: x.chatId ?? '',
      messages,
      firstIncludedId: x.firstIncludedMessageId ?? null,
      firstDisplayedId: x.firstDisplayedMessageId ?? null,
    },
    limits: { maxContext, maxResponse, maxPrompt: Math.max(0, maxContext - maxResponse) },
    input: x.input ?? '',
    lastGenerationType: x.lastGenerationType ?? '',
    isMobile: x.isMobile ?? false,
    original: oneShot(x.original),
    outlets: x.outlets ?? {},
    vars: opts.mutate ? (ctx.vars ??= emptyVars()) : cloneVars(ctx.vars),
    custom: ctx.custom,
    random: (key) => {
      if (opts.random) return opts.random();
      // {{pick}} 无论如何都按位置定种子 —— 它的意义就是「同一处永远挑到同一个」
      if (key.startsWith('pick:')) return fromSeed(key);
      return opts.seed === undefined ? Math.random() : fromSeed(`${opts.seed}:${key}`);
    },
    now: () => new Date(),
  };
}

export function substituteMacros(text: string, ctx: MacroContext, opts: MacroOptions = {}): string {
  if (!text) return '';
  // 聊天记录每次渲染都要展开宏,页面上又没有错误边界:宏引擎哪里抛了(比如奇怪的卡、AI 写出来的怪写法),
  // 整个界面就白屏,存在 localStorage 里的还会刷新后接着白。出错就原样显示
  try {
    return evaluateMacros(text, toEnv(ctx, opts), MACRO_REGISTRY);
  } catch (e) {
    console.error('宏展开出错,原样显示', e);
    return text;
  }
}

/**
 * 内置宏的说明 —— 「设置 › 宏」那张表读它。和引擎用的是同一份定义,
 * 不会出现「实现支持了但界面没写」的漂移。
 */
export interface MacroInfo {
  /** 小写宏名,也是查找键 */
  key: string;
  /** 界面上怎么写它 */
  syntax: string;
  note: string;
  example?: string;
  category: MacroCategory;
  /** 同一个宏的别名 */
  alias?: string[];
  /** 要不要带参数 —— 带参数的没有「当前值」可看 */
  takesArgs: boolean;
  /** 每次求值都可能不同(骰子、时间)—— 表里标一下,免得以为是固定映射 */
  dynamic?: boolean;
  /** 当前会展开成什么。带参数的宏返回空 */
  value: (ctx: MacroContext) => string;
}

export const BUILTIN_MACROS: MacroInfo[] = MACRO_DEFS.map((def) => {
  const takesArgs = def.minArgs > 0 || def.list === true || def.name === 'else';
  return {
    key: def.name.toLowerCase(),
    syntax: def.syntax,
    note: def.description,
    example: def.example,
    category: def.category,
    alias: def.aliases,
    takesArgs,
    dynamic: def.dynamic,
    value: (ctx) => (takesArgs ? '' : substituteMacros(`{{${def.name}}}`, ctx, { seed: 'table' })),
  };
});

/** 自定义宏不许占用这些名字 —— 内置的优先,占了也不会生效,不如提前拦住 */
export const RESERVED_MACRO_NAMES: ReadonlySet<string> = new Set(MACRO_REGISTRY.keys());

/** 找出文本里所有没被解析掉的宏,调试台上标黄提示 */
export function findUnresolvedMacros(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{[^{}]*\}\}/g)) found.add(m[0]);
  return [...found];
}
