/**
 * Jev 标注 —— 立绘 / 背景 / BGM / CG / 玩家台词每个插件可以选「AI 写标签」或「Jev 标」。
 * Jev 是 TypeSafe 的判断模型:LLM 只管写正文,这几类标签由它一句一句判断后补上。
 *
 * Jev 模式的那几类(模式是 jev、而且后端有 key):
 *   组装提示词  它们的插件块不发;提示词里它们的标签全摘掉(历史、卡里的对话示例……
 *              模型看见就会照着写)。这次一块标签块都没发时,外语块发不提标签的精简版(core/sendPlan.ts)
 *   生成中      每写完一句交给后端问 Jev(/api/annotate/lines,见 jevRun.ts)。正文只存模型写的
 *              原文,Jev 的标签另外存在 swipe_info.jev.notes,用的时候合并(见 jevNotes.ts)
 *   切句        立绘是 Jev 的回复(swipe_info.jev.kinds 有 sprite),Jev 判过的台词没带立绘标签
 *              就不算角色的
 * AI 模式的照旧:块照发、标签留着、模型自己写。以前 Jev 标的,发历史时合并进去当示例。
 *
 * 每个插件的模式和它自己的 Jev 设置存在各自的配置里(plugin.sprite / bg / bgm / cg / player);
 * 几个插件共用的(立绘和文字同步、说话人门槛、通用问法)存在 plugin.jev。Jev 的 key 只在后端。
 * 设计见 docs/superpowers/specs/2026-10-01-jev-director-design.md
 */

import { JEV_BEFORE_LINES, SPEAKER_THRESHOLD } from '../generated/contracts';
import type { AssemblyResult } from '../lib/assembler';
import type { PresetOrderEntry } from '../lib/presetParser';
import type { TagKind, VNLine } from '../vn/script';
import { objectOf, promptOf, thresholdOf, type TagMode } from './common';
import type { JevStats } from './jevRun';
import { stripReplyTags } from './jevNotes';
import { DEFAULT_LANG_BLOCK_PROMPT, DEFAULT_LANG_BLOCK_PROMPT_JEV } from './lang';
import { BLOCK_OF, JEV_KINDS, type JevKind } from './registry';
import { CG_OFF_WORD, SCENE, type ScenePluginConfig } from './scene';
import { PLACEHOLDER, type SpritePluginConfig } from './sprite';

export { insertionPoint, jevKindsOf, NO_KINDS, stripReplyTags } from './jevNotes';

export const JEV_SETTING_KEY = 'plugin.jev';

/** 说话人门槛、带上一条回复几句:默认、可调范围(前后端共用,定义在 AnimaBackend/app/contracts.py) */
export { JEV_BEFORE_LINES, SPEAKER_THRESHOLD };
/** 「立绘和文字同步」最多等 Jev 这么久,还没判完就先出字 */
export const SYNC_MAX_WAIT_MS = 2000;

/** 几个插件共用的通用问法(键和后端 DEFAULT_PROMPTS 一致) */
export const SHARED_PROMPT_KEYS = [
  'state',
  'before',
  'speaker',
  'speaker_char',
  'speaker_user',
  'speaker_other',
  'speaker_none',
] as const;
export type SharedPromptKey = (typeof SHARED_PROMPT_KEYS)[number];

/** 几个插件共用的 Jev 设置 */
export interface JevPluginConfig {
  /** 立绘和文字同步:这句的立绘 / 背景判完才开始出字(最多等 SYNC_MAX_WAIT_MS) */
  syncText: boolean;
  /** 判成「不是角色说的」要多大把握 */
  speakerThreshold: number;
  /** 改过的通用问法;null = 用后端默认 */
  prompts: Record<SharedPromptKey, string | null>;
  /** 两条队列(试用,plugins/jevRun.ts):CG 是 Jev 时别的题不再一句一句等;默认关 */
  twoQueues: boolean;
  /**
   * 判每句时带上一条 AI 回复的最后几句(0 = 不带)。2026-10-15 在两个游戏 6 个角色的剧本上测:
   * 「谁说的」判对 不带 59.6% / 8 句 64.9% / 24 句 68.8%(specs/2026-10-15-jev-previous-reply-ab.md)
   */
  beforeLines: number;
}

export const DEFAULT_JEV_CONFIG: JevPluginConfig = {
  syncText: true,
  speakerThreshold: SPEAKER_THRESHOLD.default,
  twoQueues: false,
  beforeLines: JEV_BEFORE_LINES.default,
  prompts: Object.fromEntries(SHARED_PROMPT_KEYS.map((k) => [k, null])) as Record<SharedPromptKey, null>,
};

