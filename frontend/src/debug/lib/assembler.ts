/**
 * 把 角色卡 + 预设 + 对话历史 组装成最终的 messages 数组。
 *
 * 复刻酒馆 Chat Completion 的组装顺序:
 *   遍历 prompt_order → 跳过 disabled → 找到块 → marker 展开成真实内容
 *   → 宏替换 → 产出消息
 *
 * 每条产出的消息都带 source 元数据,这是调试台能做「来源追溯」的原因。
 */

import type { TavernCard } from './cardParser';
import { stripComments } from './comments';
import { WI_ROLE } from './characterBook';
import {
  buildMacroContext,
  seededRandom,
  substituteMacros,
  type MacroExtras,
  type MacroVars,
} from './macros';
import { estimateTokens } from './tokens';
import {
  DEFAULT_WORLD_INFO_SETTINGS,
  activateWorldInfo,
  type WorldInfoDepthBlock,
  type WorldInfoResult,
  type WorldInfoSettings,
} from './worldInfo';
import {
  MARKER_LABELS,
  type PresetOrderEntry,
  type PresetPrompt,
  type PromptRole,
  type TavernPreset,
} from './presetParser';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * token 分账口径 —— 比 sourceKind 细,因为预算条要按来源分段染色。
 *
 * 和 sourceKind 唯一实质的差别在「卡覆盖预设块」:那时 sourceKind 仍是
 * preset(它确实占着预设块的位置),但字是从卡里来的,账要算到卡头上。
 */
export type PromptPart =
  | 'preset'
  | 'card'
  | 'persona'
  | 'examples'
  | 'worldInfo'
  | 'history';

/** 分账口径 → 预算条上的三段。条上只分三色,明细才铺开到 part */
export function bucketOf(part: PromptPart): 'preset' | 'card' | 'history' {
  if (part === 'preset') return 'preset';
  if (part === 'history') return 'history';
  return 'card';
}

export interface AssembledMessage {
  role: PromptRole;
  content: string;
  tokens: number;
  /** 追溯:这条消息由哪个块产生 */
  sourceIdentifier: string;
  sourceName: string;
  sourceKind: 'preset' | 'marker' | 'history' | 'examples';
  /** 示例对话的消息带这个(example_user / example_assistant),标明这句算谁说的 */
  name?: string;
  /** token 分账口径 */
  part: PromptPart;
  /** 仅历史消息有 —— 指向 input.history 的下标,截断线靠它定位 */
  historyIndex?: number;
}

export interface SkippedBlock {
  identifier: string;
  name: string;
  reason:
    | '编排里关闭'
    | '块内容为空'
    | '块不存在于预设'
    | '超出 token 预算'
    | '全部被注释'
    | '这种生成方式下不触发'
    | '内置块以外的系统块酒馆不发';
}

/** 各 part 各占多少 token —— 预算条展开后的明细就是这个 */
export type PartTokens = Record<PromptPart, number>;

export interface BudgetReport {
  /** null = 不截断 */
  limit: number | null;
  /** 固定开销 = 除历史外的一切。预算条上那条「线」的位置 */
  fixedTokens: number;
  presetTokens: number;
  cardTokens: number;
  /** 真正进了提示词的历史(截断之后) */
  historyTokens: number;
  parts: PartTokens;
  droppedCount: number;
  droppedTokens: number;
  /** 固定开销自己就超预算了 —— 历史一条都放不下 */
  overflow: boolean;
  /** 为了不发空请求强留的最后一条,自己就超预算 */
  forcedLastMessage: boolean;
  /**
   * 第一条留下来的历史消息在 input.history 里的下标。聊天区的截断线画在它上面。
   * 历史为空时是 null。
   */
  firstKeptHistoryIndex: number | null;
}

export interface AssemblyResult {
  messages: AssembledMessage[];
  skipped: SkippedBlock[];
  totalTokens: number;
  /** 编排里引用了但 prompts 里找不到的 identifier */
  danglingIdentifiers: string[];
  budget: BudgetReport;
  /** 这一轮世界书的触发明细。库里存的旧快照没有这一项 */
  worldInfo?: WorldInfoResult;
  /**
   * 组装完之后变量的样子({{setvar}} 一类宏写进去的都在里面)。
   * 真的发出去了就把它存回对话;只是预览就丢掉。库里存的旧快照没有这一项
   */
  variables?: MacroVars;
}

