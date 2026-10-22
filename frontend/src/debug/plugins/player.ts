/**
 * 玩家台词 —— 默认叫主模型别替玩家({{user}})说话(设计稿 12.1「10-16 第 2 步」:玩家台词不做设置)。
 *
 * 提示词块 anima_player 叫「别替玩家说话 · 插件」,正文和名字一律是这里的两个常量:块同步不读
 * plugin.player.blockPrompt(库里存着以前的 <我> 模板,数据留着不删)。预设里没有这块时组装自动补上
 * (core/sendPlan.ts),不受 Jev、插件开关、素材影响。
 *
 * 哪句是玩家说的交给 Jev:立绘交给 Jev 时它本来就在判谁说的,顺手认出玩家(jevKinds.player 跟着立绘,
 * plugins/jev.ts 的 chosenJevKinds / liveJevKinds)。认出来的那句前面写 <我>(半角、全角尖括号都认,里面可以夹空格);
 * 切句时这句标成 player、说话人换成玩家名字:不念、不切立绘、不弹选项(规则在 vn/script.ts 的 parseReply 里)。
 * 没有 Jev key 时只靠块里那句话。旧回复里的 <我> 照旧认。
 *
 * 标签不叫 <user>:酒馆的老宏 <USER> 会被换成玩家名字,很多卡也用它指代玩家。
 */

import type { PresetOrderEntry, TavernPreset } from '../lib/presetParser';
import type { TagKind } from '../vn/script';
import {
  insertPluginBlock,
  normalizeTagMode,
  objectOf,
  pluginBlockState,
  type BlockState,
  type TagMode,
} from './common';
import { PLUGIN } from './registry';

export const PLAYER_SETTING_KEY = PLUGIN.player.settingKey;
export const PLAYER_BLOCK_ID = PLUGIN.player.blockId;

export const DEFAULT_PLAYER_BLOCK_PROMPT = `[不替玩家说话]
{{user}} 由玩家自己扮演。不要替 {{user}} 写台词、动作和心理活动，也不要替 {{user}} 做决定。`;

/** 别替玩家说话块在预设里的名字 */
export const PLAYER_BLOCK_NAME = '别替玩家说话 · 插件';

/** 块同步(plugins/common.ts 的 syncPluginBlocks)用的正文和名字:一律是常量 */
export const PLAYER_BLOCK_SYNC: Readonly<Record<string, string>> = { [PLAYER_BLOCK_ID]: DEFAULT_PLAYER_BLOCK_PROMPT };
export const PLAYER_BLOCK_NAMES: Readonly<Record<string, string>> = { [PLAYER_BLOCK_ID]: PLAYER_BLOCK_NAME };

/**
 * 库里 plugin.player 存的设置。第 2 步起都不再用来组装、标注(插件抽屉的旧玩家台词页还读写它,抽屉线会拿掉那一页);
 * 读法不改,存着的数据不删
 */
export interface PlayerPluginConfig {
  /** 以前「加入当前预设」时写进块里的内容;现在块正文一律是 DEFAULT_PLAYER_BLOCK_PROMPT */
  blockPrompt: string;
  /** 以前的 AI 写 <我> / Jev 认出玩家说的台词;现在跟着立绘的模式 */
  mode: TagMode;
  jev: {
    /** 以前:Jev 认出的玩家台词弹成选项;现在不弹 */
    popup: boolean;
  };
}

export const DEFAULT_PLAYER_CONFIG: PlayerPluginConfig = {
  blockPrompt: DEFAULT_PLAYER_BLOCK_PROMPT,
  mode: 'ai',
  jev: { popup: true },
};

/** 后端存的是任意 JSON —— 缺字段或类型不对的就退回默认值 */
export function normalizePlayerConfig(raw: unknown): PlayerPluginConfig {
  const r = objectOf(raw);
  const j = objectOf(r.jev);
  return {
    blockPrompt:
      typeof r.blockPrompt === 'string' ? r.blockPrompt : DEFAULT_PLAYER_CONFIG.blockPrompt,
    mode: normalizeTagMode(r.mode),
    jev: { popup: typeof j.popup === 'boolean' ? j.popup : DEFAULT_PLAYER_CONFIG.jev.popup },
  };
}

export const playerBlockState = (
  preset: TavernPreset | null,
  order: readonly PresetOrderEntry[],
): BlockState => pluginBlockState(preset, order, PLAYER_BLOCK_ID);

/** 把别替玩家说话块加进预设(插在哪见 insertPluginBlock) */
export const insertPlayerBlock = (preset: TavernPreset, groupIndex: number) =>
  insertPluginBlock(preset, groupIndex, {
    identifier: PLAYER_BLOCK_ID,
    name: PLAYER_BLOCK_NAME,
    content: DEFAULT_PLAYER_BLOCK_PROMPT,
  });

/** <我> 标签。模板写死,不给改;带捕获组是因为 extractTags 取 m[1] 当标签名 */
export const playerTagKind = (): TagKind => ({
  kind: 'player',
  pattern: /[<＜]\s*(我)\s*[>＞]/g,
  prefix: '<我',
});
