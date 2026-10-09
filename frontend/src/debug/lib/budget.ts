/**
 * 预算条的刻度与持久化。
 *
 * 预算本身记在预设里,和酒馆一样是 openai_max_context:换预设跟着变,导入酒馆预设直接生效。
 * 「不截断」酒馆没有,另记一个 anima_context_off。量程只是看的范围,还是按设备记。
 *
 * 轨道是线性的,量程(轨道右端代表多少 token)由 −/+ 在阶梯上换挡 ——
 * 线性才能让固定开销的填充段长度是真比例,换挡等于把那两段放大缩小着看。
 */

const RANGE_KEY = 'debug.tokenRange';

export const DEFAULT_BUDGET = 16384;

/** 预设里的预算。null = 不截断;预设没写就用默认值 */
export function budgetFromParams(params: Record<string, unknown>): number | null {
  if (params.anima_context_off === true) return null;
  const n = Number(params.openai_max_context);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_BUDGET;
}

/** 把预算写回预设参数。关掉时 openai_max_context 留着原值,再打开回到它 */
export function paramsWithBudget<T extends Record<string, unknown>>(params: T, value: number | null): T {
  const next: Record<string, unknown> = { ...params };
  if (value === null) {
    next.anima_context_off = true;
  } else {
    delete next.anima_context_off;
    next.openai_max_context = value;
  }
  return next as T;
}

/** 量程阶梯。挡距在小值处密、大值处疏,和常用上下文长度对齐 */
export const RANGE_STEPS = [8192, 16384, 32768, 65536, 131072, 204800];

export function loadRange(): number | null {
  const raw = window.localStorage.getItem(RANGE_KEY);
  if (raw === null) return null;
  const n = Number(raw);
  return RANGE_STEPS.includes(n) ? n : null;
}

export function saveRange(value: number): void {
  window.localStorage.setItem(RANGE_KEY, String(value));
}

/** 阶梯上移/下移一挡。越界就钉在端点上,不循环 */
export function stepRange(current: number, dir: 1 | -1): number {
  const i = RANGE_STEPS.indexOf(current);
  if (i === -1) return autoRange(current);
  const next = Math.min(RANGE_STEPS.length - 1, Math.max(0, i + dir));
  return RANGE_STEPS[next];
}

/** 最小的、装得下 budget 的那一挡;超过顶端就钉在最高挡 */
export function autoRange(budget: number): number {
  return RANGE_STEPS.find((r) => r >= budget) ?? RANGE_STEPS[RANGE_STEPS.length - 1];
}

/** show more 的渲染窗口大小。设置 UI 下一轮再补,先把接口留好 */
const VISIBLE_KEY = 'debug.visibleMessages';

export const DEFAULT_VISIBLE = 50;

export function loadVisible(): number {
  const raw = window.localStorage.getItem(VISIBLE_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 10 ? Math.floor(n) : DEFAULT_VISIBLE;
}
