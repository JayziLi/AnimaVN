/**
 * 背景插件 + BGM 插件 + CG 插件 —— AI 在正文里写 <bg:食堂>、<bgm:日常>、<cg:海边烟花>,
 * 视觉小说界面换背景、换音乐、盖上一张 CG。
 *
 * 和立绘插件同一个套路(见 sprite.ts),区别在两处:
 *   素材放在「场景包」里,卡绑定一个包;多张卡可以绑同一个(同一个世界观共用素材)
 *   背景和音乐是「状态」:只在变化时写,没写就沿用。块里用 {{current_bg}} /
 *   {{current_bgm}} 告诉 AI 现在在哪、在放什么
 *
 * BGM 的规则是「场景默认 + AI 覆盖」:每个背景可以指定一首默认曲,换场景时音乐
 * 跟着换;同一个场景里气氛变了,AI 再写 BGM 标签。关掉 BGM 块,就退化成音乐只跟着
 * 场景走。
 *
 * CG 也是「状态」,而且分两层:
 *   构图  AI / Jev 点的是它,写一次一直显示,直到换成别的或者写 <cg:无>
 *   差分  构图下面挂的几张(名字是立绘的表情名),画面上那张跟着当前这句的表情换
 * CG 和背景、音乐互不牵连(10-03 用户定):出 CG 不换曲子,换场景也不收 CG。
 */

import type { SceneAsset } from '../lib/api';
import type { PresetOrderEntry, TavernPreset } from '../lib/presetParser';
import type { ChatEntry } from '../lib/chatEntry';
import { extractTags, type TagKind } from '../vn/script';
import { jevText } from './jevNotes';
import {
  buildTagRegExp,
  insertPluginBlock,
  normalizePluginConfig,
  normalizeTagMode,
  objectOf,
  pluginBlockState,
  promptOf,
  resolveByLabel,
  tagExampleOf,
  tagPrefixOf,
  thresholdOf,
  validateTagTemplate,
  type PluginConfig,
  type TagMode,
} from './common';

export type SceneKindKey = 'bg' | 'bgm' | 'cg';

/** Jev 换场景 / 音乐的门槛:默认、可调范围(和后端 ThresholdsIn 一致) */
export const SWITCH_THRESHOLD = { def: 0.6, min: 0.3, max: 0.95 };

export interface ScenePluginConfig extends PluginConfig {
  /** AI 写标签 / Jev 标(plugins/jev.ts) */
  mode: TagMode;
  jev: {
    /** Jev 选的不是「不换」,把握到这么多才换 */
    threshold: number;
    /** 改过的问法 / 「不换」选项的说明;null = 用后端默认 */
    prompt: string | null;
    keepPrompt: string | null;
    /** 只有 CG 用:「不显示CG」选项的说明 */
    offPrompt: string | null;
  };
}

interface SceneSpec {
  blockId: string;
  blockName: string;
  settingKey: string;
  placeholder: string;
  /** {{bg_tag}} 展开时占位符换成的词 */
  exampleWord: string;
  defaults: ScenePluginConfig;
}

const JEV_DEFAULTS: ScenePluginConfig['jev'] = {
  threshold: SWITCH_THRESHOLD.def,
  prompt: null,
  keepPrompt: null,
  offPrompt: null,
};

export const DEFAULT_BG_PROMPT = `[场景指令]
可以用的场景（背景图）：
{{backgrounds}}
当前场景：{{current_bg}}

剧情换到另一个地点时，在换场景的那一句前面插入 {{bg_tag}}，把「场景名」换成上面列表里的一个名字，一字不差。
- 场景没变就不要写
- 列表里没有完全对应的地点时，选最接近的一个
- 标签单独写，不要放进引号或括号里，也不要解释它`;

export const DEFAULT_CG_PROMPT = `[CG 指令]
画面上可以显示一张 CG（事件插图），代替立绘和背景。可以用的 CG：
{{cgs}}
当前画面：{{current_cg}}

剧情进入某张 CG 对得上的关键场面时（先看在哪里、正在做什么；衣着和小细节只是参考，对不上也可以用场面最接近的那张），在那一句前面插入 {{cg_tag}}，把「CG名」换成上面列表里的一个名字，一字不差。
- 插入一次以后 CG 会一直显示，直到换成别的或者写 {{cg_off_tag}}；场面还在继续时，中间只是说话、想事情，不用再写
- 场面或动作变了，就在变的那一句插入新的 CG
- 这段场面结束、回到日常时，在那一句前面插入 {{cg_off_tag}}
- 哪张都对不上时不要硬选
- 标签单独写，不要放进引号或括号里，也不要解释它`;

export const DEFAULT_BGM_PROMPT = `[音乐指令]
可以用的背景音乐（按气氛分）：
{{bgms}}
当前音乐：{{current_bgm}}

换场景时，音乐会自动换成那个场景的默认曲，不用写。只有在同一个场景里气氛明显转变时（比如闲聊转为紧张、热闹转为伤感），才在转变的那一句前面插入 {{bgm_tag}}，把「音乐名」换成上面列表里的一个名字，一字不差。
- 气氛没有明显变化就不要写，不要频繁换
- 标签单独写，不要放进引号或括号里，也不要解释它`;

