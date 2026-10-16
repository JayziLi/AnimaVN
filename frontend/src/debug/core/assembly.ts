/**
 * 组装期的插件规则,收在一处(素材架构设计 2.7)。DebugApp 拿到预设、编排以后只调这里,
 * 再交给 lib/assembler.ts 组装;组装完按 stripKinds 把 Jev 负责的标签从整份提示词里摘掉,
 * 再按 lastUserTurn 把自动补的块并进最后一个 user 回合(moveToLastUserTurn)。
 *
 * 规则(1、3、4、5 和搬过来以前一样):
 * 1. 块正文同步不在这里:读预设时就换成插件模板了(plugins/common.ts 的 syncPluginBlocks),左栏看到的也是它。
 * 2. 自动补块(autoFill):AI 模式的那一路、这张卡有跟着它走的素材、当前编排组里完全没有这一块时,
 *    这次组装里补上(不写回预设)。插在哪见 autoInsertAt。Anthropic 格式的连接补成 user 块放最后,
 *    组装完并进最后一个 user 回合(不并进开头的 system:{{current_*}} 变了,前面的提示词缓存不失效)。
 * 3. Jev 模式的那几路,编排里关掉对应的插件块(plugins/jev.ts 的 jevOrder)。预设本身不动。
 * 4. 有在用 Jev 的、而且开着的标签插件块全是 Jev 的:外语块换成不提标签的版本(jevLangPrompt)。
 * 5. 有在用 Jev 的:组装完从历史、卡里的示例、世界书……整份提示词里摘掉这几类标签(jevStripPrompt)。
 * jevKinds 已经是按 key 算过的:Jev 没 key 时那几路算 AI(缺的块照 2 补,左栏写明是临时补的)。
 * 6. 插件页右上角关掉的那几路(offKinds,plugins/switches.ts)按 Jev 的那几路处理:不补块、块不发、标签摘掉。
 */

import type { AssembledMessage, AssemblyResult } from '../lib/assembler';
import type { PresetOrderEntry, PresetPrompt, TavernPreset } from '../lib/presetParser';
import type { PluginBlock } from '../plugins/common';
import { anyJev, jevLangPrompt, jevOrder, jevTagKinds, wantsTagFreeLang, type JevKinds } from '../plugins/jev';
import { LANG_BLOCK_ID } from '../plugins/lang';
import { PLUGIN, PLUGIN_BLOCK_IDS } from '../plugins/registry';
import type { TagKind } from '../vn/script';

/** 这张卡(这个状态)有没有跟着这一路走、真能用起来的素材 */
export interface AutoFillMaterial {
  /** 表情这一路:启用的立绘、能念的主声音、有差分的 CG,有一样就算 */
  sprite: boolean;
  /** 绑的场景包里有启用的背景 */
  bg: boolean;
  /** 绑的场景包里有启用的曲子 */
  bgm: boolean;
  /** 场景包里有现在能出的 CG 构图 */
  cg: boolean;
}

export interface AutoFill {
  /** 总开关(后端设置 core.assembly 的 autoFill) */
  enabled: boolean;
  /** 选的是 Jev 的那几路(不管有没有 key);和 jevKinds 比,算出「Jev 没 key,这次临时补」 */
  configuredJev: JevKinds;
  material: AutoFillMaterial;
  /** 这张卡打开了「预设缺外语块时补上」 */
  lang: boolean;
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
  /** 自动补块要的东西;不传 = 不补 */
  autoFill?: AutoFill;
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

/** 跟着素材走、能自动补的几路(玩家台词不补,和今天一样:预设里放了才有) */
const AUTO_KINDS = ['sprite', 'bg', 'bgm', 'cg'] as const;

/** 这次要补哪几块:AI 模式、有素材、当前编排组里完全没有(有但关着是你的选择,不补) */
export function autoBlocksFor(order: readonly PresetOrderEntry[], jevKinds: JevKinds, o: AutoFill): AutoBlock[] {
  if (!o.enabled) return [];
  const present = new Set(order.map((e) => e.identifier));
  const out: AutoBlock[] = [];
  for (const kind of AUTO_KINDS) {
    const id = PLUGIN[kind].blockId;
    const block = o.blocks[id];
    if (!block || present.has(id) || jevKinds[kind] || !o.material[kind]) continue;
    out.push({ identifier: id, name: block.name, reason: o.configuredJev[kind] ? 'no-key' : 'ai' });
  }
  const lang = o.blocks[LANG_BLOCK_ID];
  if (o.lang && lang && !present.has(LANG_BLOCK_ID)) out.push({ identifier: LANG_BLOCK_ID, name: lang.name, reason: 'ai' });
  return out;
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
  // 关掉的那几路和 Jev 标的一样处理:不归 AI 写
  const gone = o.offKinds ? withOff(o.jevKinds, o.offKinds) : o.jevKinds;
  const auto = o.autoFill && o.preset ? autoBlocksFor(o.order, gone, o.autoFill) : [];
  const filled =
    auto.length > 0 && o.preset && o.autoFill
      ? withAutoBlocks(o.preset, o.order, auto, o.autoFill)
      : { preset: o.preset, order: o.order };
  const jevOn = anyJev(gone);
  const tagFreeLang = wantsTagFreeLang(gone, filled.order);
  return {
    preset:
      tagFreeLang && filled.preset
        ? {
            ...filled.preset,
            prompts: filled.preset.prompts.map((p) =>
              p.identifier === LANG_BLOCK_ID ? { ...p, content: jevLangPrompt(p.content, o.vnKinds) } : p,
            ),
          }
        : filled.preset,
    order: jevOn ? jevOrder(filled.order, gone) : filled.order,
    stripKinds: jevOn ? jevTagKinds(gone, o.vnKinds) : null,
    auto,
    lastUserTurn: o.autoFill?.lastUserTurn ? auto.map((a) => a.identifier) : [],
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