export interface AssembleInput {
  card: TavernCard;
  preset: TavernPreset;
  order: PresetOrderEntry[];
  history: ChatTurn[];
  userName: string;
  personaDescription: string;
  /** 自定义宏的查找表 —— 组装和聊天区显示用的是同一份 */
  customMacros?: Record<string, string>;
  /** 卡自带的 system_prompt / post_history_instructions 是否覆盖预设块 */
  allowCardOverrides: boolean;
  /** 整个提示词的 token 上限。超出的旧历史不进提示词。null = 不截断 */
  tokenBudget: number | null;
  /** 世界书的全局设置,不传就用酒馆的出厂值 */
  worldInfo?: WorldInfoSettings;
  /** 这条对话的变量和全局变量。组装时改的是副本,结果在返回值的 variables 里 */
  variables?: MacroVars;
  /** 宏还能读到的别的东西:模型名、对话 id、输入框里的字…… */
  macroExtra?: Partial<MacroExtras>;
  /** 世界书的概率、分组和随机类的宏都用它取数。对照测试用它把随机数钉死;平时不传 */
  random?: () => number;
  /**
   * 预设块里行首 // 的整行当注释、不发出去。这是我们自己加的功能,酒馆没有 ——
   * 从酒馆导进来的预设要关掉它,不然人家正文里以 // 开头的行就被吞了。默认开(老行为)
   */
  lineComments?: boolean;
  /** 数 token 的函数。不传用粗略估算;世界书预算、历史截断都按它算 */
  countTokens?: (text: string) => number;
}

/** 酒馆只会把这几个内置块和用户自建的块放进提示词;别的「系统块」不发 */
const BUILTIN_TEXT_BLOCKS = new Set(['main', 'nsfw', 'jailbreak', 'enhanceDefinitions']);
/** 合并相邻 system 消息时,这两种标记保持独立 */
const SQUASH_EXCLUDED = new Set(['newMainChat', 'newChat']);
/**
 * 算预算时的固定开销,数字照酒馆(它按 OpenAI 的记账方式算):
 * 每条消息 4 个、带 name 的再多 1 个;整个请求留 3 个给回复的开头;
 * 世界书自己那份预算里,每次数都多算 6 个。
 */
const MESSAGE_OVERHEAD = 4;
const NAME_OVERHEAD = 1;
const REPLY_PRIMING = 3;
const WORLD_INFO_OVERHEAD = 6;
/** 酒馆发出去之前会去掉回车符(\r) */
const noCr = (text: string) => text.replace(/\r/g, '');

/**
 * 示例对话切成一段一段。照酒馆的 parseMesExamples:每段以 <START> 开头,段内去掉首尾空白。
 * 世界书里位置是「示例对话前 / 后」的条目也各自切好,插到前面或接在后面。
 */
function exampleBlocks(own: string, fromWorldInfo: WorldInfoResult['examples']): string[] {
  const parse = (text: string): string[] => {
    if (!text || text === '<START>') return [];
    const whole = text.startsWith('<START>') ? text : `<START>\n${text.trim()}`;
    return whole
      .split(/<START>/gi)
      .slice(1)
      .map((block) => `<START>\n${block.trim()}\n`);
  };
  const blocks = parse(own);
  for (const ex of fromWorldInfo) {
    if (ex.position === 'before') blocks.unshift(...parse(ex.content));
    else blocks.push(...parse(ex.content));
  }
  return blocks;
}

/**
 * 一段示例对话 → 几条消息。照酒馆的 parseExampleIntoIndividual:
 * 以「玩家名:」「角色名:」开头的行换人说话;消息都以 system 的身份发,
 * 另带一个 name(example_user / example_assistant)标明这句是谁的。
 * 第一行(<START> 那行)丢掉;第一个说话人之前的杂行并进第一句里。
 */
