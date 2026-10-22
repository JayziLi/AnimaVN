/**
 * 组装期的插件规则,收在一处(素材架构设计 2.7)。DebugApp 拿到预设、编排以后只调这里,
 * 再交给 lib/assembler.ts 组装;组装完按 stripKinds 把 Jev 负责的标签从整份提示词里摘掉,
 * 再按 lastUserTurn 把自动补的块并进最后一个 user 回合(moveToLastUserTurn)。
 *
 * 每个插件块这次发不发先由 core/sendPlan.ts 的 blockSendPlan 算好(第 2 步),这里照它做:
 * 1. 块正文同步不在这里:读预设时就换成插件模板了(plugins/common.ts 的 syncPluginBlocks),左栏看到的也是它。
 * 2. 自动补(auto)的块这次组装里补上(不写回预设)。插在哪见 autoInsertAt。Anthropic 格式的连接补成 user 块
 *    放最后,组装完并进最后一个 user 回合(不并进开头的 system:{{current_*}} 变了,前面的提示词缓存不失效)。
 * 3. 不发(skip)的块编排里关掉:Jev 标的、插件开关关着的、这张卡没素材的、外语跟不上主声音的。预设本身不动。
 * 4. 精简版(short,或自动补的外语块带 short)的外语块换成不提标签的版本(jevLangPrompt)。
 * 5. 有在用 Jev 的、或插件开关关着的:组装完从历史、卡里的示例、世界书……整份提示词里摘掉这几类标签
 *    (jevStripPrompt)。jevKinds 已经是按 key 算过的:Jev 没 key 时那几路算 AI。
 */

import type { AssembledMessage, AssemblyResult } from '../lib/assembler';
import type { PresetOrderEntry, PresetPrompt, TavernPreset } from '../lib/presetParser';
import type { PluginBlock } from '../plugins/common';
import { anyJev, jevLangPrompt, jevTagKinds, NO_JEV, type JevKinds } from '../plugins/jev';
import { LANG_BLOCK_ID } from '../plugins/lang';
import { PLUGIN_BLOCK_IDS } from '../plugins/registry';
import type { TagKind } from '../vn/script';
import { blockSendPlan, type AutoFillMaterial, type BlockSend } from './sendPlan';

export type { AutoFillMaterial } from './sendPlan';

export interface AutoFill {
  /** 总开关(后端设置 core.assembly 的 autoFill) */
  enabled: boolean;
  /** 选的是 Jev 的那几路(不管有没有 key);和 jevKinds 比,算出「Jev 没 key,这次照 AI 写发」 */
  configuredJev: JevKinds;
  /** 这张卡有没有各路的素材:没有的那一路块不发、也不补 */
  material: AutoFillMaterial;
  /** 主声音的 text_lang;没有主声音是 null。外语块只跟着日语声音发 */
  mainVoiceLang: string | null;
  /** 各插件块的模板:名字和正文,和「加入当前预设」得到的一样 */
  blocks: Readonly<Record<string, PluginBlock>>;
  /** Anthropic 格式的连接:补的块并进最后一个 user 回合 */
  lastUserTurn: boolean;
}

/** 这次组装自动补上的一块(左栏灰色显示) */
export interface AutoBlock {
  identifier: string;
  name: string;
  /** ai:那一路是 AI 写;no-key:选的是 Jev,但 Jev 没 key,这次临时补 */
  reason: 'ai' | 'no-key';
}

export interface AssemblyPassInput {
  /** 已经同步过块正文的预设 */
  preset: TavernPreset | null;
  /** 组装正在用的那一组编排(开关已经叠上了临时的勾选) */
  order: PresetOrderEntry[];
  /** 哪几路这次由 Jev 标(没 key 时全是 false) */
  jevKinds: JevKinds;
  /** 插件页右上角关掉的那几路(plugins/switches.ts):和 Jev 的一样,块不发、标签摘掉,也不补块 */
  offKinds?: JevKinds;
  /** 视觉小说认的几类标签 */
  vnKinds: readonly TagKind[];
  /** 自动补块、这张卡的素材和主声音(哪块发不发要看);自动补块的总开关在里面 */
  autoFill: AutoFill;
}

