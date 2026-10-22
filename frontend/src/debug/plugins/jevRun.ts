/**
 * 一次生成里的 Jev 标注:跟着流式输出走,每写完一句就把它交给后端判,判完记成这句的标注。
 * 只管在用 Jev 的那几类标签(jevKinds),AI 模式的标签模型自己写、原样留着。
 *
 *   feed(body, streaming)  每来一段字调一次(写完了 streaming=false 再调一次)
 *   settle(ms)             写完以后等还没回来的判断,最多等 ms 毫秒;过时的句子当判失败
 *   abort()                停止生成 / 插话:不等了,没判完的当判失败
 *
 * 每次有变化都调 onChange,给出判过的句子的标注(正文不动,合并见 jevNotes.ts)、还在等 Jev 的
 * 第一句(pendingFrom)和统计。
 * 判失败的句子按「没标」处理:角色的台词沿用上一句的表情,和不用 Jev 时一样念、一样显示。
 * 场景、音乐一条回复里各最多换一次,以句子顺序里最前面那次为准(后端判几句时也是这样)。
 * CG 不限次数,而且每句都要知道上一句判出来的画面(「不换」才有意义):CG 是 Jev 时一句一句按顺序判,
 * 上一句回来了才发下一句。整段一次到达(中转站)时也是从第一句开始排队,一句约 0.2 秒,
 * 前面的句子先判完,读的人不会等。
 *
 * 两条队列(twoQueues,设计稿 2.2;开关在插件抽屉「Jev 标注」页的高级里,默认关):CG 是 Jev 时,别的题(说话人、表情、
 * 背景、音乐、声线)不再跟着 CG 一句一句排队,而是和 CG 不是 Jev 时一样多句一批;CG 单独一条队列,
 * 只问 CG、一句一句发,第 k 句等批量那边把第 0…k−1 句判完(背景是 Jev 时)再发,地点用这几句里判出来的背景。
 * 一句两边都回来了才算判完;语音只等批量那边(说话人、表情、声线):快照里的 voicePendingFrom。
 */

import { parseBilingual } from './lang';
import type { ChatEntry } from '../lib/chatEntry';
import type { ParsedReply, TagKind } from '../vn/script';
import {
  decisionTags,
  jevKindList,
  jevTagKinds,
  type JevDecision,
  type JevKind,
  type JevKinds,
  type TagTemplates,
} from './jev';
import { insertionPoint, jevText, makeNote, stripReplyTags, type JevNote } from './jevNotes';

/** 发给后端的一个候选(立绘 / 背景 / 音乐) */
export interface AnnotateChoice {
  label: string;
  aliases: string[];
  description: string;
}

export interface AnnotateThresholds {
  speaker: number;
  bg: number;
  bgm: number;
  cg: number;
}

export interface AnnotateRequest {
  char: string;
  user: string;
  prev: string;
  lines: { text: string; speaker: string | null }[];
  targets: number[];
  /** 立绘是 Jev 才带;背景 / BGM / CG 是 Jev 才带。不带就不问 */
  emotions: AnnotateChoice[];
  bgs: AnnotateChoice[];
  bgms: AnnotateChoice[];
  cgs: AnnotateChoice[];
  scene: {
    bg: string | null;
    bgm: string | null;
    bg_changed: boolean;
    bgm_changed: boolean;
    /** 现在画面上的 CG;现在的地点(背景名和说明,CG 题用) */
    cg: string | null;
    place: string;
  };
  /** 立绘或玩家台词是 Jev 时问「谁说的」 */
  ask_speaker: boolean;
  /** 角色的台词多判一道档(卡带登记的两档题,plugins/voiceExtensions.ts 的 asksTone 决定问不问) */
  ask_tone?: boolean;
  thresholds: AnnotateThresholds;
  /** 改过的问法(没改的不带) */
  prompts: Record<string, string>;
  /** 上一条 AI 回复的最后几句(Jev 页「带上一条回复」);不带就不发这个字段,请求和以前一样 */
  before?: BeforeLine[];
}

/** 带给 Jev 的上一条回复里的一句 */
export interface BeforeLine {
  text: string;
  speaker: string | null;
}

