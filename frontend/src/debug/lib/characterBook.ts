/**
 * 角色卡里的世界书(chara_card_v2 的 character_book)。
 *
 * 读:字段名和默认值照搬酒馆的 convertCharacterBook(world-info.js)——
 *     同一张卡在两边解析出来的条目必须一样,触发结果才可能一样。
 * 写:从原始对象出发,只覆盖被改过的字段。我们不认识的字段、别的前端写的
 *     扩展,原样带走。没动过的条目写回去和读进来时逐字节相同。
 */

/** 条目放在提示词的哪儿。数值是酒馆的 world_info_position */
export const WI_POSITION = {
  before: 0,
  after: 1,
  anTop: 2,
  anBottom: 3,
  atDepth: 4,
  emTop: 5,
  emBottom: 6,
  outlet: 7,
} as const;

/** 次要关键词的判定方式。数值是酒馆的 world_info_logic */
export const WI_LOGIC = {
  andAny: 0,
  notAll: 1,
  notAny: 2,
  andAll: 3,
} as const;

/** 指定深度的条目以什么身份插进聊天记录。数值是酒馆的 extension_prompt_roles */
export const WI_ROLE = {
  system: 0,
  user: 1,
  assistant: 2,
} as const;

export const DEFAULT_DEPTH = 4;
export const DEFAULT_WEIGHT = 100;

export const POSITION_LABELS: Record<number, string> = {
  [WI_POSITION.before]: '角色描述前',
  [WI_POSITION.after]: '角色描述后',
  [WI_POSITION.anTop]: '作者注释上',
  [WI_POSITION.anBottom]: '作者注释下',
  [WI_POSITION.atDepth]: '指定深度',
  [WI_POSITION.emTop]: '示例对话前',
  [WI_POSITION.emBottom]: '示例对话后',
  [WI_POSITION.outlet]: '自定义出口',
};

export const LOGIC_LABELS: Record<number, string> = {
  [WI_LOGIC.andAny]: '任意一个命中',
  [WI_LOGIC.andAll]: '全部命中',
  [WI_LOGIC.notAny]: '全都没命中',
  [WI_LOGIC.notAll]: '不是全部命中',
};

/** 能编辑、能参与触发的那些字段 —— 不含 uid 和 raw */
export interface CharacterBookFields {
  keys: string[];
  secondaryKeys: string[];
  comment: string;
  content: string;
  enabled: boolean;
  insertion_order: number;
  /** 常驻:不看关键词,每轮都进 */
  constant: boolean;
  /** 次要关键词是否生效 */
  selective: boolean;
  selectiveLogic: number;
  position: number;
  /** position 是指定深度时用 */
  depth: number;
  role: number;
  probability: number;
  useProbability: boolean;
  /** null = 跟全局设置 */
  scanDepth: number | null;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  /** 0 = 不延迟;N = 第 N 级递归才参与 */
  delayUntilRecursion: number;
  ignoreBudget: boolean;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  useGroupScoring: boolean | null;
  sticky: number | null;
  cooldown: number | null;
  delay: number | null;
  matchPersonaDescription: boolean;
  matchCharacterDescription: boolean;
  matchCharacterPersonality: boolean;
  matchCharacterDepthPrompt: boolean;
  matchScenario: boolean;
  matchCreatorNotes: boolean;
  outletName: string;
}

export interface CharacterBookEntry extends CharacterBookFields {
  /** 卡里的 id;没有就用下标。和酒馆一样 */
  uid: number;
  /** 读进来时的原始对象,写回去以它为底 */
  raw: Record<string, unknown>;
}

export interface CharacterBook {
  entries: CharacterBookEntry[];
  /** 世界书本身的原始对象(name、scan_depth、extensions…),entries 除外 */
  raw: Record<string, unknown>;
}

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const boolOrNull = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