export interface AssemblyPass {
  /** 发出去用的预设(补了块、外语块可能换了版本);左栏、保存用的还是原来那份 */
  preset: TavernPreset | null;
  /** 发出去用的编排;没有要补、要关的块时就是传进来的那个数组 */
  order: PresetOrderEntry[];
  /** 组装完要从整份提示词里摘掉的标签种类;null = 不摘(没有在用 Jev 的) */
  stripKinds: TagKind[] | null;
  /** 这次自动补上的块,按插进去的先后 */
  auto: AutoBlock[];
  /** 组装完要并进最后一个 user 回合的块(Anthropic 格式的连接);空 = 不用并 */
  lastUserTurn: string[];
  /** 每个插件块这次发不发、为什么(core/sendPlan.ts);只有在编排里的和这次自动补的 */
  plan: BlockSend[];
}

/** 组装的设置存在后端 app_settings 的这个键 */
export const ASSEMBLY_SETTING_KEY = 'core.assembly';

export interface AssemblyConfig {
  /** 自动补块的总开关;默认开(10-07 定的:预设里没有插件块时,组装提示词时自动补) */
  autoFill: boolean;
}

export const DEFAULT_ASSEMBLY_CONFIG: AssemblyConfig = { autoFill: true };

export function normalizeAssemblyConfig(raw: unknown): AssemblyConfig {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { autoFill: typeof r.autoFill === 'boolean' ? r.autoFill : DEFAULT_ASSEMBLY_CONFIG.autoFill };
}

/** 去掉 {{// 注释 }} 再看:名字或正文以 </xxx> 开头的块,是预设里用来闭合包裹标签的那种 */
function isClosingTag(prompts: readonly PresetPrompt[], identifier: string): boolean {
  const p = prompts.find((x) => x.identifier === identifier);
  if (!p || p.marker) return false;
  const bare = (s: string) => s.replace(/\{\{\/\/[\s\S]*?\}\}/g, '').trim();
  return /^<\/[^>\s]+>/.test(bare(p.name)) || /^<\/[^>\s]+>/.test(bare(p.content));
}

/** 编排末尾的 assistant 预填从哪开始(跳过关着的块);没有是 -1 */
function prefillStart(prompts: readonly PresetPrompt[], order: readonly PresetOrderEntry[]): number {
  let start = -1;
  for (let j = order.length - 1; j >= 0; j--) {
    if (!order[j].enabled) continue;
    const p = prompts.find((x) => x.identifier === order[j].identifier);
    if (!p || p.marker || p.role !== 'assistant' || p.injectionPosition !== 0) break;
    start = j;
  }
  return start;
}

/**
 * 自动补的块插在编排的哪(插在这个下标前面):
 * 1. 已有别的插件块:挨着最后一个插件块放,几块挨在一起;
 * 2. 否则放在 chatHistory 后面,紧跟在历史后面的收尾块(</history> 一类,先去掉 {{// }} 注释再认)跳过去,
 *    中间关着的块也跳过;
 * 3. 编排里没有 chatHistory:放最后;
 * 都排在末尾的 assistant 预填前面。toEnd:放最后(Anthropic 格式的连接,只排在预填前面)
 */
export function autoInsertAt(prompts: readonly PresetPrompt[], order: readonly PresetOrderEntry[], toEnd = false): number {
  let at = order.length;
  if (!toEnd) {
    let last = -1;
    order.forEach((e, j) => {
      if (PLUGIN_BLOCK_IDS.includes(e.identifier)) last = j;
    });
    if (last !== -1) at = last + 1;
    else {
      const h = order.findIndex((e) => e.identifier === 'chatHistory');
      if (h !== -1) {
        at = h + 1;
        for (let j = h + 1; j < order.length; j++) {
          if (!order[j].enabled) continue;
          if (!isClosingTag(prompts, order[j].identifier)) break;
          at = j + 1;
        }
      }
    }
  }
  const prefill = prefillStart(prompts, order);
  return prefill !== -1 && at > prefill ? prefill : at;
}

/** 把要补的块放进预设(块库里没有就加一份,Anthropic 格式时是 user 块)和编排(开着) */
function withAutoBlocks(
  preset: TavernPreset,
  order: PresetOrderEntry[],
  auto: readonly AutoBlock[],
  o: AutoFill,
): { preset: TavernPreset; order: PresetOrderEntry[] } {
  let prompts = preset.prompts;
  let next = order;
  for (const a of auto) {
    const block = o.blocks[a.identifier];
    const role = o.lastUserTurn ? 'user' : 'system';
    const own = prompts.find((p) => p.identifier === a.identifier);
    prompts = own
      ? prompts.map((p) => (p.identifier === a.identifier ? { ...p, role } : p))
      : [
          ...prompts,
          {
            identifier: a.identifier,
            name: block.name,
            role,
            content: block.content,
            marker: false,
            systemPrompt: false,
            injectionPosition: 0,
            injectionDepth: 4,
            injectionOrder: 100,
            injectionTrigger: [],
            forbidOverrides: false,
          },
        ];
    const at = autoInsertAt(prompts, next, o.lastUserTurn);
    next = [...next.slice(0, at), { identifier: a.identifier, enabled: true }, ...next.slice(at)];
  }
  return { preset: { ...preset, prompts }, order: next };
}