function parseExampleBlock(block: string, user: string, char: string): { name: string; content: string }[] {
  const lines = block.replace(/<START>/i, '{Example Dialogue:}').replace(/\r/g, '').split('\n');
  const out: { name: string; content: string }[] = [];
  let current: string[] = [];
  let inUser = false;
  let inBot = false;
  const flush = (speaker: string, name: string) => {
    out.push({ name, content: current.join('\n').replace(`${speaker}:`, '').trim() });
    current = [];
  };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(`${user}:`)) {
      inUser = true;
      if (inBot) flush(char, 'example_assistant');
      inBot = false;
    } else if (line.startsWith(`${char}:`)) {
      inBot = true;
      if (inUser) flush(user, 'example_user');
      inUser = false;
    }
    current.push(line);
  }
  if (inUser) flush(user, 'example_user');
  else if (inBot) flush(char, 'example_assistant');
  return out;
}

/** 酒馆的 formatWorldInfo:没内容就什么都不出;模板是空的就不套 */
function formatWorldInfo(value: string, wiFormat: string): string {
  if (!value) return '';
  // 照酒馆的 stringFormat:每个 {0} 都换,而且用函数替换 —— 字符串替换会把内容里的 $& $$ 当成特殊写法
  return wiFormat.trim() ? wiFormat.replace(/\{0\}/g, () => value) : value;
}

/** 酒馆作者注释的默认位置:聊天记录里倒数第 4 条,system。我们没有作者注释,只放挂在它上下的世界书 */
const AUTHOR_NOTE_DEPTH = 4;
const ROLE_BY_NAME: Record<string, number> = {
  system: WI_ROLE.system,
  user: WI_ROLE.user,
  assistant: WI_ROLE.assistant,
};

/**
 * 一段要插进聊天记录的文字。预设的绝对深度块和世界书 / 角色备注走同一条路,
 * 只是账要分开算(part),来源也要能追溯(identifier)。
 */
interface DepthInjection extends WorldInfoDepthBlock {
  /** 同一深度里先后:数大的在前。扩展注入(世界书、备注)固定是 100 */
  order: number;
  part: PromptPart;
  identifier: string;
  name: string;
}

/**
 * 世界书和卡带来的注入:作者注释位的世界书、角色备注(卡的 depth_prompt)、
 * 指定深度的世界书。同一深度同一身份的会合成一条,先后顺序照酒馆
 * (按注入器的键名排序:2_floating_prompt < DEPTH_PROMPT < customDepthWI)。
 */
function extensionInjections(card: TavernCard, wi: WorldInfoResult): DepthInjection[] {
  const blocks: DepthInjection[] = [];
  const tag = (b: WorldInfoDepthBlock, identifier: string, name: string): DepthInjection => ({
    ...b,
    order: 100,
    part: 'worldInfo',
    identifier,
    name,
  });
  if (wi.authorNote) {
    blocks.push(
      tag(
        { depth: AUTHOR_NOTE_DEPTH, role: WI_ROLE.system, content: wi.authorNote },
        'worldInfoDepth',
        '世界书 · 作者注释位',
      ),
    );
  }
  const note = card.extensions.depth_prompt;
  if (typeof note === 'object' && note !== null) {
    const { prompt, depth, role } = note as { prompt?: unknown; depth?: unknown; role?: unknown };
    if (typeof prompt === 'string' && prompt.trim()) {
      blocks.push(
        tag(
          {
            depth: typeof depth === 'number' && Number.isFinite(depth) ? depth : 4,
            role: (typeof role === 'string' && ROLE_BY_NAME[role]) || WI_ROLE.system,
            content: prompt,
          },
          'depthPrompt',
          '角色备注',
        ),
      );
    }
  }
  return [...blocks, ...wi.depth.map((b) => tag(b, 'worldInfoDepth', '世界书 · 指定深度'))];
}

const DEPTH_ROLES: { role: PromptRole; value: number }[] = [
  { role: 'system', value: WI_ROLE.system },
  { role: 'user', value: WI_ROLE.user },
  { role: 'assistant', value: WI_ROLE.assistant },
];

/**
 * 把绝对深度的块插进聊天记录。深度 0 = 最后一条消息之后,1 = 它之前,依此类推;
 * 聊天记录不够长就垫在最前面。照酒馆 populationInjectionPrompts 的做法:
 * 在倒序的列表上从浅到深插;同一深度先按 order 分组(数大的在前),
 * 组内 system、user、assistant 各合成一条,预设块在前、扩展注入在后。
 *
 * 合成一条时 part 只能取一个:有预设块就记预设,否则记世界书。两种混在同一条里
 * 的情况很少,分账差那几十 token 不补。
 */