function parseFields(raw: Raw): CharacterBookFields {
  const ext = isObject(raw.extensions) ? raw.extensions : {};
  const delayRec = ext.delay_until_recursion;
  return {
    keys: strings(raw.keys),
    secondaryKeys: strings(raw.secondary_keys),
    comment: str(raw.comment),
    content: str(raw.content),
    // 酒馆写的是 disable: !entry.enabled —— 没写 enabled 的条目是关着的
    enabled: Boolean(raw.enabled),
    insertion_order: num(raw.insertion_order, 0),
    constant: Boolean(raw.constant),
    selective: Boolean(raw.selective),
    selectiveLogic: num(ext.selectiveLogic, WI_LOGIC.andAny),
    // extensions.position 优先;否则只有明写 before_char 才是「前」,其余都算「后」
    position:
      typeof ext.position === 'number'
        ? ext.position
        : raw.position === 'before_char'
          ? WI_POSITION.before
          : WI_POSITION.after,
    depth: num(ext.depth, DEFAULT_DEPTH),
    role: num(ext.role, WI_ROLE.system),
    probability: num(ext.probability, 100),
    useProbability: typeof ext.useProbability === 'boolean' ? ext.useProbability : true,
    scanDepth: numOrNull(ext.scan_depth),
    caseSensitive: boolOrNull(ext.case_sensitive),
    matchWholeWords: boolOrNull(ext.match_whole_words),
    excludeRecursion: Boolean(ext.exclude_recursion),
    preventRecursion: Boolean(ext.prevent_recursion),
    delayUntilRecursion: delayRec === true ? 1 : num(delayRec, 0),
    ignoreBudget: Boolean(ext.ignore_budget),
    group: str(ext.group),
    groupOverride: Boolean(ext.group_override),
    groupWeight: num(ext.group_weight, DEFAULT_WEIGHT),
    useGroupScoring: boolOrNull(ext.use_group_scoring),
    sticky: numOrNull(ext.sticky),
    cooldown: numOrNull(ext.cooldown),
    delay: numOrNull(ext.delay),
    matchPersonaDescription: Boolean(ext.match_persona_description),
    matchCharacterDescription: Boolean(ext.match_character_description),
    matchCharacterPersonality: Boolean(ext.match_character_personality),
    matchCharacterDepthPrompt: Boolean(ext.match_character_depth_prompt),
    matchScenario: Boolean(ext.match_scenario),
    matchCreatorNotes: Boolean(ext.match_creator_notes),
    outletName: str(ext.outlet_name),
  };
}

export function parseEntry(raw: Raw, index: number): CharacterBookEntry {
  return { ...parseFields(raw), uid: num(raw.id, index), raw };
}

export function parseBook(v: unknown): CharacterBook | null {
  if (!isObject(v) || !Array.isArray(v.entries)) return null;
  const { entries, ...rest } = v;
  return {
    entries: entries.filter(isObject).map((e, i) => parseEntry(e, i)),
    raw: rest,
  };
}

