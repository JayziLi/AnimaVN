/**
 * 世界书触发:给一组条目和聊天记录,算出这一轮哪些条目进提示词、放在哪。
 *
 * 照着酒馆 1.18.0 的 checkWorldInfo(public/scripts/world-info.js)逐步移植 ——
 * 判断顺序、排序方向、预算怎么累加,连几处看着像疏漏的地方都原样保留。
 * 目标是同一张卡、同一段聊天在两边触发出同样的条目,所以别在这里「顺手优化」。
 *
 * 和酒馆不一样的地方只有这些:
 *   - 世界书只有卡里那一本,没有全局 / 聊天 / 人设世界书
 *   - 粘性、冷却要在聊天记录上存状态,还没做;带这两项的条目按普通条目处理
 *   - 正则脚本、扩展注入的文本不参与扫描
 *
 * 这个文件不碰界面也不碰 localStorage,随机数和宏替换都从外面传进来。
 */

import {
  DEFAULT_DEPTH,
  DEFAULT_WEIGHT,
  WI_LOGIC,
  WI_POSITION,
  WI_ROLE,
  entryTitle,
  type CharacterBookEntry,
} from './characterBook';

export interface WorldInfoSettings {
  /** 扫描最近几条消息 */
  scanDepth: number;
  /** 世界书最多占上下文的百分之几 */
  budgetPercent: number;
  /** 预算封顶(token),0 = 不封顶 */
  budgetCap: number;
  /** 扫描文本里每条消息前面带「名字: 」 */
  includeNames: boolean;
  /** 已触发条目的正文也拿去扫描 */
  recursive: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useGroupScoring: boolean;
  /** 0 = 不限 */
  maxRecursionSteps: number;
  /** 触发数不够就往更早的消息扫。0 = 关 */
  minActivations: number;
  /** 上一项最多扫到多深。0 = 不限 */
  minActivationsDepthMax: number;
}

/** 酒馆 default/content/settings.json 里的出厂值 */
export const DEFAULT_WORLD_INFO_SETTINGS: WorldInfoSettings = {
  scanDepth: 2,
  budgetPercent: 25,
  budgetCap: 0,
  includeNames: true,
  recursive: true,
  caseSensitive: false,
  matchWholeWords: true,
  useGroupScoring: false,
  maxRecursionSteps: 0,
  minActivations: 0,
  minActivationsDepthMax: 0,
};

/** 聊天记录以外、条目可以选择一并扫描的文本 */
export interface WorldInfoScanData {
  personaDescription: string;
  characterDescription: string;
  characterPersonality: string;
  characterDepthPrompt: string;
  scenario: string;
  creatorNotes: string;
}

export interface WorldInfoInput {
  entries: CharacterBookEntry[];
  /** 要扫描的消息,**新的在前** */
  messages: string[];
  scanData: WorldInfoScanData;
  settings: WorldInfoSettings;
  /** 上下文大小。null = 没设上限,这时只有 budgetCap 管得住预算 */
  maxContext: number | null;
  random: () => number;
  substitute: (text: string) => string;
  countTokens: (text: string) => number;
  /** 这次是哪种生成(normal / swipe / continue …)。条目可以限定只在某几种下触发。默认 normal */
  trigger?: string;
}

/** 一条条目这一轮的下场 —— 检查器和编辑界面都读它 */
export interface WorldInfoRow {
  uid: number;
  title: string;
  activated: boolean;
  /** 给人看的原因:为什么触发 / 为什么没触发 */
  reason: string;
  position: number;
  /** 触发了但没地方放(自定义出口)时是 false */
  placed: boolean;
  tokens: number;
  /** 这条用到了还没实现的功能 */
  note: string | null;
}

export interface WorldInfoDepthBlock {
  depth: number;
  role: number;
  content: string;
}

export interface WorldInfoResult {
  before: string;
  after: string;
  examples: { position: 'before' | 'after'; content: string }[];
  depth: WorldInfoDepthBlock[];
  /** 挂在作者注释上下的条目。我们没有作者注释,由组装器放到它的默认位置 */
  authorNote: string;
  /** 位置是「自定义出口」的条目,按出口名归拢。预设里写 {{outlet::名字}} 的地方取它 */
  outlets: Record<string, string>;
  rows: WorldInfoRow[];
  /** 预算(token)。null = 没有上限 */
  budget: number | null;
  overflowed: boolean;
  /** 扫描跑了几轮 */
  loops: number;
}

