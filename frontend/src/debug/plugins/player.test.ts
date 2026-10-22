import { describe, expect, it } from 'vitest';
import type { TavernPreset } from '../lib/presetParser';
import { syncPluginBlocks } from './common';
import { DEFAULT_PLAYER_BLOCK_PROMPT, PLAYER_BLOCK_ID, PLAYER_BLOCK_NAME, PLAYER_BLOCK_SYNC, PLAYER_BLOCK_NAMES } from './player';

/** 库里 plugin.player 存着的旧模板(插件抽屉以前能改) */
const OLD = '[玩家台词]\n{{user}} 说的每一句话，都必须以 <我> 开头。';

const presetWith = (name: string, content: string): TavernPreset => ({
  name: 'p',
  prompts: [
    {
      identifier: PLAYER_BLOCK_ID,
      name,
      role: 'system',
      content,
      marker: false,
      systemPrompt: false,
      injectionPosition: 0,
      injectionDepth: 4,
      injectionOrder: 100,
      injectionTrigger: [],
      forbidOverrides: false,
    },
  ],
  orderGroups: [],
  formats: {} as never,
  params: {},
  squashSystemMessages: false,
});

describe('别替玩家说话块', () => {
  it('tells the model not to play the user, and has its new name', () => {
    expect(DEFAULT_PLAYER_BLOCK_PROMPT).toBe(
      '[不替玩家说话]\n{{user}} 由玩家自己扮演。不要替 {{user}} 写台词、动作和心理活动，也不要替 {{user}} 做决定。',
    );
    expect(DEFAULT_PLAYER_BLOCK_PROMPT).not.toContain('<我>');
    expect(PLAYER_BLOCK_NAME).toBe('别替玩家说话 · 插件');
  });

  it('syncs every preset to the constant text and name, whatever the old setting says', () => {
    const synced = syncPluginBlocks(presetWith('玩家台词 · 插件', OLD), PLAYER_BLOCK_SYNC, PLAYER_BLOCK_NAMES);
    expect(synced?.prompts[0]).toMatchObject({ name: PLAYER_BLOCK_NAME, content: DEFAULT_PLAYER_BLOCK_PROMPT });
  });

  it('leaves an already synced preset as the same object', () => {
    const preset = presetWith(PLAYER_BLOCK_NAME, DEFAULT_PLAYER_BLOCK_PROMPT);
    expect(syncPluginBlocks(preset, PLAYER_BLOCK_SYNC, PLAYER_BLOCK_NAMES)).toBe(preset);
  });
});