function injectAtDepth(
  history: AssembledMessage[],
  blocks: DepthInjection[],
  count: (text: string) => number,
): AssembledMessage[] {
  if (blocks.length === 0) return history;
  const reversed = [...history].reverse();
  // 只走真有块的深度(从浅到深)。以前是 0 到最大深度一个个数:预设里写个 1e400 / 卡里写个 1e12,
  // 页面就卡死。不是非负整数的深度以前一个都对不上,照旧不插
  const depths = [...new Set(blocks.map((b) => b.depth))]
    .filter((d) => Number.isInteger(d) && d >= 0)
    .sort((a, b) => a - b);
  let inserted = 0;

  for (const depth of depths) {
    const atDepth = blocks.filter((b) => b.depth === depth && b.content);
    if (atDepth.length === 0) continue;
    const orders = [...new Set(atDepth.map((b) => b.order))].sort((a, b) => b - a);
    const here: AssembledMessage[] = [];
    for (const order of orders) {
      for (const { role, value } of DEPTH_ROLES) {
        const group = atDepth.filter((b) => b.order === order && b.role === value);
        if (group.length === 0) continue;
        // 预设块之间原样用换行接(块自己首尾的空行会留下),接完整体去首尾空白;
        // 扩展注入逐条去空白再接。两部分之间再一个换行
        const content = [
          group.filter((b) => b.part === 'preset').map((b) => b.content).join('\n'),
          group.filter((b) => b.part !== 'preset').map((b) => b.content.trim()).join('\n'),
        ]
          .filter(Boolean)
          .map((x) => x.trim())
          .join('\n');
        if (!content) continue;
        here.push({
          role,
          content,
          tokens: count(content),
          sourceIdentifier: group.map((b) => b.identifier).join(','),
          sourceName:
            group.length === 1 ? group[0].name : `深度 ${depth} · ${group.map((b) => b.name).join(' + ')}`,
          sourceKind: group.some((b) => b.part === 'preset') ? 'preset' : 'marker',
          part: group.some((b) => b.part === 'preset') ? 'preset' : 'worldInfo',
        });
      }
    }
    reversed.splice(depth + inserted, 0, ...here);
    inserted += here.length;
  }
  return reversed.reverse();
}