export interface AnnotateResponse {
  lines: JevDecision[];
  ms: number;
  tokens: number;
}

/** 存在 swipe_info 里:有它就说明这条回复有 Jev 标的标签 */
export interface JevStats {
  /** 哪几类是 Jev 标的;立绘在里面时,切句按严格规则认说话人 */
  kinds: JevKind[];
  /** 判了几句(含判失败的) */
  lines: number;
  requests: number;
  tokens: number;
  /** 最慢的一次判断 */
  maxMs: number;
  failed: number;
  error?: string;
  /**
   * 每句的标注,正文只存原文(见 jevNotes.ts)。第一版存法没有这个字段 ——
   * 那时标签直接缝进了正文
   */
  notes?: JevNote[];
}

export interface JevSnapshot {
  /** 统计 + 判过的句子的标注,整个存进 swipe_info.jev */
  record: JevStats;
  /** 还在等 Jev 的第一句;都判完了是 null */
  pendingFrom: number | null;
  /** 语音要等的第一句:说话人、表情、声线还没判完的;一条队列时和 pendingFrom 一样 */
  voicePendingFrom: number | null;
}

/** 一次试判的结果:每句的判断、统计、总耗时 */
export interface JevTrial {
  lines: JevLineResult[];
  stats: JevStats;
  ms: number;
}

/** 试判看的:每句切出来的样子和 Jev 判的结果 */
export interface JevLineResult {
  index: number;
  text: string;
  /** 切句认的说话人 */
  speaker: string | null;
  decision: JevDecision | 'failed' | null;
}

export interface JevRunOptions {
  charName: string;
  userName: string;
  /** 玩家上一句 */
  prev: string;
  /** 视觉小说认的几类标签:切句用;在用 Jev 的那几类,模型自己写的摘掉 */
  kinds: readonly TagKind[];
  jevKinds: JevKinds;
  templates: TagTemplates;
  emotions: AnnotateChoice[];
  bgs: AnnotateChoice[];
  bgms: AnnotateChoice[];
  /** CG 的构图(差分不发,画面按表情挑) */
  cgs: AnnotateChoice[];
  /** 回复开始时的场景、音乐、CG、表情 */
  scene: { bg: string | null; bgm: string | null; cg: string | null };
  /** 一个场景名 → 告诉 Jev 的地点(名字 + 说明);CG 题用 */
  placeOf: (bg: string | null) => string;
  emotionBefore: string | null;
  /** 这条回复角色的台词多判一道档(asksTone),答案记在标注的 tone 上 */
  askTone?: boolean;
  thresholds: AnnotateThresholds;
  prompts: Record<string, string>;
  annotate: (req: AnnotateRequest, signal: AbortSignal) => Promise<AnnotateResponse>;
  onChange: (snap: JevSnapshot) => void;
  /** 两条队列(见文件开头);只在 CG 是 Jev 时有区别 */
  twoQueues?: boolean;
  /** 上一条 AI 回复的最后几句(previousReplyLines),每个请求都带 */
  before?: BeforeLine[];
}

/**
 * 带给 Jev 的上一条回复:before 里最后一条 AI 回复(它当前的分支,合并了 Jev 另存的标注再摘掉标签),
 * 和这条回复同一套切句(日中对照只取中文那行),取最后 n 句。卡的开场白也是一条 AI 回复;不够 n 句有几句给几句
 */
export function previousReplyLines(
  before: readonly ChatEntry[],
  o: { kinds: readonly TagKind[]; charName: string; userName: string; n: number },
): BeforeLine[] {
  if (o.n <= 0) return [];
  const last = [...before].reverse().find((e) => e.role === 'assistant');
  if (!last) return [];
  const clean = stripReplyTags(jevText(last, o.kinds), o.kinds);
  const parsed = parseBilingual(clean, { charName: o.charName, userName: o.userName, tags: o.kinds, streaming: false });
  return parsed.lines.slice(-o.n).map((l) => ({ text: l.text, speaker: l.speaker }));
}

/** CG 那条队列判出来的一句:只有画面 */
type CgDecision = Pick<JevDecision, 'cg' | 'cg_off'>;