/** 每个字段写回原始对象的方式。ext 是 raw.extensions(保证已存在) */
const WRITERS: { [K in keyof CharacterBookFields]: (raw: Raw, ext: Raw, v: CharacterBookFields[K]) => void } = {
  keys: (raw, _e, v) => void (raw.keys = v),
  secondaryKeys: (raw, _e, v) => void (raw.secondary_keys = v),
  comment: (raw, _e, v) => void (raw.comment = v),
  content: (raw, _e, v) => void (raw.content = v),
  enabled: (raw, _e, v) => void (raw.enabled = v),
  insertion_order: (raw, _e, v) => void (raw.insertion_order = v),
  constant: (raw, _e, v) => void (raw.constant = v),
  selective: (raw, _e, v) => void (raw.selective = v),
  selectiveLogic: (_r, ext, v) => void (ext.selectiveLogic = v),
  position: (raw, ext, v) => {
    ext.position = v;
    // 规格里的 position 只有前 / 后两种写法,其余位置只存在于 extensions
    raw.position = v === WI_POSITION.before ? 'before_char' : 'after_char';
  },
  depth: (_r, ext, v) => void (ext.depth = v),
  role: (_r, ext, v) => void (ext.role = v),
  probability: (_r, ext, v) => void (ext.probability = v),
  useProbability: (_r, ext, v) => void (ext.useProbability = v),
  scanDepth: (_r, ext, v) => void (ext.scan_depth = v),
  caseSensitive: (_r, ext, v) => void (ext.case_sensitive = v),
  matchWholeWords: (_r, ext, v) => void (ext.match_whole_words = v),
  excludeRecursion: (_r, ext, v) => void (ext.exclude_recursion = v),
  preventRecursion: (_r, ext, v) => void (ext.prevent_recursion = v),
  delayUntilRecursion: (_r, ext, v) => void (ext.delay_until_recursion = v),
  ignoreBudget: (_r, ext, v) => void (ext.ignore_budget = v),
  group: (_r, ext, v) => void (ext.group = v),
  groupOverride: (_r, ext, v) => void (ext.group_override = v),
  groupWeight: (_r, ext, v) => void (ext.group_weight = v),
  useGroupScoring: (_r, ext, v) => void (ext.use_group_scoring = v),
  sticky: (_r, ext, v) => void (ext.sticky = v),
  cooldown: (_r, ext, v) => void (ext.cooldown = v),
  delay: (_r, ext, v) => void (ext.delay = v),
  matchPersonaDescription: (_r, ext, v) => void (ext.match_persona_description = v),
  matchCharacterDescription: (_r, ext, v) => void (ext.match_character_description = v),
  matchCharacterPersonality: (_r, ext, v) => void (ext.match_character_personality = v),
  matchCharacterDepthPrompt: (_r, ext, v) => void (ext.match_character_depth_prompt = v),
  matchScenario: (_r, ext, v) => void (ext.match_scenario = v),
  matchCreatorNotes: (_r, ext, v) => void (ext.match_creator_notes = v),
  outletName: (_r, ext, v) => void (ext.outlet_name = v),
};

const FIELD_KEYS = Object.keys(WRITERS) as (keyof CharacterBookFields)[];

const same = (a: unknown, b: unknown): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

export function serializeEntry(entry: CharacterBookEntry): Raw {
  const raw = structuredClone(entry.raw);
  const original = parseFields(entry.raw);
  const changed = FIELD_KEYS.filter((k) => !same(entry[k], original[k]));
  if (changed.length === 0) return raw;

  const ext: Raw = isObject(raw.extensions) ? raw.extensions : {};
  for (const k of changed) {
    (WRITERS[k] as (raw: Raw, ext: Raw, v: unknown) => void)(raw, ext, entry[k]);
  }
  if (Object.keys(ext).length > 0) raw.extensions = ext;
  return raw;
}

export function serializeBook(book: CharacterBook | null): Raw | null {
  if (!book) return null;
  return { ...structuredClone(book.raw), entries: book.entries.map(serializeEntry) };
}

export function emptyBook(): CharacterBook {
  return { entries: [], raw: { extensions: {} } };
}

/** 新建一条。默认值照酒馆编辑器里「新条目」的样子:关键词触发、放在角色描述前 */
export function createEntry(book: CharacterBook): CharacterBookEntry {
  const uid = book.entries.reduce((max, e) => Math.max(max, e.uid), -1) + 1;
  const order = book.entries.reduce((max, e) => Math.max(max, e.insertion_order), 90) + 10;
  const raw: Raw = {
    id: uid,
    keys: [],
    secondary_keys: [],
    comment: '',
    content: '',
    constant: false,
    selective: true,
    insertion_order: order,
    enabled: true,
    position: 'before_char',
    use_regex: true,
    extensions: {
      position: WI_POSITION.before,
      depth: DEFAULT_DEPTH,
      role: WI_ROLE.system,
      probability: 100,
      useProbability: true,
      selectiveLogic: WI_LOGIC.andAny,
    },
  };
  return parseEntry(raw, uid);
}

/** 条目在列表里显示的名字:标题优先,没有就用关键词 */
export function entryTitle(e: Pick<CharacterBookEntry, 'comment' | 'keys'>): string {
  return e.comment || e.keys.join(', ') || '(无标题)';
}
