/**
 * 把高频调用合成低频:第一次马上执行,之后最多每 ms 毫秒执行一次;间隔里的调用只记一笔,
 * 到点执行一次(fn 自己去读那时最新的值,所以不传参数)。
 * flush():有待执行的就马上执行 —— 收尾前调用,最后一段不丢;cancel():丢掉待执行的。
 *
 * 流式写字用它(DebugApp 的 runGeneration):模型每秒推几十段字,每段都改一次条目,整个页面
 * 就跟着重画几十遍;攒成每 0.1 秒一次,眼睛看不出差别。
 */
export interface Throttled {
  (): void;
  flush: () => void;
  cancel: () => void;
}

export function throttle(fn: () => void, ms: number): Throttled {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    timer = undefined;
    last = Date.now();
    fn();
  };
  const call = (() => {
    if (timer !== undefined) return;
    const wait = last + ms - Date.now();
    if (wait <= 0) run();
    else timer = setTimeout(run, wait);
  }) as Throttled;
  call.flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    run();
  };
  call.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return call;
}