export function normalizeJevConfig(raw: unknown): JevPluginConfig {
  const r = objectOf(raw);
  const p = objectOf(r.prompts);
  return {
    syncText: typeof r.syncText === 'boolean' ? r.syncText : DEFAULT_JEV_CONFIG.syncText,
    speakerThreshold: thresholdOf(r.speakerThreshold, SPEAKER_THRESHOLD.default, SPEAKER_THRESHOLD.min, SPEAKER_THRESHOLD.max),
    prompts: Object.fromEntries(SHARED_PROMPT_KEYS.map((k) => [k, promptOf(p[k])])) as Record<SharedPromptKey, string | null>,
    twoQueues: typeof r.twoQueues === 'boolean' ? r.twoQueues : DEFAULT_JEV_CONFIG.twoQueues,
    beforeLines: Math.round(thresholdOf(r.beforeLines, JEV_BEFORE_LINES.default, JEV_BEFORE_LINES.min, JEV_BEFORE_LINES.max)),
  };
}

// ---- Jev 页:连接好不好、每一路对这张卡在不在用、用了多少 ----

/** token 数(只数 token 不算钱,走中转的价格各不一样):一万以上写成「2.9 万」「818 万」 */
export function tokenText(n: number): string {
  if (n < 10_000) return n.toLocaleString();
  const wan = n / 10_000;
  return `${wan >= 100 ? Math.round(wan).toLocaleString() : wan.toFixed(1)} 万`;
}

/** 左栏圆点 / 页头:ok 通了 · missing 没填 key(有插件选了 Jev)· error 上次出错 · idle 没 key 也没插件选 Jev */
export type JevHealth = 'ok' | 'missing' | 'error' | 'idle';

export function jevHealth(o: {
  hasKey: boolean;
  /** 有没有哪一路的模式选了 Jev(不管有没有 key) */
  anyJevMode: boolean;
  /** 这次打开页面以后测过没有:true 通了、false 没通、null 没测 */
  testOk: boolean | null;
  /** 最新一条 AI 回复的 Jev 统计 */
  last: Pick<JevStats, 'lines' | 'failed'> | null;
}): JevHealth {
  if (!o.hasKey) return o.anyJevMode ? 'missing' : 'idle';
  if (o.testOk === false) return 'error';
  // 上一条回复一半以上没判成(偶尔一句等太久不算),而且之后没测通过
  if (o.testOk !== true && o.last && o.last.lines > 0 && o.last.failed * 2 >= o.last.lines) return 'error';
  return 'ok';
}

/**
 * 「哪几路交给 Jev」那一列:这一路对当前这张卡实际在不在用、为什么。
 * mode 是全局设的(Jev 页、插件页切的就是它);inUse 是这张卡实际在不在用 Jev(按卡设置叠过、有 key、插件开着)
 */
export function jevKindStatus(o: {
  mode: TagMode;
  inUse: boolean;
  /** 插件开关(plugins/switches.ts);没有开关的一路算开着 */
  powerOn: boolean;
  hasKey: boolean;
  /** CG:这张卡没有能出的 CG,Jev 不判 */
  noAssets?: boolean;
}): string {
  if (!o.powerOn) return '插件关着';
  if (o.inUse) {
    const base = o.mode === 'jev' ? '在用' : '这张卡另设成 Jev 标 · 在用';
    return o.noAssets ? `${base} · 这张卡没有能出的 CG,不判` : base;
  }
  if (o.mode === 'jev') return o.hasKey ? '这张卡另设成 AI 写' : '还没填 key,照旧由 AI 写';
  return 'AI 写';
}

// ---- 哪几类在用 Jev ----

/** 能让 Jev 标的几类(sprite / bg / bgm / cg / player),登记在插件总表 plugins/registry.ts */
export type { JevKind };

/** 每类标签在不在用 Jev:模式是 jev、而且后端有 key(没 key 时照旧由 AI 写) */
export type JevKinds = Record<JevKind, boolean>;
export const NO_JEV: JevKinds = Object.fromEntries(JEV_KINDS.map((k) => [k, false])) as JevKinds;

export const anyJev = (k: JevKinds) => JEV_KINDS.some((x) => k[x]);
export const jevKindList = (k: JevKinds): JevKind[] => JEV_KINDS.filter((x) => k[x]);

/** 有模式、有插件开关的四路(玩家台词没有自己的模式:跟着立绘) */
type TagRoute = 'sprite' | 'bg' | 'bgm' | 'cg';

