/**
 * 宏引擎:把文本里的 {{...}} 求值成最终的字。
 *
 * 规则对齐酒馆 1.18 默认开启的新宏引擎(public/scripts/macros/):从左到右求值、
 * 参数里可以再套宏、`::` 分隔参数、`{{if}}…{{else}}…{{/if}}` 这样的成对块、
 * `{{.变量}}` 简写。代码是照着行为自己写的(酒馆是 AGPL,没有搬它的源码),
 * 行为是否一致靠对照测试保证:把酒馆的引擎在 node 里跑起来,同一段文本喂给两边比输出。
 *
 * 这个文件只管语法和求值;有哪些宏在 macroDefs.ts。
 */

/** 变量的值。数字是 addvar / incvar 算出来的,其余都是字符串 */
export type VarValue = string | number;

export interface MacroVars {
  /** 局部变量:跟着这条对话 */
  local: Record<string, VarValue>;
  /** 全局变量:所有对话共用 */
  global: Record<string, VarValue>;
}

export interface MacroChatMessage {
  isUser: boolean;
  text: string;
  /** 这条消息有几个分支 */
  swipes?: number;
  /** 当前是第几个分支(从 0 数) */
  swipeId?: number;
  /** 发出的时间(毫秒时间戳) */
  sentAt?: number;
}

/** 求值时能读到的一切。宏的处理函数只从这里取值,不碰界面也不碰存储 */
export interface MacroEnv {
  names: { user: string; char: string; group: string; groupNotMuted: string; notChar: string };
  character: {
    charPrompt: string;
    charInstruction: string;
    description: string;
    personality: string;
    scenario: string;
    persona: string;
    mesExamplesRaw: string;
    version: string;
    charDepthPrompt: string;
    creatorNotes: string;
    firstMessage: string;
    alternateGreetings: string[];
  };
  model: string;
  chat: {
    id: string;
    messages: MacroChatMessage[];
    firstIncludedId: number | null;
    firstDisplayedId: number | null;
  };
  limits: { maxPrompt: number; maxContext: number; maxResponse: number };
  input: string;
  lastGenerationType: string;
  isMobile: boolean;
  /**
   * {{original}}:被角色卡顶替掉的预设原文。只在求「卡覆盖进来的那段字」时才有;
   * 别处没有,宏原样留着。同一段里只有第一个 {{original}} 有值,后面的是空 —— 都照酒馆。
   */
  original?: () => string;
  /** 世界书「自定义出口」的内容,键是出口名 */
  outlets: Record<string, string>;
  vars: MacroVars;
  /** 玩家自己定的宏,键是小写名字 */
  custom: Record<string, string>;
  /** 随机数。参数是这个宏在文本里的位置标识,定了种子的场合靠它让同一处每次掷出同一个数 */
  random: (key: string) => number;
  now: () => Date;
}

export interface MacroFlags {
  /** `/`:成对块的结束标记 */
  closing: boolean;
  /** `#`:成对块的内容不自动去首尾空白 */
  preserveWhitespace: boolean;
}

export interface MacroCallContext {
  /** 调用时写的名字(可能是别名) */
  name: string;
  /** 全部参数,已求值(delay 的宏拿到的是原文) */
  args: string[];
  /** 列表型宏:排在固定参数之后的那些 */
  list: string[];
  flags: MacroFlags;
  /** 是不是 {{x}}…{{/x}} 这种成对写法 */
  isScoped: boolean;
  env: MacroEnv;
  /** 这个宏在最外层文本里的位置 */
  globalOffset: number;
  /** 最外层文本的哈希,{{pick}} 用它定种子 */
  contentHash: number;
  /** 把一段文本当作完整的宏文本再求值一遍 */
  resolve: (text: string) => string;
  trimContent: (text: string) => string;
}

export type MacroCategory =
  | 'variable'
  | 'utility'
  | 'random'
  | 'names'
  | 'character'
  | 'chat'
  | 'time'
  | 'state'
  | 'prompts';

