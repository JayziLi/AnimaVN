/**
 * 音频总线(全局单例):整个页面只开一个 AudioContext,背景音乐、语音、立绘特效音、跳字音各走一条声道,
 * 汇到总音量再出声。
 *
 *   bgm   背景音乐(bgm.ts)       ─┐
 *   voice 语音(voice.ts)         ─┤  每条声道:音量 → 压低 → 总音量 → 扬声器
 *   fx    立绘特效音(spriteFx.ts) ─┤
 *   type  跳字音(typeSound.ts)    ─┘
 *
 * - 解锁:iOS 上 AudioContext 只能在手势里启动,所以点击、按键里调 unlock()。只用解锁这一次,
 *   之后 AI 回复里换曲子、念台词、放音效都不用再点
 * - 切到后台挂起、回来接着放;视觉小说关了(setActive(false))等音乐淡完再挂起,不占声卡
 * - 压低:谁出声时压低谁(今天只有念台词时压背景音乐),压到多少跟设置走(setDuckLevel)
 * - 短音效(立绘特效音、跳字音):解码好的放缓存,跳字一秒几十下也不卡
 *
 * 解锁、挂起、压低的规则原来写在 bgm.ts 里(语音、音效借 BGM 的 AudioContext 用),10-11 搬到这里,规则原样。
 */

export type Channel = 'bgm' | 'voice' | 'fx' | 'type';
export const CHANNELS: readonly Channel[] = ['bgm', 'voice', 'fx', 'type'];

/** 短音效走的声道 */
export type ShortChannel = 'fx' | 'type';

/** 谁出声时压低谁。今天只有语音:念台词时把背景音乐压低 */
export const DUCKS: Readonly<Partial<Record<Channel, readonly Channel[]>>> = { voice: ['bgm'] };

/** 念台词时 BGM 默认压到原音量的 35%;设置里可以改 */
export const DEFAULT_DUCK_LEVEL = 0.35;

/** 压下去要快、淡回来慢一点(setTargetAtTime 的时间常数,秒):念完 0.5 秒内淡回 */
const DUCK_DOWN = 0.08;
const DUCK_UP = 0.15;
/** 拖音量滑条时平滑过去,不咔哒 */
const LEVEL_SMOOTH = 0.05;

// ---- 压低的规则(纯函数,好测) ----

/** 压低的状态:被压的声道 → 正在压它的那几条声道 */
export type DuckState = ReadonlyMap<Channel, ReadonlySet<Channel>>;

/** by 这条声道开始 / 停止出声以后的压低状态。它压谁看 rules(默认 DUCKS) */
export function nextDuck(
  state: DuckState,
  by: Channel,
  on: boolean,
  rules: Readonly<Partial<Record<Channel, readonly Channel[]>>> = DUCKS,
): Map<Channel, Set<Channel>> {
  const next = new Map<Channel, Set<Channel>>();
  for (const [ch, set] of state) next.set(ch, new Set(set));
  for (const target of rules[by] ?? []) {
    const set = next.get(target) ?? new Set<Channel>();
    if (on) set.add(by);
    else set.delete(by);
    if (set.size) next.set(target, set);
    else next.delete(target);
  }
  return next;
}

/** 这条声道的「压低」那一级该淡到多少、多快:有谁压着就压到 level,没有就回到 1 */
export function duckRamp(state: DuckState, channel: Channel, level: number): { target: number; timeConstant: number } {
  return (state.get(channel)?.size ?? 0) > 0
    ? { target: level, timeConstant: DUCK_DOWN }
    : { target: 1, timeConstant: DUCK_UP };
}

// ---- 总线 ----