/**
 * 各路选的是不是 Jev(不管有没有 key、插件开没开)。玩家台词跟着立绘:立绘交给 Jev 时它本来就在判谁说的,
 * 顺手认出玩家(设计稿 12.1「10-16 第 2 步」)
 */
export const chosenJevKinds = (modes: Readonly<Record<TagRoute, TagMode>>): JevKinds => ({
  sprite: modes.sprite === 'jev',
  bg: modes.bg === 'jev',
  bgm: modes.bgm === 'jev',
  cg: modes.cg === 'jev',
  player: modes.sprite === 'jev',
});

/** 这次哪几路由 Jev 标:选了 Jev、后端有 key、插件开着(DebugApp 和提示词快照共用)。玩家台词跟着立绘 */
export function liveJevKinds(chosen: JevKinds, hasKey: boolean, switches: Readonly<Record<TagRoute, boolean>>): JevKinds {
  const live = (k: TagRoute) => hasKey && switches[k] && chosen[k];
  return { sprite: live('sprite'), bg: live('bg'), bgm: live('bgm'), cg: live('cg'), player: live('sprite') };
}

// ---- 视觉小说里(这个分支哪几类是 Jev 标的:jevNotes.ts 的 jevKindsOf) ----

/** 谁说的 / 什么表情由 Jev 判时,语音要等 Jev 判完(只有背景、音乐是 Jev 时不用等) */
export const voiceWaitsForJev = (kinds: readonly JevKind[]) =>
  kinds.includes('sprite') || kinds.includes('player');

/**
 * 这句判完以后可能多出标签吗(立绘和文字同步要不要等它):角色的台词看立绘 / 玩家台词,
 * 第一句和旁白看背景 / 音乐,CG 每句都问。还在判的台词切句先认成角色的,正好算进来
 */
export function jevMayTag(line: VNLine, index: number, charName: string, kinds: readonly JevKind[]): boolean {
  if (kinds.includes('cg')) return true;
  if (line.speaker === charName && voiceWaitsForJev(kinds)) return true;
  return (line.speaker === null || index === 0) && (kinds.includes('bg') || kinds.includes('bgm'));
}

/** 视觉小说认的几类标签里,在用 Jev 的那几类(它们的标签由 Jev 写,模型写的摘掉) */
export const jevTagKinds = (k: JevKinds, kinds: readonly TagKind[]): TagKind[] =>
  kinds.filter((t) => (JEV_KINDS as readonly string[]).includes(t.kind) && k[t.kind as JevKind]);

// ---- 组装提示词 ----

/**
 * 编排里关掉在用 Jev 的那几块(预设本身不动,只影响这次组装)。组装现在照 core/sendPlan.ts 关块,
 * 这个留给搬家以前的写法(core/assemblyLegacy.ts)对照用
 */
export const jevOrder = (order: readonly PresetOrderEntry[], k: JevKinds): PresetOrderEntry[] =>
  order.map((o) =>
    o.enabled && JEV_KINDS.some((x) => k[x] && BLOCK_OF[x] === o.identifier) ? { ...o, enabled: false } : o,
  );

/** 行首的缩进和列表记号(「- 」「* 」「• 」):留在行首;一行讲标签的话全删掉时跟着删 */
const BULLET_RE = /^\s*(?:[-*•]\s+)?/;

/**
 * 一行里讲标签的小句去掉:按「；」/「;」切成几小句,提到「标签」的不要;全不要了返回 null(整行删掉,
 * 行首的「- 」一起删);剩下的用原来的分号接回去(每句前面那个),原行以「。」结尾而剩下的不是时补一个「。」。
 * 没提「标签」的行一字不动
 */
function dropTagClauses(line: string): string | null {
  if (!line.includes('标签')) return line;
  const cr = line.endsWith('\r') ? '\r' : '';
  const body = cr ? line.slice(0, -1) : line;
  const bullet = BULLET_RE.exec(body)?.[0] ?? '';
  // [小句, 分号, 小句, 分号, 小句 …]
  const parts = body.slice(bullet.length).split(/([；;])/);
  let kept = '';
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i].includes('标签')) continue;
    kept += (kept ? parts[i - 1] : '') + parts[i];
  }
  if (!kept.trim()) return null;
  kept = kept.trim();
  if (body.trimEnd().endsWith('。') && !kept.endsWith('。')) kept += '。';
  return bullet + kept + cr;
}

