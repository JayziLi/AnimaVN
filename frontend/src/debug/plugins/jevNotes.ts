/**
 * Jev 的标注另外存,正文只存模型写的原文:
 *
 *   swipes[i]                模型写的原样 —— 编辑框、导出给酒馆、聊天区的「看原文」都是它
 *   swipe_info[i].jev.notes  Jev 给每句加的标签:插在哪儿、这句开头几个字、加了什么
 *
 * 用的时候合并(jevView):画面、语音、存档缩略图、发给模型的历史、聊天区默认显示的都是
 * 「原文 + Jev 的标签」。发历史时,现在是 Jev 模式的那几类再整个摘掉(jev.ts 的 jevStripPrompt)——
 * 所以切回 AI 写以后,以前 Jev 标的照样当示例发给模型;切到 Jev 以后,模型以前写的也不发。
 *
 * 位置按「原文摘掉这个分支 Jev 那几类的标签」算:模型不听话自己写了的,以 Jev 的为准。
 * 判成不用加标签的句子也记一条(tags 是空串):切句靠它知道这句 Jev 判过,没带立绘标签就
 * 不是角色说的。原文改过(编辑、插话截断):开头几个字对不上就找最近的同样开头的地方,
 * 找不到就扔掉这句的标注,这句当 Jev 没判过,照默认的认法。
 *
 * 第一版存法(标签直接缝进正文、没有 notes)读的时候照旧:正文就是合并后的。
 * 这个文件只依赖切句和条目模型,场景插件、存档页也能用(jev.ts 依赖场景插件,反过来会循环)
 */

import { currentInfo, currentText, type ChatEntry } from '../lib/chatEntry';
import { extractTags, type TagKind } from '../vn/script';
import type { JevKind } from './jev';
import type { JevStats } from './jevRun';

/** Jev 给一句加的标签 */
export interface JevNote {
  /** 插在第几个字前面(原文摘掉这个分支 Jev 那几类标签以后的位置) */
  at: number;
  /** 这句开头几个字:原文改没改,对一下就知道 */
  check: string;
  /** 加的标签(按插件模板写好的);判成不用加的是空串 */
  tags: string;
}

/** 核对用的开头取几个字 */
const CHECK_LEN = 8;
/** 第一版存的没有 kinds:四类都是 */
const ALL_KINDS: readonly JevKind[] = ['sprite', 'bg', 'bgm', 'player'];
export const NO_KINDS: readonly JevKind[] = [];

/** 这个分支哪几类是 Jev 标的(swipe_info.jev.kinds);没用 Jev 的是空 */
export function jevKindsOf(entry: ChatEntry): readonly JevKind[] {
  const j = currentInfo(entry)?.jev;
  if (!j) return NO_KINDS;
  return j.kinds ?? ALL_KINDS;
}

/** 这几类 Jev 标的,在视觉小说认的标签里对应哪几个 */
const tagKindsOf = (jevKinds: readonly JevKind[], kinds: readonly TagKind[]) =>
  kinds.filter((t) => (jevKinds as readonly string[]).includes(t.kind));

/**
 * 摘掉正文里的这几类标签。只有标签的一行整行去掉,不留空行。
 * 用在两处:发给模型的提示词(不让它照着写)、模型自己写出来的(以 Jev 标的为准)。
 * 流式时末尾写了一半的标签留着,切句时会藏起来,写完了下一次就摘掉
 */
export function stripReplyTags(raw: string, kinds: readonly TagKind[]): string {
  if (kinds.length === 0) return raw;
  return raw
    .split('\n')
    .flatMap((line) => {
      const { text, tags } = extractTags(line, kinds, false);
      if (tags.length === 0) return [line];
      return text.trim() ? [text.replace(/^[ \t]+/, '')] : [];
    })
    .join('\n');
}

/** 只剩标点和空白:上一句收尾的「。」「*」这些 */
const TAIL_RE = /^[\s，。、；：:;,.!！?？…—~～\-*]*$/;

/**
 * 第 k 句的标签插在原文哪儿:上一句结束之后、这句开头之前。
 * 上一句那一行剩下的只有标点时,换到下一行行首(双语时是这句的日语那行 —— 标签本来就写在
 * 日中这一对前面);跳过空行和行首空白。ends 是切句给的每句在原文里结束的位置
 */
export function insertionPoint(text: string, ends: readonly number[], k: number): number {
  let p = k === 0 ? 0 : ends[k - 1];
  if (k > 0) {
    const rowEnd = text.indexOf('\n', p);
    if (rowEnd !== -1 && TAIL_RE.test(text.slice(p, rowEnd))) p = rowEnd + 1;
  }
  while (p < text.length && /\s/.test(text[p])) p++;
  return p;
}

/** 一句的标注:标签插在 base 的 at 前面,记下这句开头几个字 */
export const makeNote = (base: string, at: number, tags: string): JevNote => ({
  at,
  check: base.slice(at, at + CHECK_LEN),
  tags,
});

/** 标注落在 base 的哪儿:开头对得上就是原位;前面改过就找最近的同样开头;找不到是 null */
function locate(base: string, n: JevNote): number | null {
  if (!n.check) return null;
  if (base.startsWith(n.check, n.at)) return n.at;
  let best: number | null = null;
  for (let i = base.indexOf(n.check); i !== -1; i = base.indexOf(n.check, i + 1)) {
    if (best === null || Math.abs(i - n.at) < Math.abs(best - n.at)) best = i;
  }
  return best;
}