/** 后端一次最多判这么多句 */
const MAX_TARGETS = 16;
/** 写完以后最多再等 Jev 这么久(一句通常 0.2 秒);过了还没回来的句子照没标处理 */
export const JEV_SETTLE_MS = 4000;

export class JevRun {
  private body = '';
  private streaming = true;
  private readonly decided = new Map<number, JevDecision | 'failed'>();
  private readonly sent = new Set<number>();
  private inflight = 0;
  /** 两条队列时 CG 那边的:判出来的、发出去的、在路上的 */
  private readonly cgDecided = new Map<number, CgDecision | 'failed'>();
  private readonly cgSent = new Set<number>();
  private cgInflight = 0;
  private readonly controller = new AbortController();
  private waiters: (() => void)[] = [];
  private stats: JevStats;
  private notes: JevNote[] = [];
  private readonly o: JevRunOptions;
  /** 模型自己写的、要摘掉的那几类 */
  private readonly own: TagKind[];

  constructor(o: JevRunOptions) {
    this.o = o;
    this.own = jevTagKinds(o.jevKinds, o.kinds);
    this.stats = { kinds: jevKindList(o.jevKinds), lines: 0, requests: 0, tokens: 0, maxMs: 0, failed: 0 };
  }

  currentStats(): JevStats {
    return this.stats;
  }

  /** 存进 swipe_info.jev 的:统计 + 判过的句子的标注 */
  record(): JevStats {
    return { ...this.stats, notes: this.notes };
  }

  /** 每句切出来的样子和判的结果(试判用) */
  results(): JevLineResult[] {
    const { parsed } = this.parse();
    return parsed.lines.map((l, index) => ({
      index,
      text: l.text,
      speaker: l.speaker,
      decision: this.decisionOf(index),
    }));
  }

  feed(body: string, streaming: boolean): void {
    this.body = body;
    this.streaming = streaming;
    this.step();
  }