/**
 * 外语块的精简版(core/sendPlan.ts:这次一块标签块都没发时发它),标签交给 Jev 以后讲标签的话不发:
 * 默认模板换成不提标签的版本(DEFAULT_LANG_BLOCK_PROMPT_JEV);改过的模板先去掉单独占一行的标签(示例里的那种),
 * 再逐行去掉讲标签的小句(dropTagClauses)
 */
export const jevLangPrompt = (prompt: string, kinds: readonly TagKind[]) =>
  prompt === DEFAULT_LANG_BLOCK_PROMPT
    ? DEFAULT_LANG_BLOCK_PROMPT_JEV
    : stripReplyTags(prompt, kinds)
        .split('\n')
        .map(dropTagClauses)
        .filter((line): line is string => line !== null)
        .join('\n');

/**
 * 组装好的整份提示词里,这几类标签全摘掉:历史、卡里的对话示例、世界书、预设里写的示例 ——
 * 模型在哪儿看见标签都会照着写
 */
export const jevStripPrompt = (result: AssemblyResult, kinds: readonly TagKind[]): AssemblyResult => ({
  ...result,
  messages: result.messages.map((m) => ({ ...m, content: stripReplyTags(m.content, kinds) })),
});

/** 发给后端的改过的问法(没改的不带,后端用默认) */
export function promptOverrides(
  shared: JevPluginConfig,
  sprite: SpritePluginConfig,
  bg: ScenePluginConfig,
  bgm: ScenePluginConfig,
  cg: ScenePluginConfig,
): Record<string, string> {
  const all: Record<string, string | null> = {
    ...shared.prompts,
    emotion: sprite.jev.emotionPrompt,
    bg: bg.jev.prompt,
    bg_keep: bg.jev.keepPrompt,
    bgm: bgm.jev.prompt,
    bgm_keep: bgm.jev.keepPrompt,
    cg: cg.jev.prompt,
    cg_keep: cg.jev.keepPrompt,
    cg_off: cg.jev.offPrompt,
  };
  return Object.fromEntries(Object.entries(all).filter((e): e is [string, string] => e[1] !== null));
}

// ---- Jev 判的结果 → 标签 ----

/** Jev 对一句的判断(后端 /api/annotate/lines 回的那一行) */
export interface JevDecision {
  index: number;
  speaker: 'char' | 'user' | 'other' | 'none' | null;
  emotion: string | null;
  bg: string | null;
  bgm: string | null;
  /** 换成这张 CG;cg_off = 收起 CG。后端是旧版时没有 */
  cg?: string | null;
  cg_off?: boolean;
  /** 这句判的档(卡带登记的两档题)。问了(ask_tone)才有 */
  tone?: string | null;
  confidence: Record<string, number>;
}

/** 写标签用的模板:插件里设的格式 */
export interface TagTemplates {
  sprite: string;
  bg: string;
  bgm: string;
  cg: string;
}

// 函数替换:label 是 Jev 给的,里面要是有 $& $$ 这类写法,字符串替换会把它当特殊符号
export const fillTag = (template: string, placeholder: string, label: string) =>
  template.replace(placeholder, () => label);

/**
 * 一句前面写哪些标签(只写在用 Jev 的那几类):场景、音乐在前(和以前 AI 写的顺序一样,
 * 背景的默认曲不会盖掉点的曲子),然后是 CG,最后是立绘或 <我>。立绘是 Jev 时角色的台词总要带
 * 立绘标签(没判出表情就沿用 emotionNow),不然它会被当成别人说的
 */
export function decisionTags(
  d: Pick<JevDecision, 'speaker' | 'emotion' | 'bg' | 'bgm' | 'cg' | 'cg_off'>,
  emotionNow: string | null,
  t: TagTemplates,
  k: JevKinds,
): string[] {
  const out: string[] = [];
  if (k.bg && d.bg) out.push(fillTag(t.bg, SCENE.bg.placeholder, d.bg));
  if (k.bgm && d.bgm) out.push(fillTag(t.bgm, SCENE.bgm.placeholder, d.bgm));
  if (k.cg && d.cg) out.push(fillTag(t.cg, SCENE.cg.placeholder, d.cg));
  else if (k.cg && d.cg_off) out.push(fillTag(t.cg, SCENE.cg.placeholder, CG_OFF_WORD));
  if (d.speaker === 'user') {
    if (k.player) out.push('<我>');
  } else if (d.speaker === 'char' && k.sprite) {
    const emotion = d.emotion ?? emotionNow;
    if (emotion) out.push(fillTag(t.sprite, PLACEHOLDER, emotion));
  }
  return out;
}
