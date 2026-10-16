/**
 * 时间线测试用的假数据:立绘、场景素材、切好的回复、认表情、形态,外加一个随机对话生成器(固定种子,结果可复现)。
 * 只给测试用,本身不是测试文件(文件名不带 .test)。
 */
import type { PackSprite, SceneAsset } from '../lib/api';
import type { ChatEntry } from '../lib/chatEntry';
import { resolveByLabel } from '../plugins/common';
import { emotionCandidates, type TagMatch, type TagResolver } from '../plugins/emotionMatch';
import type { TagHit, VNLine } from '../vn/script';
import type { Beat } from './beats';
import type { FormsLens, Pos, TimelineCtx } from './timeline';

export const CHAR = '星绘';

export const sprite = (id: string, label: string, aliases: string[] = []): PackSprite =>
  ({ id, label, aliases, has_image: true }) as unknown as PackSprite;

export const asset = (
  o: { id: string; kind: 'bg' | 'bgm' | 'cg'; label: string } & Partial<Omit<SceneAsset, 'id' | 'kind' | 'label'>>,
): SceneAsset =>
  ({ aliases: [], has_file: true, bgm_id: null, parent_id: null, forms: [], focus_x: 50, ...o }) as unknown as SceneAsset;

/** 一个标签;写在回复末尾的 lineIndex 是 -1、没有说话人 */
export const hit = (kind: string, label: string, lineIndex: number, speaker?: string | null): TagHit => ({
  kind,
  raw: `<${kind}:${label}>`,
  label,
  lineIndex,
  ...(lineIndex === -1 ? {} : { speaker: speaker === undefined ? CHAR : speaker }),
});

export function beat(id: string, lines: number, hits: TagHit[], role: 'user' | 'assistant' = 'assistant'): Beat {
  const entry: ChatEntry = {
    id,
    role,
    swipes: [''],
    swipeIndex: 0,
    swipeInfo: [{ sendDate: '' }],
    overswipe: 'regenerate',
  };
  if (role === 'user') return { entry, parsed: null, raw: '' };
  const vnLines: VNLine[] = Array.from({ length: lines }, () => ({ speaker: CHAR, text: '……' }));
  return { entry, parsed: { lines: vnLines, hits, ends: vnLines.map((_, i) => i + 1) }, raw: '' };
}

/** 认表情:先按名字 / 别名精确找;overrides 里写了的按它(模型认的、还在认) */
export function resolverOf(sprites: readonly PackSprite[], overrides: Record<string, TagMatch> = {}): TagResolver {
  const candidates = emotionCandidates(sprites);
  return (label) => {
    const o = overrides[label.trim()];
    if (o) return o;
    const exact = resolveByLabel(label.trim(), candidates);
    return exact ? { state: 'exact', label: exact.label } : { state: 'failed', reason: '假的:认不出' };
  };
}

// ── 测试用的形态 ──
// 真正的形态在形态卡带里(公开版没有),它有自己的测试,也拿这里的随机对话对照过。内核的测试用这套中性的:
// 规则照形态卡带 —— 名字以 ALT 开头的立绘算 alt 组;某句的形态 = 它之前(含同一句)最近的记号,没有是 normal;
// 表情不属于这句的形态时换成这组排第一的(这组一张都没有就用全部的第一张);CG 标了 forms 时只在列着的形态出

export const ALT = '变身';
export type TestForm = 'normal' | 'alt';
export const TEST_FORM_NAMES: Record<TestForm, string> = { normal: '普通', alt: ALT };

/** 玩家在 entryId 这条的第 line 句切成了 form */
export interface TestSwitch {
  entryId: string;
  line: number;
  form: string;
}

const groupOf = (label: string): TestForm => (label.startsWith(ALT) ? 'alt' : 'normal');

/** 造形态接口的函数:内核测试用 testLens,形态卡带的测试换成真的 */
export type LensMaker = (
  switches: readonly TestSwitch[],
  entryIds: readonly string[],
  sprites: readonly PackSprite[],
  current: string,
) => FormsLens;

