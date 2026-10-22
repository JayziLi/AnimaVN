/**
 * 外语插件 —— 日语配音、中文字幕。
 *
 * 主模型按「一行日语,下一行是它的中文」交替写(旁白和台词都这样,不加标签)。这里做三件事:
 *   1. 认出日语行:假名占得够多的行(looksJapanese —— 中文里留的片假名名字、零星假名不算);
 *      兜底是「下一行和它是同一句」的那行(「……」「……」这种)
 *   2. 把日语从正文里摘掉,挂到它下面那句中文上;剩下的中文照原来的 parseReply 切句,
 *      规则一条不改
 *   3. 念哪种:看声音的 text_lang(speechText)
 *
 * 模型不总守格式,能兜的都兜住:多空几行、日中之间隔空行、中文里夹假名、偶尔先中后日、
 * 日语行里混进一句中文、「日语」写成了中文。兜不住的(漏了中文 / 漏了日语)照原样显示
 *
 * 插件本身只有提示词模板和「显示日语」开关,全局一份,存在后端 app_settings(键 plugin.lang)。
 * 提示词块写进预设,identifier 固定为 anima_lang,正文跟着插件模板同步(和立绘插件一样)。
 * 规则见 docs/superpowers/specs/2026-09-25-lang-plugin-bilingual-design.md
 */

import type { PresetOrderEntry, TavernPreset } from '../lib/presetParser';
import { extractTags, parseReply, type ParsedReply, type TagKind, type VNLine } from '../vn/script';
import { insertPluginBlock, pluginBlockState, type BlockState } from './common';
import { PLUGIN } from './registry';

export const LANG_SETTING_KEY = PLUGIN.lang.settingKey;
export const LANG_BLOCK_ID = PLUGIN.lang.blockId;

export const DEFAULT_LANG_BLOCK_PROMPT = `[双语输出]
这是日语配音、中文字幕的视觉小说。整条回复（旁白和台词）都要日中对照着写：
- 每一段先写一行日语，紧接着下一行写这段的中文。一行日语对应一行中文，先日后中。
- 台词单独成行，日语和中文都用「」括起来。
- 中文以日语为参考来写：保留一点翻译腔，同时通顺、自然、优美。
- 中文里不要夹杂假名；日语那一行不要写任何标签。
- 立绘、场景、音乐标签写在这一对（日语 + 中文）的前面。

示例：
<sprite:微笑>
「おかえり。今日も一日、お疲れさま。」
「欢迎回来。今天也辛苦啦。」

彼女はそう言って、ソファの端に寄って場所を空けた。
她说着，往沙发边上挪了挪，给他让出位置。`;

/**
 * Jev 标注开着时发出去的版本:标签交给 Jev 标,提示词里一个标签都不提(提了模型就会照着写)。
 * 用户改过模板时不用它,见 plugins/jev.ts 的 jevLangPrompt
 */
export const DEFAULT_LANG_BLOCK_PROMPT_JEV = `[双语输出]
这是日语配音、中文字幕的视觉小说。整条回复（旁白和台词）都要日中对照着写：
- 每一段先写一行日语，紧接着下一行写这段的中文。一行日语对应一行中文，先日后中。
- 台词单独成行，日语和中文都用「」括起来。
- 中文以日语为参考来写：保留一点翻译腔，同时通顺、自然、优美。
- 中文里不要夹杂假名。

示例：
「おかえり。今日も一日、お疲れさま。」
「欢迎回来。今天也辛苦啦。」

彼女はそう言って、ソファの端に寄って場所を空けた。
她说着，往沙发边上挪了挪，给他让出位置。`;

export interface LangPluginConfig {
  /** 「加入当前预设」时写进块里的内容;预设里的这块始终跟着它 */
  blockPrompt: string;
  /** 视觉小说里在中文上方显示日语 */
  showJa: boolean;
  /** 预设里完全没有外语块时,组装这次自动补上(core/assembly.ts)。按卡设,默认关(设计稿 2.7、3.9) */
  autoFill: boolean;
}

export const DEFAULT_LANG_CONFIG: LangPluginConfig = {
  blockPrompt: DEFAULT_LANG_BLOCK_PROMPT,
  showJa: true,
  autoFill: false,
};

/** 后端存的是任意 JSON —— 缺字段或类型不对的就退回默认值 */
export function normalizeLangConfig(raw: unknown): LangPluginConfig {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_LANG_CONFIG;
  return {
    blockPrompt: typeof r.blockPrompt === 'string' ? r.blockPrompt : d.blockPrompt,
    showJa: typeof r.showJa === 'boolean' ? r.showJa : d.showJa,
    autoFill: typeof r.autoFill === 'boolean' ? r.autoFill : d.autoFill,
  };
}

