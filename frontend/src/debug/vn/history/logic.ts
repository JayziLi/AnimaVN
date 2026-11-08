/**
 * 历史页(菜单「历史」和游戏上的历史小窗口共用,设计稿 kit/scene.js 的 AV.menuHistory)的纯逻辑:
 * 把对话条目排成「一句一行」的行、认出原文里的标签和宏、算改完原文后从哪句开始播。
 * 不碰 React,方便测。
 */

import type { MutableRefObject } from 'react';
import type { SpeakRequest } from '../../lib/api';
import { currentText, type ChatEntry } from '../../lib/chatEntry';
import type { TagHit, TagKind, VNLine } from '../script';

/** 一条回复按画面上的句子切好的样子(VNScreen 的 backlog 给的) */
export interface LogLines {
  lines: VNLine[];
  /** 和 lines 一一对应:这句怎么念;不念是 null */
  plans: (SpeakRequest | null)[];
  /** 写在回复里的标签(表情、背景、音乐……):改原文时看表情有没有变 */
  hits: TagHit[];
  streaming: boolean;
}

/** 历史里一句(用户消息是那一刻)的画面:背景、CG。和舞台读同一份时间线(core/timeline.ts) */
export interface HistoryScene {
  /** 背景;没有是 null。src 是横幅用的小图 */
  bg: { id: string; label: string; src: string | null; focus: number } | null;
  /**
   * 画面上的大图;没有是 null。thumb / full 是这一句显示的那一帧。
   * 一般是 CG(构图);ai = AI 生图画的插图(它盖在 CG 上面,两个都有时算它)
   */
  cg: { id: string; thumb: string | null; full: string | null; ai?: boolean } | null;
}

/** VNScreen 递给历史页的数据 */
export interface HistoryData {
  /** 一条回复的句子;用户消息、没切出句子的回复是 null */
  of: (entry: ChatEntry) => LogLines | null;
  /** 现在游戏停在哪一句 */
  at: { entryId: string; line: number } | null;
  /** 设置里的「字幕」:日语小字显不显示 */
  showJa: boolean;
  /** 这条回复的日语被「隐藏前文日语」藏了 */
  jaHidden: (entry: ChatEntry) => boolean;
  /** 小窗口的 Esc 先问内容:在改原文就先退出编辑,返回 true = 这一下被用掉了 */
  esc: MutableRefObject<(() => boolean) | null>;
  /** 这一句(第 line 句;用户消息、整条看原文时是 0)那一刻的背景和 CG;没有时间线就不给 / 返回 null */
  scene?: (entryId: string, line: number) => HistoryScene | null;
  /** CG 或 AI 生图开着:列表左边留一栏放小图 */
  pics?: boolean;
}

export type LineRole = 'char' | 'narr' | 'player';

export interface LineRow {
  kind: 'line';
  key: string;
  entryId: string;
  line: number;
  role: LineRole;
  speaker: string | null;
  text: string;
  /** 中文上方的日语小字 */
  ja: string | null;
  plan: SpeakRequest | null;
  current: boolean;
}
export interface UserRow {
  kind: 'user';
  key: string;
  entryId: string;
  text: string;
}
/** 没切出句子的回复:整段当一行放 */
export interface PlainRow {
  kind: 'plain';
  key: string;
  entryId: string;
  text: string;
  current: boolean;
}
/** 看原文时,一条回复合成的一整块 */
export interface ReplyRow {
  kind: 'reply';
  key: string;
  entryId: string;
  raw: string;
  /** 能不能改:回复还在生成时不行 */
  editable: boolean;
  current: boolean;
}
export type HistoryRow = LineRow | UserRow | PlainRow | ReplyRow;

export interface RowOptions {
  /** 「显示原文」整页打开了 */
  raw: boolean;
  /** 单独展开原文的回复(entry.id) */
  one: ReadonlySet<string>;
  /** 正在改的回复 */
  editingId: string | null;
  data: HistoryData;
  /** 展开宏之后的正文;用户消息、没切句的回复用 */
  expand: (entry: ChatEntry) => string;
  /** 摘掉标签的正文(没切出句子的回复用) */
  plain: (shown: string) => string;
  /** 正在生成:原文不给改 */
  sending: boolean;
}

const lineRole = (ln: VNLine): LineRole => (ln.player ? 'player' : ln.speaker ? 'char' : 'narr');

/** 一条回复的原文是不是摊开着 */
export const showsRaw = (id: string, o: Pick<RowOptions, 'raw' | 'one' | 'editingId'>): boolean =>
  o.raw || o.one.has(id) || o.editingId === id;

