/**
 * 内置宏总表。酒馆 1.18 有的这里都有,名字、别名、参数个数和它一致 ——
 * 我们自己用不上的(指令模板那一批)也登记在册,返回值和酒馆「没开指令模式」时一样,
 * 这样导入的预设里写了它们不会原样漏给模型。
 *
 * 「设置 › 宏」那张说明表读的就是这一份:加宏只往这里加,不会出现实现了但界面没写的情况。
 */

import {
  ELSE_MARKER,
  VAR_NAME,
  isFalseBoolean,
  splitOnTopLevelElse,
  stringHash,
  variables,
  type MacroCallContext,
  type MacroCategory,
  type MacroDef,
  type MacroEnv,
} from './macroEngine';

export const CATEGORY_LABELS: Record<MacroCategory, string> = {
  names: '名字',
  character: '角色卡',
  chat: '聊天记录',
  variable: '变量',
  utility: '工具',
  random: '随机',
  time: '时间',
  state: '状态',
  prompts: '指令模板',
};

/** 说明表里各类的先后 */
export const CATEGORY_ORDER: MacroCategory[] = [
  'names',
  'character',
  'chat',
  'variable',
  'utility',
  'random',
  'time',
  'state',
  'prompts',
];

// ---------------------------------------------------------------- 时间

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const WEEKDAYS_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** moment 的格式串(中文区域)。只实现常用的记号,认不出的原样留着 */
export function formatDate(d: Date, format: string): string {
  const H = d.getHours();
  const h = H % 12 || 12;
  const meridiem = H < 6 ? '凌晨' : H < 9 ? '早上' : H < 12 ? '上午' : H < 13 ? '中午' : H < 18 ? '下午' : '晚上';
  const tokens: Record<string, () => string> = {
    YYYY: () => String(d.getFullYear()),
    YY: () => pad(d.getFullYear() % 100),
    MMMM: () => `${d.getMonth() + 1}月`,
    MMM: () => `${d.getMonth() + 1}月`,
    MM: () => pad(d.getMonth() + 1),
    M: () => String(d.getMonth() + 1),
    DD: () => pad(d.getDate()),
    D: () => String(d.getDate()),
    dddd: () => WEEKDAYS[d.getDay()],
    ddd: () => WEEKDAYS_SHORT[d.getDay()],
    HH: () => pad(H),
    H: () => String(H),
    hh: () => pad(h),
    h: () => String(h),
    mm: () => pad(d.getMinutes()),
    m: () => String(d.getMinutes()),
    ss: () => pad(d.getSeconds()),
    s: () => String(d.getSeconds()),
    SSS: () => pad(d.getMilliseconds(), 3),
    A: () => meridiem,
    a: () => meridiem,
    X: () => String(Math.floor(d.getTime() / 1000)),
    x: () => String(d.getTime()),
    LTS: () => `${pad(H)}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    LT: () => `${pad(H)}:${pad(d.getMinutes())}`,
    LLLL: () => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${WEEKDAYS[d.getDay()]}${meridiem}${h}点${pad(d.getMinutes())}分`,
    LLL: () => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${meridiem}${h}点${pad(d.getMinutes())}分`,
    LL: () => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
    L: () => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`,
  };
  return format.replace(
    /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|SSS|A|a|X|x|LTS|LT|LLLL|LLL|LL|L/g,
    (token, literal: string | undefined) => (literal !== undefined ? literal : tokens[token]()),
  );
}