/** 总线用到的 document 那一点:切后台挂起要看 hidden、听 visibilitychange(测试里换成假的) */
export interface BusDocument {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface AudioBusDeps {
  /** 新建一个 AudioContext;浏览器不支持时 null */
  createContext?: () => AudioContext | null;
  document?: BusDocument | null;
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

function browserContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

const browserDocument = (): BusDocument | null => (typeof document !== 'undefined' ? document : null);

interface ChannelNodes {
  /** 这条声道的音量(滑条);声音接到这里 */
  input: GainNode;
  /** 串在音量后面,被别的声道压低时调它;和音量滑条分开,互不影响 */
  duck: GainNode;
}

const SFX_BASE = '/vn/sfx/';
// 失败过的文件隔一会儿再试:跳字音每隔一个字就要放一次,文件真没有的话不能每个字都去下一遍
const RETRY_AFTER_MS = 30_000;

export class AudioBus {
  private readonly createContext: () => AudioContext | null;
  private readonly doc: BusDocument | null;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: Map<Channel, ChannelNodes> | null = null;
  /** 每条声道的音量:还没解锁时先记着,解锁建声道时用 */
  private levels = new Map<Channel, number>(CHANNELS.map((c) => [c, 1]));
  private duckLevel = DEFAULT_DUCK_LEVEL;
  private ducks: DuckState = new Map();
  private isActive = false;
  private suspendTimer: ReturnType<typeof setTimeout> | undefined;
  private unlockListeners = new Set<() => void>();
  /** 总线还没解锁时给短音效试听另开的那个 */
  private shortCtx: AudioContext | null = null;
  private clips = new Map<string, Promise<AudioBuffer | null>>();
  private clipFailedAt = new Map<string, number>();

  constructor(deps: AudioBusDeps = {}) {
    this.createContext = deps.createContext ?? browserContext;
    this.doc = deps.document === undefined ? browserDocument() : deps.document;
    if (this.doc) {
      const doc = this.doc;
      // 切到后台就停,回来接着放(手机锁屏、切 App 时不该一直响)
      doc.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (doc.hidden) void this.ctx.suspend().catch(() => {});
        else if (this.isActive) void this.ctx.resume().catch(() => {});
      });
    }
  }

  private get hidden(): boolean {
    return this.doc?.hidden ?? false;
  }

  /** 语音、背景音乐、短音效共用的 AudioContext(iOS 只用解锁一次)。还没解锁时是 null */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** 这条声道的入口(声音接到这里)。还没解锁时是 null */
  input(channel: Channel): GainNode | null {
    return this.nodes?.get(channel)?.input ?? null;
  }

  /** 视觉小说界面开着(setActive(true) 以后、setActive(false) 以前) */
  get active(): boolean {
    return this.isActive;
  }

  /** 解锁时要做的事(背景音乐:解锁之前就要求过的曲子,现在补上)。返回取消订阅 */
  onUnlock(fn: () => void): () => void {
    this.unlockListeners.add(fn);
    return () => this.unlockListeners.delete(fn);
  }

  /**
   * 在用户手势(点击、按键)里调用:第一次会创建 AudioContext,之后每次确保它在运行。
   * iOS 上 AudioContext 只能在手势里启动;锁屏回来后也可能被系统挂起,要再点一下。
   */
  unlock() {
    if (!this.ctx) {
      const ctx = this.createContext();
      if (!ctx) return;
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      const nodes = new Map<Channel, ChannelNodes>();
      for (const ch of CHANNELS) {
        const input = ctx.createGain();
        input.gain.value = this.levels.get(ch) ?? 1;
        const duck = ctx.createGain();
        input.connect(duck);
        duck.connect(this.master);
        nodes.set(ch, { input, duck });
      }
      this.nodes = nodes;
    }
    if (this.ctx.state !== 'running' && !this.hidden) void this.ctx.resume().catch(() => {});
    for (const fn of this.unlockListeners) fn();
  }

  /**
   * 视觉小说界面打开 / 关闭。关闭时等 suspendAfterMs(背景音乐淡出的时间)再挂起,不占声卡;
   * 这段时间里又打开了就不挂
   */
  setActive(on: boolean, suspendAfterMs: number) {
    this.isActive = on;
    clearTimeout(this.suspendTimer);
    if (on) {
      if (this.ctx && this.ctx.state !== 'running' && !this.hidden) {
        void this.ctx.resume().catch(() => {});
      }
      return;
    }
    this.suspendTimer = setTimeout(() => {
      if (!this.isActive) void this.ctx?.suspend().catch(() => {});
    }, suspendAfterMs);
  }