export const langBlockState = (
  preset: TavernPreset | null,
  order: readonly PresetOrderEntry[],
): BlockState => pluginBlockState(preset, order, LANG_BLOCK_ID);

/** 外语块在预设里的名字 */
export const LANG_BLOCK_NAME = '外语指令 · 插件';

/** 把外语块加进预设(插在哪见 insertPluginBlock) */
export const insertLangBlock = (preset: TavernPreset, groupIndex: number, content: string) =>
  insertPluginBlock(preset, groupIndex, {
    identifier: LANG_BLOCK_ID,
    name: LANG_BLOCK_NAME,
    content,
  });

// ---- 认日语 ----

/** 平假名、片假名(含长音「ー」;不含中文名字里也会用的间隔号「・」) */
const KANA_RE = /[ぁ-ゖゝ-ゟァ-ヺー-ヿㇰ-ㇿ]/;
export const hasKana = (text: string) => KANA_RE.test(text);
const KANA_G = new RegExp(KANA_RE.source, 'g');
const HAN_G = /\p{Script=Han}/gu;
const countOf = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

/** 片假名写的名字,可以带平假名的称呼(リエちゃん、カナミさん) */
const KANA_NAME_RE = /[ァ-ヺー-ヿㇰ-ㇿ]+(?:ちゃん|ちゃま|さん|くん|さま|たん|せんぱい|せんせい)?/g;
/**
 * 只有简体中文这么写的常用字:日语里要么写成别的字形(們、這、説、売……),要么根本不用
 * (吗、呢、吧、你、啊)。有它就说明这段是中文
 */
const ZH_ONLY_RE =
  /[她们这说还让给吗呢吧么啊哦嗯啦呀你个对为时话样边过见觉听头东车门问间开关进连实经书长无从卖买发气动现电脸讲认饭岁爱欢谢请应该马两哪轻响虽张场乐难题钱错远运选带总许读语课谁纸细红绿线结终练热]/;

/**
 * 这行是不是日语。模型常在中文行里留几个假名,光看有没有假名会把中文当成日语、日中配不上对:
 *   - 没译的片假名名字:「真的吗？リエちゃん能……」
 *   - 中文里的零星假名:句尾的「……っ」、「卖ほうじ茶的那家」
 * afterJa:上一个非空行是还没配上中文的日语 —— 这时候这行按理该是中文
 *
 * 实测(191 条双语回复):五千多行日语里假名最少也占三成(「言い訳は却下。」),
 * 夹了假名的中文行最多两成半
 */
function looksJapanese(text: string, afterJa: boolean): boolean {
  if (!hasKana(text)) return false;
  const core = text.replace(KANA_NAME_RE, '');
  const kana = countOf(core, KANA_G);
  // 假名只有片假名名字:跟在日语后面的、带简体字的,是留着名字没译的中文;
  // 别的(「カナミ、参上！」)是只写了名字的日语
  if (kana === 0) return !afterJa && !ZH_ONLY_RE.test(text);
  // 假名不到三成的,跟在日语后面、或者带简体字,是夹了假名的中文。
  // 汉字特别多的日语(「東京駅前、午後三時に集合。」)不带简体字,仍然算日语
  const few = kana < (kana + countOf(core, HAN_G)) * 0.3;
  return !(few && (afterJa || ZH_ONLY_RE.test(core)));
}