/** 一条对话条目排成几行 */
export function entryRows(entry: ChatEntry, o: RowOptions): HistoryRow[] {
  const id = entry.id;
  if (entry.role === 'user') {
    const text = o.raw ? currentText(entry) : o.expand(entry);
    return text.trim() ? [{ kind: 'user', key: id, entryId: id, text }] : [];
  }
  const cur = o.data.at?.entryId === id ? o.data.at.line : -1;
  if (showsRaw(id, o)) {
    const raw = currentText(entry);
    if (!raw.trim()) return [];
    return [{ kind: 'reply', key: id, entryId: id, raw, editable: !entry.streaming && !o.sending, current: cur >= 0 }];
  }
  const got = o.data.of(entry);
  if (!got || got.lines.length === 0) {
    const text = o.plain(o.expand(entry));
    return text.trim() ? [{ kind: 'plain', key: id, entryId: id, text, current: cur >= 0 }] : [];
  }
  const ja = o.data.showJa && !o.data.jaHidden(entry);
  return got.lines.map((ln, i) => ({
    kind: 'line' as const,
    key: `${id}:${i}`,
    entryId: id,
    line: i,
    role: lineRole(ln),
    speaker: ln.speaker,
    text: ln.text,
    ja: ja && ln.ja ? ln.ja : null,
    plan: got.plans[i] ?? null,
    current: i === cur,
  }));
}

/** CG 竖线在这一行:on = 画线;start / end = 线从这行开始 / 到这行结束(只画半截) */
export interface Rail {
  on: boolean;
  start: boolean;
  end: boolean;
}

/**
 * 一条消息里的一行:换场景横幅 / CG 小图 / 开头(头像 + 名字)/ 一句。
 * cg 是小图,放在它下面那句的左边、不占行;span = 这张显示了几句(竖线连着的句子数,你的消息算一句);
 * alone = 这条消息里这张图只连着线头那一句(图比一句高,要把那句撑高,不然压到下一张 / 被下一条消息盖住)
 */
export type BlockItem =
  | { t: 'scene'; key: string; bg: NonNullable<HistoryScene['bg']>; rail: Rail; later: boolean }
  | { t: 'cg'; key: string; cg: NonNullable<HistoryScene['cg']>; span: number; alone: boolean; rail: Rail; later: boolean }
  | { t: 'head'; key: string; rail: Rail }
  | { t: 'row'; key: string; row: HistoryRow; rail: Rail; later: boolean };

/** 一条消息(调试台 / 酒馆那样:头像和名字只在开头一次,下面是这条的所有句子) */
export interface HistoryBlock {
  entry: ChatEntry;
  user: boolean;
  /** 整条都在「现在」后面(还没播到):字变淡 */
  later: boolean;
  items: BlockItem[];
}

const rowLine = (r: HistoryRow) => (r.kind === 'line' ? r.line : 0);

/**
 * 把要显示的条目排成一条条消息。
 * - 「现在」那句后面的句子、后面的整条消息标 later(还没播到,变淡);at 是「现在」那条在 entries 里的下标,-1 = 不知道(都不淡)。
 *   横幅和 CG 小图跟着它下面那句淡(还没看到的图不剧透)
 * - 背景换了的地方(列表第一行也算)插一条横幅;CG 从出现那句到收起那句左边一条竖线,小图在线头左边。
 *   竖线跨过中间的用户消息、横幅也连着;CG 恰好从一条回复的第一句开始时,线从那句起,不从头像那行起
 */
export function historyBlocks(entries: readonly ChatEntry[], first: number, at: number, o: RowOptions): HistoryBlock[] {
  type Pre =
    | { t: 'scene'; key: string; bg: NonNullable<HistoryScene['bg']>; cg: string | null; later: boolean }
    | { t: 'cg'; key: string; cg: string; shot: NonNullable<HistoryScene['cg']>; later: boolean }
    | { t: 'head'; key: string; cg: string | null }
    | { t: 'row'; key: string; row: HistoryRow; cg: string | null; later: boolean };
  const blocks: { entry: ChatEntry; user: boolean; later: boolean; items: Pre[] }[] = [];
  const atLine = o.data.at?.line ?? -1;
  let bgId: string | null | undefined;
  let cgId: string | null = null;
  entries.forEach((entry, k) => {
    const rows = entryRows(entry, o);
    if (rows.length === 0) return;
    const i = first + k;
    const later = at >= 0 && i > at;
    const items: Pre[] = [];
    const sceneOf = (r: HistoryRow) => o.data.scene?.(entry.id, rowLine(r)) ?? null;
    // 换了背景:横幅放在这一行前面;竖线只在前后是同一张 CG 时穿过它。dim = 跟着下面那句淡不淡
    const banner = (s: HistoryScene | null, key: string, dim: boolean) => {
      const bg = s?.bg ?? null;
      if (bg && bg.id !== bgId) items.push({ t: 'scene', key: `bg:${key}`, bg, cg: s?.cg?.id === cgId ? cgId : null, later: dim });
      if (bg) bgId = bg.id;
    };
    const s0 = sceneOf(rows[0]);
    banner(s0, entry.id, later);
    // 开头那行:CG 接着上一条的才画线;这条第一句才出的 CG 从下面的小图起
    items.push({ t: 'head', key: `head:${entry.id}`, cg: s0?.cg && s0.cg.id === cgId ? cgId : null });
    rows.forEach((row, j) => {
      const s = j === 0 ? s0 : sceneOf(row);
      const rowLater = later || (i === at && row.kind === 'line' && row.line > atLine);
      if (j > 0) banner(s, row.key, rowLater);
      const cg = s?.cg ?? null;
      if (cg && cg.id !== cgId) items.push({ t: 'cg', key: `cg:${row.key}`, cg: cg.id, shot: cg, later: rowLater });
      cgId = cg?.id ?? null;
      items.push({ t: 'row', key: row.key, row, cg: cgId, later: rowLater });
    });
    blocks.push({ entry, user: entry.role === 'user', later, items });
  });
  // 竖线:按排好的顺序看前后一行是不是同一张 CG;小图不占行,它下面那句是线头。顺便数每张连着几句
  const flat = blocks.flatMap((b) => b.items);
  const spans = new Map<Pre, number>();
  let shot: Pre | null = null;
  const rails = flat.map((it, n): Rail => {
    if (it.t === 'cg') shot = it;
    else if (it.t === 'row' && shot && it.cg === shot.cg) spans.set(shot, (spans.get(shot) ?? 0) + 1);
    const id = it.cg;
    const before = n > 0 ? flat[n - 1] : null;
    const next = n < flat.length - 1 ? flat[n + 1].cg : null;
    const start = id !== null && (it.t === 'cg' || before?.t === 'cg' || before?.cg !== id);
    return { on: id !== null, start, end: id !== null && next !== id };
  });
  let n = 0;
  return blocks.map((b) => ({
    entry: b.entry,
    user: b.user,
    later: b.later,
    items: b.items.map((it, j): BlockItem => {
      const rail = rails[n++];
      switch (it.t) {
        case 'scene':
          return { t: 'scene', key: it.key, bg: it.bg, rail, later: it.later };
        case 'cg':
          return {
            t: 'cg',
            key: it.key,
            cg: it.shot,
            span: spans.get(it) ?? 0,
            alone: b.items[j + 2]?.cg !== it.cg,
            rail,
            later: it.later,
          };
        case 'head':
          return { t: 'head', key: it.key, rail };
        case 'row':
          return { t: 'row', key: it.key, row: it.row, rail, later: it.later };
      }
    }),
  }));
}