export const testLens: LensMaker = (switches, entryIds, sprites, current) => {
  const order = new Map(entryIds.map((id, i) => [id, i] as const));
  const formAt = (index: number, line: number): string => {
    let best: { index: number; line: number; form: string } | null = null;
    for (const s of switches) {
      const i = order.get(s.entryId);
      if (i === undefined || i > index || (i === index && s.line > line)) continue;
      if (!best || i > best.index || (i === best.index && s.line >= best.line)) best = { index: i, line: s.line, form: s.form };
    }
    return best?.form ?? 'normal';
  };
  const cgOk = (cg: SceneAsset, form: string) =>
    !cg.forms?.length || cg.forms.includes(TEST_FORM_NAMES[form as TestForm]);
  const pos = (entryId: string, line: number): Pos => ({ index: order.get(entryId) ?? Number.MAX_SAFE_INTEGER, line });
  const after = (a: Pos, b: Pos) => a.index > b.index || (a.index === b.index && a.line > b.line);
  return {
    formFor: (entryId, line) => {
      const index = order.get(entryId);
      return index === undefined ? current : formAt(index, line);
    },
    labelIn: (label, form) => {
      if (label !== null && groupOf(label) === form) return label;
      const group = sprites.filter((s) => groupOf(s.label) === form);
      return (group.length > 0 ? group : sprites)[0]?.label ?? label;
    },
    cgOk,
    switchedAway: (cg, from, to) =>
      switches.some((s) => {
        const index = order.get(s.entryId);
        if (index === undefined || cgOk(cg, s.form)) return false;
        const at = { index, line: s.line };
        return after(at, from) && !after(at, to);
      }),
    pos,
  };
};

export function lensOf(
  switches: TestSwitch[],
  entryIds: readonly string[],
  sprites: readonly PackSprite[],
  current: string = 'normal',
): FormsLens {
  return testLens(switches, entryIds, sprites, current);
}

export function ctxOf(o: {
  sprites: readonly PackSprite[];
  sceneAssets?: readonly SceneAsset[];
  resolve?: TagResolver;
  forms?: FormsLens | null;
}): TimelineCtx {
  return {
    sprites: o.sprites,
    sceneAssets: o.sceneAssets ?? [],
    emotion: { resolve: o.resolve ?? resolverOf(o.sprites), rawOnFail: o.sprites.length === 0, charName: CHAR },
    forms: o.forms ?? null,
  };
}

/** 固定种子的随机数(mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 随机对话里形态用哪一套:内核测试用中性的这套,形态卡带的测试换成真的(前缀、形态、CG 上标的名字、接口) */
export interface FormsKit {
  /** 第二组立绘名字的前缀 */
  prefix: string;
  /** 第二组的形态 */
  alt: string;
  /** CG 上标的形态名字:普通、第二组 */
  names: { normal: string; alt: string };
  lens: LensMaker;
}

export const TEST_KIT: FormsKit = {
  prefix: ALT,
  alt: 'alt',
  names: { normal: TEST_FORM_NAMES.normal, alt: TEST_FORM_NAMES.alt },
  lens: testLens,
};