/** 一个分支合并以后的样子 */
export interface JevView {
  /** 原文 + Jev 的标签:画面、语音、历史都用它 */
  text: string;
  /** 模型写的原样(第一版存法是摘掉 Jev 那几类标签以后的正文) */
  original: string;
  /** Jev 判过的句子:它的标签插在 text 的哪儿。null = 第一版存法,全判过 */
  judged: readonly number[] | null;
  /** Jev 加的标签在 text 里的范围(聊天区高亮用) */
  marks: readonly { from: number; to: number }[];
  /** 原文改过、对不上扔掉的标注条数 */
  dropped: number;
  /** 这个分支哪几类是 Jev 标的;没用 Jev 是空 */
  kinds: readonly JevKind[];
}

/** 没用 Jev 的分支都共用这两个空列表:切句缓存按 judged 的引用认「标注变没变」 */
const NO_JUDGED: readonly number[] = [];
const NO_MARKS: JevView['marks'] = [];

const plain = (raw: string): JevView => ({
  text: raw,
  original: raw,
  judged: NO_JUDGED,
  marks: NO_MARKS,
  dropped: 0,
  kinds: NO_KINDS,
});

function buildView(raw: string, jev: JevStats, kinds: readonly TagKind[]): JevView {
  const jevKinds = jev.kinds ?? ALL_KINDS;
  const own = tagKindsOf(jevKinds, kinds);
  if (!jev.notes) {
    // 第一版:标签已经缝在正文里了
    return {
      text: raw,
      original: stripReplyTags(raw, own),
      judged: null,
      marks: NO_MARKS,
      dropped: 0,
      kinds: jevKinds,
    };
  }
  const base = stripReplyTags(raw, own);
  const placed = new Map<number, JevNote>();
  let dropped = 0;
  for (const n of jev.notes) {
    const at = locate(base, n);
    // 两条落到同一处:后来的那条是找错了地方
    if (at === null || placed.has(at)) dropped++;
    else placed.set(at, n);
  }
  let text = '';
  let last = 0;
  const judged: number[] = [];
  const marks: { from: number; to: number }[] = [];
  for (const [at, { tags }] of [...placed].sort((a, b) => a[0] - b[0])) {
    text += base.slice(last, at);
    judged.push(text.length);
    if (tags) marks.push({ from: text.length, to: text.length + tags.length });
    text += tags;
    last = at;
  }
  text += base.slice(last);
  return {
    text,
    original: raw,
    judged,
    marks,
    dropped,
    kinds: jevKinds,
  };
}

/** 流式时每来一个字都要合并一遍:同一份 jev 记录按原文和标签种类缓存几份 */
const cache = new WeakMap<JevStats, { raw: string; kinds: readonly TagKind[]; view: JevView }[]>();

/** 原文 + 这个分支的 Jev 记录 → 合并以后的样子。kinds 是视觉小说认的几类标签 */
export function jevView(raw: string, jev: JevStats | undefined, kinds: readonly TagKind[]): JevView {
  if (!jev) return plain(raw);
  const slots = cache.get(jev) ?? [];
  const hit = slots.find((s) => s.raw === raw && s.kinds === kinds);
  if (hit) return hit.view;
  const view = buildView(raw, jev, kinds);
  cache.set(jev, [{ raw, kinds, view }, ...slots].slice(0, 4));
  return view;
}

/** 一条消息当前分支合并以后的样子 */
export const entryView = (entry: ChatEntry, kinds: readonly TagKind[]): JevView =>
  jevView(currentText(entry), currentInfo(entry)?.jev, kinds);

/** 画面、历史用的正文:原文 + Jev 的标签 */
export const jevText = (entry: ChatEntry, kinds: readonly TagKind[]): string => entryView(entry, kinds).text;

const NONE: ReadonlySet<number> = new Set();

/**
 * 切句时不按严格规则认说话人的句子:Jev 没判过的(还在判、或者原文改过标注扔掉了)。
 * ends 是切 view.text 得到的每句结尾;一条标注落在「结尾在它后面」的第一句上
 */
export function looseLines(view: JevView, ends: readonly number[]): ReadonlySet<number> {
  if (view.judged === null) return NONE;
  const judged = new Set(view.judged.map((p) => ends.findIndex((e) => e > p)));
  const loose = ends.flatMap((_, i) => (judged.has(i) ? [] : [i]));
  return loose.length === 0 ? NONE : new Set(loose);
}

/**
 * 插话截断:原文只留到 keep(一句的结尾),截掉的句子的标注一起去掉;
 * 留下的最后一句开头核对的字只核对到 keep 为止
 */
export function cutJev(jev: JevStats, keep: string, kinds: readonly TagKind[]): JevStats {
  if (!jev.notes) return jev;
  const base = stripReplyTags(keep, tagKindsOf(jev.kinds ?? ALL_KINDS, kinds));
  return {
    ...jev,
    notes: jev.notes.flatMap((n) =>
      n.at < base.length ? [{ ...n, check: n.check.slice(0, base.length - n.at) }] : [],
    ),
  };
}