  /** 这条声道的音量(0–1,已经按听感换算过的)。还没解锁时先记着 */
  setLevel(channel: Channel, level: number) {
    this.levels.set(channel, level);
    const node = this.nodes?.get(channel);
    if (this.ctx && node) node.input.gain.setTargetAtTime(level, this.ctx.currentTime, LEVEL_SMOOTH);
  }

  /** 念台词时 BGM 压到多少(1 = 不压)。正压着的时候改,立刻按新值压 */
  setDuckLevel(v: number) {
    this.duckLevel = Math.min(1, Math.max(0, v));
    for (const ch of this.ducks.keys()) this.applyDuck(ch);
  }

  /** by 这条声道开始 / 停止出声:压低它该压的声道(语音 → 背景音乐压到设置的那么多,念完 0.5 秒内淡回) */
  duck(by: Channel, on: boolean) {
    this.ducks = nextDuck(this.ducks, by, on);
    for (const target of DUCKS[by] ?? []) this.applyDuck(target);
  }

  private applyDuck(channel: Channel) {
    const node = this.nodes?.get(channel);
    if (!this.ctx || !node) return;
    const g = node.duck.gain;
    const now = this.ctx.currentTime;
    const { target, timeConstant } = duckRamp(this.ducks, channel, this.duckLevel);
    g.cancelScheduledValues(now);
    g.setTargetAtTime(target, now, timeConstant);
  }

  // ---- 短音效:立绘特效音、跳字音 ----

  /**
   * 短音效往哪儿放。游戏里用总线那个:它在玩家点击时解锁过(iOS 上 AudioContext 只能在手势里启动,
   * 自己建的那个从没在手势里 resume 过,一直是哑的)。总线还没解锁时(插件页、设置页试听)才用
   * 自己另开的那个、直接接扬声器 —— 试听是点按钮触发的,resume 在手势里
   */
  shortOut(channel: ShortChannel): { ac: AudioContext; out: AudioNode } | null {
    const ac = this.shortContext();
    if (!ac) return null;
    const out = ac === this.ctx ? this.input(channel) : null;
    return { ac, out: out ?? ac.destination };
  }

  private shortContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    this.shortCtx ??= this.createContext();
    return this.shortCtx;
  }

  /**
   * 挂起着的能不能叫醒。总线那个是切到后台时故意挂起的:后台里自动播放还在翻句,
   * 这时候放个音效把它叫醒,BGM 和语音就在后台接着响了 —— 后台不出音效
   */
  mayWake(ac: AudioContext): boolean {
    return !(ac === this.ctx && this.hidden);
  }

  private loadClip(file: string): Promise<AudioBuffer | null> {
    let p = this.clips.get(file);
    if (!p) {
      const failed = this.clipFailedAt.get(file);
      if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return Promise.resolve(null);
      const ac = this.shortContext();
      p = ac
        ? fetch(SFX_BASE + file)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
            .then((b) => ac.decodeAudioData(b))
            .catch(() => null)
        : Promise.resolve(null);
      this.clips.set(file, p);
      // 没拿到(网络抖了一下、开发服务器在重启)不记:不然这个音效这次打开页面里一直是哑的
      const mine = p;
      void mine.then((buf) => {
        if (buf !== null) this.clipFailedAt.delete(file);
        else if (this.clips.get(file) === mine) {
          this.clips.delete(file);
          this.clipFailedAt.set(file, Date.now());
        }
      });
    }
    return p;
  }

  /** 提前解码(public/vn/sfx/ 下的文件名),第一次放的时候不用等下载 */
  preloadClips(files: (string | undefined)[]): void {
    for (const f of files) if (f) void this.loadClip(f);
  }

  /** 放一个短音效文件(public/vn/sfx/ 下的文件名) */
  async playClip(channel: ShortChannel, file: string, volume: number): Promise<void> {
    const o = this.shortOut(channel);
    if (!o || volume <= 0) return;
    const { ac, out } = o;
    if (ac.state === 'suspended') {
      if (!this.mayWake(ac)) return;
      await ac.resume().catch(() => undefined);
    }
    const buf = await this.loadClip(file);
    if (!buf) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const gain = ac.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(out);
    src.start();
  }
}

export const audioBus = new AudioBus();