export function assemble(input: AssembleInput): AssemblyResult {
  const {
    card,
    preset,
    order,
    history,
    userName,
    personaDescription,
    customMacros,
    allowCardOverrides,
    tokenBudget,
    worldInfo: worldInfoSettings = DEFAULT_WORLD_INFO_SETTINGS,
    variables,
    macroExtra,
    random,
    lineComments = true,
    countTokens: count = estimateTokens,
  } = input;
  const generationType = macroExtra?.lastGenerationType || 'normal';

  // 不传 seed:每次发送本来就该重掷骰子。聊天区显示那边才需要定种子
  const ctx = buildMacroContext({
    card,
    userName,
    personaDescription,
    history,
    custom: customMacros,
    variables,
    extra: { maxContext: tokenBudget ?? 0, ...macroExtra },
  });
  // 组装有自己的一份变量:{{setvar}} 写进去的留在这份里,算完随结果交回去
  const sub = (text: string) => substituteMacros(text, ctx, { mutate: true, random });

  // 求值的先后照酒馆:聊天记录 → 卡的字段 → 世界书 → 预设块(按编排)。
  // 预设靠变量在块之间传话,先后错了读到的就是上一轮的值。
  // 每段文字只求一次 —— 带副作用的宏({{incvar}})求两次就多加了一。
  const historyTexts = history.map((turn) => sub(turn.content));

  // 卡的字段:先去首尾空白,再求宏,最后去掉回车符 —— 酒馆的 baseChatReplace 就是这三步。
  // 求完写回上下文,后面 {{description}} 这些宏取到的就是求好的字
  const field = (text: string) => noCr(sub(text.trim()));
  ctx.description = field(card.description);
  ctx.personality = field(card.personality);
  ctx.scenario = field(card.scenario);
  ctx.persona = field(personaDescription);
  const depthNote = field(ctx.extra?.charDepthPrompt ?? '');
  const creatorNotes = field(card.creator_notes);
  const mesExamples = field(card.mes_example);
  // 卡自带的主提示词 / 历史后指令也在这一步求好。这时 {{original}} 还没有值,原样留着
  const charPrompt = field(card.system_prompt);
  const charInstruction = field(card.post_history_instructions);
  ctx.extra = {
    ...ctx.extra,
    charDepthPrompt: depthNote,
    creatorNotes,
    mesExamplesRaw: mesExamples,
    charPrompt,
    charInstruction,
  };

  // 世界书的结果要分给好几个块(前、后、示例对话、聊天记录、出口)
  const lastTurn = history.at(-1)?.content ?? '';
  const wi = activateWorldInfo({
    entries: card.character_book?.entries ?? [],
    messages: [...historyTexts].reverse().map((text, i) => {
      if (!worldInfoSettings.includeNames) return text;
      const turn = history[history.length - 1 - i];
      return `${turn.role === 'user' ? ctx.user : ctx.char}: ${text}`;
    }),
    scanData: {
      personaDescription: ctx.persona,
      characterDescription: ctx.description,
      characterPersonality: ctx.personality,
      characterDepthPrompt: depthNote,
      scenario: ctx.scenario,
      creatorNotes,
    },
    settings: worldInfoSettings,
    maxContext: tokenBudget,
    // 聊天记录不变,掷出来的就不变 —— 输入框上方的预览和真正发出去的得是同一份
    random: random ?? seededRandom(`wi:${history.length}:${lastTurn}`),
    substitute: sub,
    countTokens: (text) => (text ? count(text) + WORLD_INFO_OVERHEAD : 0),
    trigger: generationType,
  });
  ctx.extra = { ...ctx.extra, outlets: wi.outlets };

  // 这几个占位符的内容和预设块无关,也先求好
  // 模板是空的就直接用字段本身
  const formatted = (value: string, template: string) =>
    value && template ? sub(template) : value;
  const markerText = {
    charDescription: ctx.description,
    charPersonality: formatted(ctx.personality, preset.formats.personality_format),
    scenario: formatted(ctx.scenario, preset.formats.scenario_format),
    personaDescription: ctx.persona,
    worldInfoBefore: sub(formatWorldInfo(wi.before, preset.formats.wi_format)),
    worldInfoAfter: sub(formatWorldInfo(wi.after, preset.formats.wi_format)),
  };

  // 示例对话:每段前面一条「新示例」标记,段里的每句都是带 name 的 system 消息
  /** 一段示例 = 一条「新示例」标记 + 段里的每一句。预算不够时整段整段地丢 */
  const exampleGroups: AssembledMessage[][] = [];
  const exampleHeader = sub(preset.formats.new_example_chat_prompt);
  const pushExample = (content: string, identifier: string, name?: string) => {
    if (!content) return;
    exampleGroups.at(-1)?.push({
      role: 'system',
      content,
      tokens: count(content),
      sourceIdentifier: identifier,
      sourceName: name ? '示例对话' : '新示例标记',
      sourceKind: 'examples',
      part: 'examples',
      ...(name ? { name } : {}),
    });
  };
  const blocks = exampleBlocks(
    mesExamples,
    wi.examples.map((ex) => ({ ...ex, content: noCr(ex.content) })),
  );
  for (const block of blocks) {
    exampleGroups.push([]);
    pushExample(exampleHeader, 'newChat');
    for (const m of parseExampleBlock(block, ctx.user, ctx.char)) {
      pushExample(m.content, 'dialogueExamples', m.name);
    }
  }

  const exampleMessages = exampleGroups.flat();
  /** 聊天记录那一块里的消息(对话本身 + 插进去的深度块),旧的在前。不含最前面的「新对话」标记 */
  let chatBlock: AssembledMessage[] = [];

  const byIdentifier = new Map(preset.prompts.map((p) => [p.identifier, p]));
  const messages: AssembledMessage[] = [];
  const skipped: SkippedBlock[] = [];
  const dangling: string[] = [];
  /** 预设里标了绝对深度的块:不按编排的位置放,攒起来插进聊天记录 */
  const depthPrompts: DepthInjection[] = [];

  const emit = (
    role: PromptRole,
    content: string,
    prompt: PresetPrompt,
    kind: AssembledMessage['sourceKind'],
    part: PromptPart,
  ) => {
    // 不裁首尾空白:酒馆原样发,只有彻底是空的才不发。只剩一个换行的块它也照发
    const text = content;
    if (!text) {
      skipped.push({ identifier: prompt.identifier, name: prompt.name, reason: '块内容为空' });
      return;
    }
    messages.push({
      role,
      content: text,
      tokens: count(text),
      sourceIdentifier: prompt.identifier,
      sourceName: prompt.name,
      sourceKind: kind,
      part,
    });
  };

  /**
   * 文本块发出去的正文(宏已求值)和分账。null = 整块被注释光(调用方记「全部被注释」)。
   *
   * 行首 // 的注释行不进请求。剔除放在宏替换**之前** —— 注释掉的 {{char}} 不该被算进
   * 「未解析宏」。卡自带的 system_prompt / post_history_instructions 覆盖对应预设块,
   * 覆盖进来的字不剔注释(注释是预设编辑器的功能,卡的字段归卡编辑器管);覆盖发生时
   * 账算到卡头上 —— 预算条上这几百 token 染成预设色就是骗人。
   */
  const textOf = (prompt: PresetPrompt): { text: string; part: PromptPart } | null => {
    const stripped = lineComments ? stripComments(prompt.content) : prompt.content;
    // 先看卡有没有顶掉这块,再看是不是被注释光了:预设的 main 全写成 // 笔记时,
    // 卡自带的 system_prompt 照样要发(酒馆里卡的覆盖不管预设原文是什么)
    if (allowCardOverrides && !prompt.forbidOverrides) {
      const override =
        prompt.identifier === 'main' ? charPrompt : prompt.identifier === 'jailbreak' ? charInstruction : '';
      if (override) {
        // 卡的字里可以写 {{original}},意思是「被我顶掉的那段预设原文放这儿」。
        // 卡的字前面已经求过一遍宏,这里为了填 {{original}} 再求一遍 —— 酒馆就是求两遍。
        // 顶进来的预设原文自己先求好,填进去之后不再求
        const original = sub(stripped);
        const text = substituteMacros(
          override,
          { ...ctx, extra: { ...ctx.extra, original } },
          { mutate: true, random },
        );
        return { text, part: 'card' };
      }
    }
    if (lineComments && prompt.content.trim() && !stripped.trim()) return null;
    return { text: sub(stripped), part: 'preset' };
  };

  /** 编排里启用、预设里存在的块;没有的记进 dangling / skipped */
  const resolve = (entry: PresetOrderEntry): PresetPrompt | null => {
    const prompt = byIdentifier.get(entry.identifier);
    if (!prompt) {
      dangling.push(entry.identifier);
      skipped.push({
        identifier: entry.identifier,
        name: '(预设里没有这个块)',
        reason: '块不存在于预设',
      });
      return null;
    }
    if (!entry.enabled) {
      skipped.push({ identifier: prompt.identifier, name: prompt.name, reason: '编排里关闭' });
      return null;
    }
    if (prompt.injectionTrigger.length > 0 && !prompt.injectionTrigger.includes(generationType)) {
      skipped.push({
        identifier: prompt.identifier,
        name: prompt.name,
        reason: '这种生成方式下不触发',
      });
      return null;
    }
    // 酒馆只认那几个内置块 + 用户自建的块(system_prompt 为 false)。
    // 别的块要是标成了系统块又不是绝对深度,它根本不会放进提示词
    if (
      !prompt.marker &&
      prompt.systemPrompt &&
      prompt.injectionPosition !== 1 &&
      !BUILTIN_TEXT_BLOCKS.has(prompt.identifier)
    ) {
      skipped.push({
        identifier: prompt.identifier,
        name: prompt.name,
        reason: '内置块以外的系统块酒馆不发',
      });
      return null;
    }
    return prompt;
  };

  // 先按编排的顺序把所有文本块求一遍值。两个原因:
  //   - 绝对深度的块不管排在哪,都要在铺聊天记录之前收齐 —— 酒馆也是先算注入再铺
  //   - 变量宏有先后:前面的块 {{setvar}},后面的块 {{getvar}},必须照编排走一趟
  const resolved = order.map(resolve);
  const texts = new Map<PresetPrompt, { text: string; part: PromptPart } | null>();
  for (const prompt of resolved) {
    if (!prompt || prompt.marker || texts.has(prompt)) continue;
    const got = textOf(prompt);
    texts.set(prompt, got);
    if (prompt.injectionPosition !== 1) continue;
    if (!got) {
      skipped.push({ identifier: prompt.identifier, name: prompt.name, reason: '全部被注释' });
      continue;
    }
    const text = got.text;
    if (!text) {
      skipped.push({ identifier: prompt.identifier, name: prompt.name, reason: '块内容为空' });
      continue;
    }
    depthPrompts.push({
      depth: prompt.injectionDepth,
      role: ROLE_BY_NAME[prompt.role] ?? WI_ROLE.system,
      order: prompt.injectionOrder,
      content: text,
      part: got.part,
      identifier: prompt.identifier,
      name: prompt.name,
    });
  }

  for (const prompt of resolved) {
    if (!prompt) continue;

    if (!prompt.marker) {
      if (prompt.injectionPosition === 1) continue; // 上面处理过了
      const got = texts.get(prompt);
      if (!got) {
        // 整块被注释光:给个专属原因,别混进「块内容为空」—— 这两种情况用户要做的事完全不同
        skipped.push({ identifier: prompt.identifier, name: prompt.name, reason: '全部被注释' });
        continue;
      }
      emit(prompt.role, got.text, prompt, 'preset', got.part);
      continue;
    }

    // ---- marker 展开 ----
    switch (prompt.identifier) {
      case 'charDescription':
      case 'charPersonality':
      case 'scenario':
        emit('system', markerText[prompt.identifier], prompt, 'marker', 'card');
        break;

      case 'personaDescription':
        emit('system', markerText.personaDescription, prompt, 'marker', 'persona');
        break;

      case 'worldInfoBefore':
      case 'worldInfoAfter':
        emit('system', markerText[prompt.identifier], prompt, 'marker', 'worldInfo');
        break;

      case 'dialogueExamples': {
        if (exampleMessages.length === 0) {
          skipped.push({
            identifier: prompt.identifier,
            name: prompt.name,
            reason: '块内容为空',
          });
        }
        messages.push(...exampleMessages);
        break;
      }

      case 'chatHistory': {
        const injected = [...depthPrompts, ...extensionInjections(card, wi)];
        const turns: AssembledMessage[] = [];
        for (const [i, turn] of history.entries()) {
          const text = noCr(historyTexts[i]);
          if (!text) continue;
          turns.push({
            role: turn.role,
            content: text,
            tokens: count(text),
            sourceIdentifier: 'chatHistory',
            sourceName: '对话历史',
            sourceKind: 'history',
            part: 'history',
            historyIndex: i,
          });
        }
        // 聊天记录最前面垫一条「新对话」标记(预设里的 new_chat_prompt,默认 [Start a new Chat])
        const newChat = sub(preset.formats.new_chat_prompt);
        if (newChat) {
          messages.push({
            role: 'system',
            content: newChat,
            tokens: count(newChat),
            sourceIdentifier: 'newMainChat',
            sourceName: '新对话标记',
            sourceKind: 'preset',
            part: 'preset',
          });
        }
        chatBlock = injectAtDepth(turns, injected, count);
        messages.push(...chatBlock);
        break;
      }

      default:
        // 预设自定义的 marker,酒馆里也是空的
        skipped.push({
          identifier: prompt.identifier,
          name: `${prompt.name} (未知 marker)`,
          reason: '块内容为空',
        });
    }
  }

  // ---- token 预算 ----
  // 先后照酒馆:预设块、卡的字段、世界书这些固定的先占;剩下的先给聊天记录
  // (从最新往回留,留不下的那条和比它更老的全丢 —— 不切半条,也不跳着留);
  // 再有剩才轮到示例对话,一段一段给,哪段放不下,它和后面的都不要。
  // 插在聊天记录里的深度块(预设的、世界书的、角色备注)和对话一起排队,太靠前的一样会被丢。
  //
  // 刻意跑在 squash 之前:合并相邻 system 会把预设块和卡的块并成一条,
  // 分账就没法算了。squash 之后 totalTokens 和明细之和会差每次合并约 1
  // token(多一个换行 + 取整),量级可忽略,不补。
  const dropped = new Set<AssembledMessage>();
  let forcedLastMessage = false;
  if (tokenBudget !== null) {
    const cost = (m: AssembledMessage) =>
      m.tokens + MESSAGE_OVERHEAD + (m.name ? count(m.name) + NAME_OVERHEAD : 0);
    const flexible = new Set([...chatBlock, ...exampleMessages]);
    let remaining = tokenBudget - REPLY_PRIMING;
    for (const m of messages) if (!flexible.has(m)) remaining -= cost(m);

    let keptTurn = false;
    for (let i = chatBlock.length - 1; i >= 0; i--) {
      const m = chatBlock[i];
      const c = cost(m);
      if (c > remaining) {
        if (keptTurn) {
          for (let j = 0; j <= i; j++) dropped.add(chatBlock[j]);
          break;
        }
        // 最新一条对话必留:丢掉它等于发一个没有用户输入的请求。
        // (酒馆这时会连它也丢;这是我们唯一故意不一样的地方)
        if (m.part === 'history') forcedLastMessage = true;
      }
      remaining -= c;
      if (m.part === 'history') keptTurn = true;
    }

    for (const [gi, group] of exampleGroups.entries()) {
      const c = group.reduce((sum, m) => sum + cost(m), 0);
      if (c > remaining) {
        for (const g of exampleGroups.slice(gi)) for (const m of g) dropped.add(m);
        skipped.push({
          identifier: 'dialogueExamples',
          name: `示例对话(后 ${exampleGroups.length - gi} 段)`,
          reason: '超出 token 预算',
        });
        break;
      }
      remaining -= c;
    }
  }

  const surviving = dropped.size > 0 ? messages.filter((m) => !dropped.has(m)) : messages;
  const parts: PartTokens = {
    preset: 0,
    card: 0,
    persona: 0,
    examples: 0,
    worldInfo: 0,
    history: 0,
  };
  for (const m of surviving) parts[m.part] += m.tokens;
  const fixedTokens =
    parts.preset + parts.card + parts.persona + parts.examples + parts.worldInfo;
  const droppedTurns = [...dropped].filter((m) => m.part === 'history');

  const budget: BudgetReport = {
    limit: tokenBudget,
    fixedTokens,
    presetTokens: parts.preset,
    cardTokens: parts.card + parts.persona + parts.examples + parts.worldInfo,
    historyTokens: parts.history,
    parts,
    droppedCount: droppedTurns.length,
    droppedTokens: droppedTurns.reduce((sum, m) => sum + m.tokens, 0),
    overflow: tokenBudget !== null && fixedTokens > tokenBudget,
    forcedLastMessage,
    firstKeptHistoryIndex: surviving.find((m) => m.part === 'history')?.historyIndex ?? null,
  };
  if (droppedTurns.length > 0) {
    skipped.push({
      identifier: 'chatHistory',
      name: `对话历史(最早的 ${droppedTurns.length} 条)`,
      reason: '超出 token 预算',
    });
  }
  for (const m of dropped) {
    if (chatBlock.includes(m) && m.part !== 'history') {
      skipped.push({ identifier: m.sourceIdentifier, name: m.sourceName, reason: '超出 token 预算' });
    }
  }

  const finalMessages = preset.squashSystemMessages ? squashSystem(surviving, count) : surviving;

  return {
    messages: finalMessages,
    skipped,
    totalTokens: finalMessages.reduce((sum, m) => sum + m.tokens, 0),
    danglingIdentifiers: dangling,
    budget,
    worldInfo: wi,
    variables: ctx.vars,
  };
}

/**
 * 合并相邻的 system 消息(酒馆的 squash_system_messages)。
 * 用换行接起来,不裁空白;「新对话」「新示例」两种标记和带 name 的示例消息不参与合并。
 */
function squashSystem(
  messages: AssembledMessage[],
  count: (text: string) => number,
): AssembledMessage[] {
  const canSquash = (m: AssembledMessage) =>
    m.role === 'system' && !m.name && !SQUASH_EXCLUDED.has(m.sourceIdentifier);
  const out: AssembledMessage[] = [];
  for (const m of messages) {
    const prev = out.at(-1);
    if (prev && canSquash(m) && canSquash(prev)) {
      const content = `${prev.content}\n${m.content}`;
      out[out.length - 1] = {
        ...prev,
        content,
        tokens: count(content),
        sourceName: `${prev.sourceName} + ${m.sourceName}`,
        sourceIdentifier: `${prev.sourceIdentifier},${m.sourceIdentifier}`,
      };
    } else {
      out.push(m);
    }
  }
  return out;
}

export function markerLabel(identifier: string, fallback: string): string {
  return MARKER_LABELS[identifier] ?? fallback;
}