export interface MacroDef {
  name: string;
  aliases?: string[];
  category: MacroCategory;
  /** 给人看的一句话说明 */
  description: string;
  /** 界面上怎么写它 */
  syntax: string;
  example?: string;
  /** 固定参数最少几个 */
  minArgs: number;
  /** 固定参数最多几个 */
  maxArgs: number;
  /** 固定参数之后还能跟任意多个(random / pick / 注释) */
  list?: boolean;
  /** 每个固定参数要求的类型;整数不对就当这个宏写错了 */
  argTypes?: ('string' | 'integer')[];
  /** 参数个数不对时:true = 原样留着不求值(默认),false = 照样执行 */
  strictArgs?: boolean;
  /** 参数不预先求值,由处理函数自己决定求哪一段({{if}} 只求选中的分支) */
  delayArgs?: boolean;
  /** 每次求值结果都可能不同,说明表里标一下 */
  dynamic?: boolean;
  handler: (call: MacroCallContext) => string | number | null | undefined;
}

export const ELSE_MARKER = '\u0000\u001FELSE\u001F\u0000';

/** 变量简写的名字:可以带连字符,但不能以连字符结尾(不然和 -- 分不清) */
export const VAR_NAME = /^[a-zA-Z](?:[\w-]*\w)?/;

