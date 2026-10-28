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

/** 历史里一句的头像:那句的表情差分,按脸裁(设计稿 AV.menuHistory 的 faceCrop) */
export interface HistoryFace {
  src: string;
  /** 0–1 的脸框;没认出脸是 null(用默认位置) */
  face: { x: number; y: number; w: number; h: number } | null;
  /** 原图宽 / 高 */
  aspect: number;
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
  /** 她这一句(第 line 句;整条回复看原文时是 0)的头像;没有立绘就不给 / 返回 null,退回卡面头像或名字章 */
  face?: (entryId: string, line: number) => HistoryFace | null;
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
