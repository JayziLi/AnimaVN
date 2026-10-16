/**
 * 背景音乐播放器(全局单例,视觉小说界面和插件抽屉的试听共用)。
 *
 * 用 Web Audio(fetch → decodeAudioData → AudioBufferSourceNode)而不是 <audio>:
 *   - iOS Safari 不许网页改 <audio> 的音量,淡入淡出只能靠 GainNode
 *   - <audio> 每次 play() 都要有用户手势;AudioContext 只要在点击里解锁一次,
 *     之后 AI 回复里换曲子,不用再点就能响
 *   - 整首解码后循环是无缝的,<audio loop> 的 MP3 在接缝处会顿一下
 * 代价是解码后的 PCM 比较占内存(一首三分钟的曲子几十 MB),所以只缓存最近几首。
 *
 * AudioContext、解锁、切后台挂起、念台词时压低 BGM 都在音频总线(audioBus.ts)上,这里走它的 bgm 声道。
 */

import { useSyncExternalStore } from 'react';
import { audioBus } from './audioBus';

/** 换歌时交叉淡入淡出的秒数 */
const FADE = 1.5;
/** 解码后的曲子最多留几首 */
const MAX_BUFFERS = 3;
const STORE_KEY = 'anima.vn.audio';

interface Track {
  url: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export interface BgmSnapshot {
  /** 最后一次要求播放的曲子(还在下载 / 解码时也算) */
  wanted: string | null;
  /** 正在出声的曲子 */
  playing: string | null;
  /** 插件页正在试听的曲子(视觉小说里场景自己在放的不算) */
  preview: string | null;
  volume: number;
  muted: boolean;
  /** 下载或解码失败的曲子 → 原因 */
  error: string | null;
  /** 解码过的曲子有多长(秒,按地址记);卡编辑器的 BGM 栏读到了才显示时长 */
  durations: Readonly<Record<string, number>>;
}

class BgmPlayer {
  private current: Track | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  /** 最近一次下载 / 解码失败的曲子(play 换曲子时清掉) */
  private failedUrl: string | null = null;
  /** 插件页试听之前在放什么:停止试听时还原(在视觉小说菜单里试听完,场景的曲子接着放) */
  private beforePreview: { wanted: string | null; active: boolean } | null = null;
  private listeners = new Set<() => void>();
  private snap: BgmSnapshot = {
    wanted: null,
    playing: null,
    preview: null,
    volume: 0.7,
    muted: false,
    error: null,
    durations: {},
  };

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as {
        volume?: unknown;
        muted?: unknown;
      } | null;
      if (saved && typeof saved.volume === 'number') {
        this.snap.volume = Math.min(1, Math.max(0, saved.volume));
      }
      if (saved && typeof saved.muted === 'boolean') this.snap.muted = saved.muted;
    } catch {
      // 隐私模式等拿不到 localStorage,用默认音量
    }
    audioBus.setLevel('bgm', this.level());
    // 解锁之前就要求过的曲子,解锁时补上
    audioBus.onUnlock(() => void this.sync());
  }

  // ---- 给 React 订阅 ----

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;
  private set(patch: Partial<BgmSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  // ---- 控制 ----

  /** 解锁声音:就是 audioBus.unlock()(解锁之前要求过的曲子跟着补上)。调试台开视觉小说时还在用这个名字 */
  unlock() {
    audioBus.unlock();
  }

  /** 视觉小说界面打开 / 关闭(关闭时淡出,淡完挂起,不占声卡) */
  setActive(on: boolean) {
    audioBus.setActive(on, FADE * 1000 + 300);
    if (!on) this.play(null);
  }

  /** 试听一首(插件页)。要在点击里调:顺手解锁 */
  startPreview(url: string) {
    this.beforePreview ??= { wanted: this.snap.wanted, active: audioBus.active };
    this.set({ preview: url });
    audioBus.unlock();
    this.setActive(true);
    this.play(url);
  }

  /** 停止试听,还原成试听之前的样子。没在试听时什么也不做 */
  stopPreview() {
    const before = this.beforePreview;
    if (!before) return;
    this.beforePreview = null;
    this.set({ preview: null });
    // 试听期间视觉小说关了(先于插件页卸载)的话,audioBus.active 已经是 false,别再放出声来
    if (before.active && audioBus.active) this.play(before.wanted);
    else this.setActive(false);
  }

  /** 换成这首(null = 淡出到静音)。和正在放的是同一首时什么也不做 */
  play(url: string | null) {
    if (url === this.snap.wanted) return;
    this.failedUrl = null;
    this.set({ wanted: url, error: null });
    void this.sync();
  }

  /** 提前下载 + 解码,切过去时不用等 */
  prefetch(url: string) {
    if (audioBus.context) {
      void this.load(url).catch(() => {});
    } else {
      // 还没解锁就没有 AudioContext 可以解码,先把文件拉进浏览器缓存
      void fetch(url).catch(() => {});
    }
  }

  setVolume(v: number) {
    this.set({ volume: Math.min(1, Math.max(0, v)) });
    this.applyLevel();
  }

  setMuted(m: boolean) {
    this.set({ muted: m });
    this.applyLevel();
  }

  // ---- 内部 ----

  /** 滑条是线性的,耳朵听响度是对数的:平方一下,滑条中间听起来才像「一半」 */
  private level() {
    return this.snap.muted ? 0 : this.snap.volume * this.snap.volume;
  }

  private applyLevel() {
    audioBus.setLevel('bgm', this.level());
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ volume: this.snap.volume, muted: this.snap.muted }),
      );
    } catch {
      // 存不了就只在这次打开里生效
    }
  }

  private load(url: string): Promise<AudioBuffer> {
    const hit = this.buffers.get(url);
    if (hit) {
      // 挪到最后 = 最近用过
      this.buffers.delete(url);
      this.buffers.set(url, hit);
      return hit;
    }
    const ctx = audioBus.context!;
    const p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`下载失败(HTTP ${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        if (this.snap.durations[url] !== decoded.duration) {
          this.set({ durations: { ...this.snap.durations, [url]: decoded.duration } });
        }
        return decoded;
      });
    // 只删自己:这条可能早被挤出缓存、换成了同一地址的新请求,别把新的删了
    p.catch(() => {
      if (this.buffers.get(url) === p) this.buffers.delete(url);
    });
    this.buffers.set(url, p);
    while (this.buffers.size > MAX_BUFFERS) {
      const oldest = this.buffers.keys().next().value as string;
      this.buffers.delete(oldest);
    }
    return p;
  }

  private async sync() {
    const url = this.snap.wanted;
    const ctx = audioBus.context;
    const out = audioBus.input('bgm');
    if (!ctx || !out) return; // 还没解锁;解锁时(audioBus.onUnlock)会再调一次
    if ((this.current?.url ?? null) === url) return;
    // 这首刚失败过(404、解码不了):别每次点击解锁时都再下一遍、再报一遍错。换曲子(play)时清掉
    if (url !== null && url === this.failedUrl) return;
    if (url === null) {
      this.fadeOut();
      this.set({ playing: null });
      return;
    }

    let buffer: AudioBuffer;
    try {
      buffer = await this.load(url);
    } catch (e) {
      if (this.snap.wanted === url) {
        this.failedUrl = url;
        this.set({ error: e instanceof Error ? e.message : '这首曲子解码失败(格式不支持?)' });
      }
      return;
    }
    // 下载 / 解码的这段时间里又换了曲子,或者别的 sync 已经把它放上了
    if (this.snap.wanted !== url || this.current?.url === url) return;

    this.fadeOut();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE);
    gain.connect(out);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.current = { url, source, gain };
    this.set({ playing: url });
  }

  private fadeOut() {
    const t = this.current;
    const ctx = audioBus.context;
    if (!t || !ctx) return;
    this.current = null;
    const now = ctx.currentTime;
    // 先读当前音量再取消排程:有的浏览器取消掉正在进行的淡入后 value 读出来是 0,音量会一下跳没
    const level = t.gain.gain.value;
    t.gain.gain.cancelScheduledValues(now);
    t.gain.gain.setValueAtTime(level, now);
    t.gain.gain.linearRampToValueAtTime(0, now + FADE);
    t.source.onended = () => t.gain.disconnect();
    t.source.stop(now + FADE + 0.05);
  }
}

export const bgmPlayer = new BgmPlayer();

export function useBgm(): BgmSnapshot {
  return useSyncExternalStore(bgmPlayer.subscribe, bgmPlayer.getSnapshot);
}