export const randomSprites = (kit: FormsKit) => [
  sprite('s1', '微笑', ['笑']),
  sprite('s2', '平静'),
  sprite('s3', '生气'),
  sprite('s4', `${kit.prefix}·微笑`),
  sprite('s5', `${kit.prefix}·害羞`),
];
export const randomAssets = (kit: FormsKit) => [
  asset({ id: 'b1', kind: 'bg', label: '客厅', bgm_id: 'm1' }),
  asset({ id: 'b2', kind: 'bg', label: '卧室' }),
  asset({ id: 'b3', kind: 'bg', label: '街道', bgm_id: 'm2' }),
  asset({ id: 'm1', kind: 'bgm', label: '日常' }),
  asset({ id: 'm2', kind: 'bgm', label: '夜晚' }),
  asset({ id: 'c1', kind: 'cg', label: '拥抱' }),
  asset({ id: 'c1v', kind: 'cg', label: '微笑', parent_id: 'c1' }),
  asset({ id: 'c2', kind: 'cg', label: '星空', forms: [kit.names.alt] }),
  asset({ id: 'c2v', kind: 'cg', label: `${kit.prefix}·害羞`, parent_id: 'c2' }),
  asset({ id: 'c3', kind: 'cg', label: '散步', forms: [kit.names.normal] }),
];
const wordsOf = (kit: FormsKit): Record<string, string[]> => ({
  sprite: ['微笑', '笑', '平静', '生气', `${kit.prefix}·微笑`, `${kit.prefix}·害羞`, '嘟嘴', '还在认', '认不出'],
  bg: ['客厅', '卧室', '街道', '不存在的地方'],
  bgm: ['日常', '夜晚', '没有这首'],
  cg: ['拥抱', '星空', '散步', '收起', '无'],
});
const KINDS = ['sprite', 'sprite', 'sprite', 'bg', 'bgm', 'cg'];
export const RANDOM_OVERRIDES: Record<string, TagMatch> = {
  嘟嘴: { state: 'model', label: '微笑', score: 0.7 },
  还在认: { state: 'pending' },
};

/**
 * 一段随机对话:几条回复(偶尔夹一条用户消息)、每条几句、随机标签(含路人台词前的、旁白前的、写在末尾的),
 * 形态开着时随机放几个切换记号(含用户消息上的、句号是 MAX_SAFE_INTEGER 的)。
 * monotonic=false 时把每条的标签顺序打乱一点(句号不再从小到大)
 */
export function randomCase(seed: number, o: { forms: boolean; monotonic?: boolean; kit?: FormsKit }) {
  const kit = o.kit ?? TEST_KIT;
  const words = wordsOf(kit);
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const beats: Beat[] = [];
  const n = 1 + Math.floor(r() * 6);
  for (let k = 0; k < n; k++) {
    if (k > 0 && r() < 0.25) beats.push(beat(`u${k}`, 0, [], 'user'));
    const lines = Math.floor(r() * 5);
    const hits: TagHit[] = [];
    const count = Math.floor(r() * 7);
    for (let j = 0; j < count; j++) {
      const kind = pick(KINDS);
      const atEnd = lines === 0 || r() < 0.15;
      const li = atEnd ? -1 : Math.floor(r() * lines);
      const speaker = r() < 0.15 ? '路人' : r() < 0.1 ? null : CHAR;
      hits.push(hit(kind, pick(words[kind]), li, speaker));
    }
    hits.sort((a, b) => (a.lineIndex === -1 ? 1e9 : a.lineIndex) - (b.lineIndex === -1 ? 1e9 : b.lineIndex));
    if (o.monotonic === false && hits.length > 2) [hits[0], hits[hits.length - 2]] = [hits[hits.length - 2], hits[0]];
    beats.push(beat(`a${k}`, lines, hits));
  }
  const ids = beats.map((b) => b.entry.id);
  const switches: TestSwitch[] = [];
  if (o.forms) {
    const marks = Math.floor(r() * 4);
    for (let j = 0; j < marks; j++) {
      switches.push({
        entryId: pick(ids),
        line: r() < 0.2 ? Number.MAX_SAFE_INTEGER : Math.floor(r() * 4),
        form: r() < 0.5 ? kit.alt : 'normal',
      });
    }
  }
  const sprites = randomSprites(kit);
  const ctx = ctxOf({
    sprites,
    sceneAssets: randomAssets(kit),
    resolve: resolverOf(sprites, RANDOM_OVERRIDES),
    forms: o.forms ? kit.lens(switches, ids, sprites, r() < 0.5 ? kit.alt : 'normal') : null,
  });
  return { beats, ctx };
}