/** 一段时长说成人话(「几秒」「5 分钟」「2 天」),分档和 moment 的 humanize 一样 */
export function humanizeDuration(ms: number): string {
  const seconds = Math.round(Math.abs(ms) / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  const months = Math.round(days / 30.4375);
  const years = Math.round(days / 365.25);
  if (seconds < 45) return '几秒';
  if (seconds < 90) return '1 分钟';
  if (minutes < 45) return `${minutes} 分钟`;
  if (minutes < 90) return '1 小时';
  if (hours < 22) return `${hours} 小时`;
  if (hours < 36) return '1 天';
  if (days < 26) return `${days} 天`;
  if (days < 45) return '1 个月';
  if (days < 320) return `${months} 个月`;
  if (days < 548) return '1 年';
  return `${years} 年`;
}

// ---------------------------------------------------------------- 骰子

const MAX_DICE = 1000;
// {{space::5亿}} 会真的拼出 5 亿个空格;超过这个数当写错了,原样留着
const MAX_SPACES = 10000;

/** NdM±K。只写数字当作 1dN。写错了返回 null */
function roll(formula: string, random: () => number): number | null {
  const text = /^\d+$/.test(formula) ? `1d${formula}` : formula;
  const m = /^([1-9]\d*)?d([1-9]\d*)([+-]\d+)?$/i.exec(text);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  // 骰子个数没上限的话 {{roll::99999999999d6}} 能把页面卡死(AI 回复里也可能写,每次渲染都算)
  if (count > MAX_DICE) return null;
  const sides = Number(m[2]);
  let total = m[3] ? Number(m[3]) : 0;
  for (let i = 0; i < count; i++) total += Math.floor(random() * sides) + 1;
  return total;
}

/** {{random:a,b,c}} / {{random:a::b::c}} 这两种老写法:整段进来,在这里切 */
function splitLegacyList(text: string): string[] {
  if (text.includes('::')) return text.split('::').map((s) => s.trim());
  return text
    .replace(/\\,/g, '\u0001')
    .split(',')
    .map((s) => s.trim().replaceAll('\u0001', ','));
}

// ---------------------------------------------------------------- 聊天记录

const lastWhere = (env: MacroEnv, test: (isUser: boolean) => boolean): string => {
  for (let i = env.chat.messages.length - 1; i >= 0; i--) {
    if (test(env.chat.messages[i].isUser)) return env.chat.messages[i].text;
  }
  return '';
};

// ---------------------------------------------------------------- 登记

type Handler = (call: MacroCallContext) => string | number | null | undefined;

interface Spec {
  aliases?: string[];
  description: string;
  syntax?: string;
  example?: string;
  args?: number | [number, number];
  list?: boolean;
  argTypes?: ('string' | 'integer')[];
  strictArgs?: boolean;
  delayArgs?: boolean;
  dynamic?: boolean;
}

function define(category: MacroCategory, name: string, spec: Spec, handler: Handler): MacroDef {
  const [minArgs, maxArgs] =
    typeof spec.args === 'number' ? [spec.args, spec.args] : (spec.args ?? [0, 0]);
  return {
    name,
    category,
    handler,
    minArgs,
    maxArgs,
    syntax: spec.syntax ?? `{{${name}}}`,
    aliases: spec.aliases,
    description: spec.description,
    example: spec.example,
    list: spec.list,
    argTypes: spec.argTypes,
    strictArgs: spec.strictArgs,
    delayArgs: spec.delayArgs,
    dynamic: spec.dynamic,
  };
}

/** 卡的字段是原文,里面可能还有宏(酒馆是提前替换好的),取出来再求一遍 */
const field = (pick: (env: MacroEnv) => string): Handler => (call) =>
  call.resolve(pick(call.env) ?? '');

function variableMacros(global: boolean): MacroDef[] {
  const g = global ? 'global' : '';
  const where = global ? '全局变量' : '这条对话的变量';
  return [
    define(
      'variable',
      `set${g}var`,
      {
        args: 2,
        syntax: `{{set${g}var::名字::值}}`,
        description: `把${where}设成一个值。自己不出字`,
        example: `{{set${g}var::style::轻小说}}`,
      },
      ({ args: [name, value], env }) => {
        variables.set(env.vars, global, name, value);
        return '';
      },
    ),
    define(
      'variable',
      `add${g}var`,
      {
        args: 2,
        syntax: `{{add${g}var::名字::值}}`,
        description: `往${where}上加:两边都是数字就相加,否则接在后面。自己不出字`,
        example: `{{add${g}var::好感度::5}}`,
      },
      ({ args: [name, value], env }) => {
        variables.add(env.vars, global, name, value);
        return '';
      },
    ),
    define(
      'variable',
      `inc${g}var`,
      {
        args: 1,
        syntax: `{{inc${g}var::名字}}`,
        description: `${where}加 1,并写出新的值`,
      },
      ({ args: [name], env }) => variables.add(env.vars, global, name, 1),
    ),
    define(
      'variable',
      `dec${g}var`,
      {
        args: 1,
        syntax: `{{dec${g}var::名字}}`,
        description: `${where}减 1,并写出新的值`,
      },
      ({ args: [name], env }) => variables.add(env.vars, global, name, -1),
    ),
    define(
      'variable',
      `get${g}var`,
      {
        args: 1,
        syntax: `{{get${g}var::名字}}`,
        description: `读出${where};没有就是空`,
        example: global ? '{{$名字}} 是它的简写' : '{{.名字}} 是它的简写',
      },
      ({ args: [name], env }) => variables.get(env.vars, global, name),
    ),
    define(
      'variable',
      `has${g}var`,
      {
        args: 1,
        aliases: [`${g}varexists`],
        syntax: `{{has${g}var::名字}}`,
        description: `${where}存在就写 true,否则 false`,
      },
      ({ args: [name], env }) => (variables.has(env.vars, global, name) ? 'true' : 'false'),
    ),
    define(
      'variable',
      `delete${g}var`,
      {
        args: 1,
        aliases: [`flush${g}var`],
        syntax: `{{delete${g}var::名字}}`,
        description: `删掉${where}。自己不出字`,
      },
      ({ args: [name], env }) => {
        variables.del(env.vars, global, name);
        return '';
      },
    ),
  ];
}

/** 指令模板那一批只在「文本补全 + 指令模式」下有值。我们走的是聊天补全,恒为空 */
const INSTRUCT_NAMES: [string, string[], string][] = [
  ['instructStoryStringPrefix', [], '故事串前缀'],
  ['instructStoryStringSuffix', [], '故事串后缀'],
  ['instructUserPrefix', ['instructInput'], '用户消息前缀'],
  ['instructUserSuffix', [], '用户消息后缀'],
  ['instructAssistantPrefix', ['instructOutput'], '助手消息前缀'],
  ['instructAssistantSuffix', ['instructSeparator'], '助手消息后缀'],
  ['instructSystemPrefix', [], '系统消息前缀'],
  ['instructSystemSuffix', [], '系统消息后缀'],
  ['instructFirstAssistantPrefix', ['instructFirstOutputPrefix'], '第一条助手消息前缀'],
  ['instructLastAssistantPrefix', ['instructLastOutputPrefix'], '最后一条助手消息前缀'],
  ['instructStop', [], '停止序列'],
  ['instructUserFiller', [], '用户对齐占位'],
  ['instructSystemInstructionPrefix', [], '系统指令前缀'],
  ['instructFirstUserPrefix', ['instructFirstInput'], '第一条用户消息前缀'],
  ['instructLastUserPrefix', ['instructLastInput'], '最后一条用户消息前缀'],
  ['defaultSystemPrompt', ['instructSystem', 'instructSystemPrompt'], '默认系统提示词'],
  ['systemPrompt', [], '当前系统提示词'],
];

export const MACRO_DEFS: MacroDef[] = [
  // ---- 名字 ----
  define('names', 'user', { description: '当前人设的名字' }, ({ env }) => env.names.user),
  define('names', 'char', { aliases: ['bot'], description: '角色卡的名字' }, ({ env }) => env.names.char),
  define(
    'names',
    'group',
    { aliases: ['charIfNotGroup'], description: '群聊成员名单;单人对话里就是角色名' },
    ({ env }) => env.names.group,
  ),
  define(
    'names',
    'groupNotMuted',
    { description: '群聊里没被静音的成员;单人对话里就是角色名' },
    ({ env }) => env.names.groupNotMuted,
  ),
  define(
    'names',
    'notChar',
    { description: '除了当前说话角色以外的所有人;单人对话里就是玩家名' },
    ({ env }) => env.names.notChar,
  ),

  // ---- 角色卡 ----
  define(
    'character',
    'charDescription',
    { aliases: ['description'], syntax: '{{description}}', description: '角色描述' },
    field((e) => e.character.description),
  ),
  define(
    'character',
    'charPersonality',
    { aliases: ['personality'], syntax: '{{personality}}', description: '角色性格' },
    field((e) => e.character.personality),
  ),
  define(
    'character',
    'charScenario',
    { aliases: ['scenario'], syntax: '{{scenario}}', description: '情景' },
    field((e) => e.character.scenario),
  ),
  define('character', 'persona', { description: '当前人设的描述' }, field((e) => e.character.persona)),
  define(
    'character',
    'charPrompt',
    { description: '角色卡自带的主提示词(system_prompt)' },
    field((e) => e.character.charPrompt),
  ),
  define(
    'character',
    'charInstruction',
    { description: '角色卡自带的历史后指令(post_history_instructions)' },
    field((e) => e.character.charInstruction),
  ),
  define(
    'character',
    'mesExamplesRaw',
    { description: '角色卡的示例对话原文' },
    field((e) => e.character.mesExamplesRaw),
  ),
  define(
    'character',
    'mesExamples',
    { description: '角色卡的示例对话,每段以 <START> 开头' },
    (call) => {
      const blocks = call.env.character.mesExamplesRaw
        .split(/<START>/gi)
        .map((b) => b.trim())
        .filter(Boolean);
      return call.resolve(blocks.map((b) => `<START>\n${b}\n`).join(''));
    },
  ),
  define(
    'character',
    'charDepthPrompt',
    { description: '角色备注(插在聊天记录里的那段)' },
    field((e) => e.character.charDepthPrompt),
  ),
  define(
    'character',
    'charCreatorNotes',
    { aliases: ['creatorNotes'], description: '创作者注释' },
    field((e) => e.character.creatorNotes),
  ),
  define(
    'character',
    'charFirstMessage',
    {
      aliases: ['greeting'],
      args: [0, 1],
      argTypes: ['integer'],
      syntax: '{{greeting::序号}}',
      description: '开场白。0 或不写是主开场,1 起是其他开场',
    },
    (call) => {
      const i = Number(call.args[0] ?? 0);
      const c = call.env.character;
      return call.resolve(i === 0 ? c.firstMessage : (c.alternateGreetings[i - 1] ?? ''));
    },
  ),
  define(
    'character',
    'charVersion',
    { aliases: ['version', 'char_version'], description: '角色卡的版本' },
    ({ env }) => env.character.version,
  ),
  define(
    'character',
    'original',
    { description: '被角色卡顶替掉的预设原文。只在卡覆盖主提示词 / 历史后指令时有值' },
    ({ env }) => {
      // 不在覆盖的场合:抛出去,引擎会把这个宏原样留下
      if (!env.original) throw new Error('no original');
      return env.original();
    },
  ),

  // ---- 聊天记录 ----
  define('chat', 'lastMessage', { description: '最后一条消息' }, ({ env }) => env.chat.messages.at(-1)?.text ?? ''),
  define(
    'chat',
    'lastMessageId',
    { description: '最后一条消息的序号(从 0 数)' },
    ({ env }) => (env.chat.messages.length ? env.chat.messages.length - 1 : ''),
  ),
  define('chat', 'lastUserMessage', { description: '最后一条玩家消息' }, ({ env }) => lastWhere(env, (u) => u)),
  define('chat', 'lastCharMessage', { description: '最后一条角色消息' }, ({ env }) => lastWhere(env, (u) => !u)),
  define(
    'chat',
    'firstIncludedMessageId',
    { description: '进了提示词的第一条消息的序号(上一次请求的结果)' },
    ({ env }) => env.chat.firstIncludedId ?? '',
  ),
  define(
    'chat',
    'firstDisplayedMessageId',
    { description: '聊天区里显示着的第一条消息的序号' },
    ({ env }) => env.chat.firstDisplayedId ?? '',
  ),
  define(
    'chat',
    'lastSwipeId',
    { description: '最后一条消息一共有几个分支' },
    ({ env }) => env.chat.messages.at(-1)?.swipes ?? '',
  ),
  define(
    'chat',
    'currentSwipeId',
    { description: '最后一条消息当前是第几个分支(从 1 数)' },
    ({ env }) => {
      const id = env.chat.messages.at(-1)?.swipeId;
      return typeof id === 'number' ? id + 1 : '';
    },
  ),
  define(
    'chat',
    'allChatRange',
    { description: '全部消息的序号范围,比如 0-10;没有消息时为空' },
    ({ env }) => (env.chat.messages.length ? `0-${env.chat.messages.length - 1}` : ''),
  ),

  // ---- 变量 ----
  ...variableMacros(false),
  ...variableMacros(true),

  // ---- 工具 ----
  define(
    'utility',
    '//',
    {
      aliases: ['comment'],
      list: true,
      strictArgs: false,
      syntax: '{{// 随便写点什么}}',
      description: '注释。写给自己看的,不会发出去',
    },
    () => '',
  ),
  define(
    'utility',
    'if',
    {
      args: 2,
      delayArgs: true,
      syntax: '{{if 条件}}…{{else}}…{{/if}}',
      example: '{{if .style}}文风:{{.style}}{{else}}没有指定文风{{/if}}',
      description:
        '条件成立出前一段,否则出 {{else}} 后面那段。空、false、off、0 算不成立;条件前加 ! 取反。条件可以直接写宏名或 .变量名',
    },
    ({ args: [rawCondition, rawContent], flags, resolve, trimContent }) => {
      let inverted = false;
      let condition = rawCondition;
      if (/^\s*!/.test(condition)) {
        inverted = true;
        condition = condition.replace(/^\s*!\s*/, '');
      }
      condition = resolve(condition);

      const shorthand = new RegExp(`^([.$])(${VAR_NAME.source.slice(1)})$`).exec(condition);
      if (shorthand) {
        condition = resolve(`{{${shorthand[1] === '.' ? 'getvar' : 'getglobalvar'}::${shorthand[2]}}}`);
      } else {
        const def = REGISTRY_BY_NAME.get(condition.toLowerCase());
        if (def && def.minArgs === 0) condition = resolve(`{{${condition}}}`);
      }

      let falsy = condition === '' || isFalseBoolean(condition);
      if (inverted) falsy = !falsy;

      const { then, otherwise } = splitOnTopLevelElse(rawContent);
      const chosen = falsy ? otherwise : then;
      if (chosen === undefined) return '';
      const result = resolve(chosen);
      return flags.preserveWhitespace ? result : trimContent(result);
    },
  ),
  define(
    'utility',
    'else',
    { description: '{{if}} 里的「否则」。单独写没有作用' },
    () => ELSE_MARKER,
  ),
  define(
    'utility',
    'trim',
    {
      args: [0, 1],
      description: '把它前后的空行吃掉。成对写 {{trim}}…{{/trim}} 则是去掉里面内容的首尾空白',
    },
    ({ args: [content], isScoped }) => (isScoped ? (content ?? '') : '{{trim}}'),
  ),
  define('utility', 'noop', { description: '什么都不做,出一个空' }, () => ''),
  define(
    'utility',
    'newline',
    { args: [0, 1], argTypes: ['integer'], syntax: '{{newline::数量}}', description: '换行。不写数量就是一个' },
    // 负数会让 repeat 抛错 —— 引擎接住后把这个宏原样留着,和酒馆一样
    ({ args: [count] }) => '\n'.repeat(Number(count ?? 1)),
  ),
  define(
    'utility',
    'space',
    { args: [0, 1], argTypes: ['integer'], syntax: '{{space::数量}}', description: '空格。不写数量就是一个' },
    ({ args: [count] }) => {
      const n = Number(count ?? 1);
      if (n > MAX_SPACES) throw new Error('太多了');
      return ' '.repeat(n);
    },
  ),
  define(
    'utility',
    'reverse',
    { args: 1, syntax: '{{reverse::文字}}', description: '把文字倒过来' },
    ({ args: [value] }) => Array.from(value).reverse().join(''),
  ),
  define('utility', 'input', { description: '输入框里此刻的文字' }, ({ env }) => env.input),
  define(
    'utility',
    'outlet',
    { args: 1, syntax: '{{outlet::出口名}}', description: '世界书里位置设成「自定义出口」的条目,在这里出来' },
    // hasOwn:{{outlet::constructor}} 不能读到 Object 原型上的函数
    ({ args: [key], env }) => (key && Object.hasOwn(env.outlets, key) ? (env.outlets[key] ?? '') : ''),
  ),
  define(
    'utility',
    'banned',
    { args: 1, syntax: '{{banned::词}}', description: '给文本补全后端用的禁词。我们走聊天补全,没有效果,也不出字' },
    () => '',
  ),

  // ---- 随机 ----
  define(
    'random',
    'roll',
    {
      args: 1,
      dynamic: true,
      syntax: '{{roll::1d20}}',
      example: '{{roll::3d6+4}}、{{roll 20}}',
      description: '掷骰子。几个几面的骰子加减几;只写一个数就是一个 N 面骰',
    },
    ({ args: [formula], env, globalOffset }) =>
      roll(formula.trim(), () => env.random(`roll:${globalOffset}`)) ?? '',
  ),
  define(
    'random',
    'random',
    {
      list: true,
      dynamic: true,
      syntax: '{{random::红::绿::蓝}}',
      description: '随机挑一个,每次求值都重挑。也认逗号写法 {{random:红,绿,蓝}}',
    },
    ({ list, env, globalOffset }) => {
      const items = list.length === 1 ? splitLegacyList(list[0]) : list;
      if (items.length === 0) return '';
      return items[Math.floor(env.random(`random:${globalOffset}`) * items.length)];
    },
  ),
  define(
    'random',
    'pick',
    {
      list: true,
      syntax: '{{pick::红::绿::蓝}}',
      description: '随机挑一个,但在同一条对话的同一个位置上每次都挑到同一个',
    },
    ({ list, env, globalOffset, contentHash }) => {
      const items = list.length === 1 ? splitLegacyList(list[0]) : list;
      if (items.length === 0) return '';
      const seed = [stringHash(env.chat.id), contentHash, globalOffset].join('-');
      return items[Math.floor(env.random(`pick:${seed}`) * items.length)];
    },
  ),

  // ---- 时间 ----
  define(
    'time',
    'time',
    {
      args: [0, 1],
      dynamic: true,
      syntax: '{{time}}',
      example: '{{time::UTC+8}}',
      description: '现在几点。可以指定时区',
    },
    ({ args: [spec], env }) => {
      const now = env.now();
      const m = spec ? /^UTC([+-]\d+)$/.exec(spec) : null;
      if (!m) return formatDate(now, 'LT');
      const shifted = new Date(now.getTime() + (now.getTimezoneOffset() + Number(m[1]) * 60) * 60000);
      return formatDate(shifted, 'LT');
    },
  ),
  define('time', 'date', { dynamic: true, description: '今天的日期' }, ({ env }) => formatDate(env.now(), 'LL')),
  define('time', 'weekday', { dynamic: true, description: '今天星期几' }, ({ env }) => formatDate(env.now(), 'dddd')),
  define('time', 'isotime', { dynamic: true, description: '现在的时间,HH:mm' }, ({ env }) => formatDate(env.now(), 'HH:mm')),
  define('time', 'isodate', { dynamic: true, description: '今天的日期,YYYY-MM-DD' }, ({ env }) =>
    formatDate(env.now(), 'YYYY-MM-DD'),
  ),
  define(
    'time',
    'datetimeformat',
    {
      args: 1,
      dynamic: true,
      syntax: '{{datetimeformat::YYYY-MM-DD HH:mm}}',
      description: '按你给的格式写现在的时间',
    },
    ({ args: [format], env }) => formatDate(env.now(), format),
  ),
  define(
    'time',
    'idleDuration',
    { aliases: ['idle_duration'], dynamic: true, description: '离玩家上一次发言过了多久' },
    ({ env }) => {
      // 最后一条之前的那条玩家消息 —— 最后一条是正在回应的,不算
      let seenOne = false;
      for (let i = env.chat.messages.length - 1; i >= 0; i--) {
        const m = env.chat.messages[i];
        if (m.isUser && seenOne) {
          return m.sentAt ? humanizeDuration(env.now().getTime() - m.sentAt) : '刚刚';
        }
        seenOne = true;
      }
      return '刚刚';
    },
  ),
  define(
    'time',
    'timeDiff',
    {
      args: 2,
      syntax: '{{timeDiff::时间一::时间二}}',
      description: '两个时间差多久',
    },
    ({ args: [left, right] }) => {
      const diff = new Date(left).getTime() - new Date(right).getTime();
      if (Number.isNaN(diff)) return '';
      return `${humanizeDuration(diff)}${diff > 0 ? '后' : '前'}`;
    },
  ),

  // ---- 状态 ----
  define('state', 'model', { description: '当前连接用的模型名' }, ({ env }) => env.model),
  define(
    'state',
    'maxPrompt',
    { aliases: ['maxPromptTokens'], description: '提示词最多多少 token(上下文减去回复)' },
    ({ env }) => env.limits.maxPrompt,
  ),
  define(
    'state',
    'maxContext',
    { aliases: ['maxContextTokens'], description: '上下文预算' },
    ({ env }) => env.limits.maxContext,
  ),
  define(
    'state',
    'maxResponse',
    { aliases: ['maxResponseTokens'], description: '回复最多多少 token' },
    ({ env }) => env.limits.maxResponse,
  ),
  define(
    'state',
    'lastGenerationType',
    { description: '上一次生成是哪种:normal(发送)、regenerate(重新生成)、swipe(换一个)' },
    ({ env }) => env.lastGenerationType,
  ),
  define('state', 'isMobile', { description: '是不是在手机上:true / false' }, ({ env }) => String(env.isMobile)),
  define(
    'state',
    'hasExtension',
    { args: 1, syntax: '{{hasExtension::名字}}', description: '酒馆的扩展装没装。我们没有酒馆扩展,恒为 false' },
    () => 'false',
  ),

  // ---- 酒馆自带扩展注册的宏 ----
  // 这些功能我们没有(总结、作者注释、画图),但预设里常写;不认的话字面的 {{summary}} 会发给 AI
  define('chat', 'summary', { description: '酒馆「总结」扩展的最新总结。我们没有这个功能,恒为空' }, () => ''),
  define('prompts', 'authorsNote', { description: '酒馆的作者注释。我们没有,恒为空' }, () => ''),
  define('prompts', 'charAuthorsNote', { description: '酒馆里角色专属的作者注释。我们没有,恒为空' }, () => ''),
  define('prompts', 'defaultAuthorsNote', { description: '酒馆的默认作者注释。我们没有,恒为空' }, () => ''),
  define('prompts', 'reasoningPrefix', { description: '思考内容开头的标记,固定是 <think>' }, () => '<think>'),
  define('prompts', 'reasoningSuffix', { description: '思考内容结尾的标记,固定是 </think>' }, () => '</think>'),
  define('prompts', 'reasoningSeparator', { description: '思考内容和正文之间的分隔,固定是一个换行' }, () => '\n'),
  define('prompts', 'charPrefix', { description: '酒馆画图扩展里角色的正面提示词前缀。我们没有,恒为空' }, () => ''),
  define('prompts', 'charNegativePrefix', { description: '酒馆画图扩展里角色的反面提示词前缀。我们没有,恒为空' }, () => ''),

  // ---- 指令模板 ----
  ...INSTRUCT_NAMES.map(([name, aliases, what]) =>
    define(
      'prompts',
      name,
      { aliases, description: `${what}。文本补全的指令模式才有值,我们走聊天补全,恒为空` },
      () => '',
    ),
  ),
  define(
    'prompts',
    'exampleSeparator',
    { aliases: ['chatSeparator'], description: '文本补全里示例对话之间的分隔符' },
    () => '***',
  ),
  define('prompts', 'chatStart', { description: '文本补全里聊天开始的标记' }, () => '***'),
];

/** {{if 宏名}} 要查「这是不是个不带参数的宏」 */
const REGISTRY_BY_NAME = new Map<string, MacroDef>();
for (const def of MACRO_DEFS) {
  REGISTRY_BY_NAME.set(def.name.toLowerCase(), def);
  for (const alias of def.aliases ?? []) REGISTRY_BY_NAME.set(alias.toLowerCase(), def);
}

export const MACRO_REGISTRY: Map<string, MacroDef> = REGISTRY_BY_NAME;