export const SCENE: Record<SceneKindKey, SceneSpec> = {
  bg: {
    blockId: 'anima_bg',
    blockName: '场景指令 · 插件',
    settingKey: 'plugin.bg',
    placeholder: '{场景}',
    exampleWord: '场景名',
    defaults: { tagTemplate: '<bg:{场景}>', blockPrompt: DEFAULT_BG_PROMPT, mode: 'ai', jev: JEV_DEFAULTS },
  },
  bgm: {
    blockId: 'anima_bgm',
    blockName: '音乐指令 · 插件',
    settingKey: 'plugin.bgm',
    placeholder: '{音乐}',
    exampleWord: '音乐名',
    defaults: { tagTemplate: '<bgm:{音乐}>', blockPrompt: DEFAULT_BGM_PROMPT, mode: 'ai', jev: JEV_DEFAULTS },
  },
  cg: {
    blockId: 'anima_cg',
    blockName: 'CG 指令 · 插件',
    settingKey: 'plugin.cg',
    placeholder: '{CG}',
    exampleWord: 'CG名',
    defaults: { tagTemplate: '<cg:{CG}>', blockPrompt: DEFAULT_CG_PROMPT, mode: 'ai', jev: JEV_DEFAULTS },
  },
};

/** <cg:无> 收起 CG。模型偶尔写成别的说法,这几个都认 */
export const CG_OFF_WORD = '无';
const CG_OFF_WORDS = new Set([CG_OFF_WORD, '无cg', '不显示', '不显示cg', '收起', '关', '结束', 'none', 'off']);
export const isCgOff = (label: string) => CG_OFF_WORDS.has(label.trim().toLowerCase());

export function normalizeSceneConfig(kind: SceneKindKey, raw: unknown): ScenePluginConfig {
  const r = objectOf(raw);
  const j = objectOf(r.jev);
  return {
    ...normalizePluginConfig(raw, SCENE[kind].defaults, SCENE[kind].placeholder),
    mode: normalizeTagMode(r.mode),
    jev: {
      threshold: thresholdOf(j.threshold, SWITCH_THRESHOLD.def, SWITCH_THRESHOLD.min, SWITCH_THRESHOLD.max),
      prompt: promptOf(j.prompt),
      keepPrompt: promptOf(j.keepPrompt),
      offPrompt: promptOf(j.offPrompt),
    },
  };
}

export const validateSceneTemplate = (kind: SceneKindKey, template: string) =>
  validateTagTemplate(template, SCENE[kind].placeholder);

export const sceneTagExample = (kind: SceneKindKey, template: string) =>
  tagExampleOf(template, SCENE[kind].placeholder, SCENE[kind].exampleWord);

/** 给解析器用的一类标签 */
export function sceneTagKind(kind: SceneKindKey, template: string): TagKind {
  const { placeholder } = SCENE[kind];
  return {
    kind,
    pattern: buildTagRegExp(template, placeholder),
    prefix: tagPrefixOf(template, placeholder),
  };
}

export const sceneBlockState = (
  kind: SceneKindKey,
  preset: TavernPreset | null,
  order: readonly PresetOrderEntry[],
) => pluginBlockState(preset, order, SCENE[kind].blockId);

export const insertSceneBlock = (
  kind: SceneKindKey,
  preset: TavernPreset,
  groupIndex: number,
  content: string,
) =>
  insertPluginBlock(preset, groupIndex, {
    identifier: SCENE[kind].blockId,
    name: SCENE[kind].blockName,
    content,
  });

// ---- 状态:现在是哪个场景、在放哪首 ----

export interface SceneState {
  bg: SceneAsset | null;
  bgm: SceneAsset | null;
  /** 音乐是怎么来的 —— 控制台里显示 */
  bgmFrom: 'initial' | 'scene' | 'tag' | null;
  /** 画面上的 CG(构图);没有是 null。具体哪张差分看表情,见 cgFrameFor */
  cg: SceneAsset | null;
}

export const backgroundsOf = (assets: readonly SceneAsset[]) => assets.filter((a) => a.kind === 'bg');
export const bgmsOf = (assets: readonly SceneAsset[]) => assets.filter((a) => a.kind === 'bgm');
/** CG 的构图(AI / Jev 点的那些);差分不算 */
export const cgsOf = (assets: readonly SceneAsset[]) => assets.filter((a) => a.kind === 'cg' && !a.parent_id);
/** 一张 CG 下面挂的差分 */
export const cgVariantsOf = (assets: readonly SceneAsset[], cgId: string) =>
  assets.filter((a) => a.kind === 'cg' && a.parent_id === cgId);

/**
 * 画面上显示 CG 的哪一张:名字(或别名)和当前表情对得上的差分;没有就是构图本身那张。
 * 构图本身没传图时退到第一张有图的差分
 */
