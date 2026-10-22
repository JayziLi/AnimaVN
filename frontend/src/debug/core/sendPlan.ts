/**
 * 每个插件块这次发不发(素材架构第 2 步,设计稿 12.1「10-16 第 2 步」):发 / 精简版 / 自动补 / 不发 + 原因。
 * 组装(core/assembly.ts 的 pluginAssemblyPass)照它补块、关块、换外语块的正文;以后预设左栏、插件抽屉也读它,
 * 显示的和发出去的是同一回事。
 *
 * 规则(从上往下,先中先停):
 * - 立绘 / 背景 / BGM / CG:插件开关关着 → 不发(off);这一路 Jev 标(有 key)→ 不发(jev);
 *   这张卡没有这一路能用的素材 → 不发(no-material);在编排里开着 → 发(选了 Jev 但没 key 时原因是 no-key);
 *   在编排里关着 → 不发(user-off);不在编排里、开着自动补块 → 自动补(上面三种不发的不补)。
 * - 外语:没有主声音 → 不发(lang-no-voice);主声音不是日语 → 不发(lang-not-ja);在编排里关着 → 不发(user-off);
 *   在编排里开着 → 这次一块标签块都没发时发精简版(lang-trim),否则照发;不在编排里、开着自动补块 → 自动补
 *   (精简版同上)。
 * - 别替玩家说话:在编排里开着 → 发;关着 → 不发(user-off);不在编排里、开着自动补块 → 自动补。
 *   不看 Jev、插件开关、素材。
 * 只列在编排里的和这次自动补的,按插件块的先后(PLUGIN_BLOCK_IDS)。
 */

import type { PresetOrderEntry } from '../lib/presetParser';
import type { JevKinds } from '../plugins/jev';
import { isJaLang, LANG_BLOCK_ID } from '../plugins/lang';
import { PLUGIN } from '../plugins/registry';

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

export type SendState = 'send' | 'short' | 'auto' | 'skip';
export type SendReason =
  | 'normal' // 预设里开着,照发
  | 'no-key' // 选了 Jev 但没 key:按 AI 写发
  | 'jev' // 这一路 Jev 标
  | 'off' // 左栏开关关着
  | 'no-material' // 这张卡没有这一路能用的素材
  | 'user-off' // 预设里关着
  | 'lang-no-voice' // 外语:没有主声音
  | 'lang-not-ja' // 外语:主声音不是日语
  | 'lang-trim' // 外语:精简版(这次一块标签块都没发)
  | 'auto-fill'; // 预设里没有,这次自动补

export interface BlockSend {
  identifier: string;
  plugin: 'sprite' | 'bg' | 'bgm' | 'cg' | 'lang' | 'player';
  state: SendState;
  reason: SendReason;
  /** auto 的外语块发的是精简版 */
  short?: boolean;
}

export interface SendPlanInput {
  /** 编排(开关已叠上临时勾选) */
  order: readonly PresetOrderEntry[];
  /** 选的模式 */
  configuredJev: JevKinds;
  /** 按 key 算过的 */
  jevKinds: JevKinds;
  offKinds: JevKinds;
  material: AutoFillMaterial;
  /** 主声音的 text_lang;没有主声音是 null */
  mainVoiceLang: string | null;
  /** core.assembly.autoFill */
  autoFill: boolean;
}

/** 跟着素材走、有标签的四路 */
const TAG_KINDS = ['sprite', 'bg', 'bgm', 'cg'] as const;

/** 只返回「在编排里的」和「这次自动补的」插件块,按 PLUGIN_BLOCK_IDS 的先后 */
export function blockSendPlan(i: SendPlanInput): BlockSend[] {
  const inOrder = (id: string) => i.order.some((e) => e.identifier === id);
  // 同一块在编排里出现几次时,有一次开着就算开着
  const enabled = (id: string) => i.order.some((e) => e.identifier === id && e.enabled);
  const out: BlockSend[] = [];

  for (const kind of TAG_KINDS) {
    const id = PLUGIN[kind].blockId;
    const add = (state: SendState, reason: SendReason) => out.push({ identifier: id, plugin: kind, state, reason });
    const skip = i.offKinds[kind] ? 'off' : i.jevKinds[kind] ? 'jev' : !i.material[kind] ? 'no-material' : null;
    if (skip) {
      if (inOrder(id)) add('skip', skip);
    } else if (inOrder(id)) {
      if (enabled(id)) add('send', i.configuredJev[kind] ? 'no-key' : 'normal');
      else add('skip', 'user-off');
    } else if (i.autoFill) {
      add('auto', 'auto-fill');
    }
  }

  // 外语块讲了标签写在哪:这次一块标签块都没发(四路都不是发 / 自动补)时只发不提标签的精简版
  const tagsSent = out.some((b) => b.state === 'send' || b.state === 'auto');
  const lang = (state: SendState, reason: SendReason, short?: boolean) =>
    out.push({ identifier: LANG_BLOCK_ID, plugin: 'lang', state, reason, ...(short ? { short } : {}) });
  const langSkip = i.mainVoiceLang === null ? 'lang-no-voice' : !isJaLang(i.mainVoiceLang) ? 'lang-not-ja' : null;
  if (langSkip) {
    if (inOrder(LANG_BLOCK_ID)) lang('skip', langSkip);
  } else if (inOrder(LANG_BLOCK_ID)) {
    if (!enabled(LANG_BLOCK_ID)) lang('skip', 'user-off');
    else if (tagsSent) lang('send', 'normal');
    else lang('short', 'lang-trim');
  } else if (i.autoFill) {
    lang('auto', 'auto-fill', !tagsSent);
  }

  const player = PLUGIN.player.blockId;
  const add = (state: SendState, reason: SendReason) => out.push({ identifier: player, plugin: 'player', state, reason });
  if (inOrder(player)) {
    if (enabled(player)) add('send', 'normal');
    else add('skip', 'user-off');
  } else if (i.autoFill) {
    add('auto', 'auto-fill');
  }
  return out;
}