export const EMPTY_WORLD_INFO: WorldInfoResult = {
  before: '',
  after: '',
  examples: [],
  depth: [],
  authorNote: '',
  outlets: {},
  rows: [],
  budget: null,
  overflowed: false,
  loops: 0,
};

const MAX_SCAN_DEPTH = 1000;
const KNOWN_DECORATORS = ['@@activate', '@@dont_activate'];

const SCAN = { none: 0, initial: 1, recursion: 2, minActivations: 3 } as const;
type ScanState = (typeof SCAN)[keyof typeof SCAN];

/** 扫描过程里用的条目:正文会被摘掉装饰行、替换宏,所以另存一份,不动传进来的对象 */
interface Working {
  e: CharacterBookEntry;
  decorators: string[];
  content: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

/** `/表达式/标志` → RegExp;不是这个格式、或者语法不对,返回 null */
export function parseRegexFromString(input: string): RegExp | null {
  const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
  if (!match) return null;
  let [, pattern] = match;
  const flags = match[2];
  // 表达式里没转义的斜杠:在别的引擎里这不是合法的分隔写法,酒馆当它不是正则
  if (pattern.match(/(^|[^\\])\//)) return null;
  pattern = pattern.replace('\\/', '/');
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * 关键词输入框里的一串字 → 关键词数组。逗号分隔,但 `/正则/` 里面的逗号不切。
 * 对应酒馆的 splitKeywordsAndRegexes。
 */
export function splitKeys(input: string): string[] {
  const out: string[] = [];
  let current = input;
  let insideRegex = false;
  let regexClosed = false;

  for (let i = 0; i < current.length; i++) {
    const char = current[i];
    if (char === '/' && (i === 0 || current[i - 1] !== '\\')) {
      if (!insideRegex) insideRegex = true;
      else if (!regexClosed) regexClosed = true;
    }
    if (char !== ',') continue;
    if (insideRegex && !regexClosed) continue;

    const token = current.slice(0, i).trim();
    if (token) {
      if (token.startsWith('/') && !parseRegexFromString(token)) {
        out.push(...token.split(',').map((x) => x.trim()).filter(Boolean));
      } else {
        out.push(token);
      }
    }
    current = current.slice(i + 1);
    insideRegex = false;
    regexClosed = false;
    i = -1;
  }

  const rest = current.trim();
  if (rest) out.push(rest);
  return out;
}

function parseDecorators(content: string): [string[], string] {
  if (!content.startsWith('@@')) return [[], content];

  const isKnown = (line: string) => {
    const data = line.startsWith('@@@') ? line.substring(1) : line;
    return KNOWN_DECORATORS.some((d) => data.startsWith(d));
  };

  let rest = content;
  const lines = content.split('\n');
  const decorators: string[] = [];
  let fallbacked = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('@@')) {
      rest = lines.slice(i).join('\n');
      break;
    }
    if (line.startsWith('@@@') && !fallbacked) continue;
    if (isKnown(line)) {
      decorators.push(line.startsWith('@@@') ? line.substring(1) : line);
      fallbacked = false;
    } else {
      fallbacked = true;
    }
  }
  return [decorators, rest];
}

class ScanBuffer {
  private depthBuffer: string[] = [];
  private recurseBuffer: string[] = [];
  private skew = 0;
  private scanData: WorldInfoScanData;
  private settings: WorldInfoSettings;

  constructor(messages: string[], scanData: WorldInfoScanData, settings: WorldInfoSettings) {
    this.depthBuffer = messages.slice(0, MAX_SCAN_DEPTH).map((m) => m.trim());
    this.scanData = scanData;
    this.settings = settings;
  }

  get(e: CharacterBookEntry, state: ScanState): string {
    let depth = e.scanDepth ?? this.getDepth();
    // 扫描条数是 0 的条目什么都扫不到,连角色描述那几项也不扫 —— 酒馆就是这样
    if (depth <= 0) return '';
    if (depth > MAX_SCAN_DEPTH) depth = MAX_SCAN_DEPTH;

    // 每段前面垫一个 \x01,正则关键词可以拿它锚定「一条消息的开头」
    const MATCHER = '\x01';
    const JOINER = '\n' + MATCHER;
    let result = MATCHER + this.depthBuffer.slice(0, depth).join(JOINER);

    const d = this.scanData;
    if (e.matchPersonaDescription && d.personaDescription) result += JOINER + d.personaDescription;
    if (e.matchCharacterDescription && d.characterDescription)
      result += JOINER + d.characterDescription;
    if (e.matchCharacterPersonality && d.characterPersonality)
      result += JOINER + d.characterPersonality;
    if (e.matchCharacterDepthPrompt && d.characterDepthPrompt)
      result += JOINER + d.characterDepthPrompt;
    if (e.matchScenario && d.scenario) result += JOINER + d.scenario;
    if (e.matchCreatorNotes && d.creatorNotes) result += JOINER + d.creatorNotes;

    // 为凑够最少触发数而加深扫描的那几轮,不看递归文本
    if (this.recurseBuffer.length > 0 && state !== SCAN.minActivations) {
      result += JOINER + this.recurseBuffer.join(JOINER);
    }
    return result;
  }

  matchKeys(haystack: string, needle: string, e: CharacterBookEntry): boolean {
    const regex = parseRegexFromString(needle);
    if (regex) return regex.test(haystack);

    const caseSensitive = e.caseSensitive ?? this.settings.caseSensitive;
    const hay = caseSensitive ? haystack : haystack.toLowerCase();
    const key = caseSensitive ? needle : needle.toLowerCase();

    if (e.matchWholeWords ?? this.settings.matchWholeWords) {
      if (key.split(/\s+/).length > 1) return hay.includes(key);
      // \W 把标点和中日韩文字都算作边界,所以中文关键词实际上是子串匹配
      return new RegExp(`(?:^|\\W)(${escapeRegex(key)})(?:$|\\W)`).test(hay);
    }
    return hay.includes(key);
  }

  addRecurse(text: string) {
    this.recurseBuffer.push(text);
  }

  hasRecurse(): boolean {
    return this.recurseBuffer.length > 0;
  }

  advanceScan() {
    this.skew++;
  }

  getDepth(): number {
    return this.settings.scanDepth + this.skew;
  }

  getScore(e: CharacterBookEntry, state: ScanState): number {
    const text = this.get(e, state);
    const primary = e.keys.filter((k) => this.matchKeys(text, k, e)).length;
    const secondary = e.secondaryKeys.filter((k) => this.matchKeys(text, k, e)).length;

    if (e.keys.length === 0) return 0;
    if (e.secondaryKeys.length > 0) {
      if (e.selectiveLogic === WI_LOGIC.andAny) return primary + secondary;
      if (e.selectiveLogic === WI_LOGIC.andAll) {
        return secondary === e.secondaryKeys.length ? primary + secondary : primary;
      }
    }
    return primary;
  }
}

const byOrderDesc = (a: Working, b: Working) => b.e.insertion_order - a.e.insertion_order;

export function activateWorldInfo(input: WorldInfoInput): WorldInfoResult {
  const { entries, messages, scanData, settings, maxContext, random, substitute, countTokens } =
    input;

  let budget: number | null =
    maxContext === null ? null : Math.round((settings.budgetPercent * maxContext) / 100) || 1;
  if (settings.budgetCap > 0 && (budget === null || budget > settings.budgetCap)) {
    budget = settings.budgetCap;
  }

  // 数组、对象都另起一份:浅拷贝会让每次结果共用模块里那几个空数组,哪天有人原地 push / sort 就串了
  if (entries.length === 0) {
    return { ...EMPTY_WORLD_INFO, examples: [], depth: [], outlets: {}, rows: [], budget };
  }

  const buffer = new ScanBuffer(messages, scanData, settings);
  const sorted: Working[] = entries
    .map((e): Working => {
      const [decorators, content] = parseDecorators(e.content || '');
      return { e, decorators, content };
    })
    .sort(byOrderDesc);

  const reasons = new Map<Working, string>();
  const activated = new Map<number, Working>();
  const activatedWhy = new Map<Working, string>();
  const failedProbability = new Set<Working>();

  let state: ScanState = SCAN.initial;
  let overflowed = false;
  let count = 0;
  let activatedText = '';

  const delayLevels = [
    ...new Set(sorted.filter((w) => w.e.delayUntilRecursion).map((w) => w.e.delayUntilRecursion)),
  ].sort((a, b) => a - b);
  let currentDelayLevel = delayLevels.shift() ?? 0;

  while (state) {
    if (settings.maxRecursionSteps && settings.maxRecursionSteps <= count) break;
    count++;

    let next: ScanState = SCAN.none;
    const now = new Set<Working>();
    const inRecursion = state === SCAN.recursion;

    for (const w of sorted) {
      const { e } = w;
      if (failedProbability.has(w) || activated.has(e.uid)) continue;

      if (!e.enabled) {
        reasons.set(w, '条目已关闭');
        continue;
      }

      const triggers = triggersOf(e);
      if (triggers.length > 0 && !triggers.includes(input.trigger || 'normal')) {
        reasons.set(w, `只在这些生成方式下触发:${triggers.join('、')}`);
        continue;
      }

      if (e.delay && messages.length < e.delay) {
        reasons.set(w, `聊天满 ${e.delay} 条才参与,现在 ${messages.length} 条`);
        continue;
      }

      if (!inRecursion && e.delayUntilRecursion) {
        reasons.set(w, '只在递归扫描时参与');
        continue;
      }
      if (inRecursion && e.delayUntilRecursion && e.delayUntilRecursion > currentDelayLevel) {
        reasons.set(w, `等第 ${e.delayUntilRecursion} 级递归`);
        continue;
      }
      if (inRecursion && settings.recursive && e.excludeRecursion) {
        // 不覆盖第一轮留下的原因 —— 「没命中关键词」比这句有用
        if (!reasons.has(w)) reasons.set(w, '不参与递归扫描');
        continue;
      }

      if (w.decorators.includes('@@activate')) {
        activatedWhy.set(w, '正文开头写了 @@activate');
        now.add(w);
        continue;
      }
      if (w.decorators.includes('@@dont_activate')) {
        reasons.set(w, '正文开头写了 @@dont_activate');
        continue;
      }

      if (e.constant) {
        activatedWhy.set(w, '常驻');
        now.add(w);
        continue;
      }

      if (e.keys.length === 0) {
        reasons.set(w, '不是常驻,也没有关键词');
        continue;
      }

      const text = buffer.get(e, state);
      const hit = (key: string) => {
        const s = substitute(key);
        return Boolean(s) && buffer.matchKeys(text, s.trim(), e);
      };

      const primary = e.keys.find(hit);
      if (!primary) {
        reasons.set(w, '没有命中关键词');
        continue;
      }
      const via = inRecursion ? `命中「${primary}」(递归)` : `命中「${primary}」`;

      if (!(e.selective && e.secondaryKeys.length > 0)) {
        activatedWhy.set(w, via);
        now.add(w);
        continue;
      }

      const matches = e.secondaryKeys.map(hit);
      const any = matches.some(Boolean);
      const all = matches.every(Boolean);
      const logic = e.selectiveLogic;
      const passed =
        (logic === WI_LOGIC.andAny && any) ||
        (logic === WI_LOGIC.notAll && !all) ||
        (logic === WI_LOGIC.notAny && !any) ||
        (logic === WI_LOGIC.andAll && all);

      if (!passed) {
        reasons.set(w, `命中「${primary}」,但次要关键词不满足`);
        continue;
      }
      activatedWhy.set(w, `${via},次要关键词满足`);
      now.add(w);
    }

    const fresh = [...now].sort((a, b) => sorted.indexOf(a) - sorted.indexOf(b));

    let newContent = '';
    const scannedTokens = countTokens(activatedText);

    filterByInclusionGroups(fresh, activated, buffer, state, settings, random, reasons);

    let ignoresBudget = fresh.filter((w) => w.e.ignoreBudget).length;

    for (const w of fresh) {
      const { e } = w;
      ignoresBudget -= e.ignoreBudget ? 1 : 0;
      if (overflowed && !e.ignoreBudget) {
        reasons.set(w, '超出世界书预算');
        if (ignoresBudget > 0) continue;
        break;
      }

      if (e.useProbability && e.probability !== 100 && random() * 100 > e.probability) {
        failedProbability.add(w);
        reasons.set(w, `概率 ${e.probability}%,这一轮没掷中`);
        continue;
      }

      w.content = substitute(w.content);
      newContent += `${w.content}\n`;

      if (!e.ignoreBudget && budget !== null && scannedTokens + countTokens(newContent) >= budget) {
        overflowed = true;
        reasons.set(w, '超出世界书预算');
        continue;
      }

      activated.set(e.uid, w);
    }
    // 上面 break 掉之后剩下的那些,同样是被预算挡住的
    if (overflowed) {
      for (const w of fresh) {
        if (!activated.has(w.e.uid) && !failedProbability.has(w)) {
          reasons.set(w, '超出世界书预算');
        }
      }
    }

    // 酒馆这里没有排除被预算挡掉的条目 —— 它们的正文照样进递归文本。原样保留
    const successful = fresh.filter((w) => !failedProbability.has(w));
    const forRecursion = successful.filter((w) => !w.e.preventRecursion);

    if (settings.recursive && !overflowed && forRecursion.length > 0) {
      next = SCAN.recursion;
    }
    if (
      settings.recursive &&
      !overflowed &&
      state === SCAN.minActivations &&
      buffer.hasRecurse()
    ) {
      next = SCAN.recursion;
    }

    const notEnough = settings.minActivations > 0 && activated.size < settings.minActivations;
    if (!next && !overflowed && notEnough) {
      const overMax =
        (settings.minActivationsDepthMax > 0 &&
          buffer.getDepth() > settings.minActivationsDepthMax) ||
        buffer.getDepth() > messages.length;
      if (!overMax) {
        next = SCAN.minActivations;
        buffer.advanceScan();
      }
    }

    if (next === SCAN.none && delayLevels.length > 0) {
      next = SCAN.recursion;
      currentDelayLevel = delayLevels.shift() ?? currentDelayLevel;
    }

    state = next;
    if (state) {
      const text = forRecursion.map((w) => w.content).join('\n');
      if (text) {
        buffer.addRecurse(text);
        activatedText = `${text}\n${activatedText}`;
      }
    }
  }

  // ---- 分发到各个位置 ----
  // 顺序号从大到小走一遍,每条往数组头上塞 —— 最后是顺序号小的在前
  const before: string[] = [];
  const after: string[] = [];
  const examples: WorldInfoResult['examples'] = [];
  const anTop: string[] = [];
  const anBottom: string[] = [];
  const depthGroups: { depth: number; role: number; entries: string[] }[] = [];
  // 没有原型的对象:出口名 / 分组名写成 constructor、toString 时 ??= 不能摸到 Object 原型上的函数
  const outletGroups: Record<string, string[]> = Object.create(null);
  const unplaced = new Set<Working>();

  for (const w of [...activated.values()].sort(byOrderDesc)) {
    const { e, content } = w;
    if (!content) {
      unplaced.add(w);
      reasons.set(w, '触发了,但正文是空的');
      continue;
    }
    switch (e.position) {
      case WI_POSITION.before:
        before.unshift(content);
        break;
      case WI_POSITION.after:
        after.unshift(content);
        break;
      case WI_POSITION.emTop:
        examples.unshift({ position: 'before', content });
        break;
      case WI_POSITION.emBottom:
        examples.unshift({ position: 'after', content });
        break;
      case WI_POSITION.anTop:
        anTop.unshift(content);
        break;
      case WI_POSITION.anBottom:
        anBottom.unshift(content);
        break;
      case WI_POSITION.atDepth: {
        const depth = e.depth ?? DEFAULT_DEPTH;
        const role = e.role ?? WI_ROLE.system;
        const group = depthGroups.find((g) => g.depth === depth && g.role === role);
        if (group) group.entries.unshift(content);
        else depthGroups.push({ depth, role, entries: [content] });
        break;
      }
      case WI_POSITION.outlet:
        if (!e.outletName) {
          unplaced.add(w);
          reasons.set(w, '触发了,但位置是「自定义出口」却没写出口名,没有进提示词');
          break;
        }
        // 这里酒馆用的是 push:同一个出口里顺序号大的在前,和别的位置相反
        (outletGroups[e.outletName] ??= []).push(content);
        break;
      default:
        unplaced.add(w);
        reasons.set(w, `触发了,但位置 ${e.position} 不认识,没有进提示词`);
    }
  }

  const depth: WorldInfoDepthBlock[] = depthGroups.map((g) => ({
    depth: g.depth,
    role: g.role,
    content: g.entries.join('\n'),
  }));
  const authorNote = [...anTop, ...anBottom].join('\n');

  const rows: WorldInfoRow[] = sorted
    .map((w): WorldInfoRow => {
      const isActivated = activated.has(w.e.uid) && activated.get(w.e.uid) === w;
      const placed = isActivated && !unplaced.has(w);
      return {
        uid: w.e.uid,
        title: entryTitle(w.e),
        activated: isActivated,
        reason: placed
          ? (activatedWhy.get(w) ?? '触发')
          : (reasons.get(w) ?? '没有命中关键词'),
        position: w.e.position,
        placed,
        tokens: placed ? countTokens(w.content) : 0,
        note: w.e.sticky || w.e.cooldown ? '粘性 / 冷却还没实现,这条按普通条目处理' : null,
      };
    })
    .sort((a, b) => Number(b.placed) - Number(a.placed));

  return {
    before: before.join('\n'),
    after: after.join('\n'),
    examples,
    depth,
    authorNote,
    outlets: Object.fromEntries(
      Object.entries(outletGroups).map(([name, parts]) => [name, parts.join('\n')]),
    ),
    rows,
    budget,
    overflowed,
    loops: count,
  };
}

function triggersOf(e: CharacterBookEntry): string[] {
  const ext = e.raw.extensions;
  if (typeof ext !== 'object' || ext === null) return [];
  const t = (ext as Record<string, unknown>).triggers;
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
}

/** 互斥分组:同一组里这一轮只留一条。fresh 会被就地删改 */
function filterByInclusionGroups(
  fresh: Working[],
  activated: Map<number, Working>,
  buffer: ScanBuffer,
  state: ScanState,
  settings: WorldInfoSettings,
  random: () => number,
  reasons: Map<Working, string>,
) {
  const groups: Record<string, Working[]> = Object.create(null);
  for (const w of fresh) {
    if (!w.e.group) continue;
    for (const name of w.e.group.split(/,\s*/).filter(Boolean)) {
      (groups[name] ??= []).push(w);
    }
  }
  if (Object.keys(groups).length === 0) return;

  const remove = (w: Working, why: string) => {
    const i = fresh.indexOf(w);
    if (i !== -1) fresh.splice(i, 1);
    reasons.set(w, why);
  };

  // 按命中关键词的个数筛一遍:分数不是最高的出局
  for (const [name, group] of Object.entries(groups)) {
    if (!settings.useGroupScoring && !group.some((w) => w.e.useGroupScoring)) continue;
    const scores = group.map((w) => buffer.getScore(w.e, state));
    const max = Math.max(...scores);
    for (let i = 0; i < group.length; i++) {
      if (!(group[i].e.useGroupScoring ?? settings.useGroupScoring)) continue;
      if (scores[i] < max) {
        remove(group[i], `互斥分组「${name}」里命中的关键词不是最多的`);
        group.splice(i, 1);
        scores.splice(i, 1);
        i--;
      }
    }
  }

  for (const [name, group] of Object.entries(groups)) {
    const lost = `互斥分组「${name}」里落选`;

    if ([...activated.values()].some((w) => w.e.group === name)) {
      for (const w of group) remove(w, `互斥分组「${name}」这一轮已经有条目了`);
      continue;
    }
    if (group.length <= 1) continue;

    const keepOnly = (winner: Working) => {
      for (const w of group) if (w !== winner) remove(w, lost);
    };

    const prios = group.filter((w) => w.e.groupOverride).sort(byOrderDesc);
    if (prios.length > 0) {
      keepOnly(prios[0]);
      continue;
    }

    const total = group.reduce((sum, w) => sum + (w.e.groupWeight ?? DEFAULT_WEIGHT), 0);
    const roll = random() * total;
    let current = 0;
    let winner: Working | null = null;
    for (const w of group) {
      current += w.e.groupWeight ?? DEFAULT_WEIGHT;
      if (roll <= current) {
        winner = w;
        break;
      }
    }
    if (winner) keepOnly(winner);
  }
}
