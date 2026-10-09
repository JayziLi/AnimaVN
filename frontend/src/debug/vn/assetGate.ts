/**
 * 素材预加载:图片整张下载完才算到齐。等待页和「新图好了才换上」都靠它。
 * 「只画了一半」是边下边画造成的,下完了再显示就不会;不用 img.decode() 提前解码 ——
 * 一口气解码三十来张大图,手机上又吃 CPU 又吃内存(实测无头浏览器里有缓存时也要 1–4 秒),
 * 真正显示时浏览器自己解码,一张几十毫秒。
 *
 * 用户要的(2026-09-27):手机上每次进游戏、换立绘都看到图只画了一半,体验很怪 ——
 *   - 等 1–4 秒可以接受;超过 4 秒就先进去,剩下的后台接着下
 *   - 但封面和开头几句对话要用的素材,进之前必须到齐
 * 所以素材分两档:must(封面 + 接下来几句要用的)一定等到;nice(这张卡其余的立绘、背景)
 * 最多等到 4 秒。音乐不在这里,由 bgm.ts 自己预取。读得快(有缓存)就不露等待页。
 *
 * 按地址记着:同一张图一次打开里只下载一次。跨次打开靠浏览器的 HTTP 缓存
 * (立绘、背景的接口给了一年的 immutable 缓存,地址里带版本号)。
 */

import { useEffect, useState } from 'react';

const loads = new Map<string, Promise<void>>();
/** 下完了(成功或失败都算:坏图不能把人卡在等待页上) */
const settled = new Set<string>();
/** 下好的图的宽高比(高 / 宽):竖长的 CG 要上下慢慢移着看 */
const ratios = new Map<string, number>();

/** 下载一张图(进浏览器缓存);同一个地址只做一次 */
export function loadImage(src: string): Promise<void> {
  let p = loads.get(src);
  if (!p) {
    p = new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => {
        if (img.naturalWidth > 0) ratios.set(src, img.naturalHeight / img.naturalWidth);
        settled.add(src);
        resolve();
      };
      img.src = src;
    });
    loads.set(src, p);
  }
  return p;
}

export const isSettled = (src: string) => settled.has(src);

/** 高 / 宽;还没用 loadImage 下过的是 null */
export const imageRatio = (src: string) => ratios.get(src) ?? null;

/** 等待页上按种类数进度:「立绘 9/15 · 背景 3/17」 */
export interface GateItem {
  src: string;
  kind: string;
}

export interface GateProgress {
  kind: string;
  done: number;
  total: number;
}

export interface GateState {
  /** 这一组可以进了:must 到齐,nice 到齐或者已经等了 4 秒 */
  ready: boolean;
  /** 等了很久 must 还没齐(网很慢):等待页上露出「先进去」 */
  slow: boolean;
  progress: GateProgress[];
  /** 进度环,0–1:走到头就进。85% 是 must(真正在等的),剩下 15% 按 nice 的进度或 4 秒的时间走,
   *  哪个快按哪个 —— 不然 must 齐了环满了还停着,或者 4 秒到了环才六成就跳进去 */
  fraction: number;
  /** 不等了,先进去 */
  skip: () => void;
}

/** nice 最多等这么久(从这一组开始算) */
export const NICE_WAIT_MS = 4000;
/** 等这么久 must 还没齐:给个「先进去」 */
const SLOW_MS = 12000;

/**
 * 一组素材的闸门。key 是「这一组」的身份(卡 + 立绘包):变了就重新等;
 * 同一个 key 放行过之后,列表再变(翻到别的句子)也不再拦 —— 那时候由「新图好了才换上」兜着。
 * dataReady:立绘、场景、对话的列表本身都拿到了(还没拿到时不知道要等哪些图)。
 */
export function useAssetGate(key: string, dataReady: boolean, must: GateItem[], nice: GateItem[]): GateState {
  const [passed, setPassed] = useState<string | null>(null);
  const [start, setStart] = useState(() => ({ key, at: Date.now() }));
  if (start.key !== key) setStart({ key, at: Date.now() });
  // 下完一张、到了某个时间点,都靠它重新渲染一次
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const ready = passed === key;

  useEffect(() => {
    if (ready) return;
    const timers = [NICE_WAIT_MS, SLOW_MS].map((ms) => window.setTimeout(bump, ms + 20));
    // 进度环有一段按时间走,没进门之前隔一会儿刷一下
    const every = window.setInterval(bump, 250);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearInterval(every);
    };
  }, [key, ready]);

  const mustSig = must.map((i) => i.src).join('\n');
  const niceSig = nice.map((i) => i.src).join('\n');
  useEffect(() => {
    if (!dataReady) return;
    let alive = true;
    const tick = () => {
      if (alive) bump();
    };
    const mustSrcs = mustSig ? mustSig.split('\n') : [];
    const niceSrcs = niceSig ? niceSig.split('\n') : [];
    // must 先下,下完再下其余的:带宽先给马上要看到的。清单变了(对话读完、表情认出来了)
    // 这一轮就作废 —— 作废的那轮不能再去下 nice,否则会和新一轮的 must 抢带宽
    void Promise.all(mustSrcs.map((s) => loadImage(s).then(tick))).then(() => {
      if (!alive) return;
      for (const s of niceSrcs) void loadImage(s).then(tick);
    });
    return () => {
      alive = false;
    };
  }, [dataReady, mustSig, niceSig]);

  const elapsed = Date.now() - (start.key === key ? start.at : Date.now());
  const mustDone = must.every((i) => settled.has(i.src));
  const niceDone = nice.every((i) => settled.has(i.src));
  const canPass = dataReady && mustDone && (niceDone || elapsed >= NICE_WAIT_MS);

  useEffect(() => {
    if (canPass && passed !== key) setPassed(key);
  }, [canPass, passed, key]);

  // settled 是模块里的集合,变化靠 tick 触发重新渲染;每次渲染都重算(几十张图,很便宜)
  const by = new Map<string, GateProgress>();
  for (const i of [...must, ...nice]) {
    const g = by.get(i.kind) ?? { kind: i.kind, done: 0, total: 0 };
    g.total += 1;
    if (settled.has(i.src)) g.done += 1;
    by.set(i.kind, g);
  }
  const progress = [...by.values()];
  const part = (items: GateItem[]) =>
    items.length ? items.filter((i) => settled.has(i.src)).length / items.length : 1;
  const fraction = !dataReady
    ? 0
    : !mustDone
      ? 0.85 * part(must)
      : 0.85 + 0.15 * Math.max(part(nice), Math.min(1, elapsed / NICE_WAIT_MS));

  return {
    ready: ready || canPass,
    slow: !(ready || canPass) && elapsed >= SLOW_MS,
    progress,
    fraction,
    skip: () => setPassed(key),
  };
}

/**
 * 换图时先留着旧的,新图下载完了再换上 —— 不会看到只画了一半的图。
 * 同一张图只是挪了位置、改了焦点(key 不变):马上用新的。
 */
export function useSettledView<T extends { key: string; src: string | null }>(view: T): T {
  const [shown, setShown] = useState(view);
  const ok = !view.src || settled.has(view.src) || view.key === shown.key;
  useEffect(() => {
    // 只在换了图时记下来:同一张图的 view 对象每次渲染可能都是新的,每次都存会死循环
    const keep = () => setShown((s) => (s.key === view.key ? s : view));
    if (ok) {
      keep();
      return;
    }
    let alive = true;
    void loadImage(view.src as string).then(() => {
      if (alive) keep();
    });
    return () => {
      alive = false;
    };
  }, [view, ok]);
  return ok ? view : shown;
}