// ── 显示(第 2 步 P4):预设左栏每块的小块、外语页页头、自动补块页的清单。说的都是 blockSendPlan 算出来的 ──

/** 小块旁问号用的说明(components/drawer/tips.ts 的键;问号里的话是定稿,不在这里写) */
export type SendTipKey =
  | 'skip_nokey'
  | 'lang_short'
  | 'auto_fill'
  | 'skip_jev'
  | 'skip_off'
  | 'skip_nomaterial'
  | 'skip_nocg'
  | 'lang_not_ja'
  | 'lang_no_voice'
  | 'skip_user_off';

export interface SendBadge {
  text: string;
  tip: SendTipKey;
  /** note:照发但有说法;auto:自动补的(虚线);skip:这次不发(开关画灰) */
  kind: 'note' | 'auto' | 'skip';
}

const SKIP_TIP: Partial<Record<SendReason, SendTipKey>> = {
  jev: 'skip_jev',
  off: 'skip_off',
  'no-material': 'skip_nomaterial',
  'lang-not-ja': 'lang_not_ja',
  'lang-no-voice': 'lang_no_voice',
};

/** 一块的小块;照预设发的、预设里本来就关着的不加(返回 null) */
export function sendBadge(b: BlockSend): SendBadge | null {
  if (b.state === 'send') return b.reason === 'no-key' ? { text: '先按 AI 写', tip: 'skip_nokey', kind: 'note' } : null;
  if (b.state === 'short') return { text: '精简版', tip: 'lang_short', kind: 'note' };
  if (b.state === 'auto') return { text: b.short ? '自动补 · 精简版' : '自动补', tip: 'auto_fill', kind: 'auto' };
  if (b.reason === 'user-off') return null;
  const tip = b.reason === 'no-material' && b.plugin === 'cg' ? 'skip_nocg' : SKIP_TIP[b.reason];
  return tip ? { text: '这次不发', tip, kind: 'skip' } : null;
}

/** 外语块这次怎么发:发 / 精简版(auto = 预设里没有、这次自动补的),或者不发和为什么(问号的说明,或一句话) */
export type LangStatus =
  | { state: 'send' | 'short'; auto: boolean }
  | { state: 'skip'; why: { tip: SendTipKey } | { text: string } };

export function langStatus(plan: readonly BlockSend[], o: { hasPreset: boolean; mainVoiceLang: string | null }): LangStatus {
  const b = plan.find((x) => x.plugin === 'lang');
  if (b) {
    if (b.state === 'send' || b.state === 'short') return { state: b.state, auto: false };
    if (b.state === 'auto') return { state: b.short ? 'short' : 'send', auto: true };
    if (b.reason === 'user-off') return { state: 'skip', why: { tip: 'skip_user_off' } };
    return { state: 'skip', why: { tip: SKIP_TIP[b.reason] ?? 'skip_user_off' } };
  }
  // 不在编排里、也没自动补
  if (!o.hasPreset) return { state: 'skip', why: { text: '还没选预设。' } };
  if (o.mainVoiceLang === null) return { state: 'skip', why: { tip: 'lang_no_voice' } };
  if (!isJaLang(o.mainVoiceLang)) return { state: 'skip', why: { tip: 'lang_not_ja' } };
  return { state: 'skip', why: { text: '当前预设里没有这一块，自动补块也关着，所以这次不发送。' } };
}

/** 这次自动补的一块(core/assembly.ts 的 AutoBlock) */
export interface AutoBlockInfo {
  identifier: string;
  name: string;
  /** no-key:选的是 Jev,但 Jev 没 key,这次先按 AI 写 */
  reason: 'ai' | 'no-key';
}

/** 自动补块页「{卡}这次会补」:块名 + 说法,按补进去的先后 */
export function autoRows(plan: readonly BlockSend[], auto: readonly AutoBlockInfo[]) {
  return auto.map((a) => {
    const short = plan.some((b) => b.identifier === a.identifier && b.state === 'auto' && b.short);
    const note = ['预设里没有', ...(short ? ['精简版'] : []), ...(a.reason === 'no-key' ? ['先按 AI 写(Jev 还没填 key)'] : [])];
    return { identifier: a.identifier, name: a.name, note: note.join(' · ') };
  });
}

/**
 * 调试台交给预设左栏和插件抽屉的「这次怎么发」(当前聊天这张卡、当前预设):抽屉里看的不是这张卡时,
 * 外语页和自动补块页只写「只看得到当前聊天这张卡的」
 */
export interface SendView {
  /** 这份是哪张卡的(调试台当前那张);null = 没选卡 */
  card: { id: string; name: string } | null;
  /** 当前预设;null = 没选预设 */
  presetName: string | null;
  plan: readonly BlockSend[];
  auto: readonly AutoBlockInfo[];
  mainVoiceLang: string | null;
  /** 外语块:插件模板原文、精简版(plugins/jev.ts 的 jevLangPrompt) */
  lang: { full: string; short: string };
}