/** 比两行是不是同一句:引号、标点、空白不算。去掉以后什么都不剩的(「……」「——」)要一字不差 */
const NOT_WORDS_G = /[\s「」『』“”"'‘’，,。.！!？?、…~～—-]/g;
function sameLine(a: string, b: string): boolean {
  const x = a.replace(NOT_WORDS_G, '');
  return x ? x === b.replace(NOT_WORDS_G, '') : a === b;
}

/**
 * 挂到中文上的日语:混进来的中文句子(没有假名、带简体字)去掉,只留日语念和显示。
 * 模型偶尔把一句中文写进日语行(「今夜は、よく歩いたね。你的腿，一定也很累了吧。」);
 * 「日语行」其实是中文写了两遍的,整行去掉,返回空串
 */
function cleanJa(ja: string): string {
  // 整行没有假名(兜底认出来的):带简体字就是中文写了两遍,不带的(「……」、全汉字的日语)照留
  if (!hasKana(ja)) return ZH_ONLY_RE.test(ja) ? '' : ja;
  const parts = ja.match(/[^。！？!?…]*[。！？!?…]+[」』”]*|[^。！？!?…]+$/g) ?? [ja];
  const kept = parts.filter((p) => hasKana(p) || !ZH_ONLY_RE.test(p));
  if (kept.length === parts.length) return ja;
  let out = kept.join('').trim();
  // 句子切在引号里面的,补上跟着中文句子一起去掉的收尾引号
  for (const [open, close] of ['「」', '『』', '“”']) {
    if (out.startsWith(open) && !out.includes(close)) out += close;
  }
  return out;
}

/** 这一行是不是台词(引号开头) —— 先中后日的一对,两行要么都是台词、要么都是旁白 */
const isQuoted = (text: string) => /^[「『“"]/.test(text);

/** 声音的 text_lang 是不是日语(GSV 的 ja / all_ja) */
export const isJaLang = (lang: string) => /(^|_)ja$/i.test(lang.trim());

interface Row {
  /** 这一行在原文里的起止(不含换行符) */
  start: number;
  end: number;
  /** 摘掉标签、去掉首尾空白后的内容 */
  content: string;
  /** 这一行里的标签原文和它在原文里的位置 */
  tags: { raw: string; at: number }[];
  /** 空行(只有标签的也算) / 日语 / 正文 */
  kind: 'blank' | 'ja' | 'text';
}

function splitRows(raw: string, kinds: readonly TagKind[], streaming: boolean): Row[] {
  const parts = raw.split('\n');
  const rows: Row[] = [];
  let start = 0;
  parts.forEach((line, i) => {
    // 流式时只有最后一行可能写着半个标签
    const { text, tags } = extractTags(line, kinds, streaming && i === parts.length - 1);
    const content = text.trim();
    let from = 0;
    const found = tags.map((t) => {
      const at = line.indexOf(t.raw, from);
      from = at + t.raw.length;
      return { raw: t.raw, at: start + at };
    });
    rows.push({ start, end: start + line.length, content, tags: found, kind: content ? 'text' : 'blank' });
    start += line.length + 1;
  });
  // 空行随便多空几行都不影响:认日语、配对都只看非空行
  let afterJa = false;
  for (const r of rows) {
    if (r.kind === 'blank') continue;
    r.kind = looksJapanese(r.content, afterJa) ? 'ja' : 'text';
    afterJa = r.kind === 'ja';
  }
  // 兜底:日语碰巧一个假名都没有(「……」、全是汉字的短句),模型会把同一行写两遍 ——
  // 下一行和它是同一句(只差引号、标点也算),前一行就是日语。模型把旁白的「日语」也写成
  // 中文时也是这样,这种挂上去时会被 cleanJa 整行去掉,只显示一遍。
  // 整条回复一行日语都没有时不这么认,免得误伤纯中文
  if (rows.some((r) => r.kind === 'ja')) {
    rows.forEach((r, i) => {
      if (r.kind !== 'text') return;
      const next = rows.find((x, k) => k > i && x.kind !== 'blank');
      if (next && next.kind === 'text' && sameLine(r.content, next.content)) r.kind = 'ja';
    });
  }
  return rows;
}

/**
 * 每行日语的去向:挂到它下面那行中文上;写反了的(先中后日)挂到上面那行;前后都没有能配的中文的
 * 留在正文里(orphan);流式时最后一行是正在写的日语(pending)
 */
function pairRows(rows: readonly Row[], streaming: boolean) {
  const jaOf = new Map<number, string>(); // 正文行 → 挂在它上面的日语
  const orphan = new Set<number>(); // 没有中文的日语行:留在正文里
  let pending: string | null = null; // 流式:正在写、中文还没开始的日语
  const nextRow = (i: number) => rows.findIndex((x, k) => k > i && x.kind !== 'blank');
  const prevRow = (i: number) => rows.findLastIndex((x, k) => k < i && x.kind !== 'blank');
  rows.forEach((r, i) => {
    if (r.kind !== 'ja') return;
    const next = nextRow(i);
    const prev = prevRow(i);
    if (next !== -1 && rows[next].kind === 'text') {
      jaOf.set(next, cleanJa(r.content));
    } else if (next === -1 && streaming) {
      pending = r.content;
    } else if (
      // 先中后日写反了:上面那行中文还没配上日语,两行又都是台词或都是旁白
      prev !== -1 &&
      rows[prev].kind === 'text' &&
      !jaOf.has(prev) &&
      isQuoted(rows[prev].content) === isQuoted(r.content)
    ) {
      jaOf.set(prev, cleanJa(r.content));
    } else {
      orphan.add(i);
    }
  });
  return { jaOf, orphan, pending: pending as string | null };
}

/**
 * 摘掉回复里挂在中文上的日语行(「隐藏前文日语」发给模型的那份,plugins/jaHide.ts)。
 * 行里的标签留在原位(它们管的是下面那句中文);只剩标签的行不再单占一行,并到下一行开头。
 * 没配上中文的日语(模型只写了日语)和画面上一样留着 —— 摘了这段就没了。没有日语的回复原样返回
 */
export function stripJa(raw: string, tags: readonly TagKind[]): string {
  const rows = splitRows(raw, tags, false);
  if (!rows.some((r) => r.kind === 'ja')) return raw;
  const { orphan } = pairRows(rows, false);
  const out: string[] = [];
  let carry = ''; // 摘掉的日语行里的标签,接到下一行开头
  rows.forEach((r, i) => {
    if (r.kind === 'ja' && !orphan.has(i)) {
      carry += r.tags.map((t) => t.raw).join('');
      return;
    }
    const line = raw.slice(r.start, r.end);
    out.push(carry && line.trim() ? carry + line : line);
    if (line.trim()) carry = '';
  });
  if (carry) out.push(carry);
  // 日语和中文之间、日中两对之间本来的空行:摘完以后连着的空行并成一行
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * 切一条回复,同时把日语挂到句子上。没有日语的回复和 parseReply 完全一样。
 *
 * 日语行从正文里摘掉(行里的标签留在原位,仍然作用到下面那句中文),挂在它下面紧跟的
 * 那行中文切出来的第一句上。写反了的(先中后日)挂到上面那行中文上。前后都没有能配的
 * 中文,这行日语就当正文显示(jaOnly)。流式时最后一行是正在写的日语,先追加一句空的
 * 中文带着它,中文开始写以后还是这一句(序号不变)。
 *
 * ends 换算回原文里的位置,插话截断直接用;日中交替写,截到哪句,后面的日语一起截掉。
 */
export function parseBilingual(
  raw: string,
  opts: {
    charName: string;
    userName: string;
    tags: readonly TagKind[];
    streaming: boolean;
    /** 见 parseReply:Jev 标过的回复 / Jev 没判过的句子 */
    strict?: boolean;
    loose?: ReadonlySet<number>;
  },
): ParsedReply {
  const rows = splitRows(raw, opts.tags, opts.streaming);
  if (!rows.some((r) => r.kind === 'ja')) return parseReply(raw, opts);
  const { jaOf, orphan, pending } = pairRows(rows, opts.streaming);

  // 摘掉日语后的文本,逐字记下它在原文里的位置
  let reduced = '';
  const map: number[] = [];
  const push = (s: string, at: number) => {
    for (let k = 0; k < s.length; k++) map.push(at + k);
    reduced += s;
  };
  const span: { from: number; to: number }[] = [];
  rows.forEach((r, i) => {
    const from = reduced.length;
    if (r.kind === 'ja' && !orphan.has(i)) {
      for (const t of r.tags) push(t.raw, t.at);
    } else {
      push(raw.slice(r.start, r.end), r.start);
    }
    span.push({ from, to: reduced.length });
    if (i < rows.length - 1) push('\n', r.end);
  });

  const parsed = parseReply(reduced, opts);
  // 每句来自哪一行:句尾落在哪行的范围里就是哪行;同一行切出好几句时,日语挂在第一句上
  const seen = new Set<number>();
  const lines: VNLine[] = parsed.lines.map((ln, k) => {
    const e = parsed.ends[k];
    const row = span.findIndex((s) => e > s.from && e <= s.to);
    const first = row !== -1 && !seen.has(row);
    if (row !== -1) seen.add(row);
    if (orphan.has(row)) return { ...ln, jaOnly: true };
    const ja = first ? jaOf.get(row) : undefined;
    return ja ? { ...ln, ja } : ln;
  });
  const ends = parsed.ends.map((e) => (e === 0 ? 0 : map[e - 1] + 1));
  if (pending !== null) {
    lines.push({ speaker: null, text: '', ja: pending });
    ends.push(raw.length);
  }
  return { lines, hits: parsed.hits, ends };
}

/**
 * 这句用这个语言的声音念什么;不念返回 null。
 * 日语声音念挂在这句上的日语(只有日语、没写中文的句子念它本身),缺日语就不念;
 * 其他语言的声音念中文,只有日语的句子不念
 */
export function speechText(line: VNLine, voiceLang: string): string | null {
  if (isJaLang(voiceLang)) return line.ja ?? (line.jaOnly ? line.text : null);
  return line.jaOnly ? null : line.text;
}