  /** 等还没回来的判断;过了 ms 还没回来的当判失败 */
  settle(ms: number): Promise<void> {
    if (this.done()) return Promise.resolve();
    // CG 一句一句排队判:还没判的句子多,就多等一会儿(一句按 0.4 秒算)
    const wait = this.o.jevKinds.cg ? Math.max(ms, (this.twoQueues ? this.cgUndecided() : this.undecided()) * 400) : ms;
    return new Promise((resolve) => {
      const t = setTimeout(() => this.abort(), wait);
      this.waiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /** 不等了(停止生成、插话、等太久):写到哪算哪,没判完的句子当判失败 */
  abort(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    this.streaming = false;
    const { parsed } = this.parse();
    for (let k = 0; k < this.completeCount(parsed); k++) {
      if (!this.decided.has(k)) this.fail([k], '没等到 Jev');
      if (this.twoQueues && !this.cgDecided.has(k)) this.cgDecided.set(k, 'failed');
    }
    this.inflight = 0;
    this.cgInflight = 0;
    this.emit();
    this.wake();
  }

  private parse(): { clean: string; parsed: ParsedReply } {
    const clean = stripReplyTags(this.body, this.own);
    const parsed = parseBilingual(clean, {
      charName: this.o.charName,
      userName: this.o.userName,
      tags: this.o.kinds,
      streaming: this.streaming,
    });
    return { clean, parsed };
  }

  /** 写完了的句子数:流式时最后一句还在写 */
  private completeCount(parsed: ParsedReply): number {
    return this.streaming ? Math.max(0, parsed.lines.length - 1) : parsed.lines.length;
  }

  /** 两条队列在用吗:开关开着、而且 CG 是 Jev */
  private get twoQueues(): boolean {
    return Boolean(this.o.twoQueues) && this.o.jevKinds.cg;
  }

  /** 这句判完了吗:两条队列时两边都要回来 */
  private isDecided(k: number): boolean {
    return this.decided.has(k) && (!this.twoQueues || this.cgDecided.has(k));
  }

  /** 这句的判断(两条队列时把 CG 那边的画面并进来);还没判完是 null */
  private decisionOf(k: number): JevDecision | 'failed' | null {
    const d = this.decided.get(k);
    if (d === undefined || !this.twoQueues) return d ?? null;
    const c = this.cgDecided.get(k);
    if (c === undefined) return null;
    if (d === 'failed' || c === 'failed') return d;
    return { ...d, cg: c.cg ?? null, cg_off: c.cg_off ?? false };
  }

  /** 写完了、还没判出结果的句子数 */
  private undecided(): number {
    const { parsed } = this.parse();
    let n = 0;
    for (let k = 0; k < this.completeCount(parsed); k++) if (!this.isDecided(k)) n++;
    return n;
  }

  /** 两条队列时 CG 那边写完了、还没判的句子数 */
  private cgUndecided(): number {
    const { parsed } = this.parse();
    let n = 0;
    for (let k = 0; k < this.completeCount(parsed); k++) if (!this.cgDecided.has(k)) n++;
    return n;
  }

  private done(): boolean {
    return !this.streaming && this.inflight === 0 && this.cgInflight === 0 && this.undecided() === 0;
  }

  private wake(): void {
    if (!this.done() && !this.controller.signal.aborted) return;
    const ws = this.waiters;
    this.waiters = [];
    ws.forEach((w) => w());
  }

  private step(): void {
    const { parsed } = this.parse();
    const todo: number[] = [];
    for (let k = 0; k < this.completeCount(parsed); k++) {
      if (!this.sent.has(k) && !this.decided.has(k)) todo.push(k);
    }
    if (this.twoQueues) {
      this.stepTwoQueues(todo, parsed);
    } else if (this.o.jevKinds.cg) {
      // CG:上一句回来了才发下一句,每句都带着上一句判出来的画面
      if (this.inflight === 0 && todo.length > 0) void this.send([todo[0]], parsed);
    } else {
      for (let i = 0; i < todo.length; i += MAX_TARGETS) void this.send(todo.slice(i, i + MAX_TARGETS), parsed);
    }
    this.emit();
    this.wake();
  }

  /** 两条队列:批量那边多句一批(没有别的题时直接算判过);CG 那边一句一句、等前面的背景判完 */
  private stepTwoQueues(todo: number[], parsed: ParsedReply): void {
    const k = this.o.jevKinds;
    if (k.sprite || k.player || k.bg || k.bgm) {
      for (let i = 0; i < todo.length; i += MAX_TARGETS) void this.send(todo.slice(i, i + MAX_TARGETS), parsed);
    } else {
      for (const t of todo) {
        this.sent.add(t);
        this.decided.set(t, { index: t, speaker: null, emotion: null, bg: null, bgm: null, confidence: {} });
      }
    }
    if (this.cgInflight === 0 && !this.controller.signal.aborted) {
      let next = -1;
      for (let j = 0; j < this.completeCount(parsed); j++) {
        if (!this.cgSent.has(j) && !this.cgDecided.has(j)) {
          next = j;
          break;
        }
      }
      // 背景是 Jev 时,第 k 句的 CG 等第 0…k−1 句的背景判完:地点要用判出来的
      const ready = next !== -1 && (!k.bg || Array.from({ length: next }, (_, j) => j).every((j) => this.decided.has(j)));
      if (ready) void this.sendCg(next, parsed);
    }
  }

  /** 已知的场景切换:按句子顺序最前面的那次 */
  private firstChange(kind: 'bg' | 'bgm'): { line: number; label: string } | null {
    let best: { line: number; label: string } | null = null;
    for (const [k, d] of this.decided) {
      if (d !== 'failed' && d[kind] && (!best || k < best.line)) best = { line: k, label: d[kind] };
    }
    return best;
  }

  /**
   * 判完的句子按顺序走一遍,每句的 CG 变化(相对走到这句时画面上的那张)。
   * 选了现在这张、没 CG 时选收起的都当没变。CG 和场景互不牵连:换了场景 CG 照样挂着(和视觉小说里一样)
   */
  private cgSteps(): Map<number, { cg: string | null; off: boolean; now: string | null }> {
    let cur = this.o.scene.cg;
    const out = new Map<number, { cg: string | null; off: boolean; now: string | null }>();
    const source: ReadonlyMap<number, CgDecision | JevDecision | 'failed'> = this.twoQueues ? this.cgDecided : this.decided;
    for (const k of [...source.keys()].sort((a, b) => a - b)) {
      const d = source.get(k);
      let cg: string | null = null;
      let off = false;
      if (d && d !== 'failed') {
        if (d.cg && d.cg !== cur) cg = cur = d.cg;
        else if (d.cg_off && cur !== null) {
          off = true;
          cur = null;
        }
      }
      out.set(k, { cg, off, now: cur });
    }
    return out;
  }

  /** 第 line 句之前(已经判回来的那些)画面上的 CG */
  private cgBefore(line: number): string | null {
    let now = this.o.scene.cg;
    for (const [k, step] of this.cgSteps()) if (k < line) now = step.now;
    return now;
  }

  private async send(targets: number[], parsed: ParsedReply): Promise<void> {
    if (this.controller.signal.aborted) return;
    targets.forEach((k) => this.sent.add(k));
    this.inflight++;
    const { jevKinds: k } = this.o;
    const bg = this.firstChange('bg');
    const bgm = this.firstChange('bgm');
    const last = Math.max(...targets);
    const bgNow = bg && bg.line <= Math.min(...targets) ? bg.label : this.o.scene.bg;
    // 两条队列时 CG 不在这一批里问
    const askCg = k.cg && !this.twoQueues;
    const req: AnnotateRequest = {
      char: this.o.charName,
      user: this.o.userName,
      prev: this.o.prev,
      lines: parsed.lines.slice(0, last + 1).map((l) => ({ text: l.text, speaker: l.speaker })),
      targets,
      emotions: k.sprite ? this.o.emotions : [],
      bgs: k.bg ? this.o.bgs : [],
      bgms: k.bgm ? this.o.bgms : [],
      cgs: askCg ? this.o.cgs : [],
      scene: {
        bg: bg?.label ?? this.o.scene.bg,
        bgm: bgm?.label ?? this.o.scene.bgm,
        bg_changed: bg !== null,
        bgm_changed: bgm !== null,
        cg: askCg ? this.cgBefore(Math.min(...targets)) : null,
        place: askCg ? this.o.placeOf(bgNow) : '',
      },
      ask_speaker: k.sprite || k.player,
      ...(this.o.askTone ? { ask_tone: true } : {}),
      thresholds: this.o.thresholds,
      prompts: this.o.prompts,
      ...(this.o.before?.length ? { before: this.o.before } : {}),
    };
    try {
      const res = await this.o.annotate(req, this.controller.signal);
      if (this.controller.signal.aborted) return;
      for (const d of res.lines) if (targets.includes(d.index)) this.decided.set(d.index, d);
      // 后端漏了的(不该发生)也算判过了,别一直等
      for (const t of targets) if (!this.decided.has(t)) this.decided.set(t, 'failed');
      this.stats = {
        ...this.stats,
        lines: this.stats.lines + targets.length,
        requests: this.stats.requests + 1,
        tokens: this.stats.tokens + res.tokens,
        maxMs: Math.max(this.stats.maxMs, res.ms),
      };
    } catch (e) {
      if (this.controller.signal.aborted) return;
      this.fail(targets, e instanceof Error ? e.message : String(e));
    } finally {
      if (!this.controller.signal.aborted) {
        this.inflight--;
        // CG 排队判:接着发下一句(step 里也会 emit / wake);两条队列时批量回来了 CG 可能就能发了
        if (this.o.jevKinds.cg) this.step();
        else {
          this.emit();
          this.wake();
        }
      }
    }
  }

  /** 两条队列的 CG 那边:只问第 k 句的 CG,带着前面判出来的画面和地点 */
  private async sendCg(line: number, parsed: ParsedReply): Promise<void> {
    if (this.controller.signal.aborted) return;
    this.cgSent.add(line);
    this.cgInflight++;
    const bg = this.firstChange('bg');
    const bgm = this.firstChange('bgm');
    // 地点:前面几句(0…k−1)里判出来的背景,没换用这条回复开头的
    const bgNow = bg && bg.line < line ? bg.label : this.o.scene.bg;
    const req: AnnotateRequest = {
      char: this.o.charName,
      user: this.o.userName,
      prev: this.o.prev,
      lines: parsed.lines.slice(0, line + 1).map((l) => ({ text: l.text, speaker: l.speaker })),
      targets: [line],
      emotions: [],
      bgs: [],
      bgms: [],
      cgs: this.o.cgs,
      scene: {
        bg: bg?.label ?? this.o.scene.bg,
        bgm: bgm?.label ?? this.o.scene.bgm,
        bg_changed: bg !== null,
        bgm_changed: bgm !== null,
        cg: this.cgBefore(line),
        place: this.o.placeOf(bgNow),
      },
      ask_speaker: false,
      thresholds: this.o.thresholds,
      prompts: this.o.prompts,
      ...(this.o.before?.length ? { before: this.o.before } : {}),
    };
    try {
      const res = await this.o.annotate(req, this.controller.signal);
      if (this.controller.signal.aborted) return;
      const d = res.lines.find((x) => x.index === line);
      this.cgDecided.set(line, d ? { cg: d.cg ?? null, cg_off: d.cg_off ?? false } : 'failed');
      this.stats = {
        ...this.stats,
        requests: this.stats.requests + 1,
        tokens: this.stats.tokens + res.tokens,
        maxMs: Math.max(this.stats.maxMs, res.ms),
      };
    } catch (e) {
      if (this.controller.signal.aborted) return;
      this.cgDecided.set(line, 'failed');
      this.stats = { ...this.stats, error: e instanceof Error ? e.message : String(e) };
    } finally {
      if (!this.controller.signal.aborted) {
        this.cgInflight--;
        this.step();
      }
    }
  }

  private fail(targets: number[], error: string): void {
    for (const k of targets) this.decided.set(k, 'failed');
    this.stats = {
      ...this.stats,
      lines: this.stats.lines + targets.length,
      failed: this.stats.failed + targets.length,
      error,
    };
  }

  /** 判过的每句记一条标注(判成不用加标签的也记,切句靠它知道这句判过);位置在摘掉模型自己写的那几类以后的原文里 */
  private emit(): void {
    const { clean, parsed } = this.parse();
    const k = this.o.jevKinds;
    const bg = this.firstChange('bg');
    const bgm = this.firstChange('bgm');
    const cgs = this.cgSteps();
    const notes: JevNote[] = [];
    let emotion = this.o.emotionBefore;
    let pendingFrom: number | null = null;
    let voicePendingFrom: number | null = null;
    parsed.lines.forEach((line, i) => {
      if (!this.decided.has(i)) voicePendingFrom ??= i;
      const d = this.decisionOf(i);
      if (!d) {
        pendingFrom ??= i;
        return;
      }
      // 判失败:照没标处理,切句认成角色的台词沿用上一句的表情(两条队列时 CG 那边判出来的画面照样用)
      const step = cgs.get(i);
      const dec =
        d === 'failed'
          ? {
              speaker: line.speaker === this.o.charName ? ('char' as const) : null,
              emotion: null,
              bg: null,
              bgm: null,
              ...(this.twoQueues ? { cg: step?.cg ?? null, cg_off: step?.off ?? false } : {}),
            }
          : {
              ...d,
              // 认出是玩家说的:写 <我>(jevKinds.player,跟着立绘),显示成玩家的名字、不念、不换立绘
              bg: bg?.line === i ? d.bg : null,
              bgm: bgm?.line === i ? d.bgm : null,
              cg: step?.cg ?? null,
              cg_off: step?.off ?? false,
            };
      const tags = decisionTags(dec, emotion, this.o.templates, k).join('');
      const tone = d !== 'failed' && dec.speaker === 'char' ? d.tone : null;
      notes.push(makeNote(clean, insertionPoint(clean, parsed.ends, i), tags, tone));
      if (dec.speaker === 'char' && dec.emotion) emotion = dec.emotion;
    });
    this.notes = notes;
    this.o.onChange({ record: this.record(), pendingFrom, voicePendingFrom });
  }
}