export function cgFrameFor(
  cg: SceneAsset,
  assets: readonly SceneAsset[],
  emotion: string | null,
): SceneAsset {
  const variants = cgVariantsOf(assets, cg.id).filter((a) => a.has_file);
  const hit = emotion ? resolveByLabel(emotion, variants) : null;
  if (hit) return hit;
  if (cg.has_file) return cg;
  return variants[0] ?? cg;
}

/**
 * 标题画面(封面)放哪首:包里设了、这首还在(没删、没禁用)就放它,否则放排第一的。
 * assets 传游戏里用的那份(已经滤掉禁用的)
 */
export function titleBgmOf(assets: readonly SceneAsset[], titleBgmId: string | null): SceneAsset | null {
  const bgms = bgmsOf(assets);
  return bgms.find((a) => a.id === titleBgmId) ?? bgms[0] ?? null;
}

/** 对话开头的状态:排第一的背景,以及它的默认曲;没有 CG */
export function initialScene(assets: readonly SceneAsset[]): SceneState {
  const bg = backgroundsOf(assets)[0] ?? null;
  const bgm = bg?.bgm_id ? (assets.find((a) => a.id === bg.bgm_id) ?? null) : null;
  return { bg, bgm, bgmFrom: bgm ? 'initial' : null, cg: null };
}

/**
 * 应用一个标签。对不上名字的标签不改状态(控制台里会标红)。
 * 换到一个「不同的」场景时,如果它有默认曲就换上;重复写同一个场景不会把
 * AI 刚点的曲子冲掉。CG 只管自己:不碰音乐,换场景也不收起。
 */
export function applySceneTag(
  state: SceneState,
  tag: { kind: string; label: string },
  assets: readonly SceneAsset[],
): SceneState {
  if (tag.kind === 'bg') {
    const bg = resolveByLabel(tag.label, backgroundsOf(assets));
    if (!bg || bg.id === state.bg?.id) return state;
    const def = bg.bgm_id ? (assets.find((x) => x.id === bg.bgm_id && x.kind === 'bgm') ?? null) : null;
    return def ? { ...state, bg, bgm: def, bgmFrom: 'scene' } : { ...state, bg };
  }
  if (tag.kind === 'bgm') {
    const bgm = resolveByLabel(tag.label, bgmsOf(assets));
    return bgm ? { ...state, bgm, bgmFrom: 'tag' } : state;
  }
  if (tag.kind === 'cg') {
    if (isCgOff(tag.label)) return state.cg ? { ...state, cg: null } : state;
    const cg = resolveByLabel(tag.label, cgsOf(assets));
    return !cg || cg.id === state.cg?.id ? state : { ...state, cg };
  }
  return state;
}

/**
 * 整段对话末尾的状态 —— 组装提示词时 {{current_bg}} / {{current_bgm}} 用它。
 * 只摘标签、不切句:句子边界不影响标签的先后顺序。Jev 标的合并进来一起算
 */
export function sceneAtEnd(
  entries: readonly ChatEntry[],
  kinds: readonly TagKind[],
  assets: readonly SceneAsset[],
): SceneState {
  let state = initialScene(assets);
  if (assets.length === 0) return state;
  for (const e of entries) {
    if (e.role !== 'assistant') continue;
    for (const t of extractTags(jevText(e, kinds), kinds, false).tags) state = applySceneTag(state, t, assets);
  }
  return state;
}

/** 插件提供的宏,并入自定义宏的查找表 */
export function sceneMacros(
  configs: Record<SceneKindKey, PluginConfig>,
  bound: boolean,
  assets: readonly SceneAsset[],
  state: SceneState,
): Record<string, string> {
  const nameOf = (id: string | null) => assets.find((a) => a.id === id)?.label;
  const line = (a: SceneAsset, extra?: string) => {
    const desc = a.description.trim();
    const tail = [desc, extra].filter(Boolean).join('；');
    return tail ? `- ${a.label}：${tail}` : `- ${a.label}`;
  };
  const none = bound ? '(场景包里还没有素材)' : '(这张卡还没有绑定场景包)';
  const bgs = backgroundsOf(assets);
  const bgms = bgmsOf(assets);
  const cgs = cgsOf(assets);
  return {
    backgrounds: bgs.length
      ? bgs.map((a) => line(a, a.bgm_id && nameOf(a.bgm_id) ? `默认音乐：${nameOf(a.bgm_id)}` : '')).join('\n')
      : none,
    bg_tag: sceneTagExample('bg', configs.bg.tagTemplate),
    current_bg: state.bg?.label ?? '(还没有场景)',
    bgms: bgms.length ? bgms.map((a) => line(a)).join('\n') : none,
    bgm_tag: sceneTagExample('bgm', configs.bgm.tagTemplate),
    current_bgm: state.bgm?.label ?? '(没有音乐)',
    cgs: cgs.length ? cgs.map((a) => line(a)).join('\n') : none,
    cg_tag: sceneTagExample('cg', configs.cg.tagTemplate),
    cg_off_tag: configs.cg.tagTemplate.replace(SCENE.cg.placeholder, () => CG_OFF_WORD),
    current_cg: state.cg?.label ?? '(没有 CG，显示立绘和背景)',
  };
}