/** 酒馆的 getStringHash(cyrb53)。{{pick}} 的种子要用它 */
export function stringHash(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export const isFalseBoolean = (v: string): boolean =>
  ['off', 'false', '0'].includes(v.trim().toLowerCase());

/** 处理函数的返回值 → 字符串 */
export function normalizeResult(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * 成对块的内容去空白:去掉首尾空白,并按第一行的缩进把每一行往左拉齐。
 * 这样 {{if}} 里的内容可以缩进着写,出来的字不带那段缩进。
 */
export function trimScopedContent(content: string): string {
  if (!content) return '';
  const lines = content.split('\n');
  let base = 0;
  for (const line of lines) {
    if (line.trim() !== '') {
      base = /^[ \t]*/.exec(line)?.[0].length ?? 0;
      break;
    }
  }
  if (base === 0) return content.trim();
  return lines
    .map((line) => {
      const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
      return indent >= base ? line.slice(base) : line.trimStart();
    })
    .join('\n')
    .trim();
}

// ---------------------------------------------------------------- 变量

function storeOf(vars: MacroVars, global: boolean): Record<string, VarValue> {
  return global ? vars.global : vars.local;
}

/** 只认自己的键:{{.constructor}}、{{hasvar::toString}} 不能读到 Object 原型上的函数 */
function own(vars: MacroVars, global: boolean, name: string): VarValue | undefined {
  const store = storeOf(vars, global);
  return Object.hasOwn(store, name) ? store[name] : undefined;
}

export const variables = {
  has: (vars: MacroVars, global: boolean, name: string): boolean => own(vars, global, name) !== undefined,

  /** 像数字的返回数字,其余返回字符串;没有这个变量返回空串 */
  get(vars: MacroVars, global: boolean, name: string): VarValue {
    const v = own(vars, global, name);
    if (v === undefined || v === null) return '';
    if (typeof v === 'string' && v.trim() === '') return v || '';
    return Number.isNaN(Number(v)) ? v || '' : Number(v);
  },

  set(vars: MacroVars, global: boolean, name: string, value: VarValue): void {
    if (!name) throw new Error('变量名不能为空');
    storeOf(vars, global)[name] = value;
  },

  del(vars: MacroVars, global: boolean, name: string): void {
    delete storeOf(vars, global)[name];
  },

  /** 两边都是数字就相加;原值是 JSON 数组就追加一项;否则接在后面 */
  add(vars: MacroVars, global: boolean, name: string, value: VarValue): VarValue {
    const current = variables.get(vars, global, name) || 0;
    try {
      const parsed: unknown = JSON.parse(String(current));
      if (Array.isArray(parsed)) {
        parsed.push(value);
        variables.set(vars, global, name, JSON.stringify(parsed));
        return JSON.stringify(parsed);
      }
    } catch {
      // 不是数组,往下走
    }
    const increment = Number(value);
    if (Number.isNaN(increment) || Number.isNaN(Number(current))) {
      const joined = String(current || '') + value;
      variables.set(vars, global, name, joined);
      return joined;
    }
    const sum = Number(current) + increment;
    if (Number.isNaN(sum)) return '';
    variables.set(vars, global, name, sum);
    return sum;
  },
};

// ---------------------------------------------------------------- 语法
//
// 这一节一步步对应酒馆词法分析器的几种状态(宏头 / 参数 / 变量简写 / 过滤器),
// 连它出错之后怎么往下跳都照着来 —— 那些「错了之后的样子」会原样出现在提示词里,
// 对不上的话同一个预设在两边发出去的字就不一样。几条不直观的规则:
//
//   - 参数里出现 |,整个宏作废、原样留着。酒馆把 | 留给了还没做完的「过滤器」语法,
//     词法分析器遇到它会跳过后面的字直到下一个英文单词,所以宏在哪儿结束也跟着变
//   - {{ 后面不是合法的宏头(空的、数字、中文),这两个大括号就是普通文字,后面照常解析
//   - 名字后面跟着奇怪的字符({{user.name}}),跳过它们直到空白、冒号或 }}

interface Span {
  /** 在所属文本里的起止,end 不含 */
  start: number;
  end: number;
}

type Head =
  /** 解析失败(参数里有 |):原样输出,里面完整的宏照常求值 */
  | { kind: 'broken' }
  /** 玩家自己定的宏,名字可以是中文,酒馆的语法不认,单独兜住 */
  | { kind: 'custom'; key: string }
  | { kind: 'var'; global: boolean; name: string; operator: string | null; value: Span | null }
  | { kind: 'macro'; name: string; flags: MacroFlags; args: Span[] };

interface MacroItem extends Span {
  head: Head;
  /** 直接套在里面的宏 */
  nested: MacroItem[];
  /** 成对块配上之后:内容的起止和结束标记的末尾 */
  scoped?: { start: number; end: number; closingEnd: number };
  keepRaw?: boolean;
}

const IDENTIFIER_AT = /[a-zA-Z][\w-]*/y;
const VAR_NAME_AT = /[a-zA-Z](?:[\w-]*\w)?/y;
const VAR_OPERATORS = ['++', '--', '??=', '??', '||=', '||', '-=', '==', '!=', '>=', '>', '<=', '<', '+=', '='];
const SPACE = /\s/;
const LETTER = /[a-zA-Z]/;
/** 名字结束的地方:空白、冒号、| 或 } */
const NAME_END = /[\s:|}]/;

function matchAt(re: RegExp, text: string, at: number): string | null {
  re.lastIndex = at;
  return re.exec(text)?.[0] ?? null;
}

function trimSpan(text: string, start: number, end: number): Span {
  while (start < end && SPACE.test(text[start])) start++;
  while (end > start && SPACE.test(text[end - 1])) end--;
  return { start, end };
}

/**
 * scanMacro 的结果按「这段文本 + 起点」记下来。参数里每个 {{ 都会递归往里读,读不成(一直没有 }})
 * 时外层只往前挪两个字,后面的 {{ 又被整个重读一遍 —— 一串没闭合的 `{{a {{a {{a …` 要读 2^n 次,
 * 二十几个就能把页面卡死(AI 的回复里就可能有,每次渲染都要算)。同一段文本、同一个起点读出来的
 * 结果总是一样的(读的过程不看别的),记下来以后每个位置只读一次。
 *
 * 缓存只在一次 collectMacros 里有效:读出来的宏后面会被 pairScoped 改(scoped / keepRaw),
 * 不能留给下一次求值复用。
 */
let scanText: string | null = null;
let scanMemo = new Map<number, MacroItem | null>();
let scanDepth = 0;
// 嵌套再深就不当宏了:几千层的 {{ 会把调用栈撑爆
const MAX_SCAN_DEPTH = 200;

function scanMacro(text: string, start: number): MacroItem | null {
  if (text !== scanText) {
    scanText = text;
    scanMemo = new Map();
  }
  const hit = scanMemo.get(start);
  if (hit !== undefined) return hit;
  if (scanDepth >= MAX_SCAN_DEPTH) return null;
  scanDepth++;
  let item: MacroItem | null;
  try {
    item = scanMacroAt(text, start);
  } finally {
    scanDepth--;
  }
  // 里层读别的文本时可能把缓存换掉了,换回来再记
  if (text !== scanText) {
    scanText = text;
    scanMemo = new Map();
  }
  scanMemo.set(start, item);
  return item;
}

/**
 * 从 start 处的 {{ 开始读一个宏。
 * 返回 null = 这不是个宏(宏头不合法,或者一直到文本末尾都没等到 }}),那两个大括号当普通文字。
 */
function scanMacroAt(text: string, start: number): MacroItem | null {
  let i = start + 2;
  const flags: MacroFlags = { closing: false, preserveWhitespace: false };
  const skipSpace = () => {
    while (i < text.length && SPACE.test(text[i])) i++;
  };

  for (;;) {
    skipSpace();
    if (text.startsWith('//', i)) return scanArgs(text, start, i + 2, '//', flags);
    const ch = text[i];
    if (ch === '.' || ch === '$') return scanVariable(text, start, i);
    if (ch === '/') flags.closing = true;
    else if (ch === '#') flags.preserveWhitespace = true;
    else if (ch !== '!' && ch !== '?' && ch !== '~' && ch !== '>') break;
    i++;
  }

  const name = matchAt(IDENTIFIER_AT, text, i);
  if (!name) return null;
  i += name.length;
  // 名字后面跟着别的字符:一个个跳过,直到能算「名字结束」的地方
  while (i < text.length && !NAME_END.test(text[i])) i++;
  skipSpace();
  return scanArgs(text, start, i, name, flags);
}

function scanArgs(
  text: string,
  start: number,
  from: number,
  name: string,
  flags: MacroFlags,
): MacroItem | null {
  let i = from;
  const nested: MacroItem[] = [];
  const args: Span[] = [];
  let broken = false;

  // {{x::a::b}} 每个 :: 切一个参数;其余写法({{x a}} / {{x:a}})后面整段算一个
  const list = text.startsWith('::', i);
  let colon = false;
  if (list) i += 2;
  else if (text[i] === ':') {
    colon = true;
    i++;
  }
  let argStart = i;

  for (;;) {
    if (i >= text.length) return null;
    if (text.startsWith('}}', i)) break;
    if (text.startsWith('{{', i)) {
      const inner = scanMacro(text, i);
      if (inner) {
        nested.push(inner);
        i = inner.end;
      } else {
        // 参数里一个落单的 {{:酒馆的语法分析到这儿就乱了
        broken = true;
        i += 2;
      }
      continue;
    }
    if (text[i] === '\\' && text[i + 1] === '|') {
      broken = true;
      i += 2;
      continue;
    }
    if (text[i] === '|') {
      broken = true;
      i++;
      // 过滤器状态:只认空白和英文单词,别的字符(包括 {{ 和 }})全跳过
      while (i < text.length && !LETTER.test(text[i])) i++;
      i += matchAt(IDENTIFIER_AT, text, i)?.length ?? 0;
      while (i < text.length && !NAME_END.test(text[i])) i++;
      continue;
    }
    if (list && text.startsWith('::', i)) {
      args.push(trimSpan(text, argStart, i));
      i += 2;
      argStart = i;
      continue;
    }
    i++;
  }

  const last = trimSpan(text, argStart, i);
  if (list || colon || last.start < last.end) args.push(last);

  return {
    start,
    end: i + 2,
    nested,
    head: broken ? { kind: 'broken' } : { kind: 'macro', name, flags, args },
  };
}

function scanVariable(text: string, start: number, at: number): MacroItem | null {
  const global = text[at] === '$';
  let i = at + 1;
  const skipSpace = () => {
    while (i < text.length && SPACE.test(text[i])) i++;
  };
  skipSpace();
  // {{.}} 这种只有前缀的:酒馆当成读一个名字为空的变量,出一个空
  const name = matchAt(VAR_NAME_AT, text, i) ?? (text.startsWith('}}', i) ? '' : null);
  if (name === null) return null;
  i += name.length;
  skipSpace();

  const make = (operator: string | null, value: Span | null, nested: MacroItem[]): MacroItem => ({
    start,
    end: i + 2,
    nested,
    head: { kind: 'var', global, name, operator, value },
  });

  if (text.startsWith('}}', i)) return make(null, null, []);
  const operator = VAR_OPERATORS.find((op) => text.startsWith(op, i));
  if (!operator) {
    // {{.a b}}:名字后面多出一个单词,酒馆的语法分析会把它丢掉,照样当作读变量
    i += matchAt(IDENTIFIER_AT, text, i)?.length ?? 0;
    skipSpace();
    return name && text.startsWith('}}', i) ? make(null, null, []) : null;
  }
  i += operator.length;
  if (operator === '++' || operator === '--') {
    skipSpace();
    return text.startsWith('}}', i) ? make(operator, null, []) : null;
  }

  // 右边的值一直到 }}。这里 | 是普通字符
  const valueStart = i;
  const nested: MacroItem[] = [];
  for (;;) {
    if (i >= text.length) return null;
    if (text.startsWith('}}', i)) break;
    if (text.startsWith('{{', i)) {
      const inner = scanMacro(text, i);
      if (inner) {
        nested.push(inner);
        i = inner.end;
        continue;
      }
      i += 2;
      continue;
    }
    i++;
  }
  return make(operator, trimSpan(text, valueStart, i), nested);
}

/** 把一段文本里最外层的宏找出来。宏之间的普通文字不单独记,靠起止位置补 */
function collectMacros(text: string, custom: Record<string, string> = {}): MacroItem[] {
  scanText = text;
  scanMemo = new Map();
  try {
    return collectMacrosIn(text, custom);
  } finally {
    scanText = null;
    scanMemo = new Map();
  }
}

function collectMacrosIn(text: string, custom: Record<string, string>): MacroItem[] {
  const items: MacroItem[] = [];
  let i = text.indexOf('{{');
  while (i !== -1) {
    // {{{x}}}:最前面多出来的那个 { 是普通文字
    if (text[i + 2] === '{') {
      i = text.indexOf('{{', i + 1);
      continue;
    }
    const item = scanMacro(text, i);
    if (item) {
      items.push(item);
      i = text.indexOf('{{', item.end);
      continue;
    }
    // 不是宏。看看是不是玩家自己定的(中文名字酒馆的语法不认)
    const close = text.indexOf('}}', i + 2);
    const key = close === -1 ? '' : text.slice(i + 2, close).trim().toLowerCase();
    if (key && Object.hasOwn(custom, key)) {
      items.push({ start: i, end: close + 2, nested: [], head: { kind: 'custom', key } });
      i = text.indexOf('{{', close + 2);
      continue;
    }
    i = text.indexOf('{{', i + 2);
  }
  return items;
}

// ---------------------------------------------------------------- 求值

interface Runtime {
  env: MacroEnv;
  registry: Map<string, MacroDef>;
  contentHash: number;
  /** 正在展开的玩家自定义宏:{{foo}} 的内容里又写了 {{foo}}(或者 a、b 互相引用)时到这儿为止 */
  activeCustom: Set<string>;
}

// 自定义宏套自定义宏最多套几层
const MAX_CUSTOM_DEPTH = 20;

/** 展开一个玩家自定义宏。转回自己、套得太深就原样留着,不能无限递归把页面撑崩 */
function evaluateCustom(rt: Runtime, key: string, offset: number, fallback: string): string {
  if (!Object.hasOwn(rt.env.custom, key)) return fallback;
  if (rt.activeCustom.has(key) || rt.activeCustom.size >= MAX_CUSTOM_DEPTH) return fallback;
  rt.activeCustom.add(key);
  try {
    return evaluate(rt, rt.env.custom[key], offset);
  } finally {
    rt.activeCustom.delete(key);
  }
}

type NamedHead = Extract<Head, { kind: 'macro' }>;

function lookup(rt: Runtime, name: string): MacroDef | undefined {
  return rt.registry.get(name.toLowerCase());
}

function canAcceptScoped(rt: Runtime, head: NamedHead): boolean {
  const def = lookup(rt, head.name);
  if (!def) return true;
  if (def.list) return false;
  const n = head.args.length + 1;
  return n >= def.minArgs && n <= def.maxArgs;
}

/** 把 {{x}}…{{/x}} 配成对。只配这一层最外面的,里面的等内容被再次求值时再配 */
function pairScoped(rt: Runtime, items: MacroItem[]): MacroItem[] {
  const named = items
    .map((item, index) => ({ item, index, head: item.head, matched: false }))
    .filter((x): x is typeof x & { head: NamedHead } => x.head.kind === 'macro');
  if (!named.some((x) => x.head.flags.closing)) return items;

  const inside = new Set<number>();
  const removed = new Set<number>();

  for (let a = 0; a < named.length; a++) {
    const open = named[a];
    if (open.head.flags.closing || open.matched || inside.has(open.index)) continue;
    const name = open.head.name.toLowerCase();

    let depth = 1;
    let found = -1;
    for (let b = a + 1; b < named.length; b++) {
      const other = named[b];
      if (other.head.name.toLowerCase() !== name || other.matched) continue;
      if (other.head.flags.closing) {
        depth--;
        if (depth === 0) {
          found = b;
          break;
        }
      } else if (canAcceptScoped(rt, other.head)) {
        depth++;
      }
    }
    if (found === -1) continue;

    const close = named[found];
    open.matched = true;
    close.matched = true;
    if (!canAcceptScoped(rt, open.head)) {
      // 这个宏收不下一段内容(参数已经满了):两头都原样留着
      open.item.keepRaw = true;
      close.item.keepRaw = true;
      continue;
    }
    open.item.scoped = { start: open.item.end, end: close.item.start, closingEnd: close.item.end };
    for (let j = open.index + 1; j <= close.index; j++) {
      removed.add(j);
      if (j < close.index) inside.add(j);
    }
  }

  for (const x of named) {
    if (x.head.flags.closing && !x.matched) x.item.keepRaw = true;
  }
  return removed.size === 0 ? items : items.filter((_, index) => !removed.has(index));
}

/** 一段文本里的宏逐个求值,普通文字原样保留。offset 是这段文本在最外层里的位置 */
function evaluateContent(rt: Runtime, text: string, offset: number): string {
  if (!text || !text.includes('{{')) return text;
  const items = pairScoped(rt, collectMacros(text, rt.env.custom));
  if (items.length === 0) return text;

  let out = '';
  let cursor = 0;
  for (const item of items) {
    out += text.slice(cursor, item.start);
    if (item.keepRaw) {
      out += text.slice(item.start, item.end);
      cursor = item.end;
      continue;
    }
    out += evaluateItem(rt, text, item, offset);
    cursor = item.scoped ? item.scoped.closingEnd : item.end;
  }
  return out + text.slice(cursor);
}

/** [from, to) 这段原文,把里面标出来的几段换成各自求值后的结果 */
function splice(text: string, from: number, to: number, parts: (Span & { value: string })[]): string {
  let out = '';
  let cursor = from;
  for (const part of parts) {
    out += text.slice(cursor, part.start) + part.value;
    cursor = part.end;
  }
  return out + text.slice(cursor, to);
}

function evaluateItem(rt: Runtime, text: string, item: MacroItem, offset: number): string {
  const { head } = item;
  const sub = (span: Span) => evaluateContent(rt, text.slice(span.start, span.end), offset + span.start);

  if (head.kind === 'custom') {
    return evaluateCustom(rt, head.key, offset + item.start, text.slice(item.start, item.end));
  }

  if (head.kind === 'broken') {
    return splice(
      text,
      item.start,
      item.end,
      item.nested.map((n) => ({ start: n.start, end: n.end, value: sub(n) })),
    );
  }

  if (head.kind === 'var') return evaluateVariable(rt, head, () => (head.value ? sub(head.value) : ''));

  const def = lookup(rt, head.name);
  const delay = def?.delayArgs === true;
  const raw = (span: Span) => text.slice(span.start, span.end);

  const args = head.args.map((span) => (delay ? raw(span) : sub(span)));
  let rawInner = splice(
    text,
    item.start + 2,
    item.end - 2,
    head.args.map((span, i) => ({ ...span, value: args[i] })),
  );

  if (item.scoped) {
    const content = raw(item.scoped);
    let value = content;
    if (content !== '' && !delay) {
      value = sub(item.scoped);
      if (!head.flags.preserveWhitespace) value = trimScopedContent(value);
    }
    args.push(value);
    // 酒馆在这里把成对块的内容接在了 }} 后面 —— 宏没求成的时候,原样输出就是这个样子
    rawInner += `}}${value}`;
  }

  const unresolved = `{{${rawInner}}}`;
  if (!def) {
    // hasOwn:{{constructor}}、{{toString}} 不能摸到 Object 原型上的函数
    const key = head.name.toLowerCase();
    if (Object.hasOwn(rt.env.custom, key) && args.length === 0) {
      return evaluateCustom(rt, key, offset + item.start, unresolved);
    }
    return unresolved;
  }

  const strict = def.strictArgs !== false;
  const arityOk = def.list
    ? args.length >= def.minArgs
    : args.length >= def.minArgs && args.length <= def.maxArgs;
  if (!arityOk && strict) return unresolved;

  const fixed = args.slice(0, Math.min(args.length, def.maxArgs));
  if (strict && def.argTypes) {
    for (let i = 0; i < fixed.length; i++) {
      if (def.argTypes[i] === 'integer' && !/^-?\d+$/.test(fixed[i].trim())) return unresolved;
    }
  }

  const globalOffset = offset + item.start;
  try {
    const result = def.handler({
      name: head.name,
      args: fixed,
      list: def.list ? args.slice(def.maxArgs) : [],
      flags: head.flags,
      isScoped: item.scoped !== undefined,
      env: rt.env,
      globalOffset,
      contentHash: rt.contentHash,
      resolve: (t) => evaluate(rt, t, globalOffset),
      trimContent: trimScopedContent,
    });
    return normalizeResult(result);
  } catch {
    return unresolved;
  }
}

function evaluateVariable(
  rt: Runtime,
  head: Extract<Head, { kind: 'var' }>,
  evaluateValue: () => string,
): string {
  const { vars } = rt.env;
  const { global, name, operator } = head;
  const get = () => variables.get(vars, global, name);

  // 右边的值只在真的用到时才求(里面可能有带副作用的宏),并且只求一次
  let cached: string | null = null;
  const value = (): string => (cached ??= evaluateValue().trim());
  const falsy = (v: VarValue) => !v || isFalseBoolean(normalizeResult(v));
  const compare = (test: (a: number, b: number) => boolean): string => {
    const a = Number(get());
    const b = Number(value());
    return !Number.isNaN(a) && !Number.isNaN(b) && test(a, b) ? 'true' : 'false';
  };

  switch (operator) {
    case null:
      return normalizeResult(get());
    case '=':
      variables.set(vars, global, name, value());
      return '';
    case '++':
      return normalizeResult(variables.add(vars, global, name, 1));
    case '--':
      return normalizeResult(variables.add(vars, global, name, -1));
    case '+=':
      variables.add(vars, global, name, value());
      return '';
    case '-=': {
      const n = Number(value());
      if (!Number.isNaN(n)) variables.add(vars, global, name, -n);
      return '';
    }
    case '||': {
      const current = get();
      return falsy(current) ? value() : normalizeResult(current);
    }
    case '??':
      return variables.has(vars, global, name) ? normalizeResult(get()) : value();
    case '||=': {
      const current = get();
      if (!falsy(current)) return normalizeResult(current);
      variables.set(vars, global, name, value());
      return value();
    }
    case '??=':
      if (variables.has(vars, global, name)) return normalizeResult(get());
      variables.set(vars, global, name, value());
      return value();
    case '==':
      return normalizeResult(get()) === value() ? 'true' : 'false';
    case '!=':
      return normalizeResult(get()) !== value() ? 'true' : 'false';
    case '>':
      return compare((a, b) => a > b);
    case '>=':
      return compare((a, b) => a >= b);
    case '<':
      return compare((a, b) => a < b);
    case '<=':
      return compare((a, b) => a <= b);
    default:
      return '';
  }
}

/** 完整走一遍:老写法改写 → 求值 → 收尾。{{if}} 选中的分支、卡的字段也走这里 */
function evaluate(rt: Runtime, input: string, offset: number): string {
  if (!input) return '';
  const pre = input
    .replace(/{{time_(UTC[+-]\d+)}}/gi, (_m, utc: string) => `{{time::${utc}}}`)
    .replace(/<USER>/gi, '{{user}}')
    .replace(/<BOT>/gi, '{{char}}')
    .replace(/<CHAR>/gi, '{{char}}')
    .replace(/<GROUP>/gi, '{{group}}')
    .replace(/<CHARIFNOTGROUP>/gi, '{{charIfNotGroup}}');

  // \{ \} 是给「我就要两个大括号」留的转义
  let out = evaluateContent(rt, pre, offset).replace(/\\([{}])/g, '$1');
  // {{trim}} 要连前后的换行一起吃掉,手伸得比一个宏长,所以留到最后用替换做。
  // 先看有没有:这个正则在一长串换行上是平方级的(10 万个换行要 10 秒),没有 {{trim}} 就别跑
  if (/{{trim}}/i.test(out)) out = out.replace(/(?:\r?\n)*{{trim}}(?:\r?\n)*/gi, '');
  return out.replaceAll(ELSE_MARKER, '');
}

export function buildRegistry(defs: readonly MacroDef[]): Map<string, MacroDef> {
  const map = new Map<string, MacroDef>();
  for (const def of defs) {
    map.set(def.name.toLowerCase(), def);
    for (const alias of def.aliases ?? []) map.set(alias.toLowerCase(), def);
  }
  return map;
}

export function evaluateMacros(
  text: string,
  env: MacroEnv,
  registry: Map<string, MacroDef>,
): string {
  if (!text) return '';
  return evaluate({ env, registry, contentHash: stringHash(text), activeCustom: new Set() }, text, 0);
}

/**
 * {{if}} 用:在一段原文的最外层找 {{else}},把它切成「是」「否」两支。
 * 嵌套的 {{if}}…{{/if}} 里的 else 不算。
 */
export function splitOnTopLevelElse(content: string): { then: string; otherwise?: string } {
  let depth = 0;
  for (const item of collectMacros(content)) {
    if (item.head.kind !== 'macro') continue;
    const name = item.head.name.toLowerCase();
    if (name === 'if') {
      if (item.head.flags.closing) depth--;
      else if (item.head.args.length === 1) depth++;
    } else if (name === 'else' && depth === 0) {
      return { then: content.slice(0, item.start), otherwise: content.slice(item.end) };
    }
  }
  return { then: content };
}