/**
 * 改完原文,从哪一句开始播:新旧两份从头一句一句比,第一处字(中文 / 日语 / 谁说的)或表情不一样的那句。
 * 一句没变 = -1;只删了后面几句 = 剩下的最后一句。
 */
export function firstChanged(oldL: LogLines | null, nu: LogLines | null): number {
  if (!nu || nu.lines.length === 0) return -1;
  if (!oldL || oldL.lines.length === 0) return 0;
  const marks = (l: LogLines, i: number) =>
    l.hits
      .filter((h) => h.lineIndex === i)
      .map((h) => `${h.kind}\u0001${h.raw}`)
      .join('\u0002');
  const same = (i: number) => {
    const a = oldL.lines[i];
    const b = nu.lines[i];
    return (
      a.speaker === b.speaker &&
      a.text === b.text &&
      (a.ja ?? '') === (b.ja ?? '') &&
      Boolean(a.player) === Boolean(b.player) &&
      marks(oldL, i) === marks(nu, i)
    );
  };
  let first = 0;
  while (first < nu.lines.length && first < oldL.lines.length && same(first)) first++;
  if (first === nu.lines.length && first === oldL.lines.length) return -1;
  return first >= nu.lines.length ? nu.lines.length - 1 : first;
}

/** 改完以后要重新合成语音的句子数:要念的句子里,原来没有同样文字的 */
export function revoiceCount(oldL: LogLines | null, nu: LogLines | null): number {
  if (!nu) return 0;
  const had = new Set((oldL?.lines ?? []).map((l) => l.text));
  return nu.lines.reduce((n, l, i) => (nu.plans[i] && !had.has(l.text) ? n + 1 : n), 0);
}

/** 改完以后列表里那条小字 */
export function editNote(revoice: number): string {
  return revoice > 0 ? `改过 · ${revoice} 句语音重念` : '改过';
}

/** 原文里的一段:标签(<sprite:开心> 一类)和宏({{user}})标成浅色小字 */
export interface RawSeg {
  text: string;
  mark: boolean;
}

export function rawSegments(raw: string, kinds: readonly TagKind[]): RawSeg[] {
  const spans: { at: number; end: number }[] = [];
  for (const k of kinds) {
    if (!k.pattern) continue;
    for (const m of raw.matchAll(new RegExp(k.pattern.source, 'g'))) {
      if (m[0]) spans.push({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
    }
  }
  for (const m of raw.matchAll(/\{\{[^{}]*\}\}/g)) spans.push({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  spans.sort((a, b) => a.at - b.at || b.end - a.end);
  const out: RawSeg[] = [];
  let last = 0;
  for (const s of spans) {
    if (s.at < last) continue; // 和前一段重叠:先到先得
    if (s.at > last) out.push({ text: raw.slice(last, s.at), mark: false });
    out.push({ text: raw.slice(s.at, s.end), mark: true });
    last = s.end;
  }
  if (last < raw.length) out.push({ text: raw.slice(last), mark: false });
  return out;
}

/** 先排最近多少条对话,往上翻再接着载入(对话很长时不一次排完) */
export const FIRST_ENTRIES = 24;
export const MORE_ENTRIES = 24;