const withOff = (jev: JevKinds, off: JevKinds): JevKinds =>
  Object.fromEntries(Object.entries(jev).map(([k, v]) => [k, v || off[k as keyof JevKinds]])) as JevKinds;

export function pluginAssemblyPass(o: AssemblyPassInput): AssemblyPass {
  const offKinds = o.offKinds ?? NO_JEV;
  const fill = o.autoFill;
  // 没有预设就没东西可补;补的块得有模板(名字和正文),没有模板的不算这次补
  const plan = blockSendPlan({
    order: o.order,
    configuredJev: fill.configuredJev,
    jevKinds: o.jevKinds,
    offKinds,
    material: fill.material,
    mainVoiceLang: fill.mainVoiceLang,
    autoFill: fill.enabled && o.preset !== null,
  }).filter((b) => b.state !== 'auto' || b.identifier in fill.blocks);

  const auto = plan
    .filter((b) => b.state === 'auto')
    .map((b): AutoBlock => ({
      identifier: b.identifier,
      name: fill.blocks[b.identifier].name,
      reason: b.plugin !== 'lang' && b.plugin !== 'player' && fill.configuredJev[b.plugin] ? 'no-key' : 'ai',
    }));
  const filled = auto.length > 0 && o.preset ? withAutoBlocks(o.preset, o.order, auto, fill) : { preset: o.preset, order: o.order };

  // 不发的块在编排里关掉(本来就关着的不动;没有要关的就还是同一个数组)
  const skip = new Set(plan.filter((b) => b.state === 'skip').map((b) => b.identifier));
  const order = filled.order.some((e) => e.enabled && skip.has(e.identifier))
    ? filled.order.map((e) => (e.enabled && skip.has(e.identifier) ? { ...e, enabled: false } : e))
    : filled.order;

  // 外语块发精简版:不提标签(这次一块标签块都没发)
  const short = plan.some((b) => b.identifier === LANG_BLOCK_ID && (b.state === 'short' || b.short));
  const preset =
    short && filled.preset
      ? {
          ...filled.preset,
          prompts: filled.preset.prompts.map((p) =>
            p.identifier === LANG_BLOCK_ID ? { ...p, content: jevLangPrompt(p.content, o.vnKinds) } : p,
          ),
        }
      : filled.preset;

  // 关掉的那几路和 Jev 标的一样:标签由不得 AI 写,整份提示词里摘掉
  const gone = withOff(o.jevKinds, offKinds);
  return {
    preset,
    order,
    stripKinds: anyJev(gone) ? jevTagKinds(gone, o.vnKinds) : null,
    auto,
    lastUserTurn: fill.lastUserTurn ? auto.map((a) => a.identifier) : [],
    plan,
  };
}

/**
 * Anthropic 格式的连接:自动补的块(组装出来是 user 消息)并进最后一个 user 回合的末尾,中间空一行。
 * 没有别的 user 消息时原样不动
 */
export function moveToLastUserTurn(result: AssemblyResult, identifiers: readonly string[]): AssemblyResult {
  if (identifiers.length === 0) return result;
  const ids = new Set(identifiers);
  const moved = result.messages.filter((m) => ids.has(m.sourceIdentifier));
  if (moved.length === 0) return result;
  const rest: AssembledMessage[] = result.messages.filter((m) => !ids.has(m.sourceIdentifier));
  let k = -1;
  rest.forEach((m, j) => {
    if (m.role === 'user') k = j;
  });
  if (k === -1) return result;
  const extra = moved.map((m) => m.content).join('\n\n');
  rest[k] = {
    ...rest[k],
    content: `${rest[k].content}\n\n${extra}`,
    tokens: rest[k].tokens + moved.reduce((n, m) => n + m.tokens, 0),
  };
  return { ...result, messages: rest };
}
