/**
 * 本地 SD 连接下这张卡的一组 LoRA(设计 docs/superpowers/specs/2026-11-07-imagegen-backends-design.md 第 5 节)。
 * 纯函数,有测试(loras.test.ts)。开着的后端写成 <lora:名字:权重> 接在提示词最后,关着的照发、后端过滤
 */

export interface LoraPick {
  /** 服务上的名字(发的就是它,别名只用来显示) */
  name: string;
  /** 0–2,默认 1 */
  weight: number;
  on: boolean;
  /** 触发词;有的话后端接在人数标签后面 */
  trigger: string;
}

/** 后端一次最多收 20 个 */
export const LORA_MAX = 20;
export const LORA_WEIGHT = { min: 0, max: 2, step: 0.05 } as const;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const weightOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(LORA_WEIGHT.max, Math.max(LORA_WEIGHT.min, v)) * 100) / 100 : 1);

/** 存的值容错(setup 里的,也可能是旧版本写的) */
export function normalizeLoras(raw: unknown): LoraPick[] {
  if (!Array.isArray(raw)) return [];
  const out: LoraPick[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (!isObj(v) || typeof v.name !== 'string') continue;
    const name = v.name.trim().slice(0, 200);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      weight: weightOf(v.weight),
      on: typeof v.on === 'boolean' ? v.on : true,
      trigger: typeof v.trigger === 'string' ? v.trigger.slice(0, 200) : '',
    });
    if (out.length === LORA_MAX) break;
  }
  return out;
}

export const toggleLora = (list: readonly LoraPick[], name: string): LoraPick[] =>
  list.map((l) => (l.name === name ? { ...l, on: !l.on } : l));

export function patchLora(list: readonly LoraPick[], name: string, patch: Partial<Pick<LoraPick, 'weight' | 'trigger'>>): LoraPick[] {
  return list.map((l) =>
    l.name === name
      ? { ...l, ...patch, ...(patch.weight !== undefined ? { weight: weightOf(patch.weight) } : {}) }
      : l,
  );
}

export function addLora(list: readonly LoraPick[], name: string): LoraPick[] {
  const n = name.trim();
  if (!n || list.length >= LORA_MAX || list.some((l) => l.name === n)) return [...list];
  return [...list, { name: n, weight: 1, on: true, trigger: '' }];
}

export const removeLora = (list: readonly LoraPick[], name: string): LoraPick[] => list.filter((l) => l.name !== name);

/** 小标签上的权重:1.0、0.8、0.85 */
export const loraWeightText = (w: number): string => (Math.round(w * 100) % 10 === 0 ? w.toFixed(1) : w.toFixed(2));

/** 实际写进提示词的样子(悬停提示) */
export const loraTag = (l: LoraPick): string => `<lora:${l.name}:${loraWeightText(l.weight)}>`;

/** /options 回的 LoRA 列表 → 名字。拿不到(服务没这个接口)是 null,界面改成手填 */
export function loraNames(raw: readonly unknown[] | undefined): string[] | null {
  if (!raw) return null;
  const out: string[] = [];
  for (const v of raw) {
    const name = typeof v === 'string' ? v : isObj(v) && typeof v.name === 'string' ? v.name : '';
    if (name) out.push(name);
  }
  return out;
}

/** 「+」打开的列表:没加过的,按名字搜(不分大小写) */
export function loraChoices(all: readonly string[], picked: readonly LoraPick[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const have = new Set(picked.map((l) => l.name));
  return all.filter((n) => !have.has(n) && (!q || n.toLowerCase().includes(q)));
}
